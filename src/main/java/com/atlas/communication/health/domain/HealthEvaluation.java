package com.atlas.communication.health.domain;

/** Result of feeding one {@link HealthReport} through a {@link HealthMonitor}. */
public record HealthEvaluation(HealthMonitor monitor, HealthTransition transition) {
}
