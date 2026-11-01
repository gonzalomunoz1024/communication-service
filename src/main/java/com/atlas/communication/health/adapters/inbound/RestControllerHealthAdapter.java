package com.atlas.communication.health.adapters.inbound;

import java.net.URI;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.atlas.communication.health.application.HealthMonitorUseCase;
import com.atlas.communication.health.domain.HealthInstance;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReportCommand;
import com.atlas.communication.health.domain.RegisterMonitorCommand;
import com.atlas.communication.health.ports.inbound.HealthInboundPort;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@RestController
@RequiredArgsConstructor
@RequestMapping("/v1/health")
@Tag(name = "Health", description = "Automated outages: probe services' health endpoints or accept "
        + "pushed health reports, and publish/retire communications from them")
public class RestControllerHealthAdapter implements HealthInboundPort {

    private final HealthMonitorUseCase useCase;

    @PostMapping("/monitors")
    @Operation(summary = "Register a monitor (with url: probed on its interval; without: push-only)")
    public Mono<ResponseEntity<HealthMonitor>> registerHttp(
            @Valid @RequestBody RegisterMonitorCommand command) {
        return register(command).map(saved -> ResponseEntity
                .created(URI.create("/v1/health/monitors/" + saved.id()))
                .body(saved));
    }

    @GetMapping("/monitors")
    @Operation(summary = "List monitors with their current state, optionally for one tenant")
    public Flux<HealthMonitor> listHttp(@RequestParam(required = false) String tenantId) {
        return list(tenantId);
    }

    @Override
    @GetMapping("/monitors/{id}")
    @Operation(summary = "One monitor, including streaks and the notice it has open")
    public Mono<HealthMonitor> get(@PathVariable String id) {
        return useCase.get(id);
    }

    @Override
    @GetMapping("/monitors/{id}/instances")
    @Operation(summary = "The pods that report for a monitor: last status, when they were last heard from,"
            + " and whether they left cleanly")
    public Flux<HealthInstance> instances(@PathVariable String id) {
        return useCase.instances(id);
    }

    @DeleteMapping("/monitors/{id}")
    @Operation(summary = "Delete a monitor, retiring any notice it has open")
    public Mono<ResponseEntity<Void>> deleteHttp(@PathVariable String id) {
        return delete(id).thenReturn(ResponseEntity.noContent().<Void>build());
    }

    @Override
    @PostMapping("/monitors/{id}/probe")
    @Operation(summary = "Probe a monitor now and apply the result")
    public Mono<HealthMonitor> probeNow(@PathVariable String id) {
        return useCase.probeNow(id);
    }

    @PostMapping("/reports")
    @Operation(summary = "Push a health report (Actuator vocabulary); first contact registers a push-only monitor")
    public Mono<ResponseEntity<HealthMonitor>> reportHttp(@Valid @RequestBody HealthReportCommand command) {
        return report(command).map(monitor -> ResponseEntity.status(HttpStatus.ACCEPTED).body(monitor));
    }

    @Override
    public Mono<HealthMonitor> register(RegisterMonitorCommand command) {
        return useCase.register(command);
    }

    @Override
    public Flux<HealthMonitor> list(String tenantId) {
        return useCase.list(tenantId);
    }

    @Override
    public Mono<Void> delete(String id) {
        return useCase.delete(id);
    }

    @Override
    public Mono<HealthMonitor> report(HealthReportCommand command) {
        return useCase.report(command);
    }
}
