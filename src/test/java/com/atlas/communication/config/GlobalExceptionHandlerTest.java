package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ConnectException;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.LogCapture;
import com.mongodb.MongoSocketOpenException;
import com.mongodb.MongoTimeoutException;
import com.mongodb.ServerAddress;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * The error contract while the database cannot be reached: 503 with a plain sentence, the
 * driver's cluster description (which names internal addresses) in the log only, and no stack
 * trace above DEBUG. Anything else keeps its 500. The wording of an error body must not depend on
 * the locale of the JVM the service runs in.
 */
class GlobalExceptionHandlerTest {

    private static final ParameterizedTypeReference<Map<String, String>> ERROR =
            new ParameterizedTypeReference<>() { };
    /** What the driver says once server selection times out while Mongo is unreachable. */
    private static final String DRIVER_MESSAGE = "Timed out while waiting for a server that matches"
            + " ReadPreferenceServerSelector{readPreference=primary}. Client view of cluster state is"
            + " {type=UNKNOWN, servers=[{address=localhost:27020, type=UNKNOWN, state=CONNECTING,"
            + " exception={com.mongodb.MongoSocketOpenException: Exception opening socket}}]";

    @RestController
    static class FailingController {

        /** What Spring Data's exception translation hands the use cases. */
        @GetMapping("/v1/translated")
        Mono<String> translated() {
            return Mono.error(new DataAccessResourceFailureException(DRIVER_MESSAGE,
                    new MongoTimeoutException(DRIVER_MESSAGE)));
        }

        @GetMapping("/v1/raw-timeout")
        Mono<String> rawTimeout() {
            return Mono.error(new MongoTimeoutException(DRIVER_MESSAGE));
        }

        @GetMapping("/v1/raw-socket")
        Mono<String> rawSocket() {
            return Mono.error(new MongoSocketOpenException("Exception opening socket",
                    new ServerAddress("localhost", 27020), new ConnectException("Connection refused")));
        }

        @GetMapping("/v1/bug")
        Mono<String> bug() {
            return Mono.error(new IllegalStateException("a bug, not the database"));
        }
    }

    private final WebTestClient client = WebTestClient.bindToController(new FailingController())
            .controllerAdvice(new GlobalExceptionHandler())
            .build();

    @Test
    void anUnreachableDatabaseIs503WithoutTheDriversClusterDescription() {
        try (LogCapture log = LogCapture.of(GlobalExceptionHandler.class)) {
            for (String path : List.of("/v1/translated", "/v1/raw-timeout", "/v1/raw-socket")) {
                client.get().uri(path).exchange()
                        .expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                        .expectHeader().contentTypeCompatibleWith(MediaType.APPLICATION_JSON)
                        .expectBody(ERROR).value(body -> assertThat(body).as(path)
                                .containsExactly(Map.entry("error", "database unavailable")));
            }

            // the detail is for the operator: one WARN line per answer naming the cause, no stack trace
            List<ILoggingEvent> warnings = log.atLeast(Level.WARN);
            assertThat(warnings).hasSize(3);
            assertThat(warnings).allSatisfy(event -> {
                assertThat(event.getLevel()).isEqualTo(Level.WARN);
                assertThat(event.getFormattedMessage()).contains("database unavailable");
                assertThat(event.getThrowableProxy()).as("stack trace stays at DEBUG").isNull();
            });
            assertThat(warnings.get(0).getFormattedMessage()).contains("GET /v1/translated").contains("localhost:27020");
            assertThat(log.events()).filteredOn(event -> event.getLevel() == Level.DEBUG)
                    .as("the stack trace is available at DEBUG")
                    .isNotEmpty()
                    .allSatisfy(event -> assertThat(event.getThrowableProxy()).isNotNull());
        }
    }

    @Test
    void the503IsJsonEvenForARequestThatAcceptsOnlyAnEventStream() {
        // a stream that cannot open answers before its first byte, with the body every other
        // endpoint gives; written as an event-stream frame, an EventSource client could not read it
        client.get().uri("/v1/translated").accept(MediaType.TEXT_EVENT_STREAM).exchange()
                .expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                .expectHeader().contentType(MediaType.APPLICATION_JSON)
                .expectBody(String.class).isEqualTo("{\"error\":\"database unavailable\"}");
    }

    @Test
    void otherFailuresKeepTheir500AndTheirMessage() {
        client.get().uri("/v1/bug").exchange()
                .expectStatus().isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR)
                .expectBody(ERROR).value(body -> assertThat(body.get("error")).isEqualTo("a bug, not the database"));
    }

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();
    private Locale defaultLocale;

    @BeforeEach
    void rememberDefaultLocale() {
        defaultLocale = Locale.getDefault();
    }

    @AfterEach
    void restoreDefaultLocale() {
        Locale.setDefault(defaultLocale);
    }

    @Test
    void aStatusWithoutReasonLowerCasesItsPhraseTheSameWayInEveryLocale() {
        // Turkish lower-cases a capital I to a dotless ı: "Internal Server Error" would otherwise
        // come out as "ınternal server error" on a pod whose JVM runs with that default locale
        Locale.setDefault(Locale.forLanguageTag("tr-TR"));

        StepVerifier.create(handler.handleStatus(new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR)))
                .assertNext(response -> {
                    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
                    assertThat(response.getBody()).containsEntry("error", "internal server error");
                })
                .verifyComplete();
    }

    @Test
    void aStatusWithAReasonKeepsTheReason() {
        StepVerifier.create(handler.handleStatus(
                        new ResponseStatusException(HttpStatus.NOT_FOUND, "no such monitor: m1")))
                .assertNext(response -> {
                    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(response.getBody()).containsEntry("error", "no such monitor: m1");
                })
                .verifyComplete();
    }
}
