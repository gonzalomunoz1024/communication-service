package com.atlas.communication.common.domain;

import java.util.Map;

/** Per-tenant communication counts by stored status, for admin oversight. */
public record TenantSummary(String tenantId, Map<CommunicationStatus, Long> counts, long total) {
}
