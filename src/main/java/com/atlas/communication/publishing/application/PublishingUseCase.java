package com.atlas.communication.publishing.application;

import java.time.Clock;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.domain.CommunicationQuery;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.common.ports.outbound.CommunicationEventsPort;
import com.atlas.communication.common.ports.outbound.CommunicationRepositoryPort;
import com.atlas.communication.publishing.domain.CreateCommunicationCommand;
import com.atlas.communication.publishing.domain.RetireRequest;
import com.atlas.communication.publishing.domain.UpdateCommunicationCommand;
import com.atlas.communication.publishing.ports.inbound.PublishingInboundPort;

import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Mono;

/**
 * All command-side business rules. Event policy: consumers only hear about communications
 * they could see, so DRAFTs are silent — CREATED fires on first non-draft save (create or
 * publish), UPDATED on content changes to visible items, RETIRED on retire; the sweeper owns
 * ACTIVATED/EXPIRED.
 */
@Service
@RequiredArgsConstructor
public class PublishingUseCase implements PublishingInboundPort {

    private final CommunicationRepositoryPort repository;
    private final CommunicationEventsPort events;
    private final Clock clock;

    @Override
    public Mono<Communication> create(CreateCommunicationCommand cmd) {
        return create(UUID.randomUUID().toString(), cmd);
    }

    /**
     * Create under a caller-chosen id. Not exposed over HTTP; lets automated publishers (health
     * monitors) record the id they are about to publish before the communication exists.
     */
    public Mono<Communication> create(String id, CreateCommunicationCommand cmd) {
        Instant now = clock.instant();
        Communication communication = Communication.create(id,
                cmd.tenantId(), cmd.publisher(), cmd.type(), cmd.severity(), cmd.title(), cmd.body(),
                cmd.affectedServices(), cmd.audience(), cmd.draft(),
                cmd.startsAt(), cmd.endsAt(), cmd.expiresAt(), cmd.externalRef(), now);
        return repository.save(communication)
                .doOnNext(saved -> {
                    if (saved.status() != CommunicationStatus.DRAFT) {
                        events.emit(CommunicationEventType.CREATED, saved);
                    }
                });
    }

    @Override
    public Mono<Communication> get(String id) {
        return repository.findById(id).switchIfEmpty(notFound(id));
    }

    @Override
    public Mono<Page<Communication>> list(String tenantId, Set<CommunicationStatus> statuses,
            CommunicationType type, int page, int size) {
        return Mono.defer(() -> {
            CommunicationQuery query = CommunicationQuery.listing(tenantId, statuses, type,
                    Page.validPage(page), Page.validSize(size));
            return repository.query(query).collectList()
                    .zipWith(repository.count(query))
                    .map(t -> Page.of(t.getT1(), query.page(), query.size(), t.getT2()));
        });
    }

    @Override
    public Mono<Communication> update(String id, UpdateCommunicationCommand cmd) {
        Instant now = clock.instant();
        return get(id)
                .flatMap(current -> {
                    if (current.status().terminal()) {
                        return Mono.error(conflict("communication " + id + " is "
                                + current.status() + " and can no longer be updated"));
                    }
                    if (!current.version().equals(cmd.expectedVersion())) {
                        return Mono.error(conflict("expectedVersion " + cmd.expectedVersion()
                                + " does not match current version " + current.version()));
                    }
                    Communication updated = current.withContent(cmd.severity(), cmd.title(),
                            cmd.body(), cmd.affectedServices(), cmd.audience(), cmd.startsAt(),
                            cmd.endsAt(), cmd.expiresAt(), actorOr(cmd.actor(), current), now);
                    return repository.save(updated);
                })
                .doOnNext(saved -> {
                    if (saved.status() != CommunicationStatus.DRAFT) {
                        events.emit(CommunicationEventType.UPDATED, saved);
                    }
                });
    }

    @Override
    public Mono<Communication> publish(String id) {
        Instant now = clock.instant();
        return get(id)
                .flatMap(current -> {
                    if (current.status() != CommunicationStatus.DRAFT) {
                        return Mono.error(conflict("only DRAFT communications can be published; "
                                + id + " is " + current.status()));
                    }
                    CommunicationStatus target = current.startsAt().isAfter(now)
                            ? CommunicationStatus.SCHEDULED : CommunicationStatus.ACTIVE;
                    return repository.save(current.withStatus(target, current.publisher(), now));
                })
                .doOnNext(saved -> events.emit(CommunicationEventType.CREATED, saved));
    }

    @Override
    public Mono<Communication> retire(String id, RetireRequest request) {
        Instant now = clock.instant();
        RetireRequest req = request == null ? RetireRequest.EMPTY : request;
        return get(id)
                .flatMap(current -> switch (current.status()) {
                    case RETIRED -> Mono.just(current); // idempotent no-op
                    case EXPIRED -> Mono.error(conflict(
                            "communication " + id + " already expired; retiring would rewrite history"));
                    default -> repository
                            .save(current.withStatus(CommunicationStatus.RETIRED,
                                    actorOr(req.actor(), current), req.note(), now))
                            .doOnNext(saved -> events.emit(CommunicationEventType.RETIRED, saved));
                });
    }

    private static String actorOr(String actor, Communication fallback) {
        return actor == null || actor.isBlank() ? fallback.publisher() : actor;
    }

    private static <T> Mono<T> notFound(String id) {
        return Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND,
                "communication " + id + " not found"));
    }

    private static ResponseStatusException conflict(String reason) {
        return new ResponseStatusException(HttpStatus.CONFLICT, reason);
    }
}
