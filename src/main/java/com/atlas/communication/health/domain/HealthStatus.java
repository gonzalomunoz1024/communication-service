package com.atlas.communication.health.domain;

import java.util.Locale;

/**
 * Normalized health of a monitored service. Spring Actuator's vocabulary (UP, DOWN,
 * OUT_OF_SERVICE, UNKNOWN) maps onto it; any custom status that is neither clearly up nor
 * clearly down (WARN, DEGRADED, PARTIAL, ...) is treated as DEGRADED.
 */
public enum HealthStatus {
    UP,
    DEGRADED,
    DOWN,
    UNKNOWN;

    /** Maps an Actuator-style status code; null/blank is UNKNOWN, unrecognised codes are DEGRADED. */
    public static HealthStatus fromCode(String code) {
        if (code == null || code.isBlank()) {
            return UNKNOWN;
        }
        return switch (code.trim().toUpperCase(Locale.ROOT)) {
            case "UP", "OK", "HEALTHY" -> UP;
            case "DOWN", "OUT_OF_SERVICE", "FATAL", "UNHEALTHY" -> DOWN;
            case "UNKNOWN" -> UNKNOWN;
            default -> DEGRADED;
        };
    }

    public boolean healthy() {
        return this == UP;
    }

    /** DOWN or DEGRADED: something a consumer should hear about. */
    public boolean unhealthy() {
        return this == DOWN || this == DEGRADED;
    }
}
