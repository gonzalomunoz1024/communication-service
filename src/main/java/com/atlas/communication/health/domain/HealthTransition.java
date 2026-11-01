package com.atlas.communication.health.domain;

/** What an observation means for the monitor's open communication, if any. */
public enum HealthTransition {
    /** Nothing to publish: healthy, below threshold, or unchanged. */
    NONE,
    /** Threshold crossed with nothing open: publish a new notice. */
    OPEN,
    /** Same kind of problem, different failing components: update the open notice in place. */
    UPDATE,
    /** Recovered for long enough: retire the open notice. */
    RESOLVE,
    /** Problem changed kind (DOWN <-> DEGRADED): retire the open notice and publish a new one. */
    REPLACE
}
