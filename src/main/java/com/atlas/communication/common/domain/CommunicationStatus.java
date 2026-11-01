package com.atlas.communication.common.domain;

/**
 * Stored lifecycle status. Time-based states (SCHEDULED/ACTIVE/EXPIRED) are additionally
 * derived at read time via {@link Communication#effectiveStatus} so reads never depend on
 * how recently the background sweeper ran.
 */
public enum CommunicationStatus {
    DRAFT,
    SCHEDULED,
    ACTIVE,
    EXPIRED,
    RETIRED;

    public boolean terminal() {
        return this == EXPIRED || this == RETIRED;
    }
}
