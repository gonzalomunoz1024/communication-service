package com.atlas.communication.common.domain;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** Per-tenant communication counts by stored status, for admin oversight. */
public record TenantSummary(String tenantId, Map<CommunicationStatus, Long> counts, long total) {

    public TenantSummary {
        // an unmodifiable copy in the caller's order (the repository builds an EnumMap)
        counts = counts == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(counts));
    }
}
