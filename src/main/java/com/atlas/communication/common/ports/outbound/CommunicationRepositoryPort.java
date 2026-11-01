package com.atlas.communication.common.ports.outbound;

import java.time.Instant;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationQuery;
import com.atlas.communication.common.domain.TenantSummary;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Durable store for communications. Implementations map storage conflicts to
 * {@code ResponseStatusException(409)}: duplicate (tenantId, externalRef) and
 * optimistic-lock (version) failures.
 */
public interface CommunicationRepositoryPort {

    Mono<Communication> save(Communication communication);

    Mono<Communication> findById(String id);

    Flux<Communication> query(CommunicationQuery query);

    Mono<Long> count(CommunicationQuery query);

    /** Stored SCHEDULED whose startsAt has passed — sweeper input. */
    Flux<Communication> dueForActivation(Instant now);

    /** Stored ACTIVE whose expiresAt has passed — sweeper input. */
    Flux<Communication> dueForExpiry(Instant now);

    Mono<Boolean> deleteById(String id);

    Flux<TenantSummary> summarizeTenants();
}
