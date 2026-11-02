package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.mongo.MongoClientSettingsBuilderCustomizer;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;

class MongoClientConfigTest {

    private final MongoClientSettingsBuilderCustomizer customizer = new MongoClientConfig().mongoTimeouts(
            new MongoTimeoutProperties(Duration.ofSeconds(5), Duration.ofSeconds(5), Duration.ofSeconds(15)));

    @Test
    void appliesTheConfiguredTimeoutsToTheClient() {
        MongoClientSettings.Builder builder = MongoClientSettings.builder();
        customizer.customize(builder);
        MongoClientSettings settings = builder.build();

        assertThat(settings.getClusterSettings().getServerSelectionTimeout(TimeUnit.MILLISECONDS)).isEqualTo(5000);
        assertThat(settings.getSocketSettings().getConnectTimeout(TimeUnit.MILLISECONDS)).isEqualTo(5000);
        assertThat(settings.getSocketSettings().getReadTimeout(TimeUnit.MILLISECONDS)).isEqualTo(15000);
    }

    @Test
    void theConfiguredValuesWinOverTheUri() {
        // Boot applies the URI first (its customizer is ordered 0, ours after it)
        MongoClientSettings.Builder builder = MongoClientSettings.builder().applyConnectionString(
                new ConnectionString("mongodb://localhost:27017/x?serverSelectionTimeoutMS=30000&connectTimeoutMS=20000"));
        customizer.customize(builder);
        MongoClientSettings settings = builder.build();

        assertThat(settings.getClusterSettings().getServerSelectionTimeout(TimeUnit.MILLISECONDS)).isEqualTo(5000);
        assertThat(settings.getSocketSettings().getConnectTimeout(TimeUnit.MILLISECONDS)).isEqualTo(5000);
    }
}
