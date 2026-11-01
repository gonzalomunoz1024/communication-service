package com.atlas.communication.common.adapters.outbound;

import reactor.core.publisher.Mono;

/** Global, monotonic sequence numbers for the event log, shared by every instance. */
public interface EventSequence {

    /** Allocates the next number (first is 1). */
    Mono<Long> next();

    /** The last number allocated, 0 when none has been. */
    Mono<Long> current();
}
