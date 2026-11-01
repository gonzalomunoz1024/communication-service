package com.atlas.communication.health.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;

class HealthRollupTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    private static final int STALE_AFTER = 90;

    private static HealthInstance pod(String id, HealthStatus status) {
        return pod(id, status, List.of(), 0, false);
    }

    private static HealthInstance pod(String id, HealthStatus status, List<ComponentHealth> failing,
            int seenSecondsAgo, boolean left) {
        return new HealthInstance("m1", id, status, failing, null, null, null, null, null, null, left,
                NOW.minusSeconds(seenSecondsAgo));
    }

    private static HealthRollup rollup(HealthInstance... pods) {
        return HealthRollup.of(List.of(pods), STALE_AFTER, null, NOW);
    }

    @Test
    void allPodsUpIsUp() {
        HealthRollup r = rollup(pod("a", HealthStatus.UP), pod("b", HealthStatus.UP), pod("c", HealthStatus.UP));
        assertThat(r.status()).isEqualTo(HealthStatus.UP);
        assertThat(r.message()).isEqualTo("3 of 3 pods UP");
        assertThat(r.live()).isEqualTo(3);
        assertThat(r.unhealthy()).isEmpty();
    }

    @Test
    void noPodsIsUnknown() {
        HealthRollup r = rollup();
        assertThat(r.status()).isEqualTo(HealthStatus.UNKNOWN);
        assertThat(r.message()).isEqualTo("no live pod reports");
    }

    @Test
    void onlyStartingPodsIsUnknown() {
        HealthRollup r = rollup(pod("a", HealthStatus.UNKNOWN), pod("b", HealthStatus.UNKNOWN));
        assertThat(r.status()).isEqualTo(HealthStatus.UNKNOWN);
        assertThat(r.message()).isEqualTo("2 pods starting, none reporting yet");
        assertThat(r.live()).isEqualTo(2);
        assertThat(r.tallied()).isZero();
    }

    @Test
    void halfThePodsUpIsStillUp() {
        HealthRollup r = rollup(pod("a", HealthStatus.UP), pod("b", HealthStatus.DOWN),
                pod("c", HealthStatus.UP), pod("d", HealthStatus.DOWN));
        assertThat(r.status()).isEqualTo(HealthStatus.UP);
        assertThat(r.message()).isEqualTo("2 of 4 pods UP (DOWN: b, d)");
        assertThat(r.failing()).isEmpty();
        assertThat(r.unhealthy()).containsExactly("b", "d");
    }

    @Test
    void fewerThanHalfUpIsDegraded() {
        HealthRollup r = rollup(pod("a", HealthStatus.UP), pod("b", HealthStatus.DOWN), pod("c", HealthStatus.DOWN));
        assertThat(r.status()).isEqualTo(HealthStatus.DEGRADED);
        assertThat(r.message()).isEqualTo("1 of 3 pods UP (DOWN: b, c)");
        assertThat(r.down()).isEqualTo(2);
    }

    @Test
    void thresholdIsConfigurable() {
        List<HealthInstance> pods = List.of(pod("a", HealthStatus.UP), pod("b", HealthStatus.UP),
                pod("c", HealthStatus.UP), pod("d", HealthStatus.UP), pod("e", HealthStatus.DOWN));
        assertThat(HealthRollup.of(pods, STALE_AFTER, 100, NOW).status()).isEqualTo(HealthStatus.DEGRADED);
        assertThat(HealthRollup.of(pods, STALE_AFTER, 80, NOW).status()).isEqualTo(HealthStatus.UP);
        assertThat(HealthRollup.of(pods, STALE_AFTER, 0, NOW).status()).isEqualTo(HealthStatus.UP);
    }

    @Test
    void anyPodWithAFailingDependencyDegradesTheService() {
        ComponentHealth redis = new ComponentHealth("redis", HealthStatus.DOWN, "error=refused");
        HealthRollup r = rollup(pod("a", HealthStatus.UP), pod("b", HealthStatus.UP), pod("c", HealthStatus.UP),
                pod("d", HealthStatus.DEGRADED, List.of(redis), 0, false),
                pod("e", HealthStatus.DEGRADED, List.of(redis), 0, false));
        assertThat(r.status()).isEqualTo(HealthStatus.DEGRADED);
        assertThat(r.message()).isEqualTo("3 of 5 pods UP (DEGRADED: d, e)");
        assertThat(r.failing()).extracting(ComponentHealth::name).containsExactly("redis"); // once, not per pod
    }

    @Test
    void noPodUpIsDownUnlessOneStillServesInPart() {
        assertThat(rollup(pod("a", HealthStatus.DOWN), pod("b", HealthStatus.DOWN)).status())
                .isEqualTo(HealthStatus.DOWN);
        assertThat(rollup(pod("a", HealthStatus.DOWN), pod("b", HealthStatus.DEGRADED)).status())
                .isEqualTo(HealthStatus.DEGRADED);
        assertThat(rollup(pod("a", HealthStatus.DOWN)).message()).isEqualTo("0 of 1 pod UP (DOWN: a)");
    }

    @Test
    void silentAndLeftPodsAreIgnored() {
        HealthRollup r = rollup(
                pod("a", HealthStatus.UP, List.of(), 100, false), // silent for longer than the window
                pod("b", HealthStatus.UP, List.of(), 0, true), // said goodbye
                pod("c", HealthStatus.DOWN));
        assertThat(r.status()).isEqualTo(HealthStatus.DOWN);
        assertThat(r.live()).isEqualTo(1);
        assertThat(r.message()).isEqualTo("0 of 1 pod UP (DOWN: c)");
    }

    @Test
    void startingPodsAreLiveButNotTallied() {
        HealthRollup r = rollup(pod("a", HealthStatus.UP), pod("b", HealthStatus.UNKNOWN));
        assertThat(r.status()).isEqualTo(HealthStatus.UP);
        assertThat(r.message()).isEqualTo("1 of 2 pods UP (1 starting)");
    }

    @Test
    void podNamesAreCappedInTheMessage() {
        HealthInstance[] pods = IntStream.range(0, 7)
                .mapToObj(i -> pod("pod-" + i, HealthStatus.DOWN))
                .toArray(HealthInstance[]::new);
        assertThat(rollup(pods).message())
                .isEqualTo("0 of 7 pods UP (DOWN: pod-0, pod-1, pod-2, pod-3, pod-4 +2 more)");
    }

    @Test
    void reportCarriesTheRollupSourceAndAConsistentEffectiveStatus() {
        ComponentHealth db = new ComponentHealth("db", HealthStatus.DOWN, null);
        HealthReport degraded = rollup(pod("a", HealthStatus.UP),
                pod("b", HealthStatus.DEGRADED, List.of(db), 0, false)).toReport(NOW);
        assertThat(degraded.source()).isEqualTo(HealthSource.ROLLUP);
        assertThat(degraded.effectiveStatus()).isEqualTo(HealthStatus.DEGRADED);
        assertThat(degraded.failing()).containsExactly(db);
        assertThat(degraded.observedAt()).isEqualTo(NOW);
        assertThat(degraded.signature()).isEqualTo("DEGRADED[db=DOWN]");

        HealthReport up = rollup(pod("a", HealthStatus.UP), pod("b", HealthStatus.DOWN)).toReport(NOW);
        assertThat(up.effectiveStatus()).isEqualTo(HealthStatus.UP);
        assertThat(up.components()).isEmpty();
    }
}
