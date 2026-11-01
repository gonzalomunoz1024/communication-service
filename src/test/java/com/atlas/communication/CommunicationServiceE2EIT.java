package com.atlas.communication;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.FluxExchangeResult;
import org.springframework.test.web.reactive.server.WebTestClient;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationStatus;

import reactor.test.StepVerifier;

/**
 * Full-stack happy path against embedded Mongo: publish → feed → SSE → retire. Also pins the
 * error contract (validation 400, duplicate 409) and that the OpenAPI spec is served.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CommunicationServiceE2EIT {

    @Autowired
    private WebTestClient client;

    private Communication publishOutage(String externalRef) {
        return client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of(
                        "tenantId", "vmforge",
                        "publisher", "vmforge-sre",
                        "type", "OUTAGE",
                        "severity", "MAJOR",
                        "title", "API degradation in eu-west",
                        "body", "We are investigating **elevated errors**.",
                        "affectedServices", java.util.List.of("vm-api"),
                        "externalRef", externalRef))
                .exchange()
                .expectStatus().isCreated()
                .expectHeader().exists("Location")
                .expectBody(Communication.class)
                .returnResult().getResponseBody();
    }

    @Test
    void publishFeedStreamRetireRoundTrip() {
        Communication created = publishOutage("INC-e2e-1");
        assertThat(created.status()).isEqualTo(CommunicationStatus.ACTIVE);

        // visible in the pull feed
        client.get().uri("/v1/feed?tenantId=vmforge&service=vm-api")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.items[?(@.id=='%s')]".formatted(created.id())).exists();

        // subscribe to SSE: snapshot arrives first, then the live retired event
        FluxExchangeResult<CommunicationEvent> stream = client.get()
                .uri("/v1/feed/stream?tenantId=vmforge")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchange()
                .expectStatus().isOk()
                .returnResult(CommunicationEvent.class);

        StepVerifier.create(stream.getResponseBody()
                        .filter(e -> e.communication().id().equals(created.id()))
                        .take(2))
                .assertNext(e -> assertThat(e.type()).isEqualTo(CommunicationEventType.SNAPSHOT))
                .then(() -> client.post().uri("/v1/communications/{id}/retire", created.id())
                        .contentType(MediaType.APPLICATION_JSON)
                        .bodyValue(Map.of("actor", "admin", "note", "resolved"))
                        .exchange()
                        .expectStatus().isOk())
                .assertNext(e -> {
                    assertThat(e.type()).isEqualTo(CommunicationEventType.RETIRED);
                    assertThat(e.communication().status()).isEqualTo(CommunicationStatus.RETIRED);
                })
                .expectComplete()
                .verify(Duration.ofSeconds(30));

        // gone from the feed, still a permalink, visible to admin with audit history
        client.get().uri("/v1/feed?tenantId=vmforge&service=vm-api")
                .exchange()
                .expectBody()
                .jsonPath("$.items[?(@.id=='%s')]".formatted(created.id())).doesNotExist();
        client.get().uri("/v1/feed/{id}", created.id())
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("RETIRED");
        client.get().uri("/v1/admin/communications?tenantId=vmforge&status=RETIRED")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.items[?(@.id=='%s')].history".formatted(created.id())).exists();
    }

    @Test
    void validationAndConflictContracts() {
        // missing tenantId + title -> 400 with field messages
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("publisher", "sre", "type", "OUTAGE", "severity", "MAJOR"))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").exists();

        // maintenance without endsAt -> 400 from domain invariants
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre",
                        "type", "MAINTENANCE", "severity", "INFO", "title", "upgrade"))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg).contains("endsAt"));

        // duplicate externalRef -> 409
        publishOutage("INC-e2e-dup");
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "again", "externalRef", "INC-e2e-dup"))
                .exchange()
                .expectStatus().isEqualTo(409);

        // invalid enum -> 400, not 500
        client.get().uri("/v1/feed?tenantId=vmforge&type=NOPE")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    void openApiSpecIsServed() {
        client.get().uri("/v3/api-docs")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.info.title").isEqualTo("Communication Service")
                .jsonPath("$.paths['/v1/communications']").exists()
                .jsonPath("$.paths['/v1/feed/stream']").exists();
    }
}
