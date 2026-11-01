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
