package com.atlas.communication.health.application;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthReportCommand;
import com.atlas.communication.health.domain.RegisterMonitorCommand;
import com.atlas.communication.health.ports.inbound.HealthInboundPort;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/** Monitor lifecycle plus the two entry points of Flow 2: pushed reports and on-demand probes. */
@Service
@RequiredArgsConstructor
public class HealthMonitorUseCase implements HealthInboundPort {

    private final HealthMonitorRepositoryPort monitors;
    private final HealthObservationUseCase observation;
    private final HealthProperties properties;
    private final Clock clock;

    @Override
    public Mono<HealthMonitor> register(RegisterMonitorCommand cmd) {
        return Mono.defer(() -> {
            Instant now = clock.instant();
            HealthMonitor monitor = HealthMonitor.create(UUID.randomUUID().toString(),
                    cmd.tenantId(), cmd.service(), cmd.url(), policyFrom(cmd), now);
            return monitors.save(monitor);
        });
    }

    @Override
    public Mono<HealthMonitor> get(String id) {
        return monitors.findById(id).switchIfEmpty(Mono.error(
                new ResponseStatusException(HttpStatus.NOT_FOUND, "monitor " + id + " not found")));
    }

    @Override
    public Flux<HealthMonitor> list(String tenantId) {
        return monitors.findAll(tenantId);
    }

    @Override
    public Mono<Void> delete(String id) {
        return get(id)
                .flatMap(monitor -> observation.close(monitor, "monitor deleted", clock.instant()))
                .flatMap(monitor -> monitors.deleteById(id))
                .then();
    }

    @Override
    public Mono<HealthMonitor> report(HealthReportCommand cmd) {
        return Mono.defer(() -> {
            Instant now = clock.instant();
            HealthReport report = cmd.toReport(now);
            return monitors.findByTenantAndService(cmd.tenantId(), cmd.service())
                    .switchIfEmpty(Mono.defer(() -> autoRegister(cmd)))
                    .flatMap(monitor -> observation.observe(monitor, report, now));
        });
    }

    @Override
    public Mono<HealthMonitor> probeNow(String id) {
        return get(id).flatMap(monitor -> {
            if (monitor.pushOnly()) {
                return Mono.error(new ResponseStatusException(HttpStatus.CONFLICT,
                        "monitor " + id + " is push-only (no url) and cannot be probed"));
            }
            return observation.probe(monitor, clock.instant());
        });
    }

    /** First push from an unknown service registers a push-only monitor with default policy. */
    private Mono<HealthMonitor> autoRegister(HealthReportCommand cmd) {
        RegisterMonitorCommand register = new RegisterMonitorCommand(cmd.tenantId(), cmd.service(),
                null, cmd.publisher(), null, null, null, null, null, null, null, null);
        return register(register)
                // lost a race with a concurrent first report: use the winner's monitor
                .onErrorResume(ResponseStatusException.class,
                        ex -> ex.getStatusCode() == HttpStatus.CONFLICT
                                ? monitors.findByTenantAndService(cmd.tenantId(), cmd.service())
                                : Mono.error(ex));
    }

    private HealthMonitor.Policy policyFrom(RegisterMonitorCommand cmd) {
        HealthMonitor.Policy d = properties.defaults().asPolicy();
        return new HealthMonitor.Policy(
                cmd.publisher() == null || cmd.publisher().isBlank() ? d.publisher() : cmd.publisher(),
                cmd.intervalSeconds() == null ? d.intervalSeconds() : cmd.intervalSeconds(),
                cmd.timeoutMs() == null ? d.timeoutMs() : cmd.timeoutMs(),
                cmd.failureThreshold() == null ? d.failureThreshold() : cmd.failureThreshold(),
                cmd.recoveryThreshold() == null ? d.recoveryThreshold() : cmd.recoveryThreshold(),
                cmd.downSeverity() == null ? d.downSeverity() : cmd.downSeverity(),
                cmd.degradedSeverity() == null ? d.degradedSeverity() : cmd.degradedSeverity(),
                cmd.audience() == null ? d.audience() : cmd.audience(),
                cmd.staleAfterSeconds());
    }
}
