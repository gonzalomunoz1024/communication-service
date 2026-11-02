package com.atlas.communication.common.adapters.outbound;

import org.springframework.data.mongodb.repository.Query;
import org.springframework.data.mongodb.repository.ReactiveMongoRepository;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

public interface CommunicationEventMongoRepository
        extends ReactiveMongoRepository<CommunicationEventDocument, Long> {

    /** Everything appended after a position, oldest first: the tail. */
    Flux<CommunicationEventDocument> findBySeqGreaterThanOrderBySeqAsc(long seq);

    /**
     * A tenant's events in a (from, to] window, oldest first: a replay. Written out as a query
     * because a derived {@code ...SeqGreaterThanAndSeqLessThanEqual...} method cannot be built:
     * Spring Data MongoDB refuses two criteria on one field ("you can't add a second 'seq'
     * expression"), and the failure only shows at runtime, on the first resume.
     */
    @Query(value = "{ 'tenantId': ?0, '_id': { '$gt': ?1, '$lte': ?2 } }", sort = "{ '_id': 1 }")
    Flux<CommunicationEventDocument> findTenantEventsInWindow(String tenantId, long fromExclusive,
            long toInclusive);

    /** The oldest event still retained. */
    Mono<CommunicationEventDocument> findFirstByOrderBySeqAsc();
}
