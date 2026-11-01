package com.atlas.communication.health.ports.outbound;

import com.atlas.communication.health.domain.HealthInstance;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Last-report-per-instance store behind a monitor. One record per (monitorId, instanceId);
 * {@link #save} replaces. Implementations expire records that have not been seen for a day.
 */
public interface HealthInstanceRepositoryPort {

    Mono<HealthInstance> save(HealthInstance instance);

    /** Every record of a monitor, including instances that left; ordered by instance id. */
    Flux<HealthInstance> findByMonitor(String monitorId);

    /** Removes every record of a monitor (the monitor is being deleted). */
    Mono<Void> deleteByMonitor(String monitorId);
}
