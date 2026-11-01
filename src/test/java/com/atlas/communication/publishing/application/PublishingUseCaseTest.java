package com.atlas.communication.publishing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationQuery;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.common.ports.outbound.CommunicationEventsPort;
import com.atlas.communication.common.ports.outbound.CommunicationRepositoryPort;
import com.atlas.communication.publishing.domain.CreateCommunicationCommand;
import com.atlas.communication.publishing.domain.RetireRequest;
import com.atlas.communication.publishing.domain.UpdateCommunicationCommand;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class PublishingUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");

    @Mock
    private CommunicationRepositoryPort repository;
    @Mock
    private CommunicationEventsPort events;

    private PublishingUseCase useCase;

    @BeforeEach
    void setUp() {
        useCase = new PublishingUseCase(repository, events, Clock.fixed(NOW, ZoneOffset.UTC));
        lenient().when(events.emit(any(), any())).thenAnswer(inv -> Mono.just(
                new CommunicationEvent(1, inv.getArgument(0), NOW, inv.getArgument(1))));
    }

    private static CreateCommunicationCommand createCommand(boolean draft, Instant startsAt) {
        return new CreateCommunicationCommand("vmforge", "vmforge-sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "API degradation", "details", List.of("vm-api"), null, draft,
                startsAt, null, null, "INC1");
    }

    /** A persisted communication: like create() but carrying a stored version. */
    private static Communication saved(boolean draft, Instant startsAt) {
        Communication c = Communication.create("c1", "vmforge", "vmforge-sre",
                CommunicationType.OUTAGE, Severity.MAJOR, "API degradation", "details",
                List.of("vm-api"), null, draft, startsAt, null, null, "INC1", NOW);
        return new Communication(c.id(), c.tenantId(), c.publisher(), c.type(), c.severity(),
                c.title(), c.body(), c.affectedServices(), c.audience(), c.status(), c.startsAt(),
                c.endsAt(), c.expiresAt(), c.externalRef(), c.createdAt(), c.updatedAt(), 0L,
                c.history());
    }

    @Test
    void createPersistsActiveCommunicationAndEmitsCreated() {
        when(repository.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.create(createCommand(false, null)))
                .assertNext(c -> {
                    assertThat(c.status()).isEqualTo(CommunicationStatus.ACTIVE);
                    assertThat(c.id()).isNotBlank();
                    assertThat(c.startsAt()).isEqualTo(NOW);
                })
                .verifyComplete();
        verify(events).emit(eq(CommunicationEventType.CREATED), any());
    }

    @Test
    void createDraftIsSilent() {
        when(repository.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.create(createCommand(true, null)))
                .assertNext(c -> assertThat(c.status()).isEqualTo(CommunicationStatus.DRAFT))
                .verifyComplete();
        verify(events, never()).emit(any(), any());
    }

    @Test
    void getUnknownIdIs404() {
        when(repository.findById("nope")).thenReturn(Mono.empty());
        StepVerifier.create(useCase.get("nope"))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.NOT_FOUND))
                .verify();
    }

    @Test
    void listClampsSizeAndComputesPage() {
        when(repository.query(any())).thenReturn(Flux.just(saved(false, null)));
        when(repository.count(any())).thenReturn(Mono.just(101L));

        StepVerifier.create(useCase.list("vmforge", null, null, 0, 500))
                .assertNext(page -> {
                    assertThat(page.size()).isEqualTo(Page.MAX_SIZE);
                    assertThat(page.totalElements()).isEqualTo(101);
                    assertThat(page.hasNext()).isTrue();
                })
                .verifyComplete();
        verify(repository).query(any(CommunicationQuery.class));
    }

    @Test
    void negativePageIsRejected() {
        StepVerifier.create(useCase.list("vmforge", null, null, -1, 20))
                .expectError(IllegalArgumentException.class)
                .verify();
    }

    @Test
    void updateWithStaleVersionIs409AndEmitsNothing() {
        when(repository.findById("c1")).thenReturn(Mono.just(saved(false, null)));

        UpdateCommunicationCommand cmd = new UpdateCommunicationCommand(null, "new title", null,
                null, null, null, null, null, "sre", 99L);
        StepVerifier.create(useCase.update("c1", cmd))
                .expectErrorSatisfies(ex -> {
                    assertThat(((ResponseStatusException) ex).getStatusCode())
                            .isEqualTo(HttpStatus.CONFLICT);
                    assertThat(((ResponseStatusException) ex).getReason())
                            .contains("expectedVersion");
                })
                .verify();
        verify(events, never()).emit(any(), any());
    }

    @Test
    void updateHappyPathSavesAndEmitsUpdated() {
        Communication current = saved(false, null);
        when(repository.findById("c1")).thenReturn(Mono.just(current));
        when(repository.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        UpdateCommunicationCommand cmd = new UpdateCommunicationCommand(Severity.CRITICAL, null,
                null, null, null, null, null, null, "sre", current.version());
        StepVerifier.create(useCase.update("c1", cmd))
                .assertNext(c -> assertThat(c.severity()).isEqualTo(Severity.CRITICAL))
                .verifyComplete();
        verify(events).emit(eq(CommunicationEventType.UPDATED), any());
    }

    @Test
    void updateTerminalStatusIs409() {
        Communication retired = saved(false, null).withStatus(CommunicationStatus.RETIRED, "a", NOW);
        when(repository.findById("c1")).thenReturn(Mono.just(retired));

        UpdateCommunicationCommand cmd = new UpdateCommunicationCommand(null, "t", null, null,
                null, null, null, null, "sre", retired.version());
        StepVerifier.create(useCase.update("c1", cmd))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.CONFLICT))
                .verify();
    }

    @Test
    void publishDraftWithFutureStartBecomesScheduledAndEmitsCreated() {
        when(repository.findById("c1")).thenReturn(Mono.just(saved(true, NOW.plusSeconds(3600))));
        when(repository.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.publish("c1"))
                .assertNext(c -> assertThat(c.status()).isEqualTo(CommunicationStatus.SCHEDULED))
                .verifyComplete();
        verify(events).emit(eq(CommunicationEventType.CREATED), any());
    }

    @Test
    void publishNonDraftIs409() {
        when(repository.findById("c1")).thenReturn(Mono.just(saved(false, null)));
        StepVerifier.create(useCase.publish("c1"))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.CONFLICT))
                .verify();
    }

    @Test
    void retireActiveEmitsRetired() {
        when(repository.findById("c1")).thenReturn(Mono.just(saved(false, null)));
        when(repository.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.retire("c1", new RetireRequest("admin", "done")))
                .assertNext(c -> assertThat(c.status()).isEqualTo(CommunicationStatus.RETIRED))
                .verifyComplete();
        verify(events).emit(eq(CommunicationEventType.RETIRED), any());
    }

    @Test
    void retireAlreadyRetiredIsIdempotentNoOp() {
        Communication retired = saved(false, null).withStatus(CommunicationStatus.RETIRED, "a", NOW);
        when(repository.findById("c1")).thenReturn(Mono.just(retired));

        StepVerifier.create(useCase.retire("c1", null))
                .assertNext(c -> assertThat(c.status()).isEqualTo(CommunicationStatus.RETIRED))
                .verifyComplete();
        verify(repository, never()).save(any());
        verify(events, never()).emit(any(), any());
    }

    @Test
    void retireExpiredIs409() {
        Communication expired = saved(false, null).withStatus(CommunicationStatus.EXPIRED, "s", NOW);
        when(repository.findById("c1")).thenReturn(Mono.just(expired));

        StepVerifier.create(useCase.retire("c1", null))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.CONFLICT))
                .verify();
    }
}
