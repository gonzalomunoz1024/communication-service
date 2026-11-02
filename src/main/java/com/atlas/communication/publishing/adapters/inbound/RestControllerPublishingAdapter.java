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
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
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

    /*
     * Request examples Swagger UI fills in. Each one is accepted as it is (OpenApiContractIT sends them):
     * the update example's expectedVersion is that of a notice the publish example just created.
     */
    static final String PUBLISH_EXAMPLE = """
            {
              "tenantId": "acme",
              "publisher": "sre-team",
              "type": "INCIDENT",
              "severity": "MAJOR",
              "title": "Checkout errors for some customers",
              "body": "Some payments fail. We are rolling back the last release; next update in 30 minutes.",
              "affectedServices": ["checkout", "payments"],
              "audience": "CUSTOMERS",
              "externalRef": "INC0012345",
              "ticket": {"system": "servicenow", "number": "INC0012345"}
            }""";
    static final String UPDATE_EXAMPLE = """
            {
              "severity": "MINOR",
              "body": "The rollback is done and errors are back to normal; we keep watching for 30 minutes.",
              "actor": "sre-team",
              "expectedVersion": 0
            }""";
    static final String RETIRE_EXAMPLE = """
            {"actor": "sre-team", "note": "Resolved: the rollback fixed checkout."}""";
    private static final String ERROR_SCHEMA = "#/components/schemas/Error";

    private final PublishingUseCase useCase;

    @PostMapping("/communications")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true, content = @Content(
            mediaType = "application/json", schema = @Schema(implementation = CreateCommunicationCommand.class),
            examples = @ExampleObject(name = "incident", summary = "An incident customers see, with its ticket",
                    value = PUBLISH_EXAMPLE)))
    @ApiResponse(responseCode = "201", description = "Published, or saved as a DRAFT when draft is true",
            headers = @Header(name = "Location", description = "The new notice: /v1/communications/{id}",
                    schema = @Schema(type = "string")),
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = Communication.class)))
    @Operation(summary = "Publish (or draft) a new communication")
    @ApiResponse(responseCode = "409", description = "externalRef already used in this tenant. It is a permanent "
            + "idempotency key: repeat it only to retry the same publish; give a follow-up notice a new value. "
            + "The body names the notice that holds it, and suggestedExternalRef is the first follow-up value the "
            + "tenant does not hold yet (absent when the first 50 are all taken).",
            content = @Content(mediaType = "application/json", examples = @ExampleObject(value = "{\"error\":"
                    + "\"externalRef 'INC0012345' is already used by notice 3f0c2a1e-7d4b-4a4e-9c2b-5e1f0a6d8b21 in "
                    + "tenant acme. externalRef is a permanent idempotency key: repeat it only to retry the same "
                    + "publish; give a follow-up notice a new value (for example INC0012345-3, which is still free).\","
                    + "\"suggestedExternalRef\":\"INC0012345-3\"}")))
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
    @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true, content = @Content(
            mediaType = "application/json", schema = @Schema(implementation = UpdateCommunicationCommand.class),
            examples = @ExampleObject(name = "downgrade", summary = "Lower the severity and say what changed",
                    value = UPDATE_EXAMPLE)))
    @ApiResponse(responseCode = "200", description = "Updated: the notice as saved, with its new version",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = Communication.class)))
    @Operation(summary = "Update content; requires expectedVersion")
    @ApiResponse(responseCode = "409", description = "expectedVersion is not the current version (someone saved "
            + "in between: re-read, re-apply, send the new version), or the communication is EXPIRED/RETIRED and "
            + "can no longer be updated",
            content = @Content(mediaType = "application/json", schema = @Schema(ref = ERROR_SCHEMA),
                    examples = @ExampleObject(value = "{\"error\":\"expectedVersion 0 does not match current version 1\"}")))
    public Mono<Communication> update(@PathVariable String id,
            @Valid @RequestBody UpdateCommunicationCommand command) {
        return useCase.update(id, command);
    }

    @Override
    @PostMapping("/communications/{id}/publish")
    @Operation(summary = "Publish a DRAFT")
    @ApiResponse(responseCode = "200", description = "Published: the notice, now ACTIVE (SCHEDULED when its "
            + "startsAt is still ahead)",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = Communication.class)))
    @ApiResponse(responseCode = "409", description = "The notice is not a DRAFT (any more)",
            content = @Content(mediaType = "application/json", schema = @Schema(ref = ERROR_SCHEMA),
                    examples = @ExampleObject(value = "{\"error\":\"only DRAFT communications can be published; "
                            + "3f0c2a1e-7d4b-4a4e-9c2b-5e1f0a6d8b21 is ACTIVE\"}")))
    public Mono<Communication> publish(@PathVariable String id) {
        return useCase.publish(id);
    }

    @Override
    @PostMapping("/communications/{id}/retire")
    @Operation(summary = "Retire a communication (idempotent on already-retired)")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(content = @Content(
            mediaType = "application/json", schema = @Schema(implementation = RetireRequest.class),
            examples = @ExampleObject(name = "resolved", summary = "Who retires it and why (both optional)",
                    value = RETIRE_EXAMPLE)))
    @ApiResponse(responseCode = "200", description = "Retired, or already retired: the notice as it is now",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = Communication.class)))
    @ApiResponse(responseCode = "409", description = "The notice already EXPIRED: retiring it would rewrite history",
            content = @Content(mediaType = "application/json", schema = @Schema(ref = ERROR_SCHEMA),
                    examples = @ExampleObject(value = "{\"error\":\"communication 3f0c2a1e-7d4b-4a4e-9c2b-5e1f0a6d8b21 "
                            + "already expired; retiring would rewrite history\"}")))
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
