package com.atlas.communication.publishing.domain;

import java.time.Instant;
import java.util.List;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.common.domain.Ticket;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Publish request. {@code draft} defaults to false (immediate publish); domain invariants
 * (maintenance windows, severity floors, time ordering) are enforced by
 * {@link com.atlas.communication.common.domain.Communication#create}. {@code ticket} optionally
 * ties the communication to the tracker ticket (ServiceNow incident) behind it; when given,
 * {@code externalRef} defaults to its number. {@code externalRef} is a permanent idempotency key:
 * usable once per tenant, for good. Every {@code affectedServices} entry names a service: a JSON
 * null is a binding error that names its position, a blank entry fails validation. A field this
 * record does not know is a 400 that names it, not ignored.
 */
@JsonIgnoreProperties(ignoreUnknown = false)
public record CreateCommunicationCommand(
        @NotBlank String tenantId,
        @NotBlank String publisher,
        @NotNull CommunicationType type,
        @NotNull Severity severity,
        @NotBlank @Size(max = Communication.TITLE_MAX) String title,
        @Size(max = Communication.BODY_MAX_BYTES) String body,
        @Size(max = 20) @JsonSetter(contentNulls = Nulls.FAIL) List<@NotBlank String> affectedServices,
        Audience audience,
        boolean draft,
        Instant startsAt,
        Instant endsAt,
        Instant expiresAt,
        @Schema(description = "Permanent idempotency key, usable once per tenant for the life of the store "
                + "(retired and expired notices included). Repeat it only to retry the same publish: the 409 "
                + "names the notice that already holds it. A follow-up notice needs a new value, for example "
                + "INC0012345-2. Defaults to ticket.number when a ticket is given.", example = "INC0012345")
        String externalRef,
        @Valid Ticket ticket) {

    public CreateCommunicationCommand {
        affectedServices = affectedServices == null ? null : List.copyOf(affectedServices);
    }
}
