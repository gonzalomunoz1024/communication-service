package com.atlas.communication.health.domain;

import java.time.Instant;
import java.util.Map;

import jakarta.validation.constraints.NotBlank;

/**
 * A pushed health report in Spring Actuator's vocabulary: a {@code status} code plus optional
 * {@code components} shaped exactly like {@code /actuator/health} output, so a service can
 * forward its own health document with just tenant and service added. {@code publisher} is
 * only used when the report auto-registers a push-only monitor.
 */
public record HealthReportCommand(
        @NotBlank String tenantId,
        @NotBlank String service,
        @NotBlank String status,
        Map<String, ActuatorComponent> components,
        String message,
        Instant observedAt,
        String publisher) {

    public HealthReport toReport(Instant now) {
        return HealthReport.fromActuator(status, components, message, HealthSource.PUSH,
                observedAt == null ? now : observedAt);
    }
}
