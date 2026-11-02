package com.atlas.communication.publishing.domain;

import java.time.Instant;
import java.util.List;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.common.domain.Ticket;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Partial content update: null fields are left unchanged. {@code expectedVersion} makes the
 * client's read-modify-write explicit — a mismatch is a 409, never a silent lost update.
 * {@code ticket} attaches or replaces the tracker ticket (a ticket can be attached to a draft
 * before it is published; it cannot be removed).
 */
public record UpdateCommunicationCommand(
        Severity severity,
        @Size(max = Communication.TITLE_MAX) String title,
        @Size(max = Communication.BODY_MAX_BYTES) String body,
        @Size(max = 20) @JsonSetter(contentNulls = Nulls.FAIL) List<@NotBlank String> affectedServices,
        Audience audience,
        Instant startsAt,
        Instant endsAt,
        Instant expiresAt,
        @Valid Ticket ticket,
        String actor,
        @Schema(description = "The version you last read: every answer and GET /v1/communications/{id} carry it. "
                + "A 409 'expectedVersion N does not match current version M' means someone saved in between: "
                + "re-read, re-apply your change and send the new version.", example = "0")
        @NotNull Long expectedVersion) {

    public UpdateCommunicationCommand {
        // null keeps the stored services (partial update); a given list is copied
        affectedServices = affectedServices == null ? null : List.copyOf(affectedServices);
    }
}
