package com.atlas.communication.common.domain;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * The communication aggregate. Immutable; every mutation returns a copy with an appended
 * {@link AuditEntry}. Stored {@code status} converges via the background sweeper, but reads
 * must use {@link #effectiveStatus(Instant)} so visibility is exact regardless of sweeper lag.
 */
public record Communication(
        String id,
        String tenantId,
        String publisher,
        CommunicationType type,
        Severity severity,
        String title,
        String body,
        List<String> affectedServices,
        Audience audience,
        CommunicationStatus status,
        Instant startsAt,
        Instant endsAt,
        Instant expiresAt,
        String externalRef,
        Ticket ticket,
        Instant createdAt,
        Instant updatedAt,
        Long version,
        List<AuditEntry> history) {

    public static final int TITLE_MAX = 200;
    public static final int BODY_MAX_BYTES = 16 * 1024;
    public static final int HISTORY_MAX = 50;

    public Communication {
        affectedServices = affectedServices == null ? List.of() : List.copyOf(affectedServices);
        history = history == null ? List.of() : List.copyOf(history);
    }

    /** Creates a new communication that is not tied to a ticket; see the overload. */
    public static Communication create(String id, String tenantId, String publisher,
            CommunicationType type, Severity severity, String title, String body,
            List<String> affectedServices, Audience audience, boolean draft,
            Instant startsAt, Instant endsAt, Instant expiresAt, String externalRef, Instant now) {
        return create(id, tenantId, publisher, type, severity, title, body, affectedServices,
                audience, draft, startsAt, endsAt, expiresAt, externalRef, null, now);
    }

    /** Creates a new communication, applying defaults and validating invariants. */
    public static Communication create(String id, String tenantId, String publisher,
            CommunicationType type, Severity severity, String title, String body,
            List<String> affectedServices, Audience audience, boolean draft,
            Instant startsAt, Instant endsAt, Instant expiresAt, String externalRef,
            Ticket ticket, Instant now) {
        Instant effectiveStart = startsAt == null ? now : startsAt;
        Instant effectiveExpiry = expiresAt == null && type == CommunicationType.MAINTENANCE
                ? endsAt : expiresAt;
        CommunicationStatus initial = draft ? CommunicationStatus.DRAFT
                : effectiveStart.isAfter(now) ? CommunicationStatus.SCHEDULED : CommunicationStatus.ACTIVE;
        Communication created = new Communication(id, tenantId, publisher, type, severity, title, body,
                affectedServices, audience == null ? Audience.CUSTOMERS : audience, initial,
                effectiveStart, endsAt, effectiveExpiry, externalRef, ticket, now, now, null,
                List.of(new AuditEntry(now, publisher, "created (" + initial + ")")));
        created.validateInvariants(startsAt == null);
        return created;
    }

    /** Applies a content update, keeping identity/lifecycle fields; appends audit. */
    public Communication withContent(Severity newSeverity, String newTitle, String newBody,
            List<String> newAffectedServices, Audience newAudience,
            Instant newStartsAt, Instant newEndsAt, Instant newExpiresAt, String actor, Instant now) {
        Communication updated = new Communication(id, tenantId, publisher, type,
                newSeverity == null ? severity : newSeverity,
                newTitle == null ? title : newTitle,
                newBody == null ? body : newBody,
                newAffectedServices == null ? affectedServices : newAffectedServices,
                newAudience == null ? audience : newAudience,
                status,
                newStartsAt == null ? startsAt : newStartsAt,
                newEndsAt == null ? endsAt : newEndsAt,
                newExpiresAt == null ? expiresAt : newExpiresAt,
                externalRef, ticket, createdAt, now, version,
                appended(now, actor, "updated"));
        updated.validateInvariants();
        return updated;
    }

    /**
     * Ties the communication to a ticket, or replaces the one it has; appends audit. No ticket,
     * or the ticket it already has, is a no-op.
     */
    public Communication withTicket(Ticket newTicket, String actor, Instant now) {
        if (newTicket == null || newTicket.equals(ticket)) {
            return this;
        }
        String action = (ticket == null ? "ticket attached: " : "ticket changed to ") + newTicket.number();
        Communication updated = new Communication(id, tenantId, publisher, type, severity, title, body,
                affectedServices, audience, status, startsAt, endsAt, expiresAt, externalRef, newTicket,
                createdAt, now, version, appended(now, actor, action));
        updated.validateInvariants();
        return updated;
    }

    /** Transitions the stored status, enforcing the state machine; appends audit. */
    public Communication withStatus(CommunicationStatus next, String actor, Instant now) {
        return withStatus(next, actor, null, now);
    }

    /** As {@link #withStatus(CommunicationStatus, String, Instant)}, recording a note in the audit entry. */
    public Communication withStatus(CommunicationStatus next, String actor, String note, Instant now) {
        if (!canTransitionTo(next)) {
            throw new IllegalArgumentException(
                    "illegal transition " + status + " -> " + next + " for communication " + id);
        }
        String action = status + " -> " + next + (note == null || note.isBlank() ? "" : ": " + note);
        return new Communication(id, tenantId, publisher, type, severity, title, body,
                affectedServices, audience, next, startsAt, endsAt, expiresAt, externalRef, ticket,
                createdAt, now, version, appended(now, actor, action));
    }

    public boolean canTransitionTo(CommunicationStatus next) {
        return switch (status) {
            case DRAFT -> next == CommunicationStatus.SCHEDULED || next == CommunicationStatus.ACTIVE
                    || next == CommunicationStatus.RETIRED;
            case SCHEDULED -> next == CommunicationStatus.ACTIVE || next == CommunicationStatus.RETIRED;
            case ACTIVE -> next == CommunicationStatus.EXPIRED || next == CommunicationStatus.RETIRED;
            case EXPIRED, RETIRED -> false;
        };
    }

    /**
     * The status a reader should see at {@code now}: DRAFT/RETIRED/EXPIRED as stored,
     * otherwise derived from the time window. Never trusts stored SCHEDULED/ACTIVE.
     */
    public CommunicationStatus effectiveStatus(Instant now) {
        if (status == CommunicationStatus.DRAFT || status == CommunicationStatus.RETIRED
                || status == CommunicationStatus.EXPIRED) {
            return status;
        }
        if (expiresAt != null && !now.isBefore(expiresAt)) {
            return CommunicationStatus.EXPIRED;
        }
        if (now.isBefore(startsAt)) {
            return CommunicationStatus.SCHEDULED;
        }
        return CommunicationStatus.ACTIVE;
    }

    /**
     * This communication as a reader sees it at {@code now}: every stored field as it is, with
     * {@link #effectiveStatus(Instant)} as its status. For answers only, never saved: nothing is
     * added to the history, and the stored status is left to the sweeper, which announces the
     * change.
     */
    public Communication asSeenAt(Instant now) {
        CommunicationStatus effective = effectiveStatus(now);
        if (effective == status) {
            return this;
        }
        return new Communication(id, tenantId, publisher, type, severity, title, body, affectedServices,
                audience, effective, startsAt, endsAt, expiresAt, externalRef, ticket, createdAt, updatedAt,
                version, history);
    }

    /** Whether the communication is visible as ACTIVE at instant {@code t}. */
    public boolean activeAt(Instant t) {
        return effectiveStatus(t) == CommunicationStatus.ACTIVE;
    }

    public void validateInvariants() {
        validateInvariants(false);
    }

    /**
     * As {@link #validateInvariants()}; {@code startsAtDefaulted} says that {@code startsAt} is the
     * creation time because the publisher sent none, which a message about it then says.
     */
    private void validateInvariants(boolean startsAtDefaulted) {
        require(tenantId != null && !tenantId.isBlank(), "tenantId is required");
        require(publisher != null && !publisher.isBlank(), "publisher is required");
        require(type != null, "type is required");
        require(severity != null, "severity is required");
        require(title != null && !title.isBlank(), "title is required");
        require(title == null || title.length() <= TITLE_MAX, "title exceeds " + TITLE_MAX + " characters");
        require(body == null || body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= BODY_MAX_BYTES,
                "body exceeds " + BODY_MAX_BYTES + " bytes");
        require(startsAt != null, "startsAt is required");
        if (type == CommunicationType.MAINTENANCE) {
            require(endsAt != null, "MAINTENANCE requires endsAt");
        }
        require(endsAt == null || endsAt.isAfter(startsAt), "endsAt must be after startsAt");
        if (expiresAt != null && !expiresAt.isAfter(startsAt)) {
            // both values, and where a start nobody sent came from (to the millisecond, as it is stored)
            throw new IllegalArgumentException("expiresAt " + expiresAt + " must be after startsAt"
                    + (startsAtDefaulted ? ", which defaulted to now (" + startsAt.truncatedTo(ChronoUnit.MILLIS) + ")"
                            : " " + startsAt));
        }
        if (type == CommunicationType.INCIDENT || type == CommunicationType.OUTAGE) {
            require(severity.atLeast(Severity.MINOR), type + " requires severity MINOR or higher");
        }
        require(ticket == null || (ticket.number() != null && !ticket.number().isBlank()),
                "ticket.number is required");
    }

    private List<AuditEntry> appended(Instant at, String actor, String action) {
        List<AuditEntry> next = new ArrayList<>(history);
        next.add(new AuditEntry(at, actor == null ? "unknown" : actor, action));
        if (next.size() > HISTORY_MAX) {
            next = next.subList(next.size() - HISTORY_MAX, next.size());
        }
        return List.copyOf(next);
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalArgumentException(message);
        }
    }
}
