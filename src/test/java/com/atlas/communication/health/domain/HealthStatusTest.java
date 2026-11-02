package com.atlas.communication.health.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.Test;

/**
 * The status words the service reads, which must mean what the health sidecar's
 * {@code Normalize} (sidecar/internal/probe/probe.go) makes of them: the sidecar normalizes the
 * overall status but forwards component statuses as the app wrote them.
 */
class HealthStatusTest {

    private static final Instant NOW = Instant.parse("2026-11-02T12:00:00Z");
    private static final List<String> UP_WORDS = List.of("UP", "OK", "PASS", "HEALTHY", "GREEN", "SERVING");
    private static final List<String> DOWN_WORDS = List.of("DOWN", "FAIL", "FAILED", "ERROR", "UNHEALTHY",
            "OUT_OF_SERVICE", "FATAL", "RED", "NOT_SERVING");

    @Test
    void everyWordOfBothVocabulariesMeansTheSameHereAsInTheSidecar() {
        SoftAssertions softly = new SoftAssertions();
        UP_WORDS.forEach(word -> expectEverySpelling(softly, word, HealthStatus.UP));
        DOWN_WORDS.forEach(word -> expectEverySpelling(softly, word, HealthStatus.DOWN));
        expectEverySpelling(softly, "UNKNOWN", HealthStatus.UNKNOWN);
        softly.assertThat(HealthStatus.fromCode(null)).as("no status").isEqualTo(HealthStatus.UNKNOWN);
        softly.assertThat(HealthStatus.fromCode(" ")).as("a blank status").isEqualTo(HealthStatus.UNKNOWN);
        softly.assertAll();
    }

    @Test
    void anyOtherWordIsDegraded() {
        SoftAssertions softly = new SoftAssertions();
        List.of("WARN", "WARNING", "DEGRADED", "PARTIAL", "YELLOW")
                .forEach(word -> expectEverySpelling(softly, word, HealthStatus.DEGRADED));
        softly.assertAll();
    }

    @Test
    void componentsInTheSidecarsWordsAreHealthyOrFailingAsTheyMean() {
        // "pass" must not turn an UP service into a HEALTH notice; "fail" is a DOWN dependency
        HealthReport healthy = HealthReport.fromActuator("UP", Map.of(
                "db", new ActuatorComponent("pass", null, null),
                "grpc", new ActuatorComponent("SERVING", null, null)), null, HealthSource.PUSH,
                NOW);
        assertThat(healthy.effectiveStatus()).isEqualTo(HealthStatus.UP);
        assertThat(healthy.failing()).isEmpty();

        HealthReport failing = HealthReport.fromActuator("UP", Map.of(
                "db", new ActuatorComponent("pass", null, null),
                "cache", new ActuatorComponent("fail", null, null)), null, HealthSource.PUSH,
                NOW);
        assertThat(failing.signature()).isEqualTo("DEGRADED[cache=DOWN]");
    }

    private static void expectEverySpelling(SoftAssertions softly, String word, HealthStatus expected) {
        for (String spelling : List.of(word, word.toLowerCase(Locale.ROOT), " " + word + "\t")) {
            softly.assertThat(HealthStatus.fromCode(spelling)).as("'%s'", spelling).isEqualTo(expected);
        }
    }
}
