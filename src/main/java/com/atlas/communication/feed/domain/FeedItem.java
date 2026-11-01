package com.atlas.communication.feed.domain;

import java.time.Instant;
import java.util.List;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;

/**
 * Consumer-facing projection: audit history omitted, {@code status} is the effective status
 * computed at read time so sweeper lag can never surface a stale state.
 */
public record FeedItem(
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
        Instant updatedAt) {

    public static FeedItem from(Communication c, Instant now) {
        return new FeedItem(c.id(), c.tenantId(), c.publisher(), c.type(), c.severity(),
                c.title(), c.body(), c.affectedServices(), c.audience(), c.effectiveStatus(now),
                c.startsAt(), c.endsAt(), c.expiresAt(), c.externalRef(), c.updatedAt());
    }
}
