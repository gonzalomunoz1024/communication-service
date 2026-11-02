package com.atlas.communication.admin.application;

import java.time.Clock;
import java.time.Instant;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.admin.ports.inbound.AdminInboundPort;
import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationQuery;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.common.domain.TenantSummary;
import com.atlas.communication.common.ports.outbound.CommunicationRepositoryPort;
import com.atlas.communication.publishing.application.PublishingUseCase;
import com.atlas.communication.publishing.domain.RetireRequest;

import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Admin oversight. Retire delegates to the publishing rules (same state machine and events);
 * search and purge are admin-only capabilities. Search answers with each communication's
 * effective status, like the publisher's own reads.
 */
@Service
@RequiredArgsConstructor
public class AdminUseCase implements AdminInboundPort {

    private final CommunicationRepositoryPort repository;
    private final PublishingUseCase publishing;
    private final Clock clock;

    @Override
    public Mono<Page<Communication>> search(String tenantId, Set<CommunicationStatus> statuses,
            CommunicationType type, String publisher, Instant createdFrom, Instant createdTo,
            int page, int size) {
        return Mono.defer(() -> {
            Instant now = clock.instant();
            CommunicationQuery query = CommunicationQuery.admin(tenantId, statuses, type,
                    publisher, createdFrom, createdTo, Page.validPage(page), Page.validSize(size));
            return repository.query(query).collectList()
                    .zipWith(repository.count(query))
                    .map(t -> Page.of(t.getT1(), query.page(), query.size(), t.getT2())
                            .map(c -> c.asSeenAt(now)));
        });
    }

    @Override
    public Flux<TenantSummary> tenants() {
        return repository.summarizeTenants();
    }

    @Override
    public Mono<Communication> retire(String id, RetireRequest request) {
        return publishing.retire(id, request);
    }

    @Override
    public Mono<Void> purge(String id) {
        return repository.deleteById(id)
                .flatMap(deleted -> deleted ? Mono.<Void>empty()
                        : Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND,
                                "communication " + id + " not found")));
    }
}
