package com.atlas.communication.common.adapters.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;

import reactor.test.StepVerifier;

class SinksCommunicationEventsAdapterTest {

    private static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");

    private SinksCommunicationEventsAdapter adapter;
    private Communication communication;

    @BeforeEach
    void setUp() {
        adapter = new SinksCommunicationEventsAdapter(Clock.fixed(NOW, ZoneOffset.UTC));
        communication = Communication.create("c1", "vmforge", "sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "t", null, List.of(), null, false, null, null, null, null, NOW);
    }

    @Test
    void assignsMonotonicSequenceAndTimestamps() {
        CommunicationEvent first = adapter.emit(CommunicationEventType.CREATED, communication);
        CommunicationEvent second = adapter.emit(CommunicationEventType.UPDATED, communication);
        assertThat(first.seq()).isLessThan(second.seq());
        assertThat(first.at()).isEqualTo(NOW);
    }

    @Test
    void multicastsLiveEventsToAllSubscribers() {
        StepVerifier.create(adapter.stream().take(1))
                .then(() -> adapter.emit(CommunicationEventType.CREATED, communication))
                .assertNext(e -> {
                    assertThat(e.type()).isEqualTo(CommunicationEventType.CREATED);
                    assertThat(e.communication().id()).isEqualTo("c1");
                })
                .verifyComplete();
    }

    @Test
    void lateSubscribersGetNoReplay() {
        adapter.emit(CommunicationEventType.CREATED, communication);
        StepVerifier.create(adapter.stream().take(1))
                .expectSubscription()
                .then(() -> adapter.emit(CommunicationEventType.RETIRED, communication))
                .assertNext(e -> assertThat(e.type()).isEqualTo(CommunicationEventType.RETIRED))
                .verifyComplete();
    }
}
