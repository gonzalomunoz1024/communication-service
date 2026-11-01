package com.atlas.communication.health.application;

import java.time.Clock;
import java.time.Instant;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Mono;

/**
 * The health scheduler: every tick, probes monitors whose interval has elapsed and declares
 * silent push-only monitors DOWN once past their staleness window. Each monitor is handled
 * independently; a failure (including a lost claim race on another node) is logged and skipped,
 * and the next tick tries again. Due-ness is decided in memory: monitor counts are small.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class HealthSweepUseCase {

    private static final int CONCURRENCY = 8;

    private final HealthMonitorRepositoryPort monitors;
    private final HealthObservationUseCase observation;
    private final Clock clock;

    @Scheduled(fixedDelayString = "${communication.health.sweep-interval-ms:5000}",
            initialDelayString = "${communication.health.sweep-interval-ms:5000}")
    public void sweepScheduled() {
        sweep(clock.instant()).block();
    }

    /** Runs one pass; returns the number of monitors evaluated. */
    public Mono<Long> sweep(Instant now) {
        return monitors.findAll(null)
                .flatMap(monitor -> evaluate(monitor, now), CONCURRENCY)
                .count()
                .doOnNext(count -> {
                    if (count > 0) {
                        log.debug("health sweep evaluated {} monitor(s)", count);
                    }
                });
    }

    private Mono<HealthMonitor> evaluate(HealthMonitor monitor, Instant now) {
        Mono<HealthMonitor> work;
        if (monitor.probeDue(now)) {
            work = observation.probe(monitor, now);
        } else if (monitor.stale(now)) {
            HealthReport stale = HealthReport.of(HealthStatus.DOWN,
                    "no health report received since " + monitor.staleBaseline(),
                    HealthSource.STALE, now);
            work = observation.observe(monitor, stale, now);
        } else {
            return Mono.empty();
        }
        return work.onErrorResume(ex -> {
            log.warn("skipping monitor {} ({}/{}): {}", monitor.id(), monitor.tenantId(),
                    monitor.service(), ex.getMessage());
            return Mono.empty();
        });
    }
}
