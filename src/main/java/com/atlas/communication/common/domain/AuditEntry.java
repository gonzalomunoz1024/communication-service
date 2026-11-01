package com.atlas.communication.common.domain;

import java.time.Instant;

/** One entry in a communication's embedded audit trail. */
public record AuditEntry(Instant at, String actor, String action) {
}
