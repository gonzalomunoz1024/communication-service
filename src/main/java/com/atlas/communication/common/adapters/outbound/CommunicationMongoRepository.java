package com.atlas.communication.common.adapters.outbound;

import org.springframework.data.mongodb.repository.ReactiveMongoRepository;

import reactor.core.publisher.Mono;

public interface CommunicationMongoRepository
        extends ReactiveMongoRepository<CommunicationDocument, String> {

    /** The notice holding an externalRef in a tenant; the unique index allows at most one. */
    Mono<CommunicationDocument> findFirstByTenantIdAndExternalRef(String tenantId, String externalRef);
}
