package com.atlas.communication.feed.adapters.inbound;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.reactive.server.FluxExchangeResult;
import org.springframework.test.web.reactive.server.WebTestClient;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.config.ClientIdWebFilter;
import com.atlas.communication.feed.application.FeedUseCase;

import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

/** HTTP shape of the SSE stream around its lifetime: it ends when the event source ends. */
@WebFluxTest(RestControllerFeedAdapter.class)
class RestControllerFeedAdapterTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    @Autowired
    private WebTestClient client;
    @MockitoBean
    private FeedUseCase useCase;

    @BeforeEach
    void identifyAsTestClient() {
        client = client.mutate()
                .defaultHeader(ClientIdWebFilter.HEADER, "communication-service-tests")
                .build();
    }

    private static CommunicationEvent created(long seq, String id) {
        Communication c = Communication.create(id, "vmforge", "sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "outage", null, List.of("vm-api"), null, false, NOW, null, null, null, NOW);
        return new CommunicationEvent(seq, CommunicationEventType.CREATED, NOW, c);
    }

    @Test
    void streamEndsWhenTheEventSourceEnds() {
        // the service is shutting down: the use case completes its stream after one event; the
        // response must complete too instead of living on through keepalive comments alone
        when(useCase.stream(any(), isNull())).thenReturn(Flux.just(created(7, "c1")));

        FluxExchangeResult<CommunicationEvent> result = client.get()
                .uri("/v1/feed/stream?tenantId=vmforge")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchange()
                .expectStatus().isOk()
                .returnResult(CommunicationEvent.class);

        StepVerifier.create(result.getResponseBody())
                .expectNextMatches(e -> e.seq() == 7 && e.communication().id().equals("c1"))
                .expectComplete()
                .verify(Duration.ofSeconds(5));
    }
}
