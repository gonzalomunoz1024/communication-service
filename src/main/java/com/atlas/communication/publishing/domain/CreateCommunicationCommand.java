package com.atlas.communication.publishing.domain;

import java.time.Instant;
import java.util.List;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.common.domain.Ticket;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Publish request. {@code draft} defaults to false (immediate publish); domain invariants
 * (maintenance windows, severity floors, time ordering) are enforced by
 * {@link com.atlas.communication.common.domain.Communication#create}. {@code ticket} optionally
 * ties the communication to the tracker ticket (ServiceNow incident) behind it; when given,
 * {@code externalRef} defaults to its number.
 */
public record CreateCommunicationCommand(
        @NotBlank String tenantId,
        @NotBlank String publisher,
        @NotNull CommunicationType type,
        @NotNull Severity severity,
        @NotBlank @Size(max = Communication.TITLE_MAX) String title,
        @Size(max = Communication.BODY_MAX_BYTES) String body,
        @Size(max = 20) List<String> affectedServices,
        Audience audience,
        boolean draft,
        Instant startsAt,
        Instant endsAt,
        Instant expiresAt,
        String externalRef,
        @Valid Ticket ticket) {

    public CreateCommunicationCommand {
        affectedServices = affectedServices == null ? null : List.copyOf(affectedServices);
    }
}
