package com.atlas.communication;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.reactive.server.WebTestClient;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * What a first-time API user sees in Swagger UI: the security scheme is named after the header it
 * fills, says what to paste, every operation documents the 401 for a missing id, and the spec
 * covers every /v1 surface.
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
    void everyOperationDocumentsTheMissingIdAnswerAndEverySurfaceIsListed() {
        JsonNode spec = client.get().uri("/v3/api-docs").exchange()
                .expectStatus().isOk()
                .expectBody(JsonNode.class).returnResult().getResponseBody();
        assertThat(spec).isNotNull();

        JsonNode paths = spec.path("paths");
        assertThat(paths.fieldNames()).toIterable().contains(
                "/v1/communications", "/v1/communications/{id}", "/v1/feed", "/v1/feed/stream",
                "/v1/admin/communications", "/v1/health/monitors", "/v1/health/reports");
        paths.fields().forEachRemaining(path -> path.getValue().fields().forEachRemaining(op -> {
            JsonNode unauthorized = op.getValue().path("responses").path("401");
            assertThat(unauthorized.isMissingNode())
                    .as("%s %s documents 401", op.getKey(), path.getKey()).isFalse();
            assertThat(unauthorized.path("description").asText()).contains("X-Client-Id");
        }));
    }
}
