package com.atlas.communication.health;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webtestclient.autoconfigure.AutoConfigureWebTestClient;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.EntityExchangeResult;
import org.springframework.test.web.reactive.server.WebTestClient;

import com.atlas.communication.config.ClientIdWebFilter;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthStatus;

/**
 * "Probe now" while the scheduler keeps probing the same monitor, with the real scheduler running
 * every second: the endpoint takes {@link FakeActuatorController#SLOW_DELAY} (3 s) to answer and
 * the monitor's interval is 5 s, so the scheduler saves the monitor (its probe-slot claim, then
 * its result) at least every 3 s and an on-demand probe of that endpoint never fits between two
 * of those saves. The operator must still get the observation, not a 409.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "communication.health.sweep-interval-ms=1000")
@AutoConfigureWebTestClient
class ForcedProbeWhileTheSchedulerProbesIT {

    @Autowired
    private WebTestClient client;
    @LocalServerPort
    private int port;

    @Test
    void forcedProbesOfASlowEndpointAnswer200WhileTheSchedulerProbesItEverySweep() throws InterruptedException {
        WebTestClient api = client.mutate()
                .defaultHeader(ClientIdWebFilter.HEADER, "communication-service-tests")
                .responseTimeout(Duration.ofSeconds(60))
                .build();
        HealthMonitor monitor = api.post().uri("/v1/health/monitors")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("tenantId", "vmforge", "service", "slow-e2e",
                        "url", "http://localhost:" + port + FakeActuatorController.SLOW_PATH,
                        "intervalSeconds", 5))
                .exchange()
                .expectStatus().isCreated()
                .expectBody(HealthMonitor.class)
                .returnResult().getResponseBody();
        assertThat(monitor).isNotNull();

        // the monitor is due at once: wait until the scheduler has claimed it (its first save)
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (read(api, monitor.id()).state().lastProbeAt() == null) {
            assertThat(System.nanoTime()).as("the scheduler claims the monitor").isLessThan(deadline);
            Thread.sleep(100);
        }

        List<String> answers = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            long started = System.nanoTime();
            EntityExchangeResult<String> probe = api.post().uri("/v1/health/monitors/{id}/probe", monitor.id())
                    .exchange()
                    .expectBody(String.class)
                    .returnResult();
            answers.add(probe.getStatus().value() + " in " + (System.nanoTime() - started) / 1_000_000 + " ms"
                    + (probe.getStatus().is2xxSuccessful() ? "" : ": " + probe.getResponseBody()));
        }
        assertThat(answers).as("forced probes while the scheduler probes the same monitor")
                .allSatisfy(answer -> assertThat(answer).startsWith("200 "));
        assertThat(read(api, monitor.id()).state().lastStatus()).isEqualTo(HealthStatus.UP);

        api.delete().uri("/v1/health/monitors/{id}", monitor.id()).exchange().expectStatus().isNoContent();
    }

    private static HealthMonitor read(WebTestClient api, String id) {
        HealthMonitor monitor = api.get().uri("/v1/health/monitors/{id}", id)
                .exchange()
                .expectStatus().isOk()
                .expectBody(HealthMonitor.class)
                .returnResult().getResponseBody();
        assertThat(monitor).isNotNull();
        return monitor;
    }
}
