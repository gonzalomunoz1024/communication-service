package com.atlas.communication.common.adapters.outbound;

import org.springframework.data.mongodb.repository.ReactiveMongoRepository;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

public interface CommunicationEventMongoRepository
        extends ReactiveMongoRepository<CommunicationEventDocument, Long> {

    /** Everything appended after a position, oldest first: the tail. */
    Flux<CommunicationEventDocument> findBySeqGreaterThanOrderBySeqAsc(long seq);

    /** A tenant's events in a (from, to] window, oldest first: a replay. */
    Flux<CommunicationEventDocument> findByTenantIdAndSeqGreaterThanAndSeqLessThanEqualOrderBySeqAsc(
            String tenantId, long from, long to);

    /** The oldest event still retained. */
    Mono<CommunicationEventDocument> findFirstByOrderBySeqAsc();
}
