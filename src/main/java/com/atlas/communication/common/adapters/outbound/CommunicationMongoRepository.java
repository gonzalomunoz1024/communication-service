package com.atlas.communication.common.adapters.outbound;

import org.springframework.data.mongodb.repository.ReactiveMongoRepository;

public interface CommunicationMongoRepository
        extends ReactiveMongoRepository<CommunicationDocument, String> {
}
