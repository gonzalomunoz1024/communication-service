package com.atlas.communication.publishing.adapters.inbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.reactive.server.WebTestClient;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.Ticket;
import com.atlas.communication.config.ClientIdWebFilter;
import com.atlas.communication.publishing.application.PublishingUseCase;
import com.atlas.communication.publishing.domain.CreateCommunicationCommand;
import com.atlas.communication.publishing.domain.UpdateCommunicationCommand;

import reactor.core.publisher.Mono;

/** HTTP contract of the publishing endpoints around tickets: JSON binding, nested validation, error shape. */
@WebFluxTest(RestControllerPublishingAdapter.class)
class RestControllerPublishingAdapterTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    @Autowired
    private WebTestClient client;
    @MockitoBean
    private PublishingUseCase useCase;

    @BeforeEach
    void identifyAsTestClient() {
        client = client.mutate()
                .defaultHeader(ClientIdWebFilter.HEADER, "communication-service-tests")
                .build();
    }

    private static Communication outageFrom(CreateCommunicationCommand cmd) {
        return Communication.create("c1", cmd.tenantId(), cmd.publisher(), cmd.type(), cmd.severity(),
                cmd.title(), cmd.body(), cmd.affectedServices(), cmd.audience(), cmd.draft(),
                cmd.startsAt(), cmd.endsAt(), cmd.expiresAt(), cmd.externalRef(), cmd.ticket(), NOW);
    }

    @Test
    void createBindsTheTicketAndEchoesItBack() {
        when(useCase.create(any())).thenAnswer(inv -> Mono.just(outageFrom(inv.getArgument(0))));

        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "down", "affectedServices", List.of("vm-api"),
                        "ticket", Map.of("number", "INC0012345", "url", "https://acme.service-now.com/x")))
                .exchange()
                .expectStatus().isCreated()
                .expectHeader().valueEquals("Location", "/v1/communications/c1")
                .expectBody()
                .jsonPath("$.ticket.number").isEqualTo("INC0012345")
                .jsonPath("$.ticket.url").isEqualTo("https://acme.service-now.com/x")
                .jsonPath("$.ticket.system").doesNotExist();

        ArgumentCaptor<CreateCommunicationCommand> captor = ArgumentCaptor.forClass(CreateCommunicationCommand.class);
        verify(useCase).create(captor.capture());
        assertThat(captor.getValue().ticket())
                .isEqualTo(new Ticket(null, "INC0012345", "https://acme.service-now.com/x"));
    }

    @Test
    void aTicketWithoutANumberFailsValidationBeforeTheUseCase() {
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "down", "ticket", Map.of("url", "https://acme.service-now.com/x")))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg).contains("ticket.number"));
        verifyNoInteractions(useCase);
    }

    @Test
    void thePolicysRejectionIsA400WithItsMessage() {
        when(useCase.create(any())).thenReturn(Mono.error(new IllegalArgumentException(
                "ticket.number 'INC-4821' is not a ServiceNow incident number (like INC0012345)")));

        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "down", "ticket", Map.of("number", "INC-4821")))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg).startsWith("ticket.number 'INC-4821'"));
    }

    @Test
    void anUnknownEnumValueNamesTheFieldAndTheAcceptedValues() {
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "BOGUS",
                        "severity", "MAJOR", "title", "down"))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .startsWith("type: 'BOGUS' is not one of [")
                        .contains("OUTAGE").contains("MAINTENANCE"));
        verifyNoInteractions(useCase);
    }

    @Test
    void aBadTimestampNamesTheFieldAndTheFormat() {
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "down", "expiresAt", "tomorrow at six"))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .startsWith("expiresAt: 'tomorrow at six' is not an ISO-8601"));
        verifyNoInteractions(useCase);
    }

    @Test
    void aNestedBadValueCarriesTheDottedPath() {
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"tenantId\":\"vmforge\",\"publisher\":\"sre\",\"type\":\"OUTAGE\","
                        + "\"severity\":\"MAJOR\",\"title\":\"down\",\"affectedServices\":\"vm-api\"}")
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .startsWith("affectedServices: expected a JSON array"));
    }

    @Test
    void aNullServiceEntryNamesItsPositionAndTheRule() {
        when(useCase.create(any())).thenAnswer(inv -> Mono.just(outageFrom(inv.getArgument(0))));
        when(useCase.update(any(), any())).thenAnswer(inv -> Mono.just(outageFrom(new CreateCommunicationCommand(
                "vmforge", "sre", com.atlas.communication.common.domain.CommunicationType.OUTAGE,
                com.atlas.communication.common.domain.Severity.MAJOR, "down", null, List.of(), null, false,
                null, null, null, null, null))));

        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"tenantId\":\"vmforge\",\"publisher\":\"sre\",\"type\":\"OUTAGE\","
                        + "\"severity\":\"MAJOR\",\"title\":\"down\",\"affectedServices\":[\"vm-api\",null]}")
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").isEqualTo("affectedServices[1]: must not be null");
        client.put().uri("/v1/communications/c1")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"affectedServices\":[null],\"expectedVersion\":0}")
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").isEqualTo("affectedServices[0]: must not be null");
        verifyNoInteractions(useCase);
    }

    @Test
    void anEmptyOrBlankServiceEntryIsRejected() {
        when(useCase.create(any())).thenAnswer(inv -> Mono.just(outageFrom(inv.getArgument(0))));
        when(useCase.update(any(), any())).thenAnswer(inv -> Mono.just(outageFrom(new CreateCommunicationCommand(
                "vmforge", "sre", com.atlas.communication.common.domain.CommunicationType.OUTAGE,
                com.atlas.communication.common.domain.Severity.MAJOR, "down", null, List.of(), null, false,
                null, null, null, null, null))));

        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "publisher", "sre", "type", "OUTAGE",
                        "severity", "MAJOR", "title", "down", "affectedServices", List.of("vm-api", "")))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").isEqualTo("affectedServices[1]: must not be blank");
        client.put().uri("/v1/communications/c1")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("affectedServices", List.of("  ", "vm-api"), "expectedVersion", 0))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").isEqualTo("affectedServices[0]: must not be blank");
        verifyNoInteractions(useCase);
    }

    @Test
    void malformedJsonSaysWhere() {
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"tenantId\": \"vmforge\", \"publisher\": }")
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .startsWith("malformed JSON at line 1, column"));
    }

    @Test
    void anOversizedBodyIs413NamingTheLimit() {
        String huge = "{\"tenantId\":\"vmforge\",\"publisher\":\"sre\",\"type\":\"OUTAGE\","
                + "\"severity\":\"MAJOR\",\"title\":\"" + "x".repeat(300 * 1024) + "\"}";
        client.post().uri("/v1/communications")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(huge)
                .exchange()
                .expectStatus().isEqualTo(413)
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .contains("request body exceeds the limit of 256 KB"));
        verifyNoInteractions(useCase);
    }

    @Test
    void anUnknownPathIs404ThatSaysSo() {
        client.get().uri("/v1/nothing").exchange()
                .expectStatus().isNotFound()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .startsWith("no such endpoint: GET /v1/nothing"));
    }

    @Test
    void theWrongVerbIs405ListingTheAllowedOnes() {
        client.delete().uri("/v1/communications").exchange()
                .expectStatus().isEqualTo(405)
                .expectHeader().exists("Allow")
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .startsWith("DELETE is not allowed on /v1/communications; allowed: ")
                        .contains("POST"));
    }

    @Test
    void theWrongContentTypeIs415NamingJson() {
        client.post().uri("/v1/communications")
                .contentType(MediaType.TEXT_PLAIN)
                .bodyValue("tenantId=vmforge")
                .exchange()
                .expectStatus().isEqualTo(415)
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .startsWith("Content-Type 'text/plain").contains("send application/json"));
        verifyNoInteractions(useCase);
    }

    @Test
    void aBadQueryParameterNamesItAndTheAcceptedValues() {
        client.get().uri("/v1/communications?tenantId=vmforge&type=BOGUS").exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").value(msg -> assertThat((String) msg)
                        .startsWith("type: 'BOGUS' is not one of [").contains("OUTAGE"));
    }

    @Test
    void updateCarriesTheTicketToTheUseCase() {
        when(useCase.update(any(), any())).thenAnswer(inv -> Mono.just(outageFrom(
                new CreateCommunicationCommand("vmforge", "sre", com.atlas.communication.common.domain.CommunicationType.OUTAGE,
                        com.atlas.communication.common.domain.Severity.MAJOR, "down", null, List.of(), null, false,
                        null, null, null, null, ((UpdateCommunicationCommand) inv.getArgument(1)).ticket()))));

        client.put().uri("/v1/communications/c1")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("ticket", Map.of("number", "inc0000042"), "expectedVersion", 0))
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.ticket.number").isEqualTo("inc0000042");

        ArgumentCaptor<UpdateCommunicationCommand> captor = ArgumentCaptor.forClass(UpdateCommunicationCommand.class);
        verify(useCase).update(any(), captor.capture());
        assertThat(captor.getValue().ticket()).isEqualTo(new Ticket(null, "inc0000042", null));
        assertThat(captor.getValue().expectedVersion()).isZero();
    }
}
