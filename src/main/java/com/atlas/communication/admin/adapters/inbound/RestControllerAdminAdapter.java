package com.atlas.communication.admin.adapters.inbound;

import java.time.Instant;
import java.util.Set;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.atlas.communication.admin.application.AdminUseCase;
import com.atlas.communication.admin.ports.inbound.AdminInboundPort;
import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.common.domain.TenantSummary;
import com.atlas.communication.publishing.domain.RetireRequest;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@RestController
@RequiredArgsConstructor
@RequestMapping("/v1/admin")
@Tag(name = "Admin", description = "Cross-tenant oversight (path-segregated for future auth)")
public class RestControllerAdminAdapter implements AdminInboundPort {

    private final AdminUseCase useCase;

    @GetMapping("/communications")
    @Operation(summary = "Search all communications, any tenant and status, incl. history")
    public Mono<Page<Communication>> searchHttp(
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) Set<CommunicationStatus> status,
            @RequestParam(required = false) CommunicationType type,
            @RequestParam(required = false) String publisher,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return search(tenantId, status, type, publisher, from, to, page, size);
    }

    @Override
    @GetMapping("/tenants")
    @Operation(summary = "Per-tenant communication counts by status")
    public Flux<TenantSummary> tenants() {
        return useCase.tenants();
    }

    @Override
    @PostMapping("/communications/{id}/retire")
    @Operation(summary = "Retire any tenant's communication (admin override)")
    public Mono<Communication> retire(@PathVariable String id,
            @RequestBody(required = false) RetireRequest request) {
        return useCase.retire(id, request);
    }

    @DeleteMapping("/communications/{id}")
    @Operation(summary = "Hard-delete a communication (destroys audit history)")
    public Mono<ResponseEntity<Void>> purgeHttp(@PathVariable String id) {
        return purge(id).thenReturn(ResponseEntity.noContent().<Void>build());
    }

    @Override
    public Mono<Page<Communication>> search(String tenantId, Set<CommunicationStatus> statuses,
            CommunicationType type, String publisher, Instant createdFrom, Instant createdTo,
            int page, int size) {
        return useCase.search(tenantId, statuses, type, publisher, createdFrom, createdTo, page, size);
    }

    @Override
    public Mono<Void> purge(String id) {
        return useCase.purge(id);
    }
}
