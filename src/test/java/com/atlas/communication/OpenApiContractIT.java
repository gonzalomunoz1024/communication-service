package com.atlas.communication;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.reactive.server.WebTestClient;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * What a first-time API user sees in Swagger UI: the security scheme is named after the header it
 * fills, says what to paste, every operation documents the 401 for a missing id, the spec
 * covers every /v1 surface, and the two fields people get wrong (externalRef, expectedVersion)
 * explain themselves where they are filled in.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OpenApiContractIT {

    @Autowired
    private WebTestClient client;

    @Test
    void theSecuritySchemeTellsTheUserWhatToPaste() {
        JsonNode spec = client.get().uri("/v3/api-docs").exchange()
                .expectStatus().isOk()
                .expectBody(JsonNode.class).returnResult().getResponseBody();
        assertThat(spec).isNotNull();

        JsonNode scheme = spec.path("components").path("securitySchemes").path("X-Client-Id");
        assertThat(scheme.isMissingNode()).as("scheme named after the header").isFalse();
        assertThat(scheme.path("type").asText()).isEqualTo("apiKey");
        assertThat(scheme.path("in").asText()).isEqualTo("header");
        assertThat(scheme.path("name").asText()).isEqualTo("X-Client-Id");
        assertThat(scheme.path("description").asText()).contains("Authorize").contains("repository name");

        assertThat(spec.path("security").toString()).as("the scheme is required globally").contains("X-Client-Id");
    }

    @Test
    void theIdempotencyKeyAndTheVersionCheckExplainThemselves() {
        JsonNode spec = client.get().uri("/v3/api-docs").exchange()
                .expectStatus().isOk()
                .expectBody(JsonNode.class).returnResult().getResponseBody();
        assertThat(spec).isNotNull();
        JsonNode schemas = spec.path("components").path("schemas");

        String externalRef = schemas.path("CreateCommunicationCommand").path("properties")
                .path("externalRef").path("description").asText();
        assertThat(externalRef).as("externalRef is described as permanent")
                .containsIgnoringCase("permanent").contains("idempotency").contains("follow-up");
        String expectedVersion = schemas.path("UpdateCommunicationCommand").path("properties")
                .path("expectedVersion").path("description").asText();
        assertThat(expectedVersion).as("expectedVersion says what to send and what the 409 means")
                .contains("version you last read").contains("409");

        JsonNode duplicate = spec.path("paths").path("/v1/communications").path("post")
                .path("responses").path("409");
        assertThat(duplicate.isMissingNode()).as("POST /v1/communications documents its 409").isFalse();
        assertThat(duplicate.path("description").asText()).contains("externalRef").contains("permanent");
        assertThat(duplicate.path("content").path("application/json").toString())
                .as("the example body shows the wording").contains("permanent idempotency key");
        JsonNode stale = spec.path("paths").path("/v1/communications/{id}").path("put")
                .path("responses").path("409");
        assertThat(stale.path("description").asText()).as("PUT documents its 409").contains("expectedVersion");
    }

    @Test
    void everyOperationDocumentsTheMissingIdAnswerAndEverySurfaceIsListed() {
        JsonNode spec = client.get().uri("/v3/api-docs").exchange()
                .expectStatus().isOk()
                .expectBody(JsonNode.class).returnResult().getResponseBody();
        assertThat(spec).isNotNull();

        JsonNode paths = spec.path("paths");
        assertThat(paths.fieldNames()).toIterable().contains(
                "/v1/communications", "/v1/communications/{id}", "/v1/feed", "/v1/feed/stream",
                "/v1/admin/communications", "/v1/health/monitors", "/v1/health/reports");
        paths.properties().forEach(path -> path.getValue().properties().forEach(op -> {
            JsonNode unauthorized = op.getValue().path("responses").path("401");
            assertThat(unauthorized.isMissingNode())
                    .as("%s %s documents 401", op.getKey(), path.getKey()).isFalse();
            assertThat(unauthorized.path("description").asText()).contains("X-Client-Id");
        }));
    }
}
