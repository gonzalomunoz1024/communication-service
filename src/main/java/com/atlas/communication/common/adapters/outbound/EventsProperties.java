package com.atlas.communication.common.adapters.outbound;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Shared event log settings: how often each instance tails the log (which bounds the latency
 * of live events) and how long events are kept for {@code Last-Event-ID} replay.
 */
@ConfigurationProperties(prefix = "communication.events")
public record EventsProperties(@DefaultValue("500") long pollIntervalMs,
        @DefaultValue("P1D") Duration retention) {

    public Duration pollInterval() {
        return Duration.ofMillis(pollIntervalMs);
    }
}
