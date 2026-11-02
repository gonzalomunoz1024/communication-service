package com.atlas.communication.health.domain;

import java.time.Instant;
import java.util.Map;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * A pushed health report in Spring Actuator's vocabulary: a {@code status} code plus optional
 * {@code components} shaped exactly like {@code /actuator/health} output, so a service can
 * forward its own health document with just tenant and service added. A document from Spring
 * Boot 2.0/2.1, which nests its components under a top-level {@code details} map, is read the
 * same way (the status-bearing entries of {@code details} are the components; {@code components}
 * wins when both are present). {@code publisher} is only used when the report auto-registers a
 * push-only monitor.
 *
 * <p>A report that names its {@code instance} (a pod, as the health sidecar does) is recorded
 * per instance and rolled up into one service status before the monitor evaluates it; a
 * report without one is evaluated as is.
 */
public record HealthReportCommand(
        @NotBlank String tenantId,
        @NotBlank String service,
        @NotBlank String status,
        Map<String, ActuatorComponent> components,
        Map<String, Object> details,
        String message,
        Instant observedAt,
        String publisher,
        @Valid ReportInstance instance) {

    public HealthReport toReport(Instant now) {
        return HealthReport.fromActuator(status, componentTree(), message, HealthSource.PUSH,
                observedAt == null ? now : observedAt);
    }

    /** {@code components} as Boot 2.2+ writes them, else whatever in a legacy {@code details} map has a status. */
    private Map<String, ActuatorComponent> componentTree() {
        if (components != null && !components.isEmpty()) {
            return components;
        }
        return new ActuatorComponent(status, details, null).children();
    }
}
