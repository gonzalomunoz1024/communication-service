package com.atlas.communication.health.adapters.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ConnectException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.reactivestreams.Subscription;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;

import com.atlas.communication.LogCapture;
import com.atlas.communication.health.domain.ComponentHealth;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.fasterxml.jackson.databind.ObjectMapper;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import reactor.core.CoreSubscriber;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
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
    void aConnectFailureThatArrivesAfterTheProbeTimedOutIsOneDebugLineNotAnErrorWithATrace() throws InterruptedException {
        // The probe's timeout ends the exchange, but a connect already under way is not stopped by
        // that: its failure (refused, reset) can still arrive a moment later, after nobody waits
        // for it. Reactor's default for such a dropped error is an ERROR with the whole trace.
        CountDownLatch failedLate = new CountDownLatch(1);
        Mono<ClientResponse> connectUnderWay = new Mono<>() {
            @Override
            public void subscribe(CoreSubscriber<? super ClientResponse> actual) {
                actual.onSubscribe(new Subscription() {
                    @Override
                    public void request(long n) {
                        // the connect is already under way
                    }

                    @Override
                    public void cancel() {
                        // too late to stop it
                    }
                });
                Schedulers.parallel().schedule(() -> {
                    actual.onError(new ConnectException("Connection refused: /127.0.0.1:18555"));
                    failedLate.countDown();
                }, 300, TimeUnit.MILLISECONDS);
            }
        };
        WebClientHealthProbeAdapter lateFailure = new WebClientHealthProbeAdapter(
                WebClient.builder().exchangeFunction(request -> connectUnderWay), new ObjectMapper());

        try (LogCapture reactor = LogCapture.of("reactor.core.publisher.Operators");
                LogCapture probe = LogCapture.of(WebClientHealthProbeAdapter.class)) {
            HealthReport report = lateFailure.probe("http://127.0.0.1:18555/slow", Duration.ofMillis(100), NOW)
                    .block(Duration.ofSeconds(5));
            assertThat(report).isNotNull();
            assertThat(report.status()).isEqualTo(HealthStatus.DOWN);
            assertThat(report.message()).isEqualTo("probe failed: no response within 100ms");
            assertThat(failedLate.await(5, TimeUnit.SECONDS)).as("the late failure arrived").isTrue();

            assertThat(reactor.atLeast(Level.WARN)).extracting(ILoggingEvent::getFormattedMessage)
                    .as("nothing for a failure nobody waits for any more").isEmpty();
            List<ILoggingEvent> lines = probe.events();
            assertThat(lines).hasSize(1);
            assertThat(lines.get(0).getLevel()).isEqualTo(Level.DEBUG);
            assertThat(lines.get(0).getFormattedMessage())
                    .contains("http://127.0.0.1:18555/slow").contains("Connection refused");
            assertThat(lines.get(0).getThrowableProxy()).as("one line, no trace").isNull();
        }
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
