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
import com.atlas.communication.common.domain.Ticket;
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
 * ACTIVATED/EXPIRED. A ticket is optional on every communication; one given goes through
 * {@link TicketPolicy#normalise} on the way in.
 */
@Service
@RequiredArgsConstructor
public class PublishingUseCase implements PublishingInboundPort {

    private final CommunicationRepositoryPort repository;
    private final CommunicationEventsPort events;
    private final Clock clock;
    private final TicketPolicy tickets;

    @Override
    public Mono<Communication> create(CreateCommunicationCommand cmd) {
        return Mono.defer(() -> create(UUID.randomUUID().toString(), cmd, tickets.normalise(cmd.ticket())));
    }

    /**
     * Create under a caller-chosen id. Not exposed over HTTP; lets automated publishers (health
     * monitors) record the id they are about to publish before the communication exists.
     */
    public Mono<Communication> create(String id, CreateCommunicationCommand cmd) {
        return Mono.defer(() -> create(id, cmd, tickets.normalise(cmd.ticket())));
    }

    private Mono<Communication> create(String id, CreateCommunicationCommand cmd, Ticket ticket) {
        Instant now = clock.instant();
        String externalRef = cmd.externalRef() != null && !cmd.externalRef().isBlank()
                ? cmd.externalRef() : ticket == null ? null : ticket.number();
        Communication communication = Communication.create(id,
                cmd.tenantId(), cmd.publisher(), cmd.type(), cmd.severity(), cmd.title(), cmd.body(),
                cmd.affectedServices(), cmd.audience(), cmd.draft(),
                cmd.startsAt(), cmd.endsAt(), cmd.expiresAt(), externalRef, ticket, now);
        return repository.save(communication)
                .flatMap(saved -> announceUnlessDraft(CommunicationEventType.CREATED, saved));
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
                    // the effective status, not the stored one: an item past expiresAt is
                    // EXPIRED for every reader even before the sweeper has caught up
                    CommunicationStatus status = current.effectiveStatus(now);
                    if (status.terminal()) {
                        return Mono.error(conflict("communication " + id + " is "
                                + status + " and can no longer be updated"));
                    }
                    if (!current.version().equals(cmd.expectedVersion())) {
                        return Mono.error(conflict("expectedVersion " + cmd.expectedVersion()
                                + " does not match current version " + current.version()));
                    }
                    String actor = actorOr(cmd.actor(), current);
                    Communication updated = current
                            .withContent(cmd.severity(), cmd.title(), cmd.body(), cmd.affectedServices(),
                                    cmd.audience(), cmd.startsAt(), cmd.endsAt(), cmd.expiresAt(), actor, now)
                            .withTicket(tickets.normalise(cmd.ticket()), actor, now);
                    return repository.save(updated);
                })
                .flatMap(saved -> announceUnlessDraft(CommunicationEventType.UPDATED, saved));
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
                .flatMap(saved -> announce(CommunicationEventType.CREATED, saved));
    }

    @Override
    public Mono<Communication> retire(String id, RetireRequest request) {
        Instant now = clock.instant();
        RetireRequest req = request == null ? RetireRequest.EMPTY : request;
        return get(id)
                .flatMap(current -> switch (current.effectiveStatus(now)) { // not the stored status
                    case RETIRED -> Mono.just(current); // idempotent no-op
                    case EXPIRED -> Mono.error(conflict(
                            "communication " + id + " already expired; retiring would rewrite history"));
                    default -> repository
                            .save(current.withStatus(CommunicationStatus.RETIRED,
                                    actorOr(req.actor(), current), req.note(), now))
                            .flatMap(saved -> announce(CommunicationEventType.RETIRED, saved));
                });
    }

    private static String actorOr(String actor, Communication fallback) {
        return actor == null || actor.isBlank() ? fallback.publisher() : actor;
    }

    /** Appends the event to the shared log; the saved communication is returned either way. */
    private Mono<Communication> announce(CommunicationEventType type, Communication saved) {
        return events.emit(type, saved).thenReturn(saved);
    }

    private Mono<Communication> announceUnlessDraft(CommunicationEventType type, Communication saved) {
        return saved.status() == CommunicationStatus.DRAFT ? Mono.just(saved) : announce(type, saved);
    }

    private static <T> Mono<T> notFound(String id) {
        return Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND,
                "communication " + id + " not found"));
    }

    private static ResponseStatusException conflict(String reason) {
        return new ResponseStatusException(HttpStatus.CONFLICT, reason);
    }
}
