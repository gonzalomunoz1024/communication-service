package com.atlas.communication.feed.domain;

import java.time.Instant;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;

/**
 * Consumer feed filters. {@code activeAt} null means "now"; {@code minSeverity} is an
 * inclusive floor; {@code includeUpcoming} pulls scheduled maintenance inside the configured
 * lookahead window into the feed.
 */
public record FeedQuery(
        String tenantId,
        String service,
        CommunicationType type,
        Severity minSeverity,
        Audience audience,
        Instant activeAt,
        boolean includeUpcoming,
        int page,
        int size) {

    public FeedQuery {
        if (tenantId == null || tenantId.isBlank()) {
            throw new IllegalArgumentException("tenantId is required");
        }
    }
}
