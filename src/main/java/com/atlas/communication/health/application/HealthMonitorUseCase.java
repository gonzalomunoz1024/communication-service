package com.atlas.communication.health.application;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.health.domain.HealthInstance;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReportCommand;
import com.atlas.communication.health.domain.HealthRollup;
import com.atlas.communication.health.domain.RegisterMonitorCommand;
import com.atlas.communication.health.ports.inbound.HealthInboundPort;
import com.atlas.communication.health.ports.outbound.HealthInstanceRepositoryPort;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

/**
 * Monitor lifecycle plus the two entry points of Flow 2: pushed reports and on-demand probes.
 *
 * <p>A report that names its instance (one pod of a service) is stored per instance and the
 * service's status is rolled up from every live instance before the monitor's state machine
 * sees it; see {@link HealthRollup}. Pods of one service report independently, so two of them
 * can collide on the monitor's version check: a report is retried a couple of times on a
 * conflict before the caller hears about it.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class HealthMonitorUseCase implements HealthInboundPort {

    /** How many times one report is applied before a persistent conflict is returned. */
    static final int REPORT_ATTEMPTS = 3;

    private final HealthMonitorRepositoryPort monitors;
    private final HealthInstanceRepositoryPort instances;
    private final HealthObservationUseCase observation;
    private final HealthProperties properties;
    private final Clock clock;

    @Override
    public Mono<HealthMonitor> register(RegisterMonitorCommand cmd) {
        return Mono.defer(() -> {
            Instant now = clock.instant();
            HealthMonitor monitor = HealthMonitor.create(UUID.randomUUID().toString(),
                    cmd.tenantId(), cmd.service(), cmd.url(), policyFrom(cmd), now);
            return monitors.save(monitor);
        });
    }

    @Override
    public Mono<HealthMonitor> get(String id) {
        return monitors.findById(id).switchIfEmpty(Mono.error(
                new ResponseStatusException(HttpStatus.NOT_FOUND, "monitor " + id + " not found")));
    }

    @Override
    public Flux<HealthMonitor> list(String tenantId) {
        return monitors.findAll(tenantId);
    }

    @Override
    public Flux<HealthInstance> instances(String id) {
        return get(id).flatMapMany(monitor -> instances.findByMonitor(monitor.id()));
    }

    @Override
    public Mono<Void> delete(String id) {
        return get(id)
                .flatMap(monitor -> observation.close(monitor, "monitor deleted", clock.instant()))
                .flatMap(monitor -> instances.deleteByMonitor(id).then(monitors.deleteById(id)))
                .then();
    }

    @Override
    public Mono<HealthMonitor> report(HealthReportCommand cmd) {
        return Mono.defer(() -> {
            Instant now = clock.instant();
            return monitors.findByTenantAndService(cmd.tenantId(), cmd.service())
                    .switchIfEmpty(Mono.defer(() -> autoRegister(cmd)))
                    .flatMap(monitor -> cmd.instance() == null
                            ? observation.observe(monitor, cmd.toReport(now), now)
                            : observeInstance(monitor, cmd, now));
        }).retryWhen(Retry.max(REPORT_ATTEMPTS - 1L)
                .filter(HealthMonitorUseCase::concurrentModification)
                .doBeforeRetry(signal -> log.debug("report for {}/{} hit a concurrent update; retrying",
                        cmd.tenantId(), cmd.service()))
                .onRetryExhaustedThrow((spec, signal) -> signal.failure()));
    }

    @Override
    public Mono<HealthMonitor> probeNow(String id) {
        return get(id).flatMap(monitor -> {
            if (monitor.pushOnly()) {
                return Mono.error(new ResponseStatusException(HttpStatus.CONFLICT,
                        "monitor " + id + " is push-only (no url) and cannot be probed"));
            }
            return observation.probe(monitor, clock.instant());
        });
    }

    /** Records the instance's report, then evaluates the service status rolled up from all of them. */
    private Mono<HealthMonitor> observeInstance(HealthMonitor monitor, HealthReportCommand cmd, Instant now) {
        HealthInstance record = HealthInstance.from(monitor.id(), cmd.instance(), cmd.toReport(now), now);
        return instances.save(record)
                .thenMany(instances.findByMonitor(monitor.id()))
                .collectList()
                .flatMap(known -> {
                    HealthRollup rollup = HealthRollup.of(known, staleWindow(monitor),
                            monitor.policy().minHealthyPercent(), now);
                    return observation.observe(monitor, rollup.toReport(now), now);
                });
    }

    /** An instance is live while heard from within the monitor's staleness window. */
    private int staleWindow(HealthMonitor monitor) {
        Integer configured = monitor.policy().staleAfterSeconds();
        return configured == null ? properties.defaults().instanceStaleAfterSeconds() : configured;
    }

    private static boolean concurrentModification(Throwable ex) {
        return ex instanceof ResponseStatusException rse && rse.getStatusCode() == HttpStatus.CONFLICT;
    }

    /**
     * First push from an unknown service registers a push-only monitor with default policy. A
     * service that reports per instance gets the instance staleness window, so a fleet that
     * goes silent is declared DOWN.
     */
    private Mono<HealthMonitor> autoRegister(HealthReportCommand cmd) {
        Integer staleAfterSeconds = cmd.instance() == null ? null
                : properties.defaults().instanceStaleAfterSeconds();
        RegisterMonitorCommand register = new RegisterMonitorCommand(cmd.tenantId(), cmd.service(),
                null, cmd.publisher(), null, null, null, null, null, null, null, staleAfterSeconds, null);
        return register(register)
                // lost a race with a concurrent first report: use the winner's monitor
                .onErrorResume(ResponseStatusException.class,
                        ex -> ex.getStatusCode() == HttpStatus.CONFLICT
                                ? monitors.findByTenantAndService(cmd.tenantId(), cmd.service())
                                : Mono.error(ex));
    }

    private HealthMonitor.Policy policyFrom(RegisterMonitorCommand cmd) {
        HealthMonitor.Policy d = properties.defaults().asPolicy();
        return new HealthMonitor.Policy(
                cmd.publisher() == null || cmd.publisher().isBlank() ? d.publisher() : cmd.publisher(),
                cmd.intervalSeconds() == null ? d.intervalSeconds() : cmd.intervalSeconds(),
                cmd.timeoutMs() == null ? d.timeoutMs() : cmd.timeoutMs(),
                cmd.failureThreshold() == null ? d.failureThreshold() : cmd.failureThreshold(),
                cmd.recoveryThreshold() == null ? d.recoveryThreshold() : cmd.recoveryThreshold(),
                cmd.downSeverity() == null ? d.downSeverity() : cmd.downSeverity(),
                cmd.degradedSeverity() == null ? d.degradedSeverity() : cmd.degradedSeverity(),
                cmd.audience() == null ? d.audience() : cmd.audience(),
                cmd.staleAfterSeconds(),
                cmd.minHealthyPercent() == null ? d.minHealthyPercent() : cmd.minHealthyPercent());
    }
}
