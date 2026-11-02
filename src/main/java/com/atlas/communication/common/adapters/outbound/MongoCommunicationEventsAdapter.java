package com.atlas.communication.common.adapters.outbound;

import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import org.bson.Document;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.stereotype.Component;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.ports.outbound.CommunicationEventsPort;
import com.mongodb.MongoCommandException;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import reactor.util.retry.Retry;

/**
 * Shared event log in Mongo ({@code communication_events}). Every instance appends to it under
 * a global sequence number and tails it on a short interval, fanning new events out to its own
 * SSE subscribers, so a notice published through any node reaches browsers connected to every
 * node. Events are kept for {@code communication.events.retention}, so a client that reconnects
 * with {@code Last-Event-ID} gets exactly what it missed, in order.
 * <p>
 * Tailing is a poll, not a change stream, so a standalone Mongo (local development, embedded
 * tests) works; live latency is bounded by {@code communication.events.poll-interval-ms}.
 */
@Component
@Slf4j
public class MongoCommunicationEventsAdapter implements CommunicationEventsPort {

    static final String TTL_INDEX = "events_ttl_idx";
    private static final int INDEX_OPTIONS_CONFLICT = 85;
    private static final int INDEX_KEY_SPECS_CONFLICT = 86;

    private final CommunicationEventMongoRepository repository;
    private final EventSequence sequence;
    private final ReactiveMongoTemplate template;
    private final Clock clock;
    private final EventsProperties properties;
    /** Last sequence fanned out by this instance; -1 until the log position has been read. */
    private final AtomicLong cursor = new AtomicLong(-1);
    // directBestEffort: slow subscribers miss events instead of blocking the tail; they can
    // resume from Last-Event-ID, and the snapshot-on-subscribe contract heals the rest.
    private final Sinks.Many<CommunicationEvent> sink =
            Sinks.many().multicast().directBestEffort();
    private Disposable tail;

    public MongoCommunicationEventsAdapter(CommunicationEventMongoRepository repository,
            EventSequence sequence, ReactiveMongoTemplate template, Clock clock,
            EventsProperties properties) {
        this.repository = repository;
        this.sequence = sequence;
        this.template = template;
        this.clock = clock;
        this.properties = properties;
    }

    @PostConstruct
    void start() {
        ensureTtlIndex().block();
        Duration interval = properties.pollInterval();
        tail = initialise()
                .retryWhen(Retry.fixedDelay(Long.MAX_VALUE, interval)
                        .doBeforeRetry(signal -> log.warn("event log not reachable yet, retrying: {}",
                                signal.failure().toString())))
                .thenMany(Flux.interval(interval, interval)
                        .onBackpressureDrop()
                        .concatMap(tick -> pollOnce().onErrorResume(ex -> {
                            log.warn("event log poll failed: {}", ex.toString());
                            return Mono.empty();
                        }), 1))
                .subscribe();
    }

    @PreDestroy
    void stop() {
        if (tail != null) {
            tail.dispose();
        }
    }

    /**
     * Ends every live stream the moment the context starts closing. SSE responses never finish
     * on their own, so the graceful shutdown of the web server (which waits for in-flight
     * requests before anything else is stopped) would otherwise sit out its whole timeout,
     * 30 s by default, and then cut the connections. {@link ContextClosedEvent} is published
     * before that wait begins; subscribers see their stream complete, reconnect to another
     * instance and resume with {@code Last-Event-ID}. Late subscribers complete at once.
     */
    @EventListener(ContextClosedEvent.class)
    public void closeStreams() {
        stop();
        sink.tryEmitComplete();
    }

    /** Positions the cursor at the end of the log, so only events from now on are fanned out. */
    Mono<Void> initialise() {
        return sequence.current().doOnNext(cursor::set).then();
    }

    /** Fans out every event appended after the cursor, in order; returns how many there were. */
    Mono<Long> pollOnce() {
        return repository.findBySeqGreaterThanOrderBySeqAsc(cursor.get())
                .doOnNext(this::fanOut)
                .count();
    }

