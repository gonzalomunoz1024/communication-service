package com.atlas.communication.health.domain;

import java.util.Locale;

/**
 * Normalized health of a monitored service. Spring Actuator's vocabulary (UP, DOWN,
 * OUT_OF_SERVICE, UNKNOWN) maps onto it, and so do the words other health checks use, the same
 * way the health sidecar's {@code Normalize} reads them: the sidecar forwards component statuses
 * as the app wrote them, so both sides must agree. Any other status, neither clearly up nor
 * clearly down (WARN, DEGRADED, PARTIAL, ...), is treated as DEGRADED.
 */
public enum HealthStatus {
    UP,
    DEGRADED,
    DOWN,
    UNKNOWN;

    /**
     * Maps a status word, in any case; unrecognised words are DEGRADED. The word is trimmed of
     * exactly what {@link String#trim()} removes, every character up to U+0020 and no other white
     * space, as the sidecar trims it; null, or nothing left after trimming, is UNKNOWN. The root
     * README lists the words.
     */
    public static HealthStatus fromCode(String code) {
        String word = code == null ? "" : code.trim();
        if (word.isEmpty()) {
            return UNKNOWN;
        }
        return switch (word.toUpperCase(Locale.ROOT)) {
            case "UP", "OK", "PASS", "HEALTHY", "GREEN", "SERVING" -> UP;
            case "DOWN", "FAIL", "FAILED", "ERROR", "UNHEALTHY", "OUT_OF_SERVICE", "FATAL", "RED",
                    "NOT_SERVING" -> DOWN;
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
