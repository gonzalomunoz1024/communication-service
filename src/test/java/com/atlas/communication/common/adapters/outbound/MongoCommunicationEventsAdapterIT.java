package com.atlas.communication.common.adapters.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.mongodb.test.autoconfigure.DataMongoTest;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;

import reactor.test.StepVerifier;

/**
 * The event log against a real MongoDB: the replay query is executed, not mocked. The unit test
 * ({@link MongoCommunicationEventsAdapterTest}) stubs the repository and can therefore never
 * notice a query that Spring Data cannot build or that selects the wrong window.
 */
@DataMongoTest
class MongoCommunicationEventsAdapterIT {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    @Autowired
    private CommunicationEventMongoRepository repository;
    @Autowired
    private ReactiveMongoTemplate template;

    private MongoCommunicationEventsAdapter adapter;

    @BeforeEach
    void setUp() {
        repository.deleteAll().block();
        template.dropCollection(MongoEventSequence.COLLECTION).block();
        adapter = new MongoCommunicationEventsAdapter(repository, new MongoEventSequence(template),
                template, Clock.fixed(NOW, ZoneOffset.UTC),
                new EventsProperties(100, Duration.ofDays(1)));
    }

    private static Communication outage(String id, String tenant) {
        return Communication.create(id, tenant, "sre", CommunicationType.OUTAGE, Severity.MAJOR,
                "outage " + id, "body", List.of("vm-api"), null, false, NOW, null, null, null, NOW);
    }

    private long emit(String id, String tenant) {
        return adapter.emit(CommunicationEventType.CREATED, outage(id, tenant)).block().seq();
    }

    @Test
    void replaysOnlyTheTenantsEventsInsideTheWindowInOrder() {
        // seq 1..6, two tenants interleaved
        emit("a1", "vmforge");            // 1
        emit("b1", "otherpod");           // 2
        emit("a2", "vmforge");            // 3
        emit("a3", "vmforge");            // 4
        emit("b2", "otherpod");           // 5
        long head = emit("a4", "vmforge"); // 6
        assertThat(head).isEqualTo(6);
        adapter.initialise().block(); // the tail is caught up at 6

        // a vmforge client that last saw event 2 gets exactly (2, 6] of its tenant, oldest first
        StepVerifier.create(adapter.streamAfter("vmforge", 2).take(3))
                .assertNext(e -> assertSeq(e, 3, "a2"))
                .assertNext(e -> assertSeq(e, 4, "a3"))
                .assertNext(e -> assertSeq(e, 6, "a4"))
                .expectComplete()
                .verify(Duration.ofSeconds(10));

        // the other tenant sees its own two events and nothing of vmforge's
        StepVerifier.create(adapter.streamAfter("otherpod", 0).take(2))
                .assertNext(e -> assertSeq(e, 2, "b1"))
                .assertNext(e -> assertSeq(e, 5, "b2"))
                .expectComplete()
                .verify(Duration.ofSeconds(10));
    }

    @Test
    void theWindowIsOpenBelowAndClosedAbove() {
        emit("a1", "vmforge"); // 1
        emit("a2", "vmforge"); // 2
        emit("a3", "vmforge"); // 3
        adapter.initialise().block(); // head = 3

        // after 1 → 2 and 3 (1 itself is excluded, 3 = the head is included)
        List<Long> seen = adapter.streamAfter("vmforge", 1).take(2)
                .map(CommunicationEvent::seq).collectList().block(Duration.ofSeconds(10));
        assertThat(seen).containsExactly(2L, 3L);
    }

    @Test
    void afterTheReplayLiveEventsFollowWithoutDuplicates() {
        emit("a1", "vmforge"); // 1
        adapter.initialise().block(); // head = 1

        List<CommunicationEvent> seen = new CopyOnWriteArrayList<>();
        adapter.streamAfter("vmforge", 1).subscribe(seen::add); // nothing to replay

        emit("a2", "vmforge"); // 2, appended but not yet tailed
        StepVerifier.create(adapter.pollOnce()).expectNext(1L).verifyComplete(); // the tail fans it out
        StepVerifier.create(adapter.pollOnce()).expectNext(0L).verifyComplete(); // and only once

        assertThat(seen).extracting(CommunicationEvent::seq).containsExactly(2L);
        assertThat(seen.get(0).communication().id()).isEqualTo("a2");
    }

    private static void assertSeq(CommunicationEvent event, long seq, String communicationId) {
        assertThat(event.seq()).isEqualTo(seq);
        assertThat(event.type()).isEqualTo(CommunicationEventType.CREATED);
        assertThat(event.communication().id()).isEqualTo(communicationId);
    }
}
