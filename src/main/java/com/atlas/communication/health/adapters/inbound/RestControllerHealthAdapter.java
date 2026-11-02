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
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
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

    /*
     * Request examples Swagger UI fills in. Each one is accepted as it is (OpenApiContractIT sends them,
     * the monitors first): the report goes to the push-only monitor of the first example.
     */
    static final String PUSH_ONLY_MONITOR_EXAMPLE = """
            {
              "tenantId": "acme",
              "service": "payments",
              "publisher": "payments-team",
              "downSeverity": "MAJOR",
              "degradedSeverity": "MINOR",
              "audience": "CUSTOMERS",
              "staleAfterSeconds": 120
            }""";
    static final String PROBED_MONITOR_EXAMPLE = """
            {
              "tenantId": "acme",
              "service": "checkout",
              "url": "http://checkout.acme.svc:8080/actuator/health",
              "intervalSeconds": 30,
              "timeoutMs": 2000,
              "failureThreshold": 3,
              "recoveryThreshold": 2,
              "downSeverity": "MAJOR",
              "degradedSeverity": "MINOR",
              "audience": "CUSTOMERS"
            }""";
    static final String REPORT_EXAMPLE = """
            {
              "tenantId": "acme",
              "service": "payments",
              "status": "DOWN",
              "components": {
                "db": {"status": "DOWN", "details": {"error": "connection refused"}},
                "diskSpace": {"status": "UP"}
              },
              "publisher": "payments-team"
            }""";
    private static final String ERROR_SCHEMA = "#/components/schemas/Error";

    private final HealthMonitorUseCase useCase;

    @PostMapping("/monitors")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true, content = @Content(
            mediaType = "application/json", schema = @Schema(implementation = RegisterMonitorCommand.class),
            examples = {
                @ExampleObject(name = "push-only", summary = "No url: the service pushes its reports",
                        value = PUSH_ONLY_MONITOR_EXAMPLE),
                @ExampleObject(name = "probed", summary = "With url: probed every intervalSeconds",
                        value = PROBED_MONITOR_EXAMPLE)}))
    @ApiResponse(responseCode = "201", description = "Registered: the monitor, before its first probe or report",
            headers = @Header(name = "Location", description = "The new monitor: /v1/health/monitors/{id}",
                    schema = @Schema(type = "string")),
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = HealthMonitor.class)))
    @ApiResponse(responseCode = "409", description = "This tenant already has a monitor for this service (a report "
            + "registers one on first contact)",
            content = @Content(mediaType = "application/json", schema = @Schema(ref = ERROR_SCHEMA),
                    examples = @ExampleObject(value = "{\"error\":\"a monitor already exists for service 'checkout' "
                            + "in tenant 'acme'\"}")))
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
    @ApiResponse(responseCode = "204", description = "Deleted, with its pods; a notice it had open is retired")
    public Mono<ResponseEntity<Void>> deleteHttp(@PathVariable String id) {
        return delete(id).thenReturn(ResponseEntity.noContent().<Void>build());
    }

    @Override
    @PostMapping("/monitors/{id}/probe")
    @Operation(summary = "Probe a monitor now and apply the result")
    @ApiResponse(responseCode = "200", description = "Probed: the monitor with the result applied",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = HealthMonitor.class)))
    @ApiResponse(responseCode = "409", description = "A push-only monitor (no url) has nothing to probe",
            content = @Content(mediaType = "application/json", schema = @Schema(ref = ERROR_SCHEMA),
                    examples = @ExampleObject(value = "{\"error\":\"monitor 3f0c2a1e-7d4b-4a4e-9c2b-5e1f0a6d8b21 is "
                            + "push-only (no url) and cannot be probed\"}")))
    public Mono<HealthMonitor> probeNow(@PathVariable String id) {
        return useCase.probeNow(id);
    }

    @PostMapping("/reports")
    @Operation(summary = "Push a health report (Actuator vocabulary); first contact registers a push-only monitor")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true, content = @Content(
            mediaType = "application/json", schema = @Schema(implementation = HealthReportCommand.class),
            examples = @ExampleObject(name = "down", summary = "An Actuator health body, with tenant and service",
                    value = REPORT_EXAMPLE)))
    @ApiResponse(responseCode = "202", description = "Accepted and applied: the monitor it went to (registered on "
            + "first contact), with its streaks and the notice it has open",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = HealthMonitor.class)))
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
