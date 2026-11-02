package com.atlas.communication.publishing.adapters.inbound;

import java.net.URI;
import java.util.Set;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.publishing.application.PublishingUseCase;
import com.atlas.communication.publishing.domain.CreateCommunicationCommand;
import com.atlas.communication.publishing.domain.RetireRequest;
import com.atlas.communication.publishing.domain.UpdateCommunicationCommand;
import com.atlas.communication.publishing.ports.inbound.PublishingInboundPort;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Mono;

@RestController
@RequiredArgsConstructor
@RequestMapping("/v1")
@Tag(name = "Publishing", description = "Publisher teams manage their communications")
public class RestControllerPublishingAdapter implements PublishingInboundPort {

    private final PublishingUseCase useCase;

    @PostMapping("/communications")
    @Operation(summary = "Publish (or draft) a new communication")
    @ApiResponse(responseCode = "409", description = "externalRef already used in this tenant. It is a permanent "
            + "idempotency key: repeat it only to retry the same publish; give a follow-up notice a new value. "
            + "The body names the notice that holds it.",
            content = @Content(mediaType = "application/json", examples = @ExampleObject(value = "{\"error\":"
                    + "\"externalRef 'INC-1' is already used by notice 3f0c2a1e-7d4b-4a4e-9c2b-5e1f0a6d8b21 in tenant "
                    + "acme. externalRef is a permanent idempotency key: repeat it only to retry the same publish; "
                    + "give a follow-up notice a new value (for example INC-1-2).\"}")))
    public Mono<ResponseEntity<Communication>> createHttp(
            @Valid @RequestBody CreateCommunicationCommand command) {
        return create(command).map(saved -> ResponseEntity
                .created(URI.create("/v1/communications/" + saved.id()))
                .body(saved));
    }

    @Override
    @GetMapping("/communications/{id}")
    @Operation(summary = "Get one communication, any status, including audit history")
    public Mono<Communication> get(@PathVariable String id) {
        return useCase.get(id);
    }

    @GetMapping("/communications")
    @Operation(summary = "List a tenant's own communications")
    public Mono<Page<Communication>> listHttp(
            @RequestParam String tenantId,
            @RequestParam(required = false) Set<CommunicationStatus> status,
            @RequestParam(required = false) CommunicationType type,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return list(tenantId, status, type, page, size);
    }

    @Override
    @PutMapping("/communications/{id}")
    @Operation(summary = "Update content; requires expectedVersion")
    @ApiResponse(responseCode = "409", description = "expectedVersion is not the current version (someone saved "
            + "in between: re-read, re-apply, send the new version), or the communication is EXPIRED/RETIRED and "
            + "can no longer be updated",
            content = @Content(mediaType = "application/json", examples = @ExampleObject(
                    value = "{\"error\":\"expectedVersion 0 does not match current version 1\"}")))
    public Mono<Communication> update(@PathVariable String id,
            @Valid @RequestBody UpdateCommunicationCommand command) {
        return useCase.update(id, command);
    }

    @Override
    @PostMapping("/communications/{id}/publish")
    @Operation(summary = "Publish a DRAFT")
    public Mono<Communication> publish(@PathVariable String id) {
        return useCase.publish(id);
    }

    @Override
    @PostMapping("/communications/{id}/retire")
    @Operation(summary = "Retire a communication (idempotent on already-retired)")
    public Mono<Communication> retire(@PathVariable String id,
            @RequestBody(required = false) RetireRequest request) {
        return useCase.retire(id, request);
    }

    @Override
    public Mono<Communication> create(CreateCommunicationCommand command) {
        return useCase.create(command);
    }

    @Override
    public Mono<Page<Communication>> list(String tenantId, Set<CommunicationStatus> statuses,
            CommunicationType type, int page, int size) {
        return useCase.list(tenantId, statuses, type, page, size);
    }
}
