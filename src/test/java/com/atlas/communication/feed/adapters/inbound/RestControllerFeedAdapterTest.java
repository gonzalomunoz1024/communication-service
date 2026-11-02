package com.atlas.communication.feed.adapters.inbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webflux.test.autoconfigure.WebFluxTest;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
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
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * HTTP shape of the SSE stream around its lifetime: it does not open while the database cannot
 * be reached, it ends when the event source ends, and it resumes after the later of the two ids a
 * reconnect can carry.
 */
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

    @BeforeEach
    void theEventLogAnswers() {
        // the stream reads the log's head before it answers
        when(useCase.head()).thenReturn(Mono.just(6L));
    }

    @Test
    void aStreamIs503BeforeItsFirstByteWhileTheDatabaseCannotBeReached() {
        when(useCase.head()).thenReturn(Mono.error(new DataAccessResourceFailureException(
                "Timed out while waiting for a server that matches ReadPreferenceServerSelector")));

        client.get()
                .uri("/v1/feed/stream?tenantId=vmforge")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchange()
                .expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                .expectHeader().contentType(MediaType.APPLICATION_JSON)
                .expectBody(String.class).isEqualTo("{\"error\":\"database unavailable\"}");
        verify(useCase, never()).stream(any(), any());
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

    @Test
    void withBothAQueryIdAndALastEventIdHeaderTheStreamResumesAfterTheLaterOne() {
        // a page reopened with ?lastEventId=80 keeps that URL; the browser's own retry adds the last
        // id it received as Last-Event-ID, never older: resuming after 80 would replay 81-85 twice
        when(useCase.stream(any(), any())).thenReturn(Flux.empty());
        String[][] queryAndHeader = { { "80", "85" }, { "85", "80" }, { "80", "not-one-of-ours" } };
        for (String[] ids : queryAndHeader) {
            FluxExchangeResult<String> result = client.get()
                    .uri("/v1/feed/stream?tenantId=vmforge&lastEventId={id}", ids[0])
                    .header("Last-Event-ID", ids[1])
                    .accept(MediaType.TEXT_EVENT_STREAM)
                    .exchange()
                    .expectStatus().isOk()
                    .returnResult(String.class);
            StepVerifier.create(result.getResponseBody())
                    .thenConsumeWhile(frame -> true)
                    .expectComplete()
                    .verify(Duration.ofSeconds(5));
        }

        ArgumentCaptor<Long> resumeAfter = ArgumentCaptor.forClass(Long.class);
        verify(useCase, times(3)).stream(any(), resumeAfter.capture());
        assertThat(resumeAfter.getAllValues()).containsExactly(85L, 85L, 80L);
    }

    @Test
    void eventNamesAreLowerCasedTheSameWayInEveryLocale() {
        // browsers subscribe to "retired"; Turkish lower-cases the I of RETIRED to a dotless ı
        Locale defaultLocale = Locale.getDefault();
        Locale.setDefault(Locale.forLanguageTag("tr-TR"));
        try {
            when(useCase.stream(any(), isNull())).thenReturn(Flux.just(new CommunicationEvent(
                    8, CommunicationEventType.RETIRED, NOW, created(7, "c1").communication())));

            FluxExchangeResult<ServerSentEvent<CommunicationEvent>> result = client.get()
                    .uri("/v1/feed/stream?tenantId=vmforge")
                    .accept(MediaType.TEXT_EVENT_STREAM)
                    .exchange()
                    .expectStatus().isOk()
                    .returnResult(new ParameterizedTypeReference<ServerSentEvent<CommunicationEvent>>() { });

            StepVerifier.create(result.getResponseBody().filter(frame -> frame.data() != null))
                    .assertNext(frame -> {
                        assertThat(frame.event()).isEqualTo("retired");
                        assertThat(frame.id()).isEqualTo("8");
                    })
                    .expectComplete()
                    .verify(Duration.ofSeconds(5));
        } finally {
            Locale.setDefault(defaultLocale);
        }
    }
}
