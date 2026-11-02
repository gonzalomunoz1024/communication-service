package com.atlas.communication.health.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;

class HealthNoticeTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    private static final HealthMonitor.Policy POLICY = new HealthMonitor.Policy("health-monitor",
            30, 5000, 2, 2, Severity.CRITICAL, Severity.INFO, Audience.CUSTOMERS, null, null);

    private static HealthMonitor monitor(String url) {
        return HealthMonitor.create("m1", "vmforge", "vm-api", url, POLICY, NOW);
    }

    @Test
    void downProbeBecomesOutageAtDownSeverity() {
        HealthReport report = new HealthReport(HealthStatus.DOWN,
                List.of(new ComponentHealth("db", HealthStatus.DOWN, "error=refused"),
                        new ComponentHealth("ping", HealthStatus.UP, null)),
                "HTTP 503", HealthSource.PROBE, NOW);
        HealthNotice notice = HealthNotice.from(monitor("http://vm-api/actuator/health"), report);
        assertThat(notice.type()).isEqualTo(CommunicationType.OUTAGE);
        assertThat(notice.severity()).isEqualTo(Severity.CRITICAL);
        assertThat(notice.title()).isEqualTo("vm-api is down");
        assertThat(notice.body())
                .startsWith("vm-api is DOWN as of 2026-11-01 12:00:00 UTC.\n"
                        + "Health check of http://vm-api/actuator/health: HTTP 503.\n")
                .contains("\ndb: DOWN (error=refused)\n")
                .doesNotContain("ping")
                .contains("retired once the service reports healthy again");
    }

    @Test
    void anAutomatedNoticeReadsAsPlainWordsWithTheTimeToTheSecond() {
        // the notice behind UX-47: a service whose pods report, observed with the clock's nanoseconds
        HealthMonitor monitor = HealthMonitor.create("2c1b983f", "podtest", "fake-app", null, POLICY, NOW);
        HealthReport rollup = new HealthReport(HealthStatus.DOWN,
                List.of(new ComponentHealth("db", HealthStatus.DOWN, "error=Connection refused")),
                "0 of 1 pod UP (DOWN: fake-app-7f9c6d5b4-x2k4q)", HealthSource.ROLLUP,
                Instant.parse("2026-11-02T04:07:48.815528360Z"));

        String body = HealthNotice.from(monitor, rollup).body();
        assertThat(body).isEqualTo("""
                fake-app is DOWN as of 2026-11-02 04:07:48 UTC.
                Reported by its pods: 0 of 1 pod UP (DOWN: fake-app-7f9c6d5b4-x2k4q).

                Failing components:
                db: DOWN (error=Connection refused)

                This notice is managed automatically and is retired once the service reports healthy again.""");
        assertThat(body).as("plain text: no Markdown emphasis").doesNotContain("*")
                .as("times to the second").doesNotContainPattern("\\d{2}:\\d{2}:\\d{2}\\.\\d");
    }

    @Test
    void degradedPushBecomesHealthNoticeAtDegradedSeverity() {
        HealthReport report = HealthReport.fromActuator("UP",
                java.util.Map.of("cache", new ActuatorComponent("DOWN", null, null)),
                "cache cluster unreachable", HealthSource.PUSH, NOW);
        HealthNotice notice = HealthNotice.from(monitor(null), report);
        assertThat(notice.type()).isEqualTo(CommunicationType.HEALTH);
        assertThat(notice.severity()).isEqualTo(Severity.INFO);
        assertThat(notice.title()).isEqualTo("vm-api is degraded");
        assertThat(notice.body()).startsWith("vm-api is DEGRADED as of 2026-11-01 12:00:00 UTC.\n"
                + "Reported by the service: cache cluster unreachable.\n\nFailing components:\ncache: DOWN\n");
    }

    @Test
    void staleNoticeExplainsSilenceAndComponentListIsCapped() {
        List<ComponentHealth> many = IntStream.range(0, 40)
                .mapToObj(i -> new ComponentHealth("c" + i, HealthStatus.DOWN, null)).toList();
        HealthReport report = new HealthReport(HealthStatus.DOWN, many, null, HealthSource.STALE, NOW);
        HealthNotice notice = HealthNotice.from(monitor(null), report);
        assertThat(notice.body())
                .contains("\nNo health report received since 2026-11-01 12:00:00 UTC.\n")
                .contains("\nc24: DOWN\n")
                .doesNotContain("c25: DOWN")
                .contains("\n... and 15 more\n");
    }
}
