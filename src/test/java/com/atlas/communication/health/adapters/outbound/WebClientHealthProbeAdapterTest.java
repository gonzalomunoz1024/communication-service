package com.atlas.communication.health.adapters.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;

import com.atlas.communication.health.domain.ComponentHealth;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.fasterxml.jackson.databind.ObjectMapper;

import reactor.core.publisher.Mono;
import reactor.netty.DisposableServer;
import reactor.netty.http.server.HttpServer;

class WebClientHealthProbeAdapterTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    private static final String ACTUATOR_DOWN = """
            {"status":"DOWN","components":{
              "db":{"status":"DOWN","details":{"error":"Connection refused"}},
              "ping":{"status":"UP"}},
             "groups":["liveness","readiness"]}
            """;

    private WebClientHealthProbeAdapter adapter;
    private DisposableServer server;

    @BeforeEach
    void setUp() {
        adapter = new WebClientHealthProbeAdapter(WebClient.builder(), new ObjectMapper());
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.disposeNow();
        }
    }

    @Test
    void actuatorDocumentWinsOverHttpStatus() {
        HealthReport report = adapter.interpret(503, ACTUATOR_DOWN, NOW);
        assertThat(report.status()).isEqualTo(HealthStatus.DOWN);
        assertThat(report.source()).isEqualTo(HealthSource.PROBE);
        assertThat(report.message()).isEqualTo("HTTP 503");
        assertThat(report.failing()).extracting(ComponentHealth::name).containsExactly("db");
        assertThat(report.failing().get(0).detail()).isEqualTo("error=Connection refused");

        HealthReport custom = adapter.interpret(200, "{\"status\":\"WARN\"}", NOW);
        assertThat(custom.status()).isEqualTo(HealthStatus.DEGRADED);
    }

    @Test
    void withoutAHealthDocumentTheHttpStatusDecides() {
        assertThat(adapter.interpret(200, "OK", NOW).status()).isEqualTo(HealthStatus.UP);
        assertThat(adapter.interpret(204, "", NOW).status()).isEqualTo(HealthStatus.UP);
        assertThat(adapter.interpret(200, "{\"foo\":1}", NOW).status()).isEqualTo(HealthStatus.UP);
        assertThat(adapter.interpret(200, "{not json", NOW).status()).isEqualTo(HealthStatus.UP);
        HealthReport down = adapter.interpret(500, "<html>boom</html>", NOW);
        assertThat(down.status()).isEqualTo(HealthStatus.DOWN);
        assertThat(down.message()).isEqualTo("HTTP 500");
    }

    @Test
    void connectionRefusedIsDownNotAnError() {
        HealthReport report = adapter.probe("http://127.0.0.1:1/actuator/health", Duration.ofSeconds(5), NOW)
                .block(Duration.ofSeconds(10));
        assertThat(report.status()).isEqualTo(HealthStatus.DOWN);
        assertThat(report.message()).startsWith("probe failed: ");
        assertThat(report.observedAt()).isEqualTo(NOW);
    }

    @Test
    void probesALiveActuatorEndpoint() {
        server = HttpServer.create().port(0)
                .route(routes -> routes.get("/actuator/health", (request, response) -> response
                        .status(503)
                        .header("Content-Type", "application/vnd.spring-boot.actuator.v3+json")
                        .sendString(Mono.just(ACTUATOR_DOWN))))
                .bindNow();

        HealthReport report = adapter.probe("http://localhost:" + server.port() + "/actuator/health",
                Duration.ofSeconds(5), NOW).block(Duration.ofSeconds(10));
        assertThat(report.status()).isEqualTo(HealthStatus.DOWN);
        assertThat(report.failing()).extracting(ComponentHealth::name).containsExactly("db");
        assertThat(report.message()).isEqualTo("HTTP 503");
    }

    @Test
    void slowEndpointIsDownAfterTheTimeout() {
        server = HttpServer.create().port(0)
                .route(routes -> routes.get("/slow", (request, response) -> response
                        .sendString(Mono.just("{\"status\":\"UP\"}").delayElement(Duration.ofSeconds(5)))))
                .bindNow();

        HealthReport report = adapter.probe("http://localhost:" + server.port() + "/slow",
                Duration.ofMillis(300), NOW).block(Duration.ofSeconds(10));
        assertThat(report.status()).isEqualTo(HealthStatus.DOWN);
        assertThat(report.message()).isEqualTo("probe failed: no response within 300ms");
    }
}
