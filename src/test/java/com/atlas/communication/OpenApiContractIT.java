package com.atlas.communication;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webtestclient.autoconfigure.AutoConfigureWebTestClient;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.MissingNode;

/**
 * What a first-time API user sees in Swagger UI: the security scheme is named after the header it
 * fills, says what to paste, every operation documents the 401 for a missing id, the spec
 * covers every /v1 surface, and the two fields people get wrong (externalRef, expectedVersion)
 * explain themselves where they are filled in. Every route documents the success answer it really
 * gives, the shared error answers that apply to it, and request examples the service accepts as they
 * are.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWebTestClient
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
        assertThat(scheme.path("type").asString()).isEqualTo("apiKey");
        assertThat(scheme.path("in").asString()).isEqualTo("header");
        assertThat(scheme.path("name").asString()).isEqualTo("X-Client-Id");
        assertThat(scheme.path("description").asString()).contains("Authorize").contains("repository name");

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
                .path("externalRef").path("description").asString();
        assertThat(externalRef).as("externalRef is described as permanent")
                .containsIgnoringCase("permanent").contains("idempotency").contains("follow-up");
        String expectedVersion = schemas.path("UpdateCommunicationCommand").path("properties")
                .path("expectedVersion").path("description").asString();
        assertThat(expectedVersion).as("expectedVersion says what to send and what the 409 means")
                .contains("version you last read").contains("409");

        JsonNode duplicate = spec.path("paths").path("/v1/communications").path("post")
                .path("responses").path("409");
        assertThat(duplicate.isMissingNode()).as("POST /v1/communications documents its 409").isFalse();
        assertThat(duplicate.path("description").asString()).contains("externalRef").contains("permanent");
        assertThat(duplicate.path("content").path("application/json").toString())
                .as("the example body shows the wording").contains("permanent idempotency key")
                .as("and the free follow-up value beside it").contains("suggestedExternalRef");
        JsonNode stale = spec.path("paths").path("/v1/communications/{id}").path("put")
                .path("responses").path("409");
        assertThat(stale.path("description").asString()).as("PUT documents its 409").contains("expectedVersion");
    }

    @Test
    void everyOperationDocumentsTheMissingIdAnswerAndEverySurfaceIsListed() {
        JsonNode spec = client.get().uri("/v3/api-docs").exchange()
                .expectStatus().isOk()
                .expectBody(JsonNode.class).returnResult().getResponseBody();
        assertThat(spec).isNotNull();

        JsonNode paths = spec.path("paths");
        assertThat(paths.propertyNames()).contains(
                "/v1/communications", "/v1/communications/{id}", "/v1/feed", "/v1/feed/stream",
                "/v1/admin/communications", "/v1/health/monitors", "/v1/health/reports");
        paths.properties().forEach(path -> path.getValue().properties().forEach(op -> {
            JsonNode unauthorized = op.getValue().path("responses").path("401");
            assertThat(unauthorized.isMissingNode())
                    .as("%s %s documents 401", op.getKey(), path.getKey()).isFalse();
            assertThat(unauthorized.path("description").asString()).contains("X-Client-Id");
        }));
    }

    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** The success answer of every route, as the service gives it: what a client codes against. */
    private static final Map<String, String> SUCCESS = Map.ofEntries(
            Map.entry("post /v1/communications", "201"),
            Map.entry("get /v1/communications", "200"),
            Map.entry("get /v1/communications/{id}", "200"),
            Map.entry("put /v1/communications/{id}", "200"),
            Map.entry("post /v1/communications/{id}/publish", "200"),
            Map.entry("post /v1/communications/{id}/retire", "200"),
            Map.entry("get /v1/feed", "200"),
            Map.entry("get /v1/feed/{id}", "200"),
            Map.entry("get /v1/feed/stream", "200"),
            Map.entry("get /v1/admin/communications", "200"),
            Map.entry("get /v1/admin/tenants", "200"),
            Map.entry("post /v1/admin/communications/{id}/retire", "200"),
            Map.entry("delete /v1/admin/communications/{id}", "204"),
            Map.entry("get /v1/health/monitors", "200"),
            Map.entry("post /v1/health/monitors", "201"),
            Map.entry("get /v1/health/monitors/{id}", "200"),
            Map.entry("get /v1/health/monitors/{id}/instances", "200"),
            Map.entry("delete /v1/health/monitors/{id}", "204"),
            Map.entry("post /v1/health/monitors/{id}/probe", "200"),
            Map.entry("post /v1/health/reports", "202"));

    /** Where the service answers 409: a reused externalRef, a stale version or a state that forbids the change. */
    private static final List<String> CONFLICTS = List.of(
            "post /v1/communications", "put /v1/communications/{id}", "post /v1/communications/{id}/publish",
            "post /v1/communications/{id}/retire", "post /v1/admin/communications/{id}/retire",
            "post /v1/health/monitors", "post /v1/health/monitors/{id}/probe");

    @Test
    void everyRouteDocumentsTheSuccessAnswerItGives() {
        JsonNode spec = spec();
        Map<String, String> documented = new TreeMap<>();
        operations(spec).forEach((route, operation) -> documented.put(route, String.join(",",
                operation.path("responses").propertyNames().stream().filter(code -> code.startsWith("2")).toList())));
        assertThat(documented).isEqualTo(new TreeMap<>(SUCCESS));

        operations(spec).forEach((route, operation) -> {
            String code = SUCCESS.get(route);
            JsonNode content = operation.path("responses").path(code).path("content");
            if ("204".equals(code)) {
                assertThat(content.isMissingNode()).as("%s %s has no body", route, code).isTrue();
                return;
            }
            String type = route.equals("get /v1/feed/stream") ? "text/event-stream" : MediaType.APPLICATION_JSON_VALUE;
            assertThat(content.propertyNames()).as("%s %s media type", route, code).containsExactly(type);
            assertThat(content.path(type).path("schema").isEmpty()).as("%s %s names its schema", route, code).isFalse();
        });
        for (String created : List.of("post /v1/communications", "post /v1/health/monitors")) {
            assertThat(operations(spec).get(created).path("responses").path("201").path("headers").has("Location"))
                    .as("%s documents the Location of what it created", created).isTrue();
        }
    }

    @Test
    void everyOperationDocumentsTheSharedErrorAnswersThatApplyToIt() {
        JsonNode spec = spec();
        JsonNode error = spec.path("components").path("schemas").path("Error");
        assertThat(error.path("properties").propertyNames()).as("the {\"error\"} body").containsExactly("error");
        for (String shared : List.of("BadRequest", "NotFound", "ServiceUnavailable")) {
            JsonNode json = spec.path("components").path("responses").path(shared).path("content").path("application/json");
            assertThat(json.path("schema").path("$ref").asString()).as(shared).isEqualTo("#/components/schemas/Error");
            assertThat(json.path("example").path("error").asString()).as("%s example", shared).isNotBlank();
        }

        TreeSet<String> conflicts = new TreeSet<>();
        operations(spec).forEach((route, operation) -> {
            JsonNode responses = operation.path("responses");
            assertThat(responses.path("400").path("$ref").asString()).as("%s documents the shared 400", route)
                    .isEqualTo("#/components/responses/BadRequest");
            assertThat(responses.path("503").path("$ref").asString()).as("%s documents the 503", route)
                    .isEqualTo("#/components/responses/ServiceUnavailable");
            assertThat(responses.path("404").path("$ref").asString()).as("%s documents a 404 if it takes an id", route)
                    .isEqualTo(route.contains("{id}") ? "#/components/responses/NotFound" : "");
            if (responses.has("409")) {
                conflicts.add(route);
                assertThat(responses.path("409").path("content").path("application/json").isMissingNode())
                        .as("%s 409 body", route).isFalse();
            }
        });
        assertThat(conflicts).as("the routes that answer 409").containsExactlyElementsOf(new TreeSet<>(CONFLICTS));
    }

    @Test
    void everyRequestExampleIsAcceptedByItsRouteAsItIs() {
        JsonNode spec = spec();
        Map<String, List<String>> examples = new TreeMap<>();
        operations(spec).forEach((route, operation) -> {
            if (operation.has("requestBody")) {
                JsonNode json = operation.path("requestBody").path("content").path("application/json");
                List<String> bodies = new ArrayList<>();
                json.path("examples").properties().forEach(example -> bodies.add(example.getValue().path("value").toString()));
                examples.put(route, bodies);
            }
        });
        assertThat(examples.keySet()).as("the routes that take a body").containsExactly(
                "post /v1/admin/communications/{id}/retire", "post /v1/communications",
                "post /v1/communications/{id}/retire", "post /v1/health/monitors", "post /v1/health/reports",
                "put /v1/communications/{id}");
        examples.forEach((route, bodies) -> assertThat(bodies).as("%s has a request example", route).isNotEmpty());

        // the publish example makes the notice that the update and retire examples then change
        String id = null;
        for (String body : examples.get("post /v1/communications")) {
            String created = send(HttpMethod.POST, "/v1/communications", body, 201).path("id").asString();
            id = id == null ? created : id;
        }
        for (String body : examples.get("put /v1/communications/{id}")) {
            send(HttpMethod.PUT, "/v1/communications/" + id, body, 200);
        }
        for (String body : examples.get("post /v1/communications/{id}/retire")) {
            send(HttpMethod.POST, "/v1/communications/" + id + "/retire", body, 200);
        }
        for (String body : examples.get("post /v1/admin/communications/{id}/retire")) {
            send(HttpMethod.POST, "/v1/admin/communications/" + id + "/retire", body, 200);
        }
        // the report example goes to the push-only monitor example's service: one monitor, two answers
        TreeSet<String> monitors = new TreeSet<>();
        for (String body : examples.get("post /v1/health/monitors")) {
            monitors.add(send(HttpMethod.POST, "/v1/health/monitors", body, 201).path("id").asString());
        }
        for (String body : examples.get("post /v1/health/reports")) {
            monitors.add(send(HttpMethod.POST, "/v1/health/reports", body, 202).path("id").asString());
        }

        // leave nothing behind for the tests that share this database
        monitors.forEach(monitor -> send(HttpMethod.DELETE, "/v1/health/monitors/" + monitor, null, 204));
        send(HttpMethod.GET, "/v1/admin/communications?tenantId=acme&size=100", null, 200).path("items")
                .forEach(notice -> send(HttpMethod.DELETE, "/v1/admin/communications/" + notice.path("id").asString(),
                        null, 204));
    }

    private JsonNode spec() {
        JsonNode spec = client.get().uri("/v3/api-docs").exchange()
                .expectStatus().isOk()
                .expectBody(JsonNode.class).returnResult().getResponseBody();
        assertThat(spec).isNotNull();
        return spec;
    }

    /** Every /v1 operation by "method path", e.g. "post /v1/communications" (tests add a fake actuator route). */
    private static Map<String, JsonNode> operations(JsonNode spec) {
        Map<String, JsonNode> operations = new TreeMap<>();
        spec.path("paths").properties().stream().filter(path -> path.getKey().startsWith("/v1/"))
                .forEach(path -> path.getValue().properties()
                        .forEach(op -> operations.put(op.getKey() + " " + path.getKey(), op.getValue())));
        return operations;
    }

    private JsonNode send(HttpMethod method, String uri, String json, int status) {
        WebTestClient.RequestBodySpec request = client.method(method).uri(uri).header("X-Client-Id", "openapi-contract");
        WebTestClient.RequestHeadersSpec<?> ready = json == null ? request
                : request.contentType(MediaType.APPLICATION_JSON).bodyValue(json);
        byte[] body = ready.exchange()
                .expectStatus().value(actual -> assertThat(actual).as("%s %s with %s", method, uri, json).isEqualTo(status))
                .expectBody().returnResult().getResponseBody();
        return body == null || body.length == 0 ? MissingNode.getInstance() : JSON.readTree(body);
    }
}
