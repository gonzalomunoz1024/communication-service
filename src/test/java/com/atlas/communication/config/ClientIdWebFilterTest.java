package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;

import reactor.core.publisher.Mono;
import tools.jackson.databind.ObjectMapper;

@ExtendWith(OutputCaptureExtension.class)
class ClientIdWebFilterTest {

    private static final ParameterizedTypeReference<Map<String, String>> ERROR =
            new ParameterizedTypeReference<>() { };

    @RestController
    static class EchoController {

        @GetMapping("/v1/echo")
        Mono<String> echo(ServerWebExchange exchange) {
            // typed default: a bare getAttribute() would resolve String.valueOf(char[])
            return Mono.just(exchange.getAttributeOrDefault(ClientIdWebFilter.ATTRIBUTE, "none"));
        }

        @PostMapping("/v1/echo")
        Mono<String> post(ServerWebExchange exchange) {
            return echo(exchange);
        }

        @GetMapping("/v3/api-docs")
        Mono<String> docs() {
            return Mono.just("docs");
        }

        @GetMapping("/actuator/health/readiness")
        Mono<String> readiness() {
            return Mono.just("{\"status\":\"UP\"}");
        }
    }

    private static WebTestClient client(boolean required) {
        return WebTestClient.bindToController(new EchoController())
                .webFilter(new ClientIdWebFilter(required, new ObjectMapper()))
                .build();
    }

    @Test
    void rejectsApiCallsThatDoNotSayWhoIsCalling() {
        client(true).post().uri("/v1/echo").exchange()
                .expectStatus().isUnauthorized()
                .expectHeader().contentType(MediaType.APPLICATION_JSON)
                .expectBody(ERROR).value(body -> assertThat(body.get("error"))
                        .contains("missing X-Client-Id").contains("repository name").contains("?clientId="));
        client(true).get().uri("/v1/echo").header(ClientIdWebFilter.HEADER, "   ").exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    void acceptsTheHeaderAndExposesItToHandlers() {
        client(true).get().uri("/v1/echo").header(ClientIdWebFilter.HEADER, " payments-api ").exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("payments-api");
    }

    @Test
    void acceptsTheQueryParameterForEventSourceClients() {
        client(true).get().uri("/v1/echo?clientId=checkout-web").exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("checkout-web");
        client(true).get().uri("/v1/echo?clientId=checkout-web")
                .header(ClientIdWebFilter.HEADER, "payments-api").exchange()
                .expectBody(String.class).isEqualTo("payments-api");
    }

    @Test
    void rejectsIdsThatAreNotRepositoryNames() {
        client(true).get().uri("/v1/echo").header(ClientIdWebFilter.HEADER, "not a repo!").exchange()
                .expectStatus().isBadRequest()
                .expectBody(ERROR).value(body -> assertThat(body.get("error")).contains("X-Client-Id must be"));
        client(true).get().uri("/v1/echo").header(ClientIdWebFilter.HEADER, "a".repeat(101)).exchange()
                .expectStatus().isBadRequest();
        client(true).get().uri("/v1/echo").header(ClientIdWebFilter.HEADER, "gonzalomunoz1024/communication-service")
                .exchange().expectStatus().isOk();
    }

    @Test
    void leavesNonApiPathsAndPreflightAlone() {
        client(true).get().uri("/v3/api-docs").exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("docs");
        client(true).options().uri("/v1/echo").exchange()
                .expectStatus().isOk();
    }

    @Test
    void logsEveryIdentifiedRequestWithItsOutcome(CapturedOutput output) {
        client(true).post().uri("/v1/echo").header(ClientIdWebFilter.HEADER, "vmforge-tools").exchange()
                .expectStatus().isOk();
        assertThat(output.getOut()).containsPattern("client=vmforge-tools POST /v1/echo -> 200 \\(\\d+ ms\\)");
    }

    @Test
    void letsProbesReachTheHealthEndpointWithoutAnId() {
        // kubelet probes cannot send X-Client-Id; /actuator/** is outside the identified surface
        client(true).get().uri("/actuator/health/readiness").exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("{\"status\":\"UP\"}");
    }

    @Test
    void canBeSwitchedOffForLocalExperiments() {
        client(false).get().uri("/v1/echo").exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("none");
    }
}
