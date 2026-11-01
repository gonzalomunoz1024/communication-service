package com.atlas.communication.publishing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
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
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.common.ports.outbound.CommunicationEventsPort;
import com.atlas.communication.common.ports.outbound.CommunicationRepositoryPort;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class StatusSweepUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");

    @Mock
    private CommunicationRepositoryPort repository;
    @Mock
    private CommunicationEventsPort events;

    private StatusSweepUseCase useCase;

    @BeforeEach
    void setUp() {
        useCase = new StatusSweepUseCase(repository, events, Clock.fixed(NOW, ZoneOffset.UTC));
        lenient().when(events.emit(any(), any())).thenAnswer(inv -> Mono.just(
                new CommunicationEvent(1, inv.getArgument(0), NOW, inv.getArgument(1))));
    }

    private static Communication scheduledMaintenance() {
        return Communication.create("m1", "vmforge", "sre", CommunicationType.MAINTENANCE,
                Severity.INFO, "upgrade", null, List.of(), null, false,
                NOW.minusSeconds(10), NOW.plusSeconds(7200), null, null, NOW.minusSeconds(60));
    }

    private static Communication activeExpired() {
        return Communication.create("c1", "vmforge", "sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "outage", null, List.of(), null, false,
                NOW.minusSeconds(600), null, NOW.minusSeconds(30), null, NOW.minusSeconds(600));
    }

    @Test
    void activatesDueScheduledAndExpiresDueActive() {
        when(repository.dueForActivation(NOW)).thenReturn(Flux.just(scheduledMaintenance()));
        when(repository.dueForExpiry(NOW)).thenReturn(Flux.just(activeExpired()));
        when(repository.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.sweep(NOW))
                .expectNext(2L)
                .verifyComplete();

        ArgumentCaptor<Communication> savedCaptor = ArgumentCaptor.forClass(Communication.class);
        verify(repository, org.mockito.Mockito.times(2)).save(savedCaptor.capture());
        assertThat(savedCaptor.getAllValues())
                .extracting(Communication::status)
                .containsExactly(CommunicationStatus.ACTIVE, CommunicationStatus.EXPIRED);
        verify(events).emit(eq(CommunicationEventType.ACTIVATED), any());
        verify(events).emit(eq(CommunicationEventType.EXPIRED), any());
    }

    @Test
    void skipsItemsAnotherNodeAlreadyTransitioned() {
        when(repository.dueForActivation(NOW)).thenReturn(Flux.empty());
        when(repository.dueForExpiry(NOW)).thenReturn(Flux.just(activeExpired()));
        when(repository.save(any())).thenReturn(Mono.error(
                new ResponseStatusException(HttpStatus.CONFLICT, "modified concurrently")));

        StepVerifier.create(useCase.sweep(NOW))
                .expectNext(0L)
                .verifyComplete();
        verify(events, org.mockito.Mockito.never()).emit(any(), any());
    }

    @Test
    void quietSweepAppliesNothing() {
        when(repository.dueForActivation(NOW)).thenReturn(Flux.empty());
        when(repository.dueForExpiry(NOW)).thenReturn(Flux.empty());
        StepVerifier.create(useCase.sweep(NOW)).expectNext(0L).verifyComplete();
    }
}
