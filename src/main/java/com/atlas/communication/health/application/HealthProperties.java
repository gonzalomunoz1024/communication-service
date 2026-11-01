package com.atlas.communication.health.application;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.domain.HealthMonitor;

/** {@code communication.health.*}: sweep cadence and the policy defaults new monitors inherit. */
@ConfigurationProperties(prefix = "communication.health")
public record HealthProperties(
        @DefaultValue("5000") long sweepIntervalMs,
        @DefaultValue Defaults defaults) {

    public record Defaults(
            @DefaultValue("health-monitor") String publisher,
            @DefaultValue("30") int intervalSeconds,
            @DefaultValue("5000") int timeoutMs,
            @DefaultValue("2") int failureThreshold,
            @DefaultValue("2") int recoveryThreshold,
            @DefaultValue("MAJOR") Severity downSeverity,
            @DefaultValue("MINOR") Severity degradedSeverity,
            @DefaultValue("CUSTOMERS") Audience audience) {

        public HealthMonitor.Policy asPolicy() {
            return new HealthMonitor.Policy(publisher, intervalSeconds, timeoutMs, failureThreshold,
                    recoveryThreshold, downSeverity, degradedSeverity, audience, null);
        }
    }
}
