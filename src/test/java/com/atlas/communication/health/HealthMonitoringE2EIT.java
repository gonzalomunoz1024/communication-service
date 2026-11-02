package com.atlas.communication.health;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.function.client.WebClient;

import com.atlas.communication.config.ClientIdWebFilter;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthStatus;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Flow 2 end to end against embedded Mongo: a probed service goes down and comes back, and a
 * service pushes its own health. Both must surface in the consumer feed exactly like a
 * human-published communication, and clean up after themselves.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HealthMonitoringE2EIT {

    @Autowired
    private WebTestClient client;
    @LocalServerPort
    private int port;
    @Autowired
    private FakeActuatorController actuator;

    @BeforeEach
    void identifyAsTestClient() {
        client = client.mutate()
                .defaultHeader(ClientIdWebFilter.HEADER, "communication-service-tests")
                .build();
    }

    private HealthMonitor register(Map<String, Object> body) {
        return client.post().uri("/v1/health/monitors")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isCreated()
                .expectHeader().exists("Location")
                .expectBody(HealthMonitor.class)
                .returnResult().getResponseBody();
    }

    private HealthMonitor probe(String id) {
        return client.post().uri("/v1/health/monitors/{id}/probe", id)
                .exchange()
                .expectStatus().isOk()
                .expectBody(HealthMonitor.class)
                .returnResult().getResponseBody();
    }

    private HealthMonitor report(String service, Map<String, Object> actuatorDocument) {
        Map<String, Object> body = new java.util.HashMap<>(actuatorDocument);
        body.put("tenantId", "vmforge");
        body.put("service", service);
        return client.post().uri("/v1/health/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isAccepted()
                .expectBody(HealthMonitor.class)
                .returnResult().getResponseBody();
    }

    private WebTestClient.BodyContentSpec feedFor(String service) {
        return client.get().uri("/v1/feed?tenantId=vmforge&service=" + service)
                .exchange()
                .expectStatus().isOk()
                .expectBody();
    }

    @Test
    void probedServiceGoingDownPublishesAnOutageAndRecoveryRetiresIt() {
        actuator.set(Map.of("status", "UP"));
        HealthMonitor monitor = register(Map.of(
                "tenantId", "vmforge",
                "service", "vm-api-e2e",
                "url", "http://localhost:" + port + FakeActuatorController.PATH,
                "failureThreshold", 2,
                "recoveryThreshold", 1));
        assertThat(monitor.policy().intervalSeconds()).isEqualTo(30); // default applied

        HealthMonitor healthy = probe(monitor.id());
        assertThat(healthy.state().lastStatus()).isEqualTo(HealthStatus.UP);
        assertThat(healthy.state().openCommunicationId()).isNull();

        actuator.set(Map.of("status", "DOWN", "components", Map.of(
                "db", Map.of("status", "DOWN", "details", Map.of("error", "Connection refused")),
                "ping", Map.of("status", "UP"))));
        HealthMonitor firstFailure = probe(monitor.id());
        assertThat(firstFailure.state().unhealthyStreak()).isEqualTo(1);
        assertThat(firstFailure.state().openCommunicationId()).isNull();
        feedFor("vm-api-e2e").jsonPath("$.totalElements").isEqualTo(0);

        HealthMonitor opened = probe(monitor.id());
        String noticeId = opened.state().openCommunicationId();
        assertThat(noticeId).isNotNull();
        assertThat(opened.state().openStatus()).isEqualTo(HealthStatus.DOWN);
        feedFor("vm-api-e2e")
                .jsonPath("$.totalElements").isEqualTo(1)
                .jsonPath("$.items[0].id").isEqualTo(noticeId)
                .jsonPath("$.items[0].type").isEqualTo("OUTAGE")
                .jsonPath("$.items[0].severity").isEqualTo("MAJOR")
                .jsonPath("$.items[0].status").isEqualTo("ACTIVE")
                .jsonPath("$.items[0].publisher").isEqualTo("health-monitor")
                .jsonPath("$.items[0].title").isEqualTo("vm-api-e2e is down")
                .jsonPath("$.items[0].externalRef").isEqualTo("health:" + monitor.id() + ":1")
                .jsonPath("$.items[0].body").value(body -> assertThat((String) body)
                        .contains("- db: DOWN - error=Connection refused")
                        .doesNotContain("ping"));

        // same failure again: quiet, no second notice
        HealthMonitor still = probe(monitor.id());
        assertThat(still.state().openCommunicationId()).isEqualTo(noticeId);
        feedFor("vm-api-e2e").jsonPath("$.totalElements").isEqualTo(1);

        actuator.set(Map.of("status", "UP"));
        HealthMonitor recovered = probe(monitor.id());
        assertThat(recovered.state().openCommunicationId()).isNull();
        feedFor("vm-api-e2e").jsonPath("$.totalElements").isEqualTo(0);
        client.get().uri("/v1/feed/{id}", noticeId)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("RETIRED");
        client.get().uri("/v1/communications/{id}", noticeId)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.history[-1].actor").isEqualTo("health-monitor")
                .jsonPath("$.history[-1].action").value(action -> assertThat((String) action)
                        .contains("ACTIVE -> RETIRED: recovered: UP"));

        client.delete().uri("/v1/health/monitors/{id}", monitor.id())
                .exchange().expectStatus().isNoContent();
        client.get().uri("/v1/health/monitors/{id}", monitor.id())
                .exchange().expectStatus().isNotFound();
    }

    @Test
    void anOperatorRetiringTheAutoNoticeMakesTheMonitorCountAgain() {
        actuator.set(Map.of("status", "DOWN", "components", Map.of("db", Map.of("status", "DOWN"))));
        HealthMonitor monitor = register(Map.of(
                "tenantId", "vmforge",
                "service", "ops-retire-e2e",
                "url", "http://localhost:" + port + FakeActuatorController.PATH,
                "failureThreshold", 2,
                "recoveryThreshold", 1));
        probe(monitor.id());
        String first = probe(monitor.id()).state().openCommunicationId();
        assertThat(first).isNotNull();

        // an SRE resolves the notice by hand while the service is still failing the same way
        client.post().uri("/v1/communications/{id}/retire", first)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("actor", "vmforge-sre", "note", "known, being worked on"))
                .exchange()
                .expectStatus().isOk();

        // the monitor notices on its next observation and starts counting again: that
        // observation, itself failing, is the first of the new count...
        HealthMonitor noticed = probe(monitor.id());
        assertThat(noticed.state().openCommunicationId()).isNull();
        assertThat(noticed.state().unhealthyStreak()).isEqualTo(1);
        feedFor("ops-retire-e2e").jsonPath("$.totalElements").isEqualTo(0);

        // ...so the threshold (2) opens a fresh notice, incident #2, on the next failing probe
        // instead of silence for ever
        HealthMonitor reopened = probe(monitor.id());
        assertThat(reopened.state().openCommunicationId()).isNotNull().isNotEqualTo(first);
        feedFor("ops-retire-e2e")
                .jsonPath("$.totalElements").isEqualTo(1)
                .jsonPath("$.items[0].id").isEqualTo(reopened.state().openCommunicationId())
                .jsonPath("$.items[0].externalRef").isEqualTo("health:" + monitor.id() + ":2");

        actuator.set(Map.of("status", "UP"));
        probe(monitor.id());
        client.delete().uri("/v1/health/monitors/{id}", monitor.id())
                .exchange().expectStatus().isNoContent();
    }

    @Test
    void pushedReportsNeedNoRegistrationAndDeletingTheMonitorRetiresItsNotice() {
        HealthMonitor first = report("billing-e2e", Map.of("status", "UP"));
        assertThat(first.url()).isNull();
        assertThat(first.state().lastStatus()).isEqualTo(HealthStatus.UP);

        Map<String, Object> down = Map.of("status", "DOWN",
                "components", Map.of("redis", Map.of("status", "DOWN")),
                "message", "cache cluster unreachable");
        assertThat(report("billing-e2e", down).state().openCommunicationId()).isNull();
        HealthMonitor opened = report("billing-e2e", down);
        assertThat(opened.state().openCommunicationId()).isNotNull();
        assertThat(opened.id()).isEqualTo(first.id());
        feedFor("billing-e2e")
                .jsonPath("$.totalElements").isEqualTo(1)
                .jsonPath("$.items[0].type").isEqualTo("OUTAGE")
                .jsonPath("$.items[0].title").isEqualTo("billing-e2e is down")
                .jsonPath("$.items[0].body").value(body -> assertThat((String) body)
                        .contains("reported by the service")
                        .contains("cache cluster unreachable")
                        .contains("- redis: DOWN"));

        client.get().uri("/v1/health/monitors?tenantId=vmforge")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$[?(@.service=='billing-e2e')].state.openCommunicationId").exists();

        client.delete().uri("/v1/health/monitors/{id}", first.id())
                .exchange().expectStatus().isNoContent();
        feedFor("billing-e2e").jsonPath("$.totalElements").isEqualTo(0);
        client.get().uri("/v1/feed/{id}", opened.state().openCommunicationId())
                .exchange()
                .expectBody()
                .jsonPath("$.status").isEqualTo("RETIRED");
    }

    @Test
    void aFleetOfPodsReportingInTheSameInstantIsAccepted() {
        // twenty sidecars of one service push at once (a rolling restart): every pod collides on
        // the monitor's version check, and every report must still be accepted and counted
        WebClient web = WebClient.create("http://localhost:" + port);
        List<Integer> statuses = Flux.range(0, 20)
                .flatMap(i -> web.post().uri("/v1/health/reports")
                        .header(ClientIdWebFilter.HEADER, "communication-service-tests")
                        .contentType(MediaType.APPLICATION_JSON)
                        .bodyValue(Map.of("tenantId", "vmforge", "service", "fleet-e2e", "status", "UP",
                                "instance", Map.of("id", "fleet-e2e-" + i, "namespace", "retail")))
                        .exchangeToMono(response -> response.releaseBody()
                                .thenReturn(response.statusCode().value())), 20)
                .collectList()
                .block(Duration.ofSeconds(60));
        assertThat(statuses).isNotNull().hasSize(20);
        long accepted = statuses.stream().filter(status -> status == 202).count();
        assertThat(accepted).as("202s out of 20 simultaneous reports: " + statuses).isGreaterThanOrEqualTo(19);

        HealthMonitor monitor = client.get().uri("/v1/health/monitors?tenantId=vmforge")
                .exchange()
                .expectStatus().isOk()
                .expectBodyList(HealthMonitor.class)
                .returnResult().getResponseBody().stream()
                .filter(m -> m.service().equals("fleet-e2e"))
                .findFirst().orElseThrow();
        assertThat(monitor.state().lastStatus()).isEqualTo(HealthStatus.UP);
        assertThat(monitor.state().lastSummary()).isEqualTo("UP (20 of 20 pods UP)");
        client.get().uri("/v1/health/monitors/{id}/instances", monitor.id())
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.length()").isEqualTo(20);

        client.delete().uri("/v1/health/monitors/{id}", monitor.id())
                .exchange().expectStatus().isNoContent();
    }

    @Test
    void degradedDependenciesPublishAHealthNoticeNotAnOutage() {
        Map<String, Object> degraded = Map.of("status", "UP",
                "components", Map.of("cache", Map.of("status", "DOWN")));
        report("catalog-e2e", degraded);
        HealthMonitor opened = report("catalog-e2e", degraded);
        assertThat(opened.state().openStatus()).isEqualTo(HealthStatus.DEGRADED);
        feedFor("catalog-e2e")
                .jsonPath("$.totalElements").isEqualTo(1)
                .jsonPath("$.items[0].type").isEqualTo("HEALTH")
                .jsonPath("$.items[0].severity").isEqualTo("MINOR")
                .jsonPath("$.items[0].title").isEqualTo("catalog-e2e is degraded");

        report("catalog-e2e", Map.of("status", "UP"));
        report("catalog-e2e", Map.of("status", "UP"));
        feedFor("catalog-e2e").jsonPath("$.totalElements").isEqualTo(0);
        client.delete().uri("/v1/health/monitors/{id}", opened.id())
                .exchange().expectStatus().isNoContent();
    }

    @Test
    void validationContracts() {
        client.post().uri("/v1/health/monitors")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "service", "x", "url", "not a url"))
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody().jsonPath("$.error").value(msg -> assertThat((String) msg).contains("http(s)"));
        client.post().uri("/v1/health/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "service", "x"))
                .exchange()
                .expectStatus().isBadRequest();
        HealthMonitor pushOnly = register(Map.of("tenantId", "vmforge", "service", "push-only-e2e"));
        client.post().uri("/v1/health/monitors/{id}/probe", pushOnly.id())
                .exchange()
                .expectStatus().isEqualTo(409);
        client.post().uri("/v1/health/monitors")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "service", "push-only-e2e"))
                .exchange()
                .expectStatus().isEqualTo(409);
        client.delete().uri("/v1/health/monitors/{id}", pushOnly.id())
                .exchange().expectStatus().isNoContent();
        client.get().uri("/v3/api-docs")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.paths['/v1/health/monitors']").exists()
                .jsonPath("$.paths['/v1/health/reports']").exists();
    }
}
