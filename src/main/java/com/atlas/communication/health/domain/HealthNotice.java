package com.atlas.communication.health.domain;

import java.util.List;

import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;

/**
 * The communication a health observation translates to. DOWN is an OUTAGE at the monitor's
 * {@code downSeverity}; DEGRADED is a HEALTH notice at {@code degradedSeverity}. The body is
 * Markdown, like human-authored communications, and lists the failing components.
 */
public record HealthNotice(CommunicationType type, Severity severity, String title, String body) {

    /** Component lines are capped so a service with hundreds of indicators stays readable. */
    public static final int COMPONENT_LINES_MAX = 25;

    public static HealthNotice from(HealthMonitor monitor, HealthReport report) {
        boolean down = report.effectiveStatus() == HealthStatus.DOWN;
        CommunicationType type = down ? CommunicationType.OUTAGE : CommunicationType.HEALTH;
        Severity severity = down ? monitor.policy().downSeverity() : monitor.policy().degradedSeverity();
        String title = monitor.service() + (down ? " is down" : " is degraded");
        return new HealthNotice(type, severity, title, body(monitor, report));
    }

    static String body(HealthMonitor monitor, HealthReport report) {
        StringBuilder sb = new StringBuilder();
        sb.append("Automated health check reported **").append(report.effectiveStatus())
                .append("** at ").append(report.observedAt());
        sb.append(switch (report.source()) {
            case PROBE -> " (probe of " + monitor.url() + ")";
            case PUSH -> " (reported by the service)";
            case STALE -> " (no health report received since " + monitor.staleBaseline() + ")";
        });
        sb.append('.');
        if (report.message() != null && !report.message().isBlank()) {
            sb.append("\n\n").append(report.message());
        }
        List<ComponentHealth> failing = report.failing();
        if (!failing.isEmpty()) {
            sb.append("\n\nFailing components:");
            failing.stream().limit(COMPONENT_LINES_MAX).forEach(c -> {
                sb.append("\n- ").append(c.name()).append(": ").append(c.status());
                if (c.detail() != null) {
                    sb.append(" - ").append(c.detail());
                }
            });
            if (failing.size() > COMPONENT_LINES_MAX) {
                sb.append("\n- ... and ").append(failing.size() - COMPONENT_LINES_MAX).append(" more");
            }
        }
        sb.append("\n\nThis notice is managed automatically and is retired once the service reports healthy again.");
        return sb.toString();
    }
}
