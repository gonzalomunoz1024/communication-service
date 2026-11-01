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
                .contains("**DOWN** at " + NOW)
                .contains("probe of http://vm-api/actuator/health")
                .contains("HTTP 503")
                .contains("- db: DOWN - error=refused")
                .doesNotContain("ping")
                .contains("retired once the service reports healthy again");
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
        assertThat(notice.body()).contains("reported by the service").contains("cache cluster unreachable");
    }

    @Test
    void staleNoticeExplainsSilenceAndComponentListIsCapped() {
        List<ComponentHealth> many = IntStream.range(0, 40)
                .mapToObj(i -> new ComponentHealth("c" + i, HealthStatus.DOWN, null)).toList();
        HealthReport report = new HealthReport(HealthStatus.DOWN, many, null, HealthSource.STALE, NOW);
        HealthNotice notice = HealthNotice.from(monitor(null), report);
        assertThat(notice.body())
                .contains("no health report received since " + NOW)
                .contains("- c24: DOWN")
                .doesNotContain("- c25: DOWN")
                .contains("... and 15 more");
    }
}
