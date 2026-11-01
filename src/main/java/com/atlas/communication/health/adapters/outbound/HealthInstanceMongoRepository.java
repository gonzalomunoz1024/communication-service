package com.atlas.communication.health.adapters.outbound;

import org.springframework.data.mongodb.repository.ReactiveMongoRepository;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

public interface HealthInstanceMongoRepository extends ReactiveMongoRepository<HealthInstanceDocument, String> {

    Flux<HealthInstanceDocument> findByMonitorIdOrderByInstanceIdAsc(String monitorId);

    Mono<Long> deleteByMonitorId(String monitorId);
}
