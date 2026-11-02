package com.atlas.communication.config;

import java.util.concurrent.TimeUnit;

import org.springframework.boot.autoconfigure.mongo.MongoClientSettingsBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Applies {@link MongoTimeoutProperties} to the reactive Mongo client. Boot runs its own
 * customizer (the one that applies the URI) first, so these values win over the URI's.
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
}
