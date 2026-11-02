package com.atlas.communication.health.application;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
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
 * (and number) of monitors is silent at the same time. A service whose pods all said goodbye
 * (scaled to zero) is never stale, and does not count towards that share either.
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
                .flatMap(all -> silence(all, now)
                        .flatMap(silence -> Flux.fromIterable(all)
                                .flatMap(monitor -> evaluate(monitor, now, silence), CONCURRENCY)
                                .count()))
                .doOnNext(count -> {
                    if (count > 0) {
                        log.debug("health sweep evaluated {} monitor(s)", count);
                    }
                });
    }

    /**
     * What one pass knows about silence: the instance records of every stale monitor, loaded
     * once, and whether silence may be trusted at all.
     */
    record Silence(Map<String, List<HealthInstance>> instancesOfStale, boolean allowed) {

        List<HealthInstance> instancesOf(HealthMonitor monitor) {
            return instancesOfStale.getOrDefault(monitor.id(), List.of());
        }
    }

    /** Every pod said goodbye: the service was scaled to zero on purpose, not lost. */
    static boolean scaledToZero(List<HealthInstance> known) {
        return !known.isEmpty() && known.stream().allMatch(HealthInstance::left);
    }

    /**
     * The safety valve: silence is not trusted during the startup grace, nor while an
     * implausible share of the monitors that can go stale are silent together. Services scaled
     * to zero are silent by design and count on neither side, and fewer than
     * {@code stalePauseMinSilent} silent services never pause anything.
     */
    Mono<Silence> silence(List<HealthMonitor> all, Instant now) {
        if (now.isBefore(startedAt.plusMillis(properties.staleGraceAfterStartMs()))) {
            return Mono.just(new Silence(Map.of(), false));
        }
        List<HealthMonitor> stale = all.stream().filter(m -> m.stale(now)).toList();
        return Flux.fromIterable(stale)
                .flatMap(m -> instances.findByMonitor(m.id()).collectList()
                        .map(known -> Map.entry(m.id(), known)), CONCURRENCY)
                .collectMap(Map.Entry::getKey, Map.Entry::getValue)
                .map(known -> {
                    long scaled = stale.stream().filter(m -> scaledToZero(known.get(m.id()))).count();
                    long silent = stale.size() - scaled;
                    long capable = all.stream()
                            .filter(m -> m.pushOnly() && m.policy().staleAfterSeconds() != null)
                            .count() - scaled;
                    boolean pause = capable >= PAUSE_MIN_MONITORS
                            && silent >= properties.stalePauseMinSilent()
                            && silent > capable * properties.stalePauseFraction();
                    if (stalePaused.compareAndSet(!pause, pause)) {
                        if (pause) {
                            log.warn("{} of {} push-only monitors are silent at once; not declaring them DOWN"
                                    + " until some report again (can the clusters reach this service?)",
                                    silent, capable);
                        } else {
                            log.info("staleness evaluation resumed");
                        }
                    }
                    return new Silence(known, !pause);
                });
    }

    private Mono<HealthMonitor> evaluate(HealthMonitor monitor, Instant now, Silence silence) {
        Mono<HealthMonitor> work;
        if (monitor.probeDue(now)) {
            work = observation.probe(monitor, now);
        } else if (silence.allowed() && monitor.stale(now)) {
            work = observeStale(monitor, silence.instancesOf(monitor), now);
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
    private Mono<HealthMonitor> observeStale(HealthMonitor monitor, List<HealthInstance> known, Instant now) {
        if (known.isEmpty()) {
            return observation.observe(monitor, stale(
                    "no health report received since " + monitor.staleBaseline(), now), now);
        }
        if (scaledToZero(known)) {
            log.debug("monitor {} ({}/{}): every pod left cleanly; not stale", monitor.id(),
                    monitor.tenantId(), monitor.service());
            return Mono.empty();
        }
        long present = known.stream().filter(i -> !i.left()).count();
        return observation.observe(monitor, stale(present
                + (present == 1 ? " pod has" : " pods have")
                + " not reported since " + monitor.staleBaseline()
                + " (" + names(known) + ")", now), now);
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
