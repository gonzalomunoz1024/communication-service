package com.atlas.communication.health.domain;

import java.time.Instant;
import java.util.Map;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * A pushed health report in Spring Actuator's vocabulary: a {@code status} code plus optional
 * {@code components} shaped exactly like {@code /actuator/health} output, so a service can
 * forward its own health document with just tenant and service added. {@code publisher} is
 * only used when the report auto-registers a push-only monitor.
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
        String message,
        Instant observedAt,
        String publisher,
        @Valid ReportInstance instance) {

    public HealthReport toReport(Instant now) {
        return HealthReport.fromActuator(status, components, message, HealthSource.PUSH,
                observedAt == null ? now : observedAt);
    }
}
