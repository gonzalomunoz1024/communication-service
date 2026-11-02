package com.atlas.communication.common.ports.outbound;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Lifecycle event log feeding SSE subscribers on every instance. Events carry a global,
 * monotonic sequence number that doubles as the SSE event id, so a subscriber that remembers
 * the last id it saw can resume where it left off: live events come exactly once, a snapshot's
 * id (the {@link #head()} when it was taken) may replay what the snapshot already showed.
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
     * Sequence number of the last event in the log (0 while it is empty), read from the store
     * rather than from this instance's fan-out cursor, which can trail it by one poll. A snapshot
     * taken after this read and stamped with it can be resumed from with {@link #streamAfter}
     * without skipping anything: at worst an event whose change the snapshot already showed
     * comes again.
     */
    Mono<Long> head();
}
