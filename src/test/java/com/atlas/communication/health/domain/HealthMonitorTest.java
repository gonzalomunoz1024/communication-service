package com.atlas.communication.health.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;

class HealthMonitorTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    private static final HealthMonitor.Policy POLICY = policy(2, 2, null);

    private static HealthMonitor.Policy policy(int failureThreshold, int recoveryThreshold,
            Integer staleAfterSeconds) {
        return new HealthMonitor.Policy("health-monitor", 30, 5000, failureThreshold,
                recoveryThreshold, Severity.MAJOR, Severity.MINOR, Audience.CUSTOMERS, staleAfterSeconds, null);
    }

    private static HealthMonitor probed() {
        return HealthMonitor.create("m1", "vmforge", "vm-api", "http://vm-api/actuator/health", POLICY, NOW);
    }

    private static HealthMonitor pushOnly(Integer staleAfterSeconds) {
        return HealthMonitor.create("m2", "vmforge", "billing", null, policy(2, 2, staleAfterSeconds), NOW);
    }

    private static HealthReport probe(HealthStatus status, Instant at) {
        return HealthReport.of(status, "HTTP 503", HealthSource.PROBE, at);
    }

    private static HealthReport down(Instant at) {
        return probe(HealthStatus.DOWN, at);
    }

    /** A monitor that has crossed the failure threshold and claimed a DOWN notice. */
    private static HealthMonitor openDown() {
        HealthMonitor m = probed().evaluate(down(NOW), NOW).monitor();
        HealthEvaluation e = m.evaluate(down(NOW.plusSeconds(30)), NOW.plusSeconds(30));
        assertThat(e.transition()).isEqualTo(HealthTransition.OPEN);
        return e.monitor().withOpen("c1", HealthStatus.DOWN, down(NOW).signature());
    }

    @Test
    void createValidatesUrlAndPolicy() {
        assertThatThrownBy(() -> HealthMonitor.create("m", "t", "s", "not a url", POLICY, NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("http(s)");
        assertThatThrownBy(() -> HealthMonitor.create("m", "t", "s", "ftp://host/x", POLICY, NOW))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> HealthMonitor.create("m", "t", "s", null,
                new HealthMonitor.Policy("p", 1, 5000, 2, 2, Severity.MAJOR, Severity.MINOR,
                        Audience.CUSTOMERS, null, null), NOW))
                .hasMessageContaining("intervalSeconds");
        assertThatThrownBy(() -> HealthMonitor.create("m", "t", "s", null,
                new HealthMonitor.Policy("p", 30, 5000, 2, 2, Severity.INFO, Severity.MINOR,
                        Audience.CUSTOMERS, null, null), NOW))
                .hasMessageContaining("downSeverity");
        assertThatThrownBy(() -> HealthMonitor.create("m", " ", "s", null, POLICY, NOW))
                .hasMessageContaining("tenantId");
    }

    @Test
    void blankUrlMeansPushOnly() {
        HealthMonitor m = HealthMonitor.create("m", "t", "s", "   ", POLICY, NOW);
        assertThat(m.url()).isNull();
        assertThat(m.pushOnly()).isTrue();
        assertThat(m.state()).isEqualTo(HealthMonitor.State.INITIAL);
    }

    @Test
    void singleFailureStaysBelowThreshold() {
        HealthEvaluation e = probed().evaluate(down(NOW), NOW);
        assertThat(e.transition()).isEqualTo(HealthTransition.NONE);
        assertThat(e.monitor().state().unhealthyStreak()).isEqualTo(1);
        assertThat(e.monitor().state().lastStatus()).isEqualTo(HealthStatus.DOWN);
        assertThat(e.monitor().state().lastProbeAt()).isEqualTo(NOW);
        assertThat(e.monitor().state().lastReportAt()).isEqualTo(NOW);
        assertThat(e.monitor().state().lastSummary()).isEqualTo("DOWN (HTTP 503)");
        assertThat(e.monitor().updatedAt()).isEqualTo(NOW);
    }

    @Test
    void consecutiveFailuresAtThresholdOpen() {
        HealthMonitor m = probed().evaluate(down(NOW), NOW).monitor();
        HealthEvaluation e = m.evaluate(down(NOW.plusSeconds(30)), NOW.plusSeconds(30));
        assertThat(e.transition()).isEqualTo(HealthTransition.OPEN);
        assertThat(e.monitor().state().unhealthyStreak()).isEqualTo(2);
        // nothing claimed yet: the use case does that after the store accepts the claim
        assertThat(e.monitor().state().hasOpen()).isFalse();
    }

    @Test
    void streakRestartsWhenTheUnhealthyStatusChanges() {
        HealthMonitor m = probed().evaluate(down(NOW), NOW).monitor();
        HealthEvaluation e = m.evaluate(probe(HealthStatus.DEGRADED, NOW), NOW);
        assertThat(e.transition()).isEqualTo(HealthTransition.NONE);
        assertThat(e.monitor().state().unhealthyStreak()).isEqualTo(1);
        assertThat(e.monitor().state().lastStatus()).isEqualTo(HealthStatus.DEGRADED);
    }

    @Test
    void unknownCarriesNoInformation() {
        HealthMonitor m = probed().evaluate(down(NOW), NOW).monitor();
        HealthEvaluation unknown = m.evaluate(probe(HealthStatus.UNKNOWN, NOW), NOW);
        assertThat(unknown.transition()).isEqualTo(HealthTransition.NONE);
        assertThat(unknown.monitor().state().unhealthyStreak()).isEqualTo(1);
        assertThat(unknown.monitor().state().lastStatus()).isEqualTo(HealthStatus.DOWN);
        assertThat(unknown.monitor().state().lastSummary()).startsWith("UNKNOWN");

        assertThat(unknown.monitor().evaluate(down(NOW), NOW).transition())
                .isEqualTo(HealthTransition.OPEN);
    }

    @Test
    void recoveryResolvesOnlyAfterItsThreshold() {
        HealthMonitor open = openDown();
        HealthEvaluation first = open.evaluate(probe(HealthStatus.UP, NOW), NOW);
        assertThat(first.transition()).isEqualTo(HealthTransition.NONE);
        assertThat(first.monitor().state().healthyStreak()).isEqualTo(1);
        assertThat(first.monitor().state().unhealthyStreak()).isZero();
        assertThat(first.monitor().state().hasOpen()).isTrue();

        HealthEvaluation second = first.monitor().evaluate(probe(HealthStatus.UP, NOW), NOW);
        assertThat(second.transition()).isEqualTo(HealthTransition.RESOLVE);
        assertThat(second.monitor().state().healthyStreak()).isEqualTo(2);
    }

    @Test
    void healthyWithNothingOpenIsQuiet() {
        HealthEvaluation e = probed().evaluate(probe(HealthStatus.UP, NOW), NOW);
        assertThat(e.transition()).isEqualTo(HealthTransition.NONE);
        assertThat(e.monitor().evaluate(probe(HealthStatus.UP, NOW), NOW).transition())
                .isEqualTo(HealthTransition.NONE);
    }

    @Test
    void sameProblemWhileOpenIsQuietButNewFailingComponentsUpdate() {
        HealthMonitor open = openDown();
        assertThat(open.evaluate(down(NOW), NOW).transition()).isEqualTo(HealthTransition.NONE);

        HealthReport moreBroken = new HealthReport(HealthStatus.DOWN,
                List.of(new ComponentHealth("db", HealthStatus.DOWN, null)), "HTTP 503",
                HealthSource.PROBE, NOW);
        assertThat(open.evaluate(moreBroken, NOW).transition()).isEqualTo(HealthTransition.UPDATE);
    }

    @Test
    void changeOfKindWhileOpenReplacesAfterThreshold() {
        HealthMonitor open = openDown();
        HealthEvaluation first = open.evaluate(probe(HealthStatus.DEGRADED, NOW), NOW);
        assertThat(first.transition()).isEqualTo(HealthTransition.NONE);
        assertThat(first.monitor().state().hasOpen()).isTrue();
        HealthEvaluation second = first.monitor().evaluate(probe(HealthStatus.DEGRADED, NOW), NOW);
        assertThat(second.transition()).isEqualTo(HealthTransition.REPLACE);
    }

    @Test
    void claimAndCloseBookkeeping() {
        HealthMonitor open = openDown();
        assertThat(open.state().incidents()).isEqualTo(1);
        assertThat(open.externalRef()).isEqualTo("health:m1:1");
        assertThat(open.state().openStatus()).isEqualTo(HealthStatus.DOWN);

        HealthMonitor closed = open.withClosed();
        assertThat(closed.state().hasOpen()).isFalse();
        assertThat(closed.state().unhealthyStreak()).isEqualTo(2);
        assertThat(closed.state().incidents()).isEqualTo(1);

        // an operator's retire starts the count again; the failing observation in hand is its first
        HealthMonitor byOperator = open.withClosedByOperator();
        assertThat(byOperator.state().hasOpen()).isFalse();
        assertThat(byOperator.state().unhealthyStreak()).isEqualTo(1);

        assertThat(open.withOpenSignature("DOWN[db=DOWN]").state().openSignature())
                .isEqualTo("DOWN[db=DOWN]");
    }

    @Test
    void anOperatorsRetireStartsTheCountAgainWithTheObservationThatNoticedIt() {
        HealthMonitor open = openDown();

        // noticed by a failing observation: that one counts, so with threshold 2 the next failure reopens
        HealthMonitor noticedWhileFailing = open.evaluate(down(NOW.plusSeconds(60)), NOW.plusSeconds(60))
                .monitor().withClosedByOperator();
        assertThat(noticedWhileFailing.state().unhealthyStreak()).isEqualTo(1);
        HealthEvaluation next = noticedWhileFailing.evaluate(down(NOW.plusSeconds(90)), NOW.plusSeconds(90));
        assertThat(next.transition()).isEqualTo(HealthTransition.OPEN);
        assertThat(next.monitor().state().unhealthyStreak()).isEqualTo(2);

        // noticed by a healthy observation: there is nothing to count
        HealthMonitor noticedWhileUp = open.evaluate(probe(HealthStatus.UP, NOW.plusSeconds(60)), NOW.plusSeconds(60))
                .monitor().withClosedByOperator();
        assertThat(noticedWhileUp.state().hasOpen()).isFalse();
        assertThat(noticedWhileUp.state().unhealthyStreak()).isZero();
    }

    @Test
    void probeIsDueOnceIntervalElapsed() {
        HealthMonitor fresh = probed();
        assertThat(fresh.probeDue(NOW)).isTrue();
        HealthMonitor probedNow = fresh.evaluate(probe(HealthStatus.UP, NOW), NOW).monitor();
        assertThat(probedNow.probeDue(NOW.plusSeconds(29))).isFalse();
        assertThat(probedNow.probeDue(NOW.plusSeconds(30))).isTrue();
        assertThat(pushOnly(60).probeDue(NOW.plusSeconds(3600))).isFalse();
    }

    @Test
    void claimingTheProbeSlotRecordsTheProbeTimeAndNothingElse() {
        // a monitor with history: a notice open after two failing probes a minute ago
        HealthMonitor open = probed();
        for (int i = 0; i < 2; i++) {
            open = open.evaluate(down(NOW.minusSeconds(60)), NOW.minusSeconds(60)).monitor();
        }
        open = open.withOpen("c1", HealthStatus.DOWN, "DOWN[]");

        HealthMonitor claimed = open.withProbeClaimed(NOW);
        assertThat(claimed.state().lastProbeAt()).isEqualTo(NOW);
        assertThat(claimed.probeDue(NOW)).as("claimed: not due again in this tick").isFalse();
        assertThat(claimed.probeDue(NOW.plusSeconds(29))).isFalse();
        assertThat(claimed.probeDue(NOW.plusSeconds(30))).isTrue();
        // streaks, status and the open notice are the probe result's business, not the claim's
        assertThat(claimed.state()).usingRecursiveComparison().ignoringFields("lastProbeAt").isEqualTo(open.state());
        assertThat(claimed.version()).isEqualTo(open.version());
        assertThat(claimed.updatedAt()).isEqualTo(NOW);
    }

    @Test
    void pushOnlyMonitorsGoStaleFromRegistrationOrLastReport() {
        assertThat(pushOnly(null).stale(NOW.plusSeconds(999_999))).isFalse();
        HealthMonitor silent = pushOnly(60);
        assertThat(silent.stale(NOW.plusSeconds(59))).isFalse();
        assertThat(silent.stale(NOW.plusSeconds(60))).isTrue();

        HealthMonitor reported = silent.evaluate(
                HealthReport.of(HealthStatus.UP, null, HealthSource.PUSH, NOW.plusSeconds(10)),
                NOW.plusSeconds(10)).monitor();
        assertThat(reported.state().lastProbeAt()).isNull();
        assertThat(reported.stale(NOW.plusSeconds(69))).isFalse();
        assertThat(reported.stale(NOW.plusSeconds(70))).isTrue();

        // a synthesized stale observation must not count as a report
        HealthMonitor stale = reported.evaluate(
                HealthReport.of(HealthStatus.DOWN, "silent", HealthSource.STALE, NOW.plusSeconds(70)),
                NOW.plusSeconds(70)).monitor();
        assertThat(stale.state().lastReportAt()).isEqualTo(NOW.plusSeconds(10));
        assertThat(stale.state().unhealthyStreak()).isEqualTo(1);
        assertThat(probed().stale(NOW.plusSeconds(999_999))).isFalse();
    }
}
