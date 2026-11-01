package com.atlas.communication.common.ports.outbound;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;

import reactor.core.publisher.Flux;

/**
 * In-process lifecycle event bus feeding SSE subscribers. Single-node by design in v1;
 * a Mongo change-stream or broker adapter can replace it behind the same port.
 */
public interface CommunicationEventsPort {

    /** Builds (assigning the next sequence number) and emits an event. */
    CommunicationEvent emit(CommunicationEventType type, Communication communication);

    /** Hot stream of events from subscription time onward (no replay). */
    Flux<CommunicationEvent> stream();
}
