package com.atlas.communication.health.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * One observation of a service's health, whichever way it arrived (probe, push or staleness).
 * Pure data: the monitor decides what it means.
 */
public record HealthReport(
        HealthStatus status,
        List<ComponentHealth> components,
        String message,
        HealthSource source,
        Instant observedAt) {

    /** Per-component detail text is capped so a chatty indicator cannot bloat a communication. */
    public static final int DETAIL_MAX = 200;

    public HealthReport {
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(observedAt, "observedAt");
        components = components == null ? List.of() : List.copyOf(components);
    }

    public static HealthReport of(HealthStatus status, String message, HealthSource source,
            Instant observedAt) {
        return new HealthReport(status, List.of(), message, source, observedAt);
    }

    /**
     * Builds a report from an Actuator-style document: the top-level status code plus nested
     * components, flattened to dotted names ({@code db.primary}).
     */
    public static HealthReport fromActuator(String statusCode, Map<String, ActuatorComponent> components,
            String message, HealthSource source, Instant observedAt) {
        List<ComponentHealth> flat = new ArrayList<>();
        if (components != null) {
            flatten(null, components, flat);
        }
        return new HealthReport(HealthStatus.fromCode(statusCode), flat, message, source, observedAt);
    }

    private static void flatten(String prefix, Map<String, ActuatorComponent> nodes,
            List<ComponentHealth> out) {
        nodes.forEach((name, node) -> {
            if (node == null) {
                return;
            }
            String path = prefix == null ? name : prefix + "." + name;
            Map<String, ActuatorComponent> children = node.children();
            if (children.isEmpty()) {
                out.add(new ComponentHealth(path, HealthStatus.fromCode(node.status()),
                        describe(node.details())));
            } else {
                flatten(path, children, out);
            }
        });
    }

    /** Compact "key=value" rendering of a component's details, error first, capped in length. */
    static String describe(Map<String, Object> details) {
        if (details == null || details.isEmpty()) {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        if (details.get("error") != null) {
            sb.append("error=").append(details.get("error"));
        }
        details.forEach((key, value) -> {
            if ("error".equals(key) || value == null) {
                return;
            }
            if (!sb.isEmpty()) {
                sb.append(", ");
            }
            sb.append(key).append('=').append(value);
        });
        return sb.length() > DETAIL_MAX ? sb.substring(0, DETAIL_MAX - 3) + "..." : sb.toString();
    }

    /** Components that are DOWN or DEGRADED. */
    public List<ComponentHealth> failing() {
        return components.stream().filter(c -> c.status().unhealthy()).toList();
    }

    /** The status the monitor acts on: UP with failing components is DEGRADED. */
    public HealthStatus effectiveStatus() {
        return status == HealthStatus.UP && !failing().isEmpty() ? HealthStatus.DEGRADED : status;
    }

    /**
     * Stable fingerprint of what is wrong (status + failing components). An open notice is only
     * updated when this changes, so fluctuating detail text does not spam consumers.
     */
    public String signature() {
        return effectiveStatus() + failing().stream()
                .map(c -> c.name() + "=" + c.status())
                .sorted()
                .collect(Collectors.joining(",", "[", "]"));
    }

    /** One-line human summary for audit entries and monitor state. */
    public String summary() {
        StringBuilder sb = new StringBuilder(effectiveStatus().name());
        if (message != null && !message.isBlank()) {
            sb.append(" (").append(message).append(')');
        }
        List<ComponentHealth> failing = failing();
        if (!failing.isEmpty()) {
            sb.append(": ").append(failing.stream()
                    .map(c -> c.name() + " " + c.status())
                    .collect(Collectors.joining(", ")));
        }
        return sb.toString();
    }
}
