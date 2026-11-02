package com.atlas.communication.config;

import java.util.concurrent.TimeUnit;

import org.springframework.boot.mongodb.autoconfigure.MongoClientSettingsBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.core.ReactiveMongoOperations;

/**
 * Applies {@link MongoTimeoutProperties} to the reactive Mongo client. Boot runs its own
 * customizer (the one that applies the URI) first, so these values win over the URI's. Readiness
 * asks the database through {@link MongoReadinessIndicator}.
 */
@Configuration
public class MongoClientConfig {

    @Bean
    public MongoClientSettingsBuilderCustomizer mongoTimeouts(MongoTimeoutProperties timeouts) {
        return builder -> builder
                .applyToClusterSettings(cluster -> cluster.serverSelectionTimeout(
                        timeouts.serverSelectionTimeout().toMillis(), TimeUnit.MILLISECONDS))
                .applyToSocketSettings(socket -> socket
                        .connectTimeout(timeouts.connectTimeout().toMillis(), TimeUnit.MILLISECONDS)
                        .readTimeout(timeouts.readTimeout().toMillis(), TimeUnit.MILLISECONDS));
    }

    /**
     * The {@code mongo} indicator of the readiness group. Named like Boot's own, which therefore
     * stands down: Boot's logs a stack trace on every probe while the database is unreachable.
     */
    @Bean
    public MongoReadinessIndicator mongoHealthIndicator(ReactiveMongoOperations mongo, MongoTimeoutProperties timeouts) {
        return new MongoReadinessIndicator(mongo, timeouts.readinessTimeout());
    }
}
