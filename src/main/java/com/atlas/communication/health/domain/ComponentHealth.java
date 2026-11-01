package com.atlas.communication.health.domain;

/** Health of one component (dependency) of a monitored service, e.g. {@code db} or {@code redis}. */
public record ComponentHealth(String name, HealthStatus status, String detail) {
}
