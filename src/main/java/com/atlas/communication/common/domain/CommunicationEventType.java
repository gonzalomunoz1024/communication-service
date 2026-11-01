package com.atlas.communication.common.domain;

/** Lifecycle events emitted to live (SSE) subscribers. */
public enum CommunicationEventType {
    SNAPSHOT,
    CREATED,
    UPDATED,
    ACTIVATED,
    EXPIRED,
    RETIRED
}
