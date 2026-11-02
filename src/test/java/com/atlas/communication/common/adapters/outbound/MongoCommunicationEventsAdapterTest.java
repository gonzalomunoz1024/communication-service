package com.atlas.communication.common.adapters.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/** The log semantics without Mongo: sequence allocation, tailing, exactly-once resume, retention checks. */
@ExtendWith(MockitoExtension.class)
class MongoCommunicationEventsAdapterTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    @Mock
    private CommunicationEventMongoRepository repository;
    @Mock
    private EventSequence sequence;
    @Mock
    private ReactiveMongoTemplate template; // only used by start(), which these tests never call

    private MongoCommunicationEventsAdapter adapter;

    @BeforeEach
    void setUp() {
        adapter = new MongoCommunicationEventsAdapter(repository, sequence, template,
                Clock.fixed(NOW, ZoneOffset.UTC), new EventsProperties(100, Duration.ofDays(1)));
    }

    private static Communication outage(String id) {
        return Communication.create(id, "vmforge", "sre", CommunicationType.OUTAGE, Severity.MAJOR,
                "outage", null, List.of("vm-api"), null, false, NOW, null, null, null, NOW);
    }

    private static CommunicationEventDocument doc(long seq, String id) {
        return CommunicationEventDocument.fromDomain(
                new CommunicationEvent(seq, CommunicationEventType.CREATED, NOW, outage(id)));
    }

    @Test
    void emitAppendsUnderTheNextGlobalSequenceNumber() {
        when(sequence.next()).thenReturn(Mono.just(42L));
        when(repository.insert(any(CommunicationEventDocument.class)))
                .thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(adapter.emit(CommunicationEventType.CREATED, outage("c1")))
                .assertNext(event -> {
                    assertThat(event.seq()).isEqualTo(42);
                    assertThat(event.type()).isEqualTo(CommunicationEventType.CREATED);
                    assertThat(event.at()).isEqualTo(NOW);
                    assertThat(event.communication().id()).isEqualTo("c1");
                })
                .verifyComplete();

        ArgumentCaptor<CommunicationEventDocument> appended =
                ArgumentCaptor.forClass(CommunicationEventDocument.class);
        verify(repository).insert(appended.capture());
        assertThat(appended.getValue().seq).isEqualTo(42L);
        assertThat(appended.getValue().tenantId).isEqualTo("vmforge");
        assertThat(appended.getValue().communication.id()).isEqualTo("c1");
    }

    @Test
    void emitFailuresAreLoggedNotPropagated() {
        when(sequence.next()).thenReturn(Mono.error(new IllegalStateException("mongo down")));
        StepVerifier.create(adapter.emit(CommunicationEventType.CREATED, outage("c1")))
                .verifyComplete();
    }

    @Test
    void startsAtTheEndOfTheLogAndFansOutOnlyWhatComesAfter() {
        when(sequence.current()).thenReturn(Mono.just(10L));
        adapter.initialise().block();
        assertThat(adapter.position()).isEqualTo(10);

        List<CommunicationEvent> seen = new ArrayList<>();
        adapter.stream().subscribe(seen::add);
        when(repository.findBySeqGreaterThanOrderBySeqAsc(10))
                .thenReturn(Flux.just(doc(11, "a"), doc(12, "b")));
        StepVerifier.create(adapter.pollOnce()).expectNext(2L).verifyComplete();
        assertThat(seen).extracting(CommunicationEvent::seq).containsExactly(11L, 12L);
        assertThat(adapter.position()).isEqualTo(12);

        when(repository.findBySeqGreaterThanOrderBySeqAsc(12)).thenReturn(Flux.empty());
        StepVerifier.create(adapter.pollOnce()).expectNext(0L).verifyComplete();
        assertThat(seen).hasSize(2);
    }

    @Test
    void positionIsZeroUntilTheLogHasBeenRead() {
        assertThat(adapter.position()).isZero();
    }

    @Test
    void headIsTheEndOfTheLogEvenWhileTheCursorTrailsIt() {
        when(sequence.current()).thenReturn(Mono.just(10L), Mono.just(12L));
        adapter.initialise().block();

        // two events were appended since the last poll: the head knows, the cursor does not yet
        StepVerifier.create(adapter.head()).expectNext(12L).verifyComplete();
        assertThat(adapter.position()).isEqualTo(10);
    }

    @Test
    void streamAfterReplaysTheGapThenContinuesLiveExactlyOnce() {
        when(sequence.current()).thenReturn(Mono.just(12L));
        adapter.initialise().block();
        when(repository.findTenantEventsInWindow("vmforge", 9, 12))
                .thenReturn(Flux.just(doc(10, "a"), doc(12, "b")));

        List<CommunicationEvent> seen = new ArrayList<>();
        adapter.streamAfter("vmforge", 9).subscribe(seen::add);
        assertThat(seen).extracting(CommunicationEvent::seq).containsExactly(10L, 12L);

        // the tail delivers 12 again (it was in flight when the subscriber arrived): dropped
        adapter.fanOut(doc(12, "b"));
        assertThat(seen).hasSize(2);

        // anything newer flows through live, in order
        adapter.fanOut(doc(13, "c"));
        adapter.fanOut(doc(14, "d"));
        assertThat(seen).extracting(CommunicationEvent::seq).containsExactly(10L, 12L, 13L, 14L);
    }

    @Test
    void streamAfterWithNothingMissedIsJustLive() {
        when(sequence.current()).thenReturn(Mono.just(5L));
        adapter.initialise().block();
        when(repository.findTenantEventsInWindow("vmforge", 5, 5))
                .thenReturn(Flux.empty());

        List<CommunicationEvent> seen = new ArrayList<>();
        adapter.streamAfter("vmforge", 5).subscribe(seen::add);
        adapter.fanOut(doc(6, "a"));
        assertThat(seen).extracting(CommunicationEvent::seq).containsExactly(6L);
    }

    @Test
    void closingTheContextCompletesEveryLiveStream() {
        when(sequence.current()).thenReturn(Mono.just(3L));
        adapter.initialise().block();
        when(repository.findTenantEventsInWindow("vmforge", 3, 3)).thenReturn(Flux.empty());

        AtomicBoolean liveCompleted = new AtomicBoolean();
        AtomicBoolean resumedCompleted = new AtomicBoolean();
        adapter.stream().subscribe(e -> { }, ex -> { }, () -> liveCompleted.set(true));
        adapter.streamAfter("vmforge", 3).subscribe(e -> { }, ex -> { }, () -> resumedCompleted.set(true));
        assertThat(liveCompleted).isFalse();
        assertThat(resumedCompleted).isFalse();

        adapter.closeStreams(); // what the ContextClosedEvent triggers

        assertThat(liveCompleted).as("live subscriber").isTrue();
        assertThat(resumedCompleted).as("resumed subscriber").isTrue();
        // whoever subscribes while the instance is going away is told so at once
        StepVerifier.create(adapter.stream()).verifyComplete();
    }

    @Test
    void canResumeAfterKnowsWhatTheLogStillHolds() {
        when(sequence.current()).thenReturn(Mono.just(20L));
        when(repository.findFirstByOrderBySeqAsc()).thenReturn(Mono.just(doc(15, "oldest")));

        assertThat(adapter.canResumeAfter(25).block()).as("never issued").isFalse();
        assertThat(adapter.canResumeAfter(20).block()).as("nothing since").isTrue();
        assertThat(adapter.canResumeAfter(17).block()).as("gap fully retained").isTrue();
        assertThat(adapter.canResumeAfter(14).block()).as("gap starts at the oldest").isTrue();
        assertThat(adapter.canResumeAfter(13).block()).as("14 already expired").isFalse();
    }

    @Test
    void canResumeAfterIsFalseWhenTheLogIsEmptyButNotCaughtUp() {
        when(sequence.current()).thenReturn(Mono.just(20L));
        when(repository.findFirstByOrderBySeqAsc()).thenReturn(Mono.empty());
        assertThat(adapter.canResumeAfter(10).block()).isFalse();
    }
}
