package com.atlas.communication.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * {@code communication.mongo.*}: how long a call waits for the database before giving up. With
 * the driver's own defaults (30 s to find a server, no socket timeouts) every request and the
 * readiness probe hang for half a minute while Mongo is unreachable; with these a call gives up
 * within seconds and answers 503 "database unavailable". They override the same options given
 * on the connection URI. Readiness waits {@code readinessTimeout} for the database to answer a
 * ping before it reports DOWN: 0.8 s, so the whole answer reaches a kubelet within its default
 * probe timeout of 1 s.
 */
@ConfigurationProperties(prefix = "communication.mongo")
public record MongoTimeoutProperties(
        @DefaultValue("PT5S") Duration serverSelectionTimeout,
        @DefaultValue("PT5S") Duration connectTimeout,
        @DefaultValue("PT15S") Duration readTimeout,
        @DefaultValue("PT0.8S") Duration readinessTimeout) {
}
