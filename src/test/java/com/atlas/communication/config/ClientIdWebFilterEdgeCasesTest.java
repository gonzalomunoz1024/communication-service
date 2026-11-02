package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.Closeable;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.WebFilterChain;

import com.atlas.communication.LogCapture;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * The filter's less common outcomes. A request that ends before anything set a status is logged
 * as {@code error} or {@code cancelled}, not as a 200; a blank {@code clientId} parameter is no id;
 * and when the error body cannot be serialised the caller still gets a JSON error.
 */
class ClientIdWebFilterEdgeCasesTest {

    private static final WebFilterChain UNREACHABLE = exchange -> Mono.error(new AssertionError("must not reach a handler"));

    private final ClientIdWebFilter filter = new ClientIdWebFilter(true, new ObjectMapper());

    private static MockServerWebExchange identified(String path) {
        return MockServerWebExchange.from(MockServerHttpRequest.get(path).header(ClientIdWebFilter.HEADER, "vmforge-tools"));
    }

    private static List<String> infoLines(LogCapture log) {
        return log.atLeast(Level.INFO).stream().map(ILoggingEvent::getFormattedMessage).toList();
    }

    @Test
    void aRequestWhoseHandlerFailsBeforeSettingAStatusIsLoggedAsError() {
        MockServerWebExchange exchange = identified("/v1/communications");

        try (LogCapture log = LogCapture.of(ClientIdWebFilter.class)) {
            StepVerifier.create(filter.filter(exchange, e -> Mono.error(new IllegalStateException("handler failed"))))
                    .verifyErrorMessage("handler failed");

            List<String> lines = infoLines(log);
            assertThat(lines).hasSize(1);
            assertThat(lines.get(0)).matches("client=vmforge-tools GET /v1/communications -> error \\(\\d+ ms\\)");
        }
    }

    @Test
    void aRequestTheCallerAbandonsBeforeAStatusIsSetIsLoggedAsCancelled() {
        MockServerWebExchange exchange = identified("/v1/feed/stream?tenantId=t1");

        try (LogCapture log = LogCapture.of(ClientIdWebFilter.class)) {
            StepVerifier.create(filter.filter(exchange, e -> Mono.never()))
                    .expectSubscription()
                    .thenCancel()
                    .verify();

            List<String> lines = infoLines(log);
            assertThat(lines).hasSize(1);
            assertThat(lines.get(0)).matches("client=vmforge-tools GET /v1/feed/stream -> cancelled \\(\\d+ ms\\)");
        }
    }

    @Test
    void aBlankClientIdParameterIsNoId() {
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.get("/v1/feed/stream?tenantId=t1&clientId={id}", "  "));

        StepVerifier.create(filter.filter(exchange, UNREACHABLE)).verifyComplete();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(exchange.getResponse().getBodyAsString().block()).contains("missing X-Client-Id");
    }

    @Test
    void anErrorBodyThatCannotBeSerialisedFallsBackToAFixedJsonError() {
        ObjectMapper broken = new ObjectMapper() {
            @Override
            public byte[] writeValueAsBytes(Object value) throws JsonProcessingException {
                throw new JsonMappingException((Closeable) null, "no serializer available");
            }
        };
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/v1/communications"));

        StepVerifier.create(new ClientIdWebFilter(true, broken).filter(exchange, UNREACHABLE)).verifyComplete();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(exchange.getResponse().getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_JSON);
        assertThat(exchange.getResponse().getBodyAsString().block()).isEqualTo("{\"error\":\"client id required\"}");
    }
}
