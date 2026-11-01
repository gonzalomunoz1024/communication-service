package com.atlas.communication.health.application;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.domain.HealthMonitor;

/**
 * {@code communication.health.*}: sweep cadence, the staleness safety valve and the policy
 * defaults new monitors inherit.
 *
 * <p>The safety valve keeps our own trouble from looking like everyone's outage: silent
 * services are not declared DOWN for {@code staleGraceAfterStartMs} after this service starts,
 * nor while more than {@code stalePauseFraction} of the monitors that can go stale are stale
 * at the same time.
 */
@ConfigurationProperties(prefix = "communication.health")
public record HealthProperties(
        @DefaultValue("5000") long sweepIntervalMs,
        @DefaultValue("300000") long staleGraceAfterStartMs,
        @DefaultValue("0.3") double stalePauseFraction,
        @DefaultValue Defaults defaults) {

    public record Defaults(
            @DefaultValue("health-monitor") String publisher,
            @DefaultValue("30") int intervalSeconds,
            @DefaultValue("5000") int timeoutMs,
            @DefaultValue("2") int failureThreshold,
            @DefaultValue("2") int recoveryThreshold,
            @DefaultValue("MAJOR") Severity downSeverity,
            @DefaultValue("MINOR") Severity degradedSeverity,
            @DefaultValue("CUSTOMERS") Audience audience,
            @DefaultValue("50") int minHealthyPercent,
            @DefaultValue("90") int instanceStaleAfterSeconds) {

        public HealthMonitor.Policy asPolicy() {
            return new HealthMonitor.Policy(publisher, intervalSeconds, timeoutMs, failureThreshold,
                    recoveryThreshold, downSeverity, degradedSeverity, audience, null, minHealthyPercent);
        }
    }
}
