package com.atlas.communication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;

import java.net.ConnectException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.actuate.health.HealthEndpointGroup;
import org.springframework.boot.actuate.health.HealthEndpointGroups;
import org.springframework.boot.actuate.health.ReactiveHealthContributorRegistry;
import org.springframework.boot.actuate.health.ReactiveHealthIndicator;
import org.springframework.boot.actuate.health.Status;
import org.springframework.boot.autoconfigure.mongo.MongoClientSettingsBuilderCustomizer;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.server.adapter.HttpWebHandlerAdapter;

import com.atlas.communication.common.ports.outbound.CommunicationEventsPort;
import com.atlas.communication.config.ClientIdWebFilter;
import com.atlas.communication.config.GlobalExceptionHandler;
import com.atlas.communication.feed.adapters.inbound.RestControllerFeedAdapter;
import com.mongodb.MongoClientSettings;
import com.mongodb.MongoSocketOpenException;
import com.mongodb.MongoTimeoutException;
import com.mongodb.ServerAddress;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * The operational surface a cluster relies on: liveness and readiness probes answer without a
 * client id, readiness reflects MongoDB, and nothing else under /actuator is exposed.
 * <p>
 * The service refuses to start without MongoDB (index creation runs at startup), so "readiness is
 * 503 while Mongo is unreachable" cannot be reproduced with a context that never had a database;
 * the wiring that produces it is asserted instead: the readiness group contains the {@code mongo}
 * indicator, and that indicator is the real reactive one answering from the running database. A
 * stream opened during an outage is reproduced by making the event log's queries fail the way they
 * do once server selection gives up.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OperationsEndpointsIT {

    @Autowired
    private WebTestClient client;
    @Autowired
    private HealthEndpointGroups groups;
    @Autowired
    private ReactiveHealthContributorRegistry contributors;
    @Autowired
    private ObjectProvider<MongoClientSettingsBuilderCustomizer> clientCustomizers;
    @MockitoSpyBean
    private CommunicationEventsPort events;
    @LocalServerPort
    private int port;

    @Test
    void readinessIsUpWhenMongoAnswers() {
        client.get().uri("/actuator/health/readiness").exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("UP");
    }

    @Test
    void livenessIsUp() {
        client.get().uri("/actuator/health/liveness").exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("UP");
    }

    @Test
    void overallHealthNeedsNoClientIdAndHidesDetails() {
        client.get().uri("/actuator/health").exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("UP")
                .jsonPath("$.components").doesNotExist()
                .jsonPath("$.details").doesNotExist();
    }

    @Test
    void readinessAsksMongoAndLivenessDoesNot() {
        HealthEndpointGroup readiness = groups.get("readiness");
        assertThat(readiness.isMember("readinessState")).isTrue();
        assertThat(readiness.isMember("mongo")).as("readiness includes the Mongo indicator").isTrue();
        HealthEndpointGroup liveness = groups.get("liveness");
        assertThat(liveness.isMember("livenessState")).isTrue();
        assertThat(liveness.isMember("mongo")).as("a lost database must not restart the pod").isFalse();

        ReactiveHealthIndicator mongo = (ReactiveHealthIndicator) contributors.getContributor("mongo");
        assertThat(mongo).as("the reactive Mongo indicator is registered").isNotNull();
        assertThat(mongo.health().block(Duration.ofSeconds(10)).getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void theMongoClientGivesUpOnAnUnreachableDatabaseWithinSeconds() {
        // the settings the reactive client is built with: Boot applies every customizer, in
        // order, to a fresh builder (ReactiveMongoClientFactory); with the driver's own defaults
        // readiness and every API call wait 30 s before answering while Mongo is unreachable
        MongoClientSettings.Builder builder = MongoClientSettings.builder();
        clientCustomizers.orderedStream().forEach(customizer -> customizer.customize(builder));
        MongoClientSettings settings = builder.build();

        assertThat(settings.getClusterSettings().getServerSelectionTimeout(TimeUnit.MILLISECONDS))
                .as("server selection timeout").isEqualTo(5000);
        assertThat(settings.getSocketSettings().getConnectTimeout(TimeUnit.MILLISECONDS))
                .as("connect timeout").isEqualTo(5000);
        assertThat(settings.getSocketSettings().getReadTimeout(TimeUnit.MILLISECONDS))
                .as("socket read timeout").isEqualTo(15000);
    }

    /** The three forms the 503 mapping knows: Spring's translation and the driver's own two. */
    private static Map<String, RuntimeException> databaseUnavailable() {
        String driver = "Timed out while waiting for a server that matches ReadPreferenceServerSelector"
                + "{readPreference=primary}. Client view of cluster state is {type=UNKNOWN, servers=["
                + "{address=localhost:27099, type=UNKNOWN, state=CONNECTING}]";
        return Map.of(
                "translated", new DataAccessResourceFailureException(driver, new MongoTimeoutException(driver)),
                "timeout", new MongoTimeoutException(driver),
                "socket", new MongoSocketOpenException("Exception opening socket",
                        new ServerAddress("localhost", 27099), new ConnectException("Connection refused")));
    }

    @Test
    void aStreamOpenedWhileTheDatabaseIsUnreachableIs503BeforeAnyByteWithOneWarning() {
        // The stream reads the event log's head before it answers: when that query gives up, the
        // answer is not committed yet, so the client gets the 503 every other endpoint gives and
        // its own reconnect backoff applies, instead of a 200 that ends a moment later.
        WebClient raw = WebClient.create("http://localhost:" + port);

        databaseUnavailable().forEach((form, failure) -> {
            // a query that waits a moment and then fails, like server selection timing out
            doReturn(Mono.delay(Duration.ofMillis(300)).then(Mono.error(failure))).when(events).head();
            doReturn(Mono.delay(Duration.ofMillis(300)).then(Mono.error(failure)))
                    .when(events).canResumeAfter(anyLong());

            for (String uri : List.of("/v1/feed/stream?tenantId=ops-outage",
                    "/v1/feed/stream?tenantId=ops-outage&lastEventId=1")) {
                String what = form + " " + uri;
                try (LogCapture feed = LogCapture.of(RestControllerFeedAdapter.class);
                        LogCapture handler = LogCapture.of(GlobalExceptionHandler.class);
                        LogCapture web = LogCapture.of(HttpWebHandlerAdapter.class);
                        LogCapture server = LogCapture.of("reactor.netty.http.server.HttpServerOperations")) {
                    String answer = raw.get().uri(uri)
                            .header(ClientIdWebFilter.HEADER, "communication-service-tests")
                            .accept(MediaType.TEXT_EVENT_STREAM)
                            .exchangeToMono(response -> response.bodyToMono(String.class)
                                    .defaultIfEmpty("")
                                    .map(body -> response.statusCode().value() + " "
                                            + response.headers().contentType().map(MediaType::toString).orElse("-")
                                            + " " + body))
                            .block(Duration.ofSeconds(10));

                    assertThat(answer).as(what).isEqualTo("503 application/json {\"error\":\"database unavailable\"}");
                    List<String> logged = Stream.of(feed, handler, web, server)
                            .flatMap(capture -> capture.atLeast(Level.WARN).stream())
                            .map(OperationsEndpointsIT::describe)
                            .toList();
                    assertThat(logged).as("%s: WARN and above", what)
                            .noneMatch(line -> line.startsWith("ERROR"))
                            .containsExactly("WARN " + GlobalExceptionHandler.class.getName()
                                    + ": GET /v1/feed/stream -> 503, database unavailable: " + failure.getMessage());
                    assertThat(handler.atLeast(Level.WARN).get(0).getThrowableProxy())
                            .as("%s: no stack trace above DEBUG", what).isNull();
                }
            }
        });
    }

    @Test
    void aStreamWhoseDatabaseGoesAwayAfterItOpenedEndsWithOneWarningAndNoError() {
        // The head was read and the answer committed with ": connected"; then the snapshot (or the
        // resume check) asks the event log and that query gives up. A 503 can no longer be sent:
        // the stream ends, and the client reconnects with its backoff.
        WebClient raw = WebClient.create("http://localhost:" + port);

        databaseUnavailable().forEach((form, failure) -> {
            Mono<Long> givesUp = Mono.delay(Duration.ofMillis(300)).then(Mono.error(failure));
            for (String uri : List.of("/v1/feed/stream?tenantId=ops-outage",
                    "/v1/feed/stream?tenantId=ops-outage&lastEventId=1")) {
                String what = form + " " + uri;
                // the first read answers, every later one gives up
                doReturn(Mono.just(0L), givesUp).when(events).head();
                doReturn(givesUp).when(events).canResumeAfter(anyLong());
                try (LogCapture feed = LogCapture.of(RestControllerFeedAdapter.class);
                        LogCapture handler = LogCapture.of(GlobalExceptionHandler.class);
                        LogCapture web = LogCapture.of(HttpWebHandlerAdapter.class);
                        LogCapture server = LogCapture.of("reactor.netty.http.server.HttpServerOperations")) {
                    AtomicReference<Throwable> clientError = new AtomicReference<>();
                    String received = raw.get().uri(uri)
                            .header(ClientIdWebFilter.HEADER, "communication-service-tests")
                            .accept(MediaType.TEXT_EVENT_STREAM)
                            .exchangeToFlux(response -> response.bodyToFlux(DataBuffer.class))
                            .map(buffer -> {
                                String text = buffer.toString(StandardCharsets.UTF_8);
                                DataBufferUtils.release(buffer);
                                return text;
                            })
                            .onErrorResume(e -> {
                                clientError.set(e);
                                return Flux.empty();
                            })
                            .collectList()
                            .map(parts -> String.join("", parts))
                            .block(Duration.ofSeconds(10));

                    List<String> logged = Stream.of(feed, handler, web, server)
                            .flatMap(capture -> capture.atLeast(Level.WARN).stream())
                            .map(OperationsEndpointsIT::describe)
                            .toList();
                    assertThat(logged).as("%s: WARN and above", what)
                            .noneMatch(line -> line.startsWith("ERROR"))
                            .containsExactly("WARN " + RestControllerFeedAdapter.class.getName()
                                    + ": feed stream closed: database unavailable: " + failure.getMessage());
                    assertThat(feed.atLeast(Level.WARN).get(0).getThrowableProxy())
                            .as("%s: no stack trace above DEBUG", what).isNull();
                    assertThat(clientError.get()).as("%s: the stream ends cleanly", what).isNull();
                    assertThat(received).as(what).startsWith(":connected");
                }
            }
        });
    }

    private static String describe(ILoggingEvent event) {
        return event.getLevel() + " " + event.getLoggerName() + ": " + event.getFormattedMessage();
    }

    @Test
    void onlyHealthIsExposed() {
        client.get().uri("/actuator/env").exchange().expectStatus().isNotFound();
        client.get().uri("/actuator/beans").exchange().expectStatus().isNotFound();
        client.get().uri("/actuator/configprops").exchange().expectStatus().isNotFound();
    }
}
