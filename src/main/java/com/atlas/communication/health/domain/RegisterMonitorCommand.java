package com.atlas.communication.health.domain;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

/**
 * Registers a monitor. Only tenant and service are required; {@code url} makes it a probed
 * monitor (omit it for push-only). Null policy fields take the service-wide defaults.
 */
public record RegisterMonitorCommand(
        @NotBlank String tenantId,
        @NotBlank String service,
        String url,
        String publisher,
        @Min(HealthMonitor.MIN_INTERVAL_SECONDS) Integer intervalSeconds,
        @Min(HealthMonitor.MIN_TIMEOUT_MS) Integer timeoutMs,
        @Min(1) Integer failureThreshold,
        @Min(1) Integer recoveryThreshold,
        Severity downSeverity,
        Severity degradedSeverity,
        Audience audience,
        @Min(1) Integer staleAfterSeconds) {
}
