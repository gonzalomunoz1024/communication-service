package com.atlas.communication.common.ports.outbound;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Lifecycle event log feeding SSE subscribers on every instance. Events carry a global,
 * monotonic sequence number that doubles as the SSE event id, so a subscriber that remembers
 * the last id it saw can resume exactly where it left off.
 */
public interface CommunicationEventsPort {

    /**
     * Appends an event (assigning the next sequence number) so every instance fans it out.
     * Failures are logged, not propagated: the communication itself is already saved and the
     * pull feed stays correct, only live subscribers would miss the event.
     */
    Mono<CommunicationEvent> emit(CommunicationEventType type, Communication communication);

    /** Hot stream of events from now on, from every instance. No replay. */
    Flux<CommunicationEvent> stream();

    /**
     * Every retained event of the tenant after {@code afterSeq}, in order, then live events as
     * they happen, each exactly once.
     */
    Flux<CommunicationEvent> streamAfter(String tenantId, long afterSeq);

    /**
     * Whether the log still holds everything after {@code seq}: false for an id it never issued
     * (a future one, or one from before a reset) and once retention has removed part of the gap.
     */
    Mono<Boolean> canResumeAfter(long seq);

    /**
     * Sequence number of the last event this instance has fanned out. A subscriber that
     * remembers it misses nothing when it later calls {@link #streamAfter}.
     */
    long position();
}
