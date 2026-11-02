package com.atlas.communication;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webtestclient.autoconfigure.AutoConfigureWebTestClient;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.FluxExchangeResult;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.function.client.WebClient;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.Ticket;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.config.ClientIdWebFilter;

import reactor.test.StepVerifier;

/**
 * Full-stack happy path against embedded Mongo: publish → feed → SSE → retire. Also pins the
 * error contract (validation 400, duplicate 409) and that the OpenAPI spec is served.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWebTestClient
class CommunicationServiceE2EIT {

    @Autowired
    private WebTestClient client;
    @LocalServerPort
    private int port;

    @BeforeEach
    void identifyAsTestClient() {
        client = client.mutate()
                .defaultHeader(ClientIdWebFilter.HEADER, "communication-service-tests")
                .build();
    }

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
                        "externalRef", externalRef,
                        "ticket", Map.of("number", "INC0012345")))
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
    void reconnectingWithLastEventIdReplaysWhatWasMissed() {
        Communication first = publishOutage("INC-e2e-replay-1");

        // first connection: remember the id of the first frame about our outage (a snapshot
        // stamped with the log position, or the live created event, whichever comes first)
        CommunicationEvent seen = client.get()
                .uri("/v1/feed/stream?tenantId=vmforge&service=vm-api")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchange()
                .expectStatus().isOk()
                .returnResult(CommunicationEvent.class)
                .getResponseBody()
                .filter(e -> e.communication().id().equals(first.id()))
                .blockFirst(Duration.ofSeconds(30));
        assertThat(seen).isNotNull();

        // while disconnected: the outage is retired and another one is published
        client.post().uri("/v1/communications/{id}/retire", first.id())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("actor", "admin", "note", "resolved"))
                .exchange()
                .expectStatus().isOk();
        Communication second = publishOutage("INC-e2e-replay-2");

        // reconnect with Last-Event-ID: the gap is replayed in order, with no snapshot frames
        Set<String> ours = Set.of(first.id(), second.id());
        FluxExchangeResult<CommunicationEvent> resumed = client.get()
                .uri("/v1/feed/stream?tenantId=vmforge&service=vm-api")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .header("Last-Event-ID", Long.toString(seen.seq()))
                .exchange()
                .expectStatus().isOk()
                .returnResult(CommunicationEvent.class);
        StepVerifier.create(resumed.getResponseBody()
                        .doOnNext(e -> assertThat(e.type()).isNotEqualTo(CommunicationEventType.SNAPSHOT))
                        .filter(e -> ours.contains(e.communication().id()))
                        // the first outage's created event may precede the snapshot we resumed from
                        .skipWhile(e -> e.type() == CommunicationEventType.CREATED
                                && e.communication().id().equals(first.id()))
                        .take(2))
                .assertNext(e -> {
                    assertThat(e.type()).isEqualTo(CommunicationEventType.RETIRED);
                    assertThat(e.communication().id()).isEqualTo(first.id());
                })
                .assertNext(e -> {
                    assertThat(e.type()).isEqualTo(CommunicationEventType.CREATED);
                    assertThat(e.communication().id()).isEqualTo(second.id());
                })
                .expectComplete()
                .verify(Duration.ofSeconds(30));
    }

    @Test
    void streamIsCommittedAtOnceForATenantWithNothingVisible() {
        // nothing is visible for this tenant, so no snapshot frame will ever be written; the
        // status, headers and an opening comment must still reach the client immediately
        // (before this fix they arrived with the first keepalive, 15 s in)
        WebClient raw = WebClient.create("http://localhost:" + port);
        long started = System.nanoTime();
        String firstBytes = raw.get()
                .uri("/v1/feed/stream?tenantId=nobody-publishes-here-" + started)
                .header(ClientIdWebFilter.HEADER, "communication-service-tests")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchangeToFlux(response -> {
                    assertThat(response.statusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(response.headers().contentType()).hasValueSatisfying(type ->
                            assertThat(type.isCompatibleWith(MediaType.TEXT_EVENT_STREAM)).isTrue());
                    return response.bodyToFlux(DataBuffer.class)
                            .map(buffer -> {
                                String text = buffer.toString(StandardCharsets.UTF_8);
                                DataBufferUtils.release(buffer);
                                return text;
                            });
                })
                .next()
                .block(Duration.ofSeconds(5));
        long elapsedMs = Duration.ofNanos(System.nanoTime() - started).toMillis();

        assertThat(firstBytes).startsWith(":connected");
        assertThat(elapsedMs).as("time to first bytes").isLessThan(2000);
    }

    @Test
    void ticketContracts() {
        // a ticket is optional; one given is normalised, linked into the configured instance,
        // and becomes the externalRef unless one was set
        Map<String, Object> withTicket = Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                "severity", "MAJOR", "title", "with ticket", "ticket", Map.of("number", " inc0077001 "));
        Communication created = client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(withTicket)
                .exchange()
                .expectStatus().isCreated()
                .expectBody(Communication.class)
                .returnResult().getResponseBody();
        assertThat(created.ticket()).isEqualTo(new Ticket("servicenow", "INC0077001",
                "https://acme.service-now.com/nav_to.do?uri=incident.do%3Fsysparm_query%3Dnumber%3DINC0077001"));
        assertThat(created.externalRef()).isEqualTo("INC0077001");

        // the feed carries it, and the same ticket again is the same notice (409 through externalRef)
        client.get().uri("/v1/feed?tenantId=vmforge&type=OUTAGE")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.items[?(@.id=='" + created.id() + "')].ticket.number").isEqualTo("INC0077001")
                .jsonPath("$.items[?(@.id=='" + created.id() + "')].ticket.url").isEqualTo(created.ticket().url());
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(withTicket)
                .exchange()
                .expectStatus().isEqualTo(409);

        // a number that is not an incident -> 400
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "bad ticket", "ticket", Map.of("number", "INC-4821")))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg).contains("INC-4821"));

        // a ticket can be attached later, and the audit says so
        Communication draft = client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "ticket comes later", "draft", true))
                .exchange()
                .expectStatus().isCreated()
                .expectBody(Communication.class)
                .returnResult().getResponseBody();
        assertThat(draft.ticket()).isNull();
        client.put().uri("/v1/communications/{id}", draft.id())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("ticket", Map.of("number", "INC0077002"), "expectedVersion", draft.version()))
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.ticket.number").isEqualTo("INC0077002")
                .jsonPath("$.history[2].action").isEqualTo("ticket attached: INC0077002");
        client.post().uri("/v1/communications/{id}/publish", draft.id())
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("ACTIVE")
                .jsonPath("$.ticket.number").isEqualTo("INC0077002");
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

        // duplicate externalRef -> 409 whose body names the notice holding it and says the key is permanent
        Communication dupHolder = publishOutage("INC-e2e-dup");
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "again", "externalRef", "INC-e2e-dup"))
                .exchange()
                .expectStatus().isEqualTo(409)
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .contains("permanent").contains(dupHolder.id()).contains("INC-e2e-dup-2"));

        // invalid enum -> 400, not 500
        client.get().uri("/v1/feed?tenantId=vmforge&type=NOPE")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    void publisherAndAdminReadsReportTheEffectiveStatusBeforeTheSweeperRuns() {
        // published when its window had already closed: ACTIVE in the store until the status sweep
        // (every 60 s in tests) converges it, EXPIRED for every reader from the start
        String tenant = "vmforge-lapsed-" + System.nanoTime();
        Instant now = Instant.now();
        Communication lapsed = client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", tenant, "publisher", "vmforge-sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "over before it was published",
                        "startsAt", now.minusSeconds(7200).toString(),
                        "expiresAt", now.minusSeconds(3600).toString()))
                .exchange()
                .expectStatus().isCreated()
                .expectBody(Communication.class)
                .returnResult().getResponseBody();
        String item = "$.items[?(@.id=='%s')]".formatted(lapsed.id());

        client.get().uri("/v1/feed/{id}", lapsed.id()).exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.status").isEqualTo("EXPIRED");
        client.get().uri("/v1/communications/{id}", lapsed.id()).exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("EXPIRED")
                .jsonPath("$.version").isEqualTo(0)
                .jsonPath("$.history.length()").isEqualTo(1);
        client.get().uri("/v1/communications?tenantId={tenant}", tenant).exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath(item + ".status").isEqualTo("EXPIRED");
        client.get().uri("/v1/admin/communications?tenantId={tenant}", tenant).exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath(item + ".status").isEqualTo("EXPIRED");
        assertThat(lapsed.status()).as("the publish answer").isEqualTo(CommunicationStatus.EXPIRED);
    }

    @Test
    void anExpiryBeforeTheDefaultedStartAndAMissingVersionSayWhatWasSentAndWhatToSend() {
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "already over", "expiresAt", "2026-10-01T09:00:00Z"))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg).matches(
                        "expiresAt 2026-10-01T09:00:00Z must be after startsAt, which defaulted to now "
                                + "\\(\\d{4}-\\d\\d-\\d\\dT[0-9:.]+Z\\)"));
        client.put().uri("/v1/communications/{id}", publishOutage("INC-e2e-version").id())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("body", "Mitigation in progress."))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").isEqualTo("expectedVersion is required: send the version from your last GET "
                        + "of this notice; a 409 means someone changed it since");
    }

    @Test
    void publishingRejectsUnknownFieldsWhileHealthReportsAcceptThem() {
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "vmforge-sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "typo", "expiryAt", "2026-11-01T14:00:00Z"))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .startsWith("unknown field 'expiryAt'; known fields: ").contains("expiresAt"));

        // the service's own Actuator document forwarded as is, plus tenant and service
        client.post().uri("/v1/health/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("""
                        {"tenantId":"vmforge-forwarded","service":"vm-api","status":"UP",
                         "groups":["liveness","readiness"],"components":{"ping":{"status":"UP"}}}
                        """)
                .exchange()
                .expectStatus().isAccepted();
    }

    @Test
    void aNoticePutBackWholeNamesEveryFieldAnUpdateDoesNotTakeInOneAnswer() {
        // read-modify-write as a client first tries it: GET the notice, change the body, PUT the document back
        String id = publishOutage("INC-e2e-put-back").id();
        Map<String, Object> document = new LinkedHashMap<>(client.get().uri("/v1/communications/{id}", id)
                .exchange()
                .expectStatus().isOk()
                .expectBody(new ParameterizedTypeReference<Map<String, Object>>() { })
                .returnResult().getResponseBody());
        document.put("body", "Mitigation in progress.");
        List<String> readOnly = List.of("createdAt", "externalRef", "history", "id", "publisher", "status",
                "tenantId", "type", "updatedAt", "version");

        client.put().uri("/v1/communications/{id}", id)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(document)
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").isEqualTo("unknown fields 'createdAt', 'externalRef', 'history', 'id', "
                        + "'publisher', 'status', 'tenantId', 'type', 'updatedAt', 'version'; known fields: actor, "
                        + "affectedServices, audience, body, endsAt, expectedVersion, expiresAt, severity, startsAt, "
                        + "ticket, title");

        // one answer was enough: without the fields it named, and with the version it read, the update saves
        Object version = document.get("version");
        document.keySet().removeAll(readOnly);
        document.put("expectedVersion", version);
        client.put().uri("/v1/communications/{id}", id)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(document)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.body").isEqualTo("Mitigation in progress.")
                .jsonPath("$.version").isEqualTo(1);
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
