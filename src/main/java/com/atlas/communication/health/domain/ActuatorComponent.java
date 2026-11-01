package com.atlas.communication.health.domain;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One node of a Spring Actuator-style health document: a status code, free-form details and,
 * for composite indicators, nested components. Older Actuator versions nest children under
 * {@code details} instead of {@code components}; {@link #children()} understands both.
 */
public record ActuatorComponent(
        String status,
        Map<String, Object> details,
        Map<String, ActuatorComponent> components) {

    public ActuatorComponent {
        details = details == null ? Map.of() : details;
        components = components == null ? Map.of() : components;
    }

    /** Nested components, falling back to status-bearing entries of {@code details}. */
    public Map<String, ActuatorComponent> children() {
        if (!components.isEmpty()) {
            return components;
        }
        Map<String, ActuatorComponent> fromDetails = new LinkedHashMap<>();
        details.forEach((name, value) -> {
            if (value instanceof Map<?, ?> map && map.get("status") instanceof String) {
                fromDetails.put(name, fromTree(map));
            }
        });
        return fromDetails;
    }

    /** Converts a generic JSON tree (as Jackson produces for {@code Map<String, Object>}). */
    @SuppressWarnings("unchecked")
    public static ActuatorComponent fromTree(Map<?, ?> tree) {
        String status = tree.get("status") instanceof String s ? s : null;
        Map<String, Object> details = tree.get("details") instanceof Map<?, ?> d
                ? (Map<String, Object>) d : Map.of();
        Map<String, ActuatorComponent> components = new LinkedHashMap<>();
        if (tree.get("components") instanceof Map<?, ?> c) {
            c.forEach((name, value) -> {
                if (value instanceof Map<?, ?> child) {
                    components.put(String.valueOf(name), fromTree(child));
                }
            });
        }
        return new ActuatorComponent(status, details, components);
    }
}
