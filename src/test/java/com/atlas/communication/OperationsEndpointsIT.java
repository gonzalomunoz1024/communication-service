package com.atlas.communication;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.actuate.health.HealthEndpointGroup;
import org.springframework.boot.actuate.health.HealthEndpointGroups;
import org.springframework.boot.actuate.health.ReactiveHealthContributorRegistry;
import org.springframework.boot.actuate.health.ReactiveHealthIndicator;
import org.springframework.boot.actuate.health.Status;
import org.springframework.boot.autoconfigure.mongo.MongoClientSettingsBuilderCustomizer;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.reactive.server.WebTestClient;

import com.mongodb.MongoClientSettings;

/**
 * The operational surface a cluster relies on: liveness and readiness probes answer without a
 * client id, readiness reflects MongoDB, and nothing else under /actuator is exposed.
 * <p>
 * The service refuses to start without MongoDB (index creation runs at startup), so "readiness is
 * 503 while Mongo is unreachable" cannot be reproduced with a context that never had a database;
 * the wiring that produces it is asserted instead: the readiness group contains the {@code mongo}
 * indicator, and that indicator is the real reactive one answering from the running database.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OperationsEndpointsIT {

    @Autowired
    private WebTestClient client;
    @Autowired
    private HealthEndpointGroups groups;
    @Autowired
    private ReactiveHealthContributorRegistry contributors;
    @Autowired
    private ObjectProvider<MongoClientSettingsBuilderCustomizer> clientCustomizers;

    @Test
    void readinessIsUpWhenMongoAnswers() {
        client.get().uri("/actuator/health/readiness").exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("UP");
    }

    @Test
    void livenessIsUp() {
        client.get().uri("/actuator/health/liveness").exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("UP");
    }

    @Test
    void overallHealthNeedsNoClientIdAndHidesDetails() {
        client.get().uri("/actuator/health").exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("UP")
                .jsonPath("$.components").doesNotExist()
                .jsonPath("$.details").doesNotExist();
    }

    @Test
    void readinessAsksMongoAndLivenessDoesNot() {
        HealthEndpointGroup readiness = groups.get("readiness");
        assertThat(readiness.isMember("readinessState")).isTrue();
        assertThat(readiness.isMember("mongo")).as("readiness includes the Mongo indicator").isTrue();
        HealthEndpointGroup liveness = groups.get("liveness");
        assertThat(liveness.isMember("livenessState")).isTrue();
        assertThat(liveness.isMember("mongo")).as("a lost database must not restart the pod").isFalse();

        ReactiveHealthIndicator mongo = (ReactiveHealthIndicator) contributors.getContributor("mongo");
        assertThat(mongo).as("the reactive Mongo indicator is registered").isNotNull();
        assertThat(mongo.health().block(Duration.ofSeconds(10)).getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void theMongoClientGivesUpOnAnUnreachableDatabaseWithinSeconds() {
        // the settings the reactive client is built with: Boot applies every customizer, in
        // order, to a fresh builder (ReactiveMongoClientFactory); with the driver's own defaults
        // readiness and every API call wait 30 s before answering while Mongo is unreachable
        MongoClientSettings.Builder builder = MongoClientSettings.builder();
        clientCustomizers.orderedStream().forEach(customizer -> customizer.customize(builder));
        MongoClientSettings settings = builder.build();

        assertThat(settings.getClusterSettings().getServerSelectionTimeout(TimeUnit.MILLISECONDS))
                .as("server selection timeout").isEqualTo(5000);
        assertThat(settings.getSocketSettings().getConnectTimeout(TimeUnit.MILLISECONDS))
                .as("connect timeout").isEqualTo(5000);
        assertThat(settings.getSocketSettings().getReadTimeout(TimeUnit.MILLISECONDS))
                .as("socket read timeout").isEqualTo(15000);
    }

    @Test
    void onlyHealthIsExposed() {
        client.get().uri("/actuator/env").exchange().expectStatus().isNotFound();
        client.get().uri("/actuator/beans").exchange().expectStatus().isNotFound();
        client.get().uri("/actuator/configprops").exchange().expectStatus().isNotFound();
    }
}
