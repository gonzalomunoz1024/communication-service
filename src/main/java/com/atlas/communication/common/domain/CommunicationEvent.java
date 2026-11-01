package com.atlas.communication.common.domain;

import java.time.Instant;

/**
 * A lifecycle event carrying the full communication payload. {@code seq} is a
 * process-local monotonic sequence used as the SSE event id for client-side ordering.
 */
public record CommunicationEvent(long seq, CommunicationEventType type, Instant at,
        Communication communication) {
}
