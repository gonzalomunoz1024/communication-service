package com.atlas.communication.health.domain;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;

/**
 * The communication a health observation translates to. DOWN is an OUTAGE at the monitor's
 * {@code downSeverity}; DEGRADED is a HEALTH notice at {@code degradedSeverity}. The body is plain
 * text, like the bodies people write in the form: the status as of the observation (UTC, to the
 * second), where it came from (the probed URL and its answer, the service's own message, its pods,
 * or its silence) and the failing components.
 */
public record HealthNotice(CommunicationType type, Severity severity, String title, String body) {

    /** Component lines are capped so a service with hundreds of indicators stays readable. */
    public static final int COMPONENT_LINES_MAX = 25;

    private static final DateTimeFormatter UTC = DateTimeFormatter
            .ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'", Locale.ROOT)
            .withZone(ZoneOffset.UTC);

    public static HealthNotice from(HealthMonitor monitor, HealthReport report) {
        boolean down = report.effectiveStatus() == HealthStatus.DOWN;
        CommunicationType type = down ? CommunicationType.OUTAGE : CommunicationType.HEALTH;
        Severity severity = down ? monitor.policy().downSeverity() : monitor.policy().degradedSeverity();
        String title = monitor.service() + (down ? " is down" : " is degraded");
        return new HealthNotice(type, severity, title, body(monitor, report));
    }

    /** A time the way notices write it: UTC, to the second ({@code 2026-11-02 04:07:48 UTC}). */
    public static String utc(Instant instant) {
        return UTC.format(instant);
    }

    static String body(HealthMonitor monitor, HealthReport report) {
        StringBuilder sb = new StringBuilder();
        sb.append(monitor.service()).append(" is ").append(report.effectiveStatus())
                .append(" as of ").append(utc(report.observedAt())).append(".\n")
                .append(sentence(origin(monitor, report)));
        List<ComponentHealth> failing = report.failing();
        if (!failing.isEmpty()) {
            sb.append("\n\nFailing components:");
            failing.stream().limit(COMPONENT_LINES_MAX).forEach(c -> {
                sb.append('\n').append(c.name()).append(": ").append(c.status());
                if (c.detail() != null) {
                    sb.append(" (").append(c.detail()).append(')');
                }
            });
            if (failing.size() > COMPONENT_LINES_MAX) {
                sb.append("\n... and ").append(failing.size() - COMPONENT_LINES_MAX).append(" more");
            }
        }
        sb.append("\n\nThis notice is managed automatically and is retired once the service reports healthy again.");
        return sb.toString();
    }

    /** Where the observation came from, and what it said. */
    private static String origin(HealthMonitor monitor, HealthReport report) {
        String message = report.message() == null || report.message().isBlank() ? null : report.message().strip();
        return switch (report.source()) {
            case PROBE -> "Health check of " + monitor.url() + (message == null ? "" : ": " + message);
            case PUSH -> "Reported by the service" + (message == null ? "" : ": " + message);
            case ROLLUP -> "Reported by its pods" + (message == null ? "" : ": " + message);
            case STALE -> message == null
                    ? "No health report received since " + utc(monitor.staleBaseline())
                    : Character.toUpperCase(message.charAt(0)) + message.substring(1);
        };
    }

    /** Ends the text with a full stop unless it already ends a sentence. */
    private static String sentence(String text) {
        char last = text.charAt(text.length() - 1);
        return last == '.' || last == '!' || last == '?' ? text : text + ".";
    }
}
