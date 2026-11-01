package com.atlas.communication.publishing.application;

import java.time.Clock;
import java.time.Instant;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.ports.outbound.CommunicationEventsPort;
import com.atlas.communication.common.ports.outbound.CommunicationRepositoryPort;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Converges stored status with reality: SCHEDULED items whose window opened become ACTIVE,
 * ACTIVE items past expiry become EXPIRED — each persisted and announced to SSE subscribers.
 * Feed correctness never depends on this job (reads filter by time); it exists so stored
 * state converges and live subscribers get push events. Save conflicts are skipped: another
 * node already won that transition.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StatusSweepUseCase {

    private final CommunicationRepositoryPort repository;
    private final CommunicationEventsPort events;
    private final Clock clock;

    @Scheduled(fixedDelayString = "${communication.sweep.interval-ms}")
    public void sweepScheduled() {
        sweep(clock.instant()).block();
    }

    /** Runs one sweep pass; returns the number of transitions applied. */
    public Mono<Long> sweep(Instant now) {
        Flux<Communication> activations = repository.dueForActivation(now)
                .concatMap(c -> transition(c, CommunicationStatus.ACTIVE,
                        CommunicationEventType.ACTIVATED, now));
        Flux<Communication> expirations = repository.dueForExpiry(now)
                .concatMap(c -> transition(c, CommunicationStatus.EXPIRED,
                        CommunicationEventType.EXPIRED, now));
        return activations.concatWith(expirations).count()
                .doOnNext(count -> {
                    if (count > 0) {
                        log.info("sweep applied {} status transition(s)", count);
                    }
                });
    }

    private Mono<Communication> transition(Communication communication, CommunicationStatus target,
            CommunicationEventType eventType, Instant now) {
        return repository.save(communication.withStatus(target, "sweeper", now))
                .doOnNext(saved -> events.emit(eventType, saved))
                .onErrorResume(ex -> {
                    log.warn("skipping sweep transition {} -> {} for {}: {}",
                            communication.status(), target, communication.id(), ex.getMessage());
                    return Mono.empty();
                });
    }
}
