package com.atlas.communication.feed.adapters.inbound;

import java.time.Duration;
import java.time.Instant;

import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.feed.application.FeedUseCase;
import com.atlas.communication.feed.domain.FeedItem;
import com.atlas.communication.feed.domain.FeedQuery;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

@RestController
@RequiredArgsConstructor
@RequestMapping("/v1")
@Tag(name = "Feed", description = "Consumer-facing feed and live stream")
public class RestControllerFeedAdapter {

    /** Comment-only frames so idle streams survive proxies and load balancers. */
    private static final Duration KEEPALIVE_INTERVAL = Duration.ofSeconds(15);
    /** First bytes of every stream, so status and headers reach the client at once. */
    private static final ServerSentEvent<CommunicationEvent> CONNECTED =
            ServerSentEvent.<CommunicationEvent>builder().comment("connected").build();

    private final FeedUseCase useCase;

    @GetMapping("/feed")
    @Operation(summary = "Page of communications visible at a point in time (default: now)")
    public Mono<Page<FeedItem>> feed(
            @RequestParam String tenantId,
            @RequestParam(required = false) String service,
            @RequestParam(required = false) CommunicationType type,
            @RequestParam(required = false) Severity severity,
            @RequestParam(required = false) Audience audience,
            @RequestParam(required = false) Instant activeAt,
            @RequestParam(defaultValue = "true") boolean includeUpcoming,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return useCase.feed(new FeedQuery(tenantId, service, type, severity, audience,
                activeAt, includeUpcoming, page, size));
    }

    @GetMapping("/feed/{id}")
    @Operation(summary = "One communication by id (permalink; drafts are invisible)")
    public Mono<FeedItem> item(@PathVariable String id) {
        return useCase.item(id);
    }

    @GetMapping(value = "/feed/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "SSE: snapshot of visible items, then live lifecycle events; "
            + "send Last-Event-ID (or ?lastEventId=) to resume where you left off instead")
    public Flux<ServerSentEvent<CommunicationEvent>> stream(
            @RequestParam String tenantId,
            @RequestParam(required = false) String service,
            @RequestParam(required = false) CommunicationType type,
            @RequestParam(required = false) Severity severity,
            @RequestParam(required = false) Audience audience,
            @RequestParam(required = false) Long lastEventId,
            @RequestHeader(name = "Last-Event-ID", required = false) String lastEventIdHeader) {
        FeedQuery query = new FeedQuery(tenantId, service, type, severity, audience,
                null, true, 0, Page.MAX_SIZE);
        Long resumeAfter = lastEventId != null ? lastEventId : parseEventId(lastEventIdHeader);
        return Flux.defer(() -> {
            // The keepalive must stop with the data: when the event source completes (this
            // instance is shutting down) the response has to end too, or it would live on
            // through comments alone until the graceful-shutdown timeout cuts it.
            Sinks.Empty<Void> ended = Sinks.empty();
            Flux<ServerSentEvent<CommunicationEvent>> data = useCase.stream(query, resumeAfter)
                    .map(e -> ServerSentEvent.<CommunicationEvent>builder()
                            .id(Long.toString(e.seq()))
                            .event(e.type().name().toLowerCase())
                            .data(e)
                            .build())
                    .doFinally(signal -> ended.tryEmitEmpty());
            Flux<ServerSentEvent<CommunicationEvent>> keepalive = Flux
                    .interval(KEEPALIVE_INTERVAL, KEEPALIVE_INTERVAL)
                    .map(i -> ServerSentEvent.<CommunicationEvent>builder().comment("keepalive").build())
                    .takeUntilOther(ended.asMono());
            // The response is only committed with its first write. A tenant with nothing visible
            // would otherwise get status and headers with the first keepalive, 15 s in, and a
            // browser would sit in "connecting" for that long: open with a comment frame instead.
            return Flux.merge(data, keepalive).startWith(CONNECTED);
        });
    }

    /** Browsers echo the last {@code id:} verbatim; anything that is not one of ours means a fresh start. */
    private static Long parseEventId(String header) {
        if (header == null || header.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(header.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
