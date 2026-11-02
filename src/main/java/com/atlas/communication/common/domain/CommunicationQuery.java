package com.atlas.communication.common.domain;

import java.time.Instant;
import java.util.Set;

/**
 * Repository filter shared by the feed and admin read sides. All fields are optional
 * (null = no constraint; {@code statuses} is kept as an unmodifiable copy, empty = no
 * constraint) except paging. When {@code activeAt} is set the repository applies
 * the feed visibility predicate: stored status in (SCHEDULED, ACTIVE), startsAt <= activeAt,
 * and (expiresAt null or > activeAt) — OR'd, when {@code upcomingUntil} is set, with
 * SCHEDULED MAINTENANCE whose startsAt <= upcomingUntil.
 */
public record CommunicationQuery(
        String tenantId,
        Set<CommunicationStatus> statuses,
        CommunicationType type,
        Severity minSeverity,
        Audience audience,
        String publisher,
        String service,
        Instant activeAt,
        Instant upcomingUntil,
        Instant createdFrom,
        Instant createdTo,
        int page,
        int size) {

    public CommunicationQuery {
        statuses = statuses == null ? Set.of() : Set.copyOf(statuses);
    }

    /** Feed visibility query: everything visible at {@code activeAt} for one tenant. */
    public static CommunicationQuery visibleAt(String tenantId, Instant activeAt, Instant upcomingUntil,
            CommunicationType type, Severity minSeverity, Audience audience, String service,
            int page, int size) {
        return new CommunicationQuery(tenantId, null, type, minSeverity, audience, null, service,
                activeAt, upcomingUntil, null, null, page, size);
    }

    /** Publisher's own listing (no time predicate, any status unless narrowed). */
    public static CommunicationQuery listing(String tenantId, Set<CommunicationStatus> statuses,
            CommunicationType type, int page, int size) {
        return new CommunicationQuery(tenantId, statuses, type, null, null, null, null,
                null, null, null, null, page, size);
    }

    /** Admin cross-tenant search. */
    public static CommunicationQuery admin(String tenantId, Set<CommunicationStatus> statuses,
            CommunicationType type, String publisher, Instant createdFrom, Instant createdTo,
            int page, int size) {
        return new CommunicationQuery(tenantId, statuses, type, null, null, publisher, null,
                null, null, createdFrom, createdTo, page, size);
    }
}
