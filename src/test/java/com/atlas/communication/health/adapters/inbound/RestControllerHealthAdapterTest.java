package com.atlas.communication.health.adapters.inbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.server.ResponseStatusException;
import org.mockito.ArgumentCaptor;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.config.ClientIdWebFilter;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.application.HealthMonitorUseCase;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReportCommand;
import com.atlas.communication.health.domain.RegisterMonitorCommand;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/** HTTP contract of the health endpoints: status codes, validation and Actuator-shaped JSON binding. */
@WebFluxTest(RestControllerHealthAdapter.class)
class RestControllerHealthAdapterTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    @Autowired
    private WebTestClient client;
    @MockitoBean
    private HealthMonitorUseCase useCase;

    @BeforeEach
    void identifyAsTestClient() {
        client = client.mutate()
                .defaultHeader(ClientIdWebFilter.HEADER, "communication-service-tests")
                .build();
    }

    private static HealthMonitor monitor() {
        return HealthMonitor.create("m1", "vmforge", "vm-api", "http://vm-api/actuator/health",
                new HealthMonitor.Policy("health-monitor", 30, 5000, 2, 2, Severity.MAJOR,
                        Severity.MINOR, Audience.CUSTOMERS, null), NOW);
    }

    @Test
    void callsWithoutAClientIdNeverReachTheController() {
        client.mutate().defaultHeaders(h -> h.remove(ClientIdWebFilter.HEADER)).build()
                .get().uri("/v1/health/monitors?tenantId=vmforge")
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody().jsonPath("$.error").exists();
        verifyNoInteractions(useCase);
    }

    @Test
    void registerReturns201WithLocationAndBindsOverrides() {
        when(useCase.register(any())).thenReturn(Mono.just(monitor()));

        client.post().uri("/v1/health/monitors")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "service", "vm-api",
                        "url", "http://vm-api/actuator/health", "failureThreshold", 3,
                        "downSeverity", "CRITICAL", "staleAfterSeconds", 120))
                .exchange()
                .expectStatus().isCreated()
                .expectHeader().valueEquals("Location", "/v1/health/monitors/m1")
                .expectBody()
                .jsonPath("$.id").isEqualTo("m1")
                .jsonPath("$.policy.intervalSeconds").isEqualTo(30)
                .jsonPath("$.state.lastStatus").isEqualTo("UNKNOWN");

        ArgumentCaptor<RegisterMonitorCommand> cmd = ArgumentCaptor.forClass(RegisterMonitorCommand.class);
        verify(useCase).register(cmd.capture());
        assertThat(cmd.getValue().failureThreshold()).isEqualTo(3);
        assertThat(cmd.getValue().downSeverity()).isEqualTo(Severity.CRITICAL);
        assertThat(cmd.getValue().staleAfterSeconds()).isEqualTo(120);
        assertThat(cmd.getValue().intervalSeconds()).isNull();
    }

    @Test
    void registerValidatesTheBody() {
        client.post().uri("/v1/health/monitors")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "intervalSeconds", 1))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .contains("service").contains("intervalSeconds"));
    }

    @Test
    void reportBindsActuatorShapedComponentsAndReturns202() {
        when(useCase.report(any())).thenReturn(Mono.just(monitor()));

        String actuatorJson = """
                {"tenantId":"vmforge","service":"vm-api","status":"DOWN","message":"db pool exhausted",
                 "observedAt":"2026-11-01T11:59:00Z",
                 "components":{"db":{"status":"DOWN","details":{"error":"Connection refused","validationQuery":"isValid()"}},
                               "diskSpace":{"status":"UP","details":{"total":1000,"free":500}},
                               "groups":{"status":"UP","components":{"a":{"status":"UP"}}}}}
                """;
        client.post().uri("/v1/health/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(actuatorJson)
                .exchange()
                .expectStatus().isAccepted()
                .expectBody().jsonPath("$.id").isEqualTo("m1");

        ArgumentCaptor<HealthReportCommand> cmd = ArgumentCaptor.forClass(HealthReportCommand.class);
        verify(useCase).report(cmd.capture());
        HealthReportCommand value = cmd.getValue();
        assertThat(value.status()).isEqualTo("DOWN");
        assertThat(value.message()).isEqualTo("db pool exhausted");
        assertThat(value.observedAt()).isEqualTo(Instant.parse("2026-11-01T11:59:00Z"));
        assertThat(value.components()).containsKeys("db", "diskSpace", "groups");
        assertThat(value.components().get("db").details()).containsEntry("error", "Connection refused");
        assertThat(value.components().get("groups").components()).containsKey("a");
        assertThat(value.toReport(NOW).failing()).hasSize(1);
    }

    @Test
    void reportRequiresAStatus() {
        client.post().uri("/v1/health/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "service", "vm-api"))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody().jsonPath("$.error").value(msg -> assertThat((String) msg).contains("status"));
    }

    @Test
    void listGetProbeAndDeleteMapStatuses() {
        when(useCase.list("vmforge")).thenReturn(Flux.just(monitor()));
        when(useCase.get("m1")).thenReturn(Mono.just(monitor()));
        when(useCase.get("nope")).thenReturn(Mono.error(
                new ResponseStatusException(HttpStatus.NOT_FOUND, "monitor nope not found")));
        when(useCase.probeNow("m1")).thenReturn(Mono.just(monitor()));
        when(useCase.delete("m1")).thenReturn(Mono.empty());

        client.get().uri("/v1/health/monitors?tenantId=vmforge").exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$[0].service").isEqualTo("vm-api");
        client.get().uri("/v1/health/monitors/m1").exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.url").isEqualTo("http://vm-api/actuator/health");
        client.get().uri("/v1/health/monitors/nope").exchange()
                .expectStatus().isNotFound()
                .expectBody().jsonPath("$.error").isEqualTo("monitor nope not found");
        client.post().uri("/v1/health/monitors/m1/probe").exchange()
                .expectStatus().isOk();
        client.delete().uri("/v1/health/monitors/m1").exchange()
                .expectStatus().isNoContent();
    }
}
