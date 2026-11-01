package com.atlas.communication.health.application;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.health.domain.HealthEvaluation;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthNotice;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;
import com.atlas.communication.health.ports.outbound.HealthProbePort;
import com.atlas.communication.publishing.application.PublishingUseCase;
import com.atlas.communication.publishing.domain.CreateCommunicationCommand;
import com.atlas.communication.publishing.domain.RetireRequest;
import com.atlas.communication.publishing.domain.UpdateCommunicationCommand;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Mono;

/**
 * Applies a health observation: runs the monitor's state machine, then publishes, updates or
 * retires communications through the ordinary publishing rules, so consumers see automated
 * notices exactly like human ones (same feed, SSE events and audit history).
 *
 * <p>Opening a notice claims it first: the monitor is saved with the new communication id
 * (optimistic version check) before the communication is created. Two nodes evaluating the
 * same monitor concurrently therefore cannot both publish; the loser's save conflicts and its
 * evaluation is dropped. Resolving and updating are idempotent, so they act first and save
 * after.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class HealthObservationUseCase {

    /** Audit actor for everything the monitor does on a communication. */
    public static final String ACTOR = "health-monitor";

    private final HealthMonitorRepositoryPort monitors;
    private final HealthProbePort probes;
    private final PublishingUseCase publishing;

    /** Probes a monitor's URL and applies the result. */
    public Mono<HealthMonitor> probe(HealthMonitor monitor, Instant now) {
        return probes.probe(monitor.url(), Duration.ofMillis(monitor.policy().timeoutMs()), now)
                .flatMap(report -> observe(monitor, report, now));
    }

    /** Applies one observation and persists the monitor; returns the persisted monitor. */
    public Mono<HealthMonitor> observe(HealthMonitor monitor, HealthReport report, Instant now) {
        HealthEvaluation evaluation = monitor.evaluate(report, now);
        HealthMonitor next = evaluation.monitor();
        return switch (evaluation.transition()) {
            case NONE -> monitors.save(next);
            case OPEN -> open(next, report, now);
            case REPLACE -> replace(next, report, now);
            case UPDATE -> update(next, report, now).flatMap(monitors::save);
            case RESOLVE -> resolve(next, "recovered: " + report.summary(), now).flatMap(monitors::save);
        };
    }

    /** Retires whatever the monitor has open (used when a monitor is deleted). */
    public Mono<HealthMonitor> close(HealthMonitor monitor, String note, Instant now) {
        return monitor.state().hasOpen() ? resolve(monitor, note, now) : Mono.just(monitor);
    }

    private Mono<HealthMonitor> open(HealthMonitor next, HealthReport report, Instant now) {
        HealthMonitor claimed = next.withOpen(UUID.randomUUID().toString(),
                report.effectiveStatus(), report.signature());
        return monitors.save(claimed)
                .flatMap(saved -> create(saved, report)
                        .thenReturn(saved)
                        .onErrorResume(ex -> rollbackClaim(saved, ex)));
    }

    private Mono<HealthMonitor> replace(HealthMonitor next, HealthReport report, Instant now) {
        String previous = next.state().openCommunicationId();
        HealthMonitor claimed = next.withOpen(UUID.randomUUID().toString(),
                report.effectiveStatus(), report.signature());
        return monitors.save(claimed)
                .flatMap(saved -> retire(previous, "reclassified as " + report.effectiveStatus()
                        + ": " + report.summary(), now)
                        .then(create(saved, report))
                        .thenReturn(saved)
                        .onErrorResume(ex -> rollbackClaim(saved, ex)));
    }

    private Mono<HealthMonitor> update(HealthMonitor next, HealthReport report, Instant now) {
        String id = next.state().openCommunicationId();
        HealthNotice notice = HealthNotice.from(next, report);
        HealthMonitor marked = next.withOpenSignature(report.signature());
        return publishing.get(id)
                .flatMap(current -> {
                    if (current.status().terminal()) {
                        // An operator closed the auto notice by hand: respect it and start over.
                        log.info("notice {} for monitor {} was closed externally; clearing",
                                id, next.id());
                        return Mono.just(next.withClosedByOperator());
                    }
                    UpdateCommunicationCommand cmd = new UpdateCommunicationCommand(
                            notice.severity(), notice.title(), notice.body(), null, null,
                            null, null, null, ACTOR, current.version());
                    return publishing.update(id, cmd).thenReturn(marked);
                })
                .onErrorResume(ResponseStatusException.class, ex -> {
                    if (ex.getStatusCode() == HttpStatus.NOT_FOUND) {
                        // Purged by an admin: re-create under the claimed id so state stays coherent.
                        return create(marked, report).thenReturn(marked);
                    }
                    log.warn("could not update notice {} for monitor {}: {}", id, next.id(), ex.getReason());
                    return Mono.just(next);
                });
    }

    private Mono<HealthMonitor> resolve(HealthMonitor next, String note, Instant now) {
        return retire(next.state().openCommunicationId(), note, now).thenReturn(next.withClosed());
    }

    private Mono<Communication> create(HealthMonitor monitor, HealthReport report) {
        HealthNotice notice = HealthNotice.from(monitor, report);
        CreateCommunicationCommand cmd = new CreateCommunicationCommand(monitor.tenantId(),
                monitor.policy().publisher(), notice.type(), notice.severity(), notice.title(),
                notice.body(), List.of(monitor.service()), monitor.policy().audience(), false,
                null, null, null, monitor.externalRef());
        return publishing.create(monitor.state().openCommunicationId(), cmd)
                .doOnNext(c -> log.info("monitor {} opened {} {} for {}/{}", monitor.id(),
                        c.type(), c.id(), monitor.tenantId(), monitor.service()));
    }

    /** Retire tolerant of a notice that is already gone or terminal (nothing left to do). */
    private Mono<Void> retire(String id, String note, Instant now) {
        return publishing.retire(id, new RetireRequest(ACTOR, note))
                .doOnNext(c -> log.info("retired notice {}: {}", id, note))
                .onErrorResume(ResponseStatusException.class, ex -> {
                    if (ex.getStatusCode() == HttpStatus.NOT_FOUND
                            || ex.getStatusCode() == HttpStatus.CONFLICT) {
                        log.info("notice {} needs no retire: {}", id, ex.getReason());
                        return Mono.empty();
                    }
                    return Mono.error(ex);
                })
                .then();
    }

    private Mono<HealthMonitor> rollbackClaim(HealthMonitor claimed, Throwable cause) {
        log.error("publishing notice for monitor {} failed after claim; releasing claim: {}",
                claimed.id(), cause.getMessage());
        return monitors.save(claimed.withClosed())
                .onErrorResume(saveEx -> {
                    log.error("could not release claim for monitor {}: {}", claimed.id(), saveEx.getMessage());
                    return Mono.empty();
                })
                .then(Mono.error(cause));
    }
}
