package com.atlas.communication.health.adapters.outbound;

import org.springframework.stereotype.Component;

import com.atlas.communication.health.domain.HealthInstance;
import com.atlas.communication.health.ports.outbound.HealthInstanceRepositoryPort;

import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/** Mongo-backed instance store; a save replaces the previous record of the same instance. */
@Component
@RequiredArgsConstructor
public class MongoHealthInstanceRepositoryAdapter implements HealthInstanceRepositoryPort {

    private final HealthInstanceMongoRepository repository;

    @Override
    public Mono<HealthInstance> save(HealthInstance instance) {
        return repository.save(HealthInstanceDocument.fromDomain(instance))
                .map(HealthInstanceDocument::toDomain);
    }

    @Override
    public Flux<HealthInstance> findByMonitor(String monitorId) {
        return repository.findByMonitorIdOrderByInstanceIdAsc(monitorId)
                .map(HealthInstanceDocument::toDomain);
    }

    @Override
    public Mono<Void> deleteByMonitor(String monitorId) {
        return repository.deleteByMonitorId(monitorId).then();
    }
}
