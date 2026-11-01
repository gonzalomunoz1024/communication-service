package com.atlas.communication.health.ports.outbound;

import com.atlas.communication.health.domain.HealthMonitor;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Durable store for monitors and their state. Implementations map storage conflicts to
 * {@code ResponseStatusException(409)}: duplicate (tenantId, service) and optimistic-lock
 * (version) failures. The version check is what makes a notice claim exclusive.
 */
public interface HealthMonitorRepositoryPort {

    Mono<HealthMonitor> save(HealthMonitor monitor);

    Mono<HealthMonitor> findById(String id);

    Mono<HealthMonitor> findByTenantAndService(String tenantId, String service);

    /** All monitors, or one tenant's when {@code tenantId} is non-null. */
    Flux<HealthMonitor> findAll(String tenantId);

    Mono<Boolean> deleteById(String id);
}
