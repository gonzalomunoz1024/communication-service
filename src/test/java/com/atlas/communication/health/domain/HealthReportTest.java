package com.atlas.communication.health.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

class HealthReportTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    @Test
    void statusCodesMapOntoNormalizedVocabulary() {
        assertThat(HealthStatus.fromCode("UP")).isEqualTo(HealthStatus.UP);
        assertThat(HealthStatus.fromCode("up")).isEqualTo(HealthStatus.UP);
        assertThat(HealthStatus.fromCode("DOWN")).isEqualTo(HealthStatus.DOWN);
        assertThat(HealthStatus.fromCode("OUT_OF_SERVICE")).isEqualTo(HealthStatus.DOWN);
        assertThat(HealthStatus.fromCode("FATAL")).isEqualTo(HealthStatus.DOWN);
        assertThat(HealthStatus.fromCode("WARN")).isEqualTo(HealthStatus.DEGRADED);
        assertThat(HealthStatus.fromCode("DEGRADED")).isEqualTo(HealthStatus.DEGRADED);
        assertThat(HealthStatus.fromCode("UNKNOWN")).isEqualTo(HealthStatus.UNKNOWN);
        assertThat(HealthStatus.fromCode(null)).isEqualTo(HealthStatus.UNKNOWN);
        assertThat(HealthStatus.fromCode(" ")).isEqualTo(HealthStatus.UNKNOWN);
    }

    @Test
    void actuatorDocumentIsFlattenedWithDottedNames() {
        Map<String, Object> dbDetails = new LinkedHashMap<>();
        dbDetails.put("database", "PostgreSQL");
        dbDetails.put("error", "Connection refused");
        Map<String, ActuatorComponent> components = new LinkedHashMap<>();
        components.put("db", new ActuatorComponent("DOWN", dbDetails, null));
        components.put("ping", new ActuatorComponent("UP", null, null));
        components.put("datasources", new ActuatorComponent("DOWN", null, Map.of(
                "primary", new ActuatorComponent("DOWN", null, null),
                "replica", new ActuatorComponent("UP", null, null))));

        HealthReport report = HealthReport.fromActuator("DOWN", components, "HTTP 503",
                HealthSource.PROBE, NOW);

        assertThat(report.status()).isEqualTo(HealthStatus.DOWN);
        assertThat(report.components()).hasSize(4);
        assertThat(report.failing()).extracting(ComponentHealth::name)
                .containsExactlyInAnyOrder("db", "datasources.primary");
        ComponentHealth db = report.components().get(0);
        assertThat(db.name()).isEqualTo("db");
        assertThat(db.detail()).startsWith("error=Connection refused").contains("database=PostgreSQL");
        assertThat(report.signature()).isEqualTo("DOWN[datasources.primary=DOWN,db=DOWN]");
        assertThat(report.summary()).isEqualTo("DOWN (HTTP 503): db DOWN, datasources.primary DOWN");
    }

    @Test
    void legacyActuatorNestingUnderDetailsIsUnderstood() {
        Map<String, Object> details = Map.of("redis", Map.of("status", "DOWN"),
                "hello", "world");
        HealthReport report = HealthReport.fromActuator("DOWN",
                Map.of("cache", new ActuatorComponent("DOWN", details, null)), null,
                HealthSource.PUSH, NOW);
        assertThat(report.failing()).extracting(ComponentHealth::name).containsExactly("cache.redis");
    }

    @Test
    void genericTreeConversionKeepsStatusDetailsAndChildren() {
        Map<String, Object> tree = Map.of(
                "status", "UP",
                "components", Map.of("db", Map.of("status", "UP", "details", Map.of("x", 1))),
                "groups", List.of("liveness"));
        ActuatorComponent doc = ActuatorComponent.fromTree(tree);
        assertThat(doc.status()).isEqualTo("UP");
        assertThat(doc.children()).containsKey("db");
        assertThat(doc.children().get("db").details()).containsEntry("x", 1);
    }

    @Test
    void pushedLegacyDocumentNestsComponentsUnderDetails() {
        Map<String, Object> details = Map.of(
                "db", Map.of("status", "DOWN", "details", Map.of("error", "Connection refused")),
                "ping", Map.of("status", "UP"),
                "hello", "world");
        HealthReportCommand legacy = new HealthReportCommand("vmforge", "vm-api", "DOWN", null, details,
                null, null, null, null);
        HealthReport report = legacy.toReport(NOW);
        assertThat(report.components()).extracting(ComponentHealth::name).containsExactlyInAnyOrder("db", "ping");
        assertThat(report.failing()).extracting(ComponentHealth::name).containsExactly("db");
        assertThat(report.signature()).isEqualTo("DOWN[db=DOWN]");
    }

    @Test
    void pushedComponentsWinOverALegacyDetailsMap() {
        HealthReportCommand both = new HealthReportCommand("vmforge", "vm-api", "DOWN",
                Map.of("redis", new ActuatorComponent("DOWN", null, null)),
                Map.of("db", Map.of("status", "DOWN")), null, null, null, null);
        assertThat(both.toReport(NOW).failing()).extracting(ComponentHealth::name).containsExactly("redis");
        HealthReportCommand neither = new HealthReportCommand("vmforge", "vm-api", "UP", null, null,
                null, null, null, null);
        assertThat(neither.toReport(NOW).components()).isEmpty();
    }

    @Test
    void upWithFailingComponentsIsDegraded() {
        HealthReport report = HealthReport.fromActuator("UP",
                Map.of("cache", new ActuatorComponent("DOWN", null, null)), null,
                HealthSource.PUSH, NOW);
        assertThat(report.status()).isEqualTo(HealthStatus.UP);
        assertThat(report.effectiveStatus()).isEqualTo(HealthStatus.DEGRADED);
        assertThat(report.summary()).isEqualTo("DEGRADED: cache DOWN");
        assertThat(report.signature()).isEqualTo("DEGRADED[cache=DOWN]");
    }

    @Test
    void plainReportHasEmptySignatureSuffix() {
        HealthReport report = HealthReport.of(HealthStatus.DOWN, "probe failed: refused",
                HealthSource.PROBE, NOW);
        assertThat(report.components()).isEmpty();
        assertThat(report.signature()).isEqualTo("DOWN[]");
        assertThat(report.summary()).isEqualTo("DOWN (probe failed: refused)");
    }

    @Test
    void componentDetailIsCapped() {
        String detail = HealthReport.describe(Map.of("blob", "x".repeat(1000)));
        assertThat(detail).hasSize(HealthReport.DETAIL_MAX).endsWith("...");
        assertThat(HealthReport.describe(Map.of())).isNull();
        assertThat(HealthReport.describe(null)).isNull();
    }
}
