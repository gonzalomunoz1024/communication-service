package com.atlas.communication.common.domain;

import java.time.Instant;

/**
 * A lifecycle event carrying the full communication payload. {@code seq} is a global monotonic
 * sequence number from the shared event log, used as the SSE event id: clients order by it and
 * resume from it with {@code Last-Event-ID}. Snapshot frames carry the log position at the time
 * of the snapshot.
 */
public record CommunicationEvent(long seq, CommunicationEventType type, Instant at,
        Communication communication) {
}
