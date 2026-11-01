package com.atlas.communication.health.ports.outbound;

import java.time.Duration;
import java.time.Instant;

import com.atlas.communication.health.domain.HealthReport;

import reactor.core.publisher.Mono;

/**
 * Pulls a service's health. Never errors: transport failures, timeouts and non-2xx responses
 * without a readable health document all become DOWN reports.
 */
public interface HealthProbePort {

    Mono<HealthReport> probe(String url, Duration timeout, Instant now);
}
