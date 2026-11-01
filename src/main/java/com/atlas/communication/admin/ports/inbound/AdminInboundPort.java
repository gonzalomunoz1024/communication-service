package com.atlas.communication.admin.ports.inbound;

import java.time.Instant;
import java.util.Set;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.common.domain.TenantSummary;
import com.atlas.communication.publishing.domain.RetireRequest;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Cross-tenant oversight. Served under /v1/admin/** so a gateway or auth filter can protect
 * the whole surface once authn/authz lands.
 */
public interface AdminInboundPort {

    /** Cross-tenant search including DRAFT/EXPIRED/RETIRED; tenantId null = all tenants. */
    Mono<Page<Communication>> search(String tenantId, Set<CommunicationStatus> statuses,
            CommunicationType type, String publisher, Instant createdFrom, Instant createdTo,
            int page, int size);

    Flux<TenantSummary> tenants();

    /** Admin override retire, any tenant. */
    Mono<Communication> retire(String id, RetireRequest request);

    /** Hard delete (GDPR/mistakes) — the one intentional exception to keep-forever audit. */
    Mono<Void> purge(String id);
}
