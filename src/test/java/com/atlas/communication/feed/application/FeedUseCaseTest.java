package com.atlas.communication.feed.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.ArgumentMatchers.anyLong;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.Mockito;
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
import com.atlas.communication.feed.domain.FeedQuery;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class FeedUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");

    @Mock
    private CommunicationRepositoryPort repository;
    @Mock
    private CommunicationEventsPort events;

    private FeedUseCase useCase;

    @BeforeEach
    void setUp() {
        useCase = new FeedUseCase(repository, events, Clock.fixed(NOW, ZoneOffset.UTC),
                Duration.ofDays(7));
    }

    private static Communication outage(String id, Instant startsAt, Instant expiresAt) {
        return Communication.create(id, "vmforge", "sre", CommunicationType.OUTAGE, Severity.MAJOR,
                "outage", null, List.of("vm-api"), null, false, startsAt, null, expiresAt, null, NOW);
    }

    private static FeedQuery query(int page, int size) {
        return new FeedQuery("vmforge", null, null, null, null, null, true, page, size);
    }

    @Test
    void feedTranslatesFiltersIncludingUpcomingWindow() {
        when(repository.query(any())).thenReturn(Flux.empty());
        when(repository.count(any())).thenReturn(Mono.just(0L));

        StepVerifier.create(useCase.feed(new FeedQuery("vmforge", "vm-api",
                        CommunicationType.OUTAGE, Severity.MINOR, null, null, true, 0, 20)))
                .assertNext(page -> {
                    assertThat(page.items()).isEmpty();
                    assertThat(page.totalElements()).isZero();
                    assertThat(page.hasNext()).isFalse();
                })
                .verifyComplete();

        ArgumentCaptor<CommunicationQuery> captor = ArgumentCaptor.forClass(CommunicationQuery.class);
        Mockito.verify(repository).query(captor.capture());
        CommunicationQuery store = captor.getValue();
        assertThat(store.tenantId()).isEqualTo("vmforge");
        assertThat(store.service()).isEqualTo("vm-api");
        assertThat(store.minSeverity()).isEqualTo(Severity.MINOR);
        assertThat(store.activeAt()).isEqualTo(NOW);
        assertThat(store.upcomingUntil()).isEqualTo(NOW.plus(Duration.ofDays(7)));
    }

    @Test
    void feedOmitsUpcomingWindowWhenDisabled() {
        when(repository.query(any())).thenReturn(Flux.empty());
        when(repository.count(any())).thenReturn(Mono.just(0L));

        StepVerifier.create(useCase.feed(new FeedQuery("vmforge", null, null, null, null,
                        null, false, 0, 20)))
                .expectNextCount(1)
                .verifyComplete();

        ArgumentCaptor<CommunicationQuery> captor = ArgumentCaptor.forClass(CommunicationQuery.class);
        Mockito.verify(repository).query(captor.capture());
        assertThat(captor.getValue().upcomingUntil()).isNull();
    }

    @Test
    void feedProjectsEffectiveStatusNotStoredStatus() {
        // stored ACTIVE but past expiry (sweeper hasn't run yet)
        when(repository.query(any())).thenReturn(Flux.just(
                outage("stale", NOW.minusSeconds(600), NOW.minusSeconds(60))));
        when(repository.count(any())).thenReturn(Mono.just(1L));

        StepVerifier.create(useCase.feed(query(0, 20)))
                .assertNext(page -> assertThat(page.items().get(0).status())
                        .isEqualTo(CommunicationStatus.EXPIRED))
                .verifyComplete();
    }

    @Test
    void feedPaginationMathClampsSize() {
        when(repository.query(any())).thenReturn(Flux.empty());
        when(repository.count(any())).thenReturn(Mono.just(250L));

        StepVerifier.create(useCase.feed(query(1, 500)))
                .assertNext(page -> {
                    assertThat(page.size()).isEqualTo(Page.MAX_SIZE);
                    assertThat(page.page()).isEqualTo(1);
                    assertThat(page.hasNext()).isTrue();
                })
                .verifyComplete();
    }

    @Test
    void itemHidesDrafts() {
        Communication draft = Communication.create("d1", "vmforge", "sre",
                CommunicationType.HEALTH, Severity.INFO, "draft", null, List.of(), null, true,
                null, null, null, null, NOW);
        when(repository.findById("d1")).thenReturn(Mono.just(draft));

        StepVerifier.create(useCase.item("d1"))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.NOT_FOUND))
                .verify();
    }

    @Test
    void itemServesExpiredPermalinks() {
        when(repository.findById("c1")).thenReturn(Mono.just(
                outage("c1", NOW.minusSeconds(600), NOW.minusSeconds(60))));
        StepVerifier.create(useCase.item("c1"))
                .assertNext(item -> assertThat(item.status()).isEqualTo(CommunicationStatus.EXPIRED))
                .verifyComplete();
    }

    @Test
    void streamEmitsMatchingLiveEventsAndASnapshotStampedWithThePosition() {
        Communication visible = outage("c1", NOW.minusSeconds(60), null);
        Communication otherTenant = Communication.create("x1", "otherpod", "sre",
                CommunicationType.OUTAGE, Severity.MAJOR, "other", null, List.of(), null, false,
                NOW, null, null, null, NOW);
        when(repository.query(any())).thenReturn(Flux.just(visible));
        when(events.position()).thenReturn(42L);
        when(events.stream()).thenReturn(Flux.just(
                new CommunicationEvent(7, CommunicationEventType.RETIRED, NOW, otherTenant),
                new CommunicationEvent(8, CommunicationEventType.RETIRED, NOW, visible)));

        // the live bus is subscribed before the snapshot query runs; with cold test sources that
        // puts the live event first (in production the order is whichever arrives first)
        StepVerifier.create(useCase.stream(query(0, 100)).take(2))
                .assertNext(e -> {
                    assertThat(e.type()).isEqualTo(CommunicationEventType.RETIRED);
                    assertThat(e.seq()).isEqualTo(8);
                })
                .assertNext(e -> {
                    assertThat(e.type()).isEqualTo(CommunicationEventType.SNAPSHOT);
                    assertThat(e.seq()).isEqualTo(42);
                    assertThat(e.communication().id()).isEqualTo("c1");
                })
                .verifyComplete();
    }

    @Test
    void streamResumesFromLastEventIdWhileTheLogStillHasIt() {
        Communication visible = outage("c1", NOW.minusSeconds(60), null);
        Communication otherService = Communication.create("c2", "vmforge", "sre",
                CommunicationType.OUTAGE, Severity.MAJOR, "billing", null, List.of("billing"), null,
                false, NOW, null, null, null, NOW);
        when(events.canResumeAfter(8)).thenReturn(Mono.just(true));
        when(events.streamAfter("vmforge", 8)).thenReturn(Flux.just(
                new CommunicationEvent(9, CommunicationEventType.UPDATED, NOW, otherService),
                new CommunicationEvent(10, CommunicationEventType.RETIRED, NOW, visible)));

        FeedQuery filtered = new FeedQuery("vmforge", "vm-api", null, null, null, null, true, 0, 100);
        StepVerifier.create(useCase.stream(filtered, 8L))
                .assertNext(e -> {
                    assertThat(e.seq()).isEqualTo(10);
                    assertThat(e.type()).isEqualTo(CommunicationEventType.RETIRED);
                })
                .verifyComplete();
        verify(repository, never()).query(any());
    }

    @Test
    void streamFallsBackToASnapshotWhenLastEventIdIsTooOld() {
        Communication visible = outage("c1", NOW.minusSeconds(60), null);
        when(events.canResumeAfter(3)).thenReturn(Mono.just(false));
        when(events.stream()).thenReturn(Flux.empty());
        when(repository.query(any())).thenReturn(Flux.just(visible));

        StepVerifier.create(useCase.stream(query(0, 100), 3L))
                .assertNext(e -> assertThat(e.type()).isEqualTo(CommunicationEventType.SNAPSHOT))
                .verifyComplete();
        verify(events, never()).streamAfter(any(), anyLong());
    }

    @Test
    void streamFiltersByServiceAndSeverity() {
        Communication minorOther = Communication.create("c2", "vmforge", "sre",
                CommunicationType.HEALTH, Severity.INFO, "note", null, List.of("billing"), null,
                false, NOW, null, null, null, NOW);
        Communication majorMatch = outage("c3", NOW, null);
        // take(1) below cancels before the deferred snapshot query would run
        lenient().when(repository.query(any())).thenReturn(Flux.empty());
        when(events.stream()).thenReturn(Flux.just(
                new CommunicationEvent(1, CommunicationEventType.CREATED, NOW, minorOther),
                new CommunicationEvent(2, CommunicationEventType.CREATED, NOW, majorMatch)));

        FeedQuery filtered = new FeedQuery("vmforge", "vm-api", null, Severity.MINOR, null,
                null, true, 0, 100);
        StepVerifier.create(useCase.stream(filtered).take(1))
                .assertNext(e -> assertThat(e.communication().id()).isEqualTo("c3"))
                .verifyComplete();
    }
}
