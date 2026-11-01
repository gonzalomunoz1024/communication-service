package com.atlas.communication.health.domain;

/** Where a health observation came from. */
public enum HealthSource {
    /** The service probed a health endpoint (pull). */
    PROBE,
    /** The monitored service reported its own health (push). */
    PUSH,
    /** Synthesized: a push-only service has been silent longer than its staleness window. */
    STALE
}
