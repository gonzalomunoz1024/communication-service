package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.WebFilterChain;

import com.atlas.communication.LogCapture;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import tools.jackson.core.JacksonException;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.DatabindException;
import tools.jackson.databind.ObjectMapper;

/**
 * The filter's less common outcomes. A request that ends before anything set a status is logged
 * as {@code error} or {@code cancelled}, not as a 200; with the check switched off every request is
 * still logged; a blank {@code clientId} parameter is no id; and when the error body cannot be
 * serialised the caller still gets a JSON error.
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
    void withTheCheckSwitchedOffEveryRequestIsStillLoggedUnidentifiedOnesAsADash() {
        ClientIdWebFilter off = new ClientIdWebFilter(false, new ObjectMapper());
        WebFilterChain ok = exchange -> {
            exchange.getResponse().setStatusCode(HttpStatus.OK);
            return Mono.empty();
        };
        MockServerWebExchange anonymous = MockServerWebExchange.from(MockServerHttpRequest.get("/v1/communications"));
        MockServerWebExchange named = identified("/v1/communications");
        MockServerWebExchange malformed = MockServerWebExchange.from(
                MockServerHttpRequest.post("/v1/communications").header(ClientIdWebFilter.HEADER, "not a repo!"));

        try (LogCapture log = LogCapture.of(ClientIdWebFilter.class)) {
            StepVerifier.create(off.filter(anonymous, ok)).verifyComplete();
            StepVerifier.create(off.filter(named, ok)).verifyComplete();
            StepVerifier.create(off.filter(malformed, ok)).verifyComplete();

            List<String> lines = infoLines(log);
            assertThat(lines).hasSize(3);
            assertThat(lines.get(0)).matches("client=- GET /v1/communications -> 200 \\(\\d+ ms\\)");
            assertThat(lines.get(1)).matches("client=vmforge-tools GET /v1/communications -> 200 \\(\\d+ ms\\)");
            // an id that is not a repository name is not written to the log
            assertThat(lines.get(2)).matches("client=- POST /v1/communications -> 200 \\(\\d+ ms\\)");
        }
        assertThat(named.<String>getAttribute(ClientIdWebFilter.ATTRIBUTE)).isEqualTo("vmforge-tools");
        assertThat(anonymous.<String>getAttribute(ClientIdWebFilter.ATTRIBUTE)).isNull();
        assertThat(malformed.<String>getAttribute(ClientIdWebFilter.ATTRIBUTE)).isNull();
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
            public byte[] writeValueAsBytes(Object value) throws JacksonException {
                throw DatabindException.from((JsonGenerator) null, "no serializer available");
            }
        };
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/v1/communications"));

        StepVerifier.create(new ClientIdWebFilter(true, broken).filter(exchange, UNREACHABLE)).verifyComplete();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(exchange.getResponse().getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_JSON);
        assertThat(exchange.getResponse().getBodyAsString().block()).isEqualTo("{\"error\":\"client id required\"}");
    }
}
