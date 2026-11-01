package com.atlas.communication.health.adapters.outbound;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/** Mongo-backed monitor store; storage conflicts become 409s like the communication store. */
@Component
@RequiredArgsConstructor
public class MongoHealthMonitorRepositoryAdapter implements HealthMonitorRepositoryPort {

    private final HealthMonitorMongoRepository repository;

    @Override
    public Mono<HealthMonitor> save(HealthMonitor monitor) {
        return repository.save(HealthMonitorDocument.fromDomain(monitor))
                .map(HealthMonitorDocument::toDomain)
                .onErrorMap(DuplicateKeyException.class, ex -> new ResponseStatusException(
                        HttpStatus.CONFLICT, "a monitor already exists for service '"
                                + monitor.service() + "' in tenant '" + monitor.tenantId() + "'"))
                .onErrorMap(OptimisticLockingFailureException.class, ex -> new ResponseStatusException(
                        HttpStatus.CONFLICT, "monitor " + monitor.id()
                                + " was modified concurrently; reload and retry"));
    }

    @Override
    public Mono<HealthMonitor> findById(String id) {
        return repository.findById(id).map(HealthMonitorDocument::toDomain);
    }

    @Override
    public Mono<HealthMonitor> findByTenantAndService(String tenantId, String service) {
        return repository.findByTenantIdAndService(tenantId, service).map(HealthMonitorDocument::toDomain);
    }

    @Override
    public Flux<HealthMonitor> findAll(String tenantId) {
        Flux<HealthMonitorDocument> docs = tenantId == null
                ? repository.findAll() : repository.findByTenantId(tenantId);
        return docs.map(HealthMonitorDocument::toDomain);
    }

    @Override
    public Mono<Boolean> deleteById(String id) {
        return repository.existsById(id)
                .flatMap(exists -> exists ? repository.deleteById(id).thenReturn(true) : Mono.just(false));
    }
}
