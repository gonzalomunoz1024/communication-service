package com.atlas.communication.health.application;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.atlas.communication.health.domain.HealthInstance;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.atlas.communication.health.ports.outbound.HealthInstanceRepositoryPort;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * The health scheduler: every tick, probes monitors whose interval has elapsed and declares
 * silent push-only monitors DOWN once past their staleness window. Each monitor is handled
 * independently; a failure (including a lost claim race on another node) is logged and skipped,
 * and the next tick tries again. Due-ness is decided in memory: monitor counts are small.
 *
 * <p>Staleness has two guards against our own trouble looking like everyone's outage: it is
 * not evaluated for a grace period after this service starts, nor while an implausible share
 * of monitors is silent at the same time. A service whose pods all said goodbye (scaled to
 * zero) is never stale.
 */
@Service
@Slf4j
public class HealthSweepUseCase {

    private static final int CONCURRENCY = 8;

    /** Below this many silence-capable monitors the share rule says nothing. */
    static final int PAUSE_MIN_MONITORS = 3;

    private final HealthMonitorRepositoryPort monitors;
    private final HealthInstanceRepositoryPort instances;
    private final HealthObservationUseCase observation;
    private final HealthProperties properties;
    private final Clock clock;
    private final Instant startedAt;
    private final AtomicBoolean stalePaused = new AtomicBoolean();

    public HealthSweepUseCase(HealthMonitorRepositoryPort monitors, HealthInstanceRepositoryPort instances,
            HealthObservationUseCase observation, HealthProperties properties, Clock clock) {
        this.monitors = monitors;
        this.instances = instances;
        this.observation = observation;
        this.properties = properties;
        this.clock = clock;
        this.startedAt = clock.instant();
    }

    @Scheduled(fixedDelayString = "${communication.health.sweep-interval-ms:5000}",
            initialDelayString = "${communication.health.sweep-interval-ms:5000}")
    public void sweepScheduled() {
        sweep(clock.instant()).block();
    }

    /** Runs one pass; returns the number of monitors evaluated. */
    public Mono<Long> sweep(Instant now) {
        return monitors.findAll(null)
                .collectList()
                .flatMap(all -> {
                    boolean staleAllowed = staleAllowed(all, now);
                    return Flux.fromIterable(all)
                            .flatMap(monitor -> evaluate(monitor, now, staleAllowed), CONCURRENCY)
                            .count();
                })
                .doOnNext(count -> {
                    if (count > 0) {
                        log.debug("health sweep evaluated {} monitor(s)", count);
                    }
                });
    }

    /** The safety valve: false while silence must not be trusted. */
    boolean staleAllowed(List<HealthMonitor> all, Instant now) {
        if (now.isBefore(startedAt.plusMillis(properties.staleGraceAfterStartMs()))) {
            return false;
        }
        long capable = all.stream()
                .filter(m -> m.pushOnly() && m.policy().staleAfterSeconds() != null)
                .count();
        long stale = all.stream().filter(m -> m.stale(now)).count();
        boolean pause = capable >= PAUSE_MIN_MONITORS && stale > capable * properties.stalePauseFraction();
        if (stalePaused.compareAndSet(!pause, pause)) {
            if (pause) {
                log.warn("{} of {} push-only monitors are silent at once; not declaring them DOWN until"
                        + " some report again (can the clusters reach this service?)", stale, capable);
            } else {
                log.info("staleness evaluation resumed");
            }
        }
        return !pause;
    }

    private Mono<HealthMonitor> evaluate(HealthMonitor monitor, Instant now, boolean staleAllowed) {
        Mono<HealthMonitor> work;
        if (monitor.probeDue(now)) {
            work = observation.probe(monitor, now);
        } else if (staleAllowed && monitor.stale(now)) {
            work = observeStale(monitor, now);
        } else {
            return Mono.empty();
        }
        return work.onErrorResume(ex -> {
            log.warn("skipping monitor {} ({}/{}): {}", monitor.id(), monitor.tenantId(),
                    monitor.service(), ex.getMessage());
            return Mono.empty();
        });
    }

    /**
     * A silent service is DOWN, unless it reports per instance and every instance left
     * cleanly: then it was scaled to zero on purpose and there is nothing to say.
     */
    private Mono<HealthMonitor> observeStale(HealthMonitor monitor, Instant now) {
        return instances.findByMonitor(monitor.id())
                .collectList()
                .flatMap(known -> {
                    if (known.isEmpty()) {
                        return observation.observe(monitor, stale(
                                "no health report received since " + monitor.staleBaseline(), now), now);
                    }
                    long present = known.stream().filter(i -> !i.left()).count();
                    if (present == 0) {
                        log.debug("monitor {} ({}/{}): every pod left cleanly; not stale", monitor.id(),
                                monitor.tenantId(), monitor.service());
                        return Mono.empty();
                    }
                    return observation.observe(monitor, stale(present
                            + (present == 1 ? " pod has" : " pods have")
                            + " not reported since " + monitor.staleBaseline()
                            + " (" + names(known) + ")", now), now);
                });
    }

    private static HealthReport stale(String message, Instant now) {
        return HealthReport.of(HealthStatus.DOWN, message, HealthSource.STALE, now);
    }

    private static String names(List<HealthInstance> known) {
        List<String> ids = known.stream().filter(i -> !i.left()).map(HealthInstance::instanceId).toList();
        String head = String.join(", ", ids.subList(0, Math.min(ids.size(), 5)));
        return ids.size() > 5 ? head + " +" + (ids.size() - 5) + " more" : head;
    }
}
