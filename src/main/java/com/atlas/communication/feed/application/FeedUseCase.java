package com.atlas.communication.feed.application;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationQuery;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.common.ports.outbound.CommunicationEventsPort;
import com.atlas.communication.common.ports.outbound.CommunicationRepositoryPort;
import com.atlas.communication.feed.domain.FeedItem;
import com.atlas.communication.feed.domain.FeedQuery;
import com.atlas.communication.feed.ports.inbound.FeedInboundPort;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Read side: materializes the consumer feed on the fly. Visibility is decided by time
 * predicates in the store plus {@link Communication#effectiveStatus}, never by trusting the
 * stored status of time-driven states.
 */
@Service
public class FeedUseCase implements FeedInboundPort {

    private final CommunicationRepositoryPort repository;
    private final CommunicationEventsPort events;
    private final Clock clock;
    private final Duration upcomingWindow;

    public FeedUseCase(CommunicationRepositoryPort repository, CommunicationEventsPort events,
            Clock clock,
            @Value("${communication.feed.upcoming-window:P7D}") Duration upcomingWindow) {
        this.repository = repository;
        this.events = events;
        this.clock = clock;
        this.upcomingWindow = upcomingWindow;
    }

    @Override
    public Mono<Page<FeedItem>> feed(FeedQuery query) {
        return Mono.defer(() -> {
            Instant activeAt = query.activeAt() == null ? clock.instant() : query.activeAt();
            CommunicationQuery storeQuery = toStoreQuery(query, activeAt);
            return repository.query(storeQuery).collectList()
                    .zipWith(repository.count(storeQuery))
                    .map(t -> Page.of(t.getT1(), storeQuery.page(), storeQuery.size(), t.getT2())
                            .map(c -> FeedItem.from(c, activeAt)));
        });
    }

    @Override
    public Mono<FeedItem> item(String id) {
        return repository.findById(id)
                .filter(c -> c.status() != CommunicationStatus.DRAFT)
                .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "communication " + id + " not found")))
                .map(c -> FeedItem.from(c, clock.instant()));
    }

    @Override
    public Flux<CommunicationEvent> stream(FeedQuery query) {
        return stream(query, null);
    }

    @Override
    public Flux<CommunicationEvent> stream(FeedQuery query, Long lastEventId) {
        if (lastEventId == null) {
            return snapshotThenLive(query);
        }
        return events.canResumeAfter(lastEventId)
                .flatMapMany(resumable -> resumable
                        ? events.streamAfter(query.tenantId(), lastEventId)
                                .filter(e -> matches(query, e.communication()))
                        : snapshotThenLive(query));
    }

    /**
     * The live bus is subscribed first, so nothing emitted during the snapshot query is lost;
     * clients upsert by communication id, so a snapshot/live overlap is harmless. Snapshot frames
     * carry the log head read before the snapshot is queried (not this node's fan-out cursor,
     * which can trail it by one poll), so a client that reconnects with it as Last-Event-ID
     * misses nothing that happened after its snapshot; it may see an event again whose change
     * the snapshot already showed, and dedupes on the communication's id and version.
     */
    private Flux<CommunicationEvent> snapshotThenLive(FeedQuery query) {
        Flux<CommunicationEvent> live = events.stream()
                .filter(e -> matches(query, e.communication()));
        Flux<CommunicationEvent> snapshot = Flux.defer(() -> {
            Instant now = clock.instant();
            return events.head().flatMapMany(head -> repository.query(toStoreQuery(withFirstPage(query), now))
                    .map(c -> new CommunicationEvent(head, CommunicationEventType.SNAPSHOT, now, c)));
        });
        return Flux.merge(live, snapshot);
    }

    private CommunicationQuery toStoreQuery(FeedQuery query, Instant activeAt) {
        Instant upcomingUntil = query.includeUpcoming() ? activeAt.plus(upcomingWindow) : null;
        return CommunicationQuery.visibleAt(query.tenantId(), activeAt, upcomingUntil,
                query.type(), query.minSeverity(), query.audience(), query.service(),
                Page.validPage(query.page()), Page.validSize(query.size()));
    }

    private static FeedQuery withFirstPage(FeedQuery q) {
        return new FeedQuery(q.tenantId(), q.service(), q.type(), q.minSeverity(), q.audience(),
                q.activeAt(), q.includeUpcoming(), 0, Page.MAX_SIZE);
    }

    /** Per-subscriber live filter mirroring the feed filters (visibility is implied by emission). */
    private static boolean matches(FeedQuery query, Communication c) {
        if (!c.tenantId().equals(query.tenantId())) {
            return false;
        }
        if (query.service() != null && !c.affectedServices().contains(query.service())) {
            return false;
        }
        if (query.type() != null && c.type() != query.type()) {
            return false;
        }
        if (query.minSeverity() != null && !c.severity().atLeast(query.minSeverity())) {
            return false;
        }
        return query.audience() == null || c.audience() == query.audience();
    }
}