    void fanOut(CommunicationEventDocument doc) {
        cursor.set(doc.seq);
        Sinks.EmitResult result = sink.tryEmitNext(doc.toDomain());
        if (result.isFailure() && result != Sinks.EmitResult.FAIL_ZERO_SUBSCRIBER) {
            log.warn("dropped communication event seq={} type={} for a subscriber: {}",
                    doc.seq, doc.type, result);
        }
    }

    @Override
    public Mono<CommunicationEvent> emit(CommunicationEventType type, Communication communication) {
        return sequence.next()
                .map(seq -> new CommunicationEvent(seq, type, clock.instant(), communication))
                .flatMap(event -> repository.insert(CommunicationEventDocument.fromDomain(event))
                        .thenReturn(event))
                .doOnNext(event -> log.debug("appended event seq={} type={} communication={}",
                        event.seq(), type, communication.id()))
                .onErrorResume(ex -> {
                    log.error("could not append {} event for communication {}; live subscribers"
                            + " will not see it: {}", type, communication.id(), ex.toString());
                    return Mono.empty();
                });
    }

    @Override
    public Flux<CommunicationEvent> stream() {
        return sink.asFlux();
    }

    @Override
    public Flux<CommunicationEvent> streamAfter(String tenantId, long afterSeq) {
        return Flux.defer(() -> {
            // Subscribe to the live fan-out before reading the cursor, so nothing can fall
            // between the replayed range and the live range; whatever the replay already
            // covers is dropped from the live side.
            Sinks.Many<CommunicationEvent> buffer = Sinks.many().unicast().onBackpressureBuffer();
            Disposable live = sink.asFlux()
                    .subscribe(buffer::tryEmitNext, buffer::tryEmitError, buffer::tryEmitComplete);
            long replayedUpTo = Math.max(cursor.get(), afterSeq);
            Flux<CommunicationEvent> replay = repository
                    .findTenantEventsInWindow(tenantId, afterSeq, replayedUpTo)
                    .map(CommunicationEventDocument::toDomain);
            return Flux.concat(replay, buffer.asFlux().filter(e -> e.seq() > replayedUpTo))
                    .doFinally(signal -> live.dispose());
        });
    }

    @Override
    public Mono<Boolean> canResumeAfter(long seq) {
        return sequence.current().flatMap(head -> {
            if (seq > head) {
                return Mono.just(false); // never issued: another log, or one reset since
            }
            if (seq == head) {
                return Mono.just(true); // nothing has happened since
            }
            return repository.findFirstByOrderBySeqAsc()
                    .map(oldest -> oldest.seq <= seq + 1) // the whole gap is still retained
                    .defaultIfEmpty(false);
        });
    }

    @Override
    public long position() {
        return Math.max(cursor.get(), 0);
    }

    private Mono<Void> ensureTtlIndex() {
        Index ttl = new Index().on("at", Sort.Direction.ASC).named(TTL_INDEX)
                .expire(properties.retention());
        return template.indexOps(CommunicationEventDocument.class).createIndex(ttl)
                .onErrorResume(MongoCommunicationEventsAdapter::isIndexConflict, ex -> updateTtl())
                .then();
    }

    /** The index already exists with another retention: Mongo can change it in place. */
    private Mono<String> updateTtl() {
        Document command = new Document("collMod", template.getCollectionName(CommunicationEventDocument.class))
                .append("index", new Document("name", TTL_INDEX)
                        .append("expireAfterSeconds", properties.retention().toSeconds()));
        return template.executeCommand(command)
                .doOnSuccess(result -> log.info("{} now expires events after {}", TTL_INDEX,
                        properties.retention()))
                .thenReturn(TTL_INDEX);
    }

    private static boolean isIndexConflict(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof MongoCommandException command
                    && (command.getErrorCode() == INDEX_OPTIONS_CONFLICT
                            || command.getErrorCode() == INDEX_KEY_SPECS_CONFLICT)) {
                return true;
            }
        }
        return false;
    }
}
