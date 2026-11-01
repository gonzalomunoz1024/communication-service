package com.atlas.communication.health.adapters.outbound;

import org.springframework.data.mongodb.repository.ReactiveMongoRepository;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

public interface HealthMonitorMongoRepository
        extends ReactiveMongoRepository<HealthMonitorDocument, String> {

    Mono<HealthMonitorDocument> findByTenantIdAndService(String tenantId, String service);

    Flux<HealthMonitorDocument> findByTenantId(String tenantId);
}
