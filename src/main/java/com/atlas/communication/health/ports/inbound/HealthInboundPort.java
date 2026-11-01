package com.atlas.communication.health.ports.inbound;

import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReportCommand;
import com.atlas.communication.health.domain.RegisterMonitorCommand;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Automated publishing: services are monitored (pull) or report themselves (push), and the
 * resulting outages and health notices flow into the same feed humans publish to.
 */
public interface HealthInboundPort {

    /** Registers a monitor; 409 if one exists for the (tenantId, service) pair. */
    Mono<HealthMonitor> register(RegisterMonitorCommand command);

    Mono<HealthMonitor> get(String id);

    /** All monitors, optionally narrowed to one tenant. */
    Flux<HealthMonitor> list(String tenantId);

    /** Deletes a monitor, retiring any notice it has open. */
    Mono<Void> delete(String id);

    /** Accepts a pushed health report, auto-registering a push-only monitor on first contact. */
    Mono<HealthMonitor> report(HealthReportCommand command);

    /** Probes a monitor right now instead of waiting for its interval; 409 for push-only. */
    Mono<HealthMonitor> probeNow(String id);
}
