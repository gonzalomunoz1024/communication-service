package com.atlas.communication.health.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.domain.HealthInstance;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.atlas.communication.health.ports.outbound.HealthInstanceRepositoryPort;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class HealthSweepUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    private static final HealthProperties.Defaults DEFAULTS = new HealthProperties.Defaults(
            "health-monitor", 30, 5000, 2, 2, Severity.MAJOR, Severity.MINOR, Audience.CUSTOMERS, 50, 90);
    /** No startup grace, so the existing staleness tests see the sweep at work right away. */
    private static final HealthProperties PROPERTIES = new HealthProperties(5000, 0, 0.3, 2, DEFAULTS);

    @Mock
    private HealthMonitorRepositoryPort monitors;
    @Mock
    private HealthInstanceRepositoryPort instances;
    @Mock
    private HealthObservationUseCase observation;

    private HealthSweepUseCase useCase;

    @BeforeEach
    void setUp() {
        useCase = new HealthSweepUseCase(monitors, instances, observation, PROPERTIES,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static HealthInstance instance(String monitorId, String pod, boolean left, Instant lastSeenAt) {
        return new HealthInstance(monitorId, pod, HealthStatus.UP, List.of(), null, null, null, null,
                null, null, left, lastSeenAt);
    }

    private static HealthMonitor silent(String id) {
        return HealthMonitor.create(id, "vmforge", id, null, policy(60), NOW.minusSeconds(120));
    }

    private static HealthMonitor.Policy policy(Integer staleAfterSeconds) {
        return new HealthMonitor.Policy("health-monitor", 30, 5000, 2, 2, Severity.MAJOR,
                Severity.MINOR, Audience.CUSTOMERS, staleAfterSeconds, null);
    }

    private static HealthMonitor probed(String id, Instant lastProbeAt) {
        HealthMonitor m = HealthMonitor.create(id, "vmforge", id, "http://" + id + "/health",
                policy(null), NOW.minusSeconds(600));
        return lastProbeAt == null ? m
                : m.evaluate(HealthReport.of(HealthStatus.UP, null, HealthSource.PROBE, lastProbeAt), lastProbeAt).monitor();
    }

    @Test
    void probesOnlyMonitorsWhoseIntervalElapsed() {
        HealthMonitor due = probed("due", null);
        HealthMonitor alsoDue = probed("also-due", NOW.minusSeconds(30));
        HealthMonitor recent = probed("recent", NOW.minusSeconds(10));
        HealthMonitor pushOnly = HealthMonitor.create("push", "vmforge", "push", null, policy(null), NOW);
        when(monitors.findAll(null)).thenReturn(Flux.just(due, alsoDue, recent, pushOnly));
        when(observation.probe(any(), eq(NOW))).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(2L).verifyComplete();
        verify(observation).probe(due, NOW);
        verify(observation).probe(alsoDue, NOW);
        verify(observation, never()).probe(eq(recent), any());
        verify(observation, never()).probe(eq(pushOnly), any());
        verify(observation, never()).observe(any(), any(), any());
    }

    @Test
    void silentPushOnlyMonitorsAreObservedAsDown() {
        HealthMonitor silent = HealthMonitor.create("silent", "vmforge", "silent", null,
                policy(60), NOW.minusSeconds(120));
        HealthMonitor fresh = HealthMonitor.create("fresh", "vmforge", "fresh", null, policy(60), NOW);
        when(monitors.findAll(null)).thenReturn(Flux.just(silent, fresh));
        when(instances.findByMonitor("silent")).thenReturn(Flux.empty());
        when(observation.observe(eq(silent), any(), eq(NOW))).thenReturn(Mono.just(silent));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(1L).verifyComplete();

        ArgumentCaptor<HealthReport> report = ArgumentCaptor.forClass(HealthReport.class);
        verify(observation).observe(eq(silent), report.capture(), eq(NOW));
        assertThat(report.getValue().status()).isEqualTo(HealthStatus.DOWN);
        assertThat(report.getValue().source()).isEqualTo(HealthSource.STALE);
        assertThat(report.getValue().message()).contains(NOW.minusSeconds(120).toString());
        verify(observation, never()).observe(eq(fresh), any(), any());
    }

    @Test
    void aFailingMonitorDoesNotStopTheSweep() {
        HealthMonitor broken = probed("broken", null);
        HealthMonitor fine = probed("fine", null);
        when(monitors.findAll(null)).thenReturn(Flux.just(broken, fine));
        when(observation.probe(broken, NOW)).thenReturn(Mono.error(new IllegalStateException("conflict")));
        when(observation.probe(fine, NOW)).thenReturn(Mono.just(fine));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(1L).verifyComplete();
    }

    @Test
    void emptySweepIsQuiet() {
        when(monitors.findAll(null)).thenReturn(Flux.empty());
        StepVerifier.create(useCase.sweep(NOW)).expectNext(0L).verifyComplete();
    }

    // --- staleness guards ---

    @Test
    void silenceIsNotTrustedDuringTheStartupGrace() {
        HealthSweepUseCase justStarted = new HealthSweepUseCase(monitors, instances, observation,
                new HealthProperties(5000, 300_000, 0.3, 2, DEFAULTS), Clock.fixed(NOW, ZoneOffset.UTC));
        HealthMonitor due = probed("due", null);
        when(monitors.findAll(null)).thenReturn(Flux.just(silent("silent"), due));
        when(observation.probe(eq(due), any())).thenReturn(Mono.just(due)); // probes are not affected

        StepVerifier.create(justStarted.sweep(NOW)).expectNext(1L).verifyComplete();
        verify(observation, never()).observe(any(), any(), any());

        // five minutes later the grace is over and the silent monitor is declared DOWN
        when(instances.findByMonitor("silent")).thenReturn(Flux.empty());
        when(observation.observe(any(), any(), any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
        Instant later = NOW.plusSeconds(300);
        StepVerifier.create(justStarted.sweep(later)).expectNext(2L).verifyComplete();
        verify(observation).observe(any(), any(), eq(later));
    }

    @Test
    void silenceIsNotTrustedWhenMostMonitorsGoSilentTogether() {
        HealthMonitor fresh = HealthMonitor.create("fresh", "vmforge", "fresh", null, policy(60), NOW);
        when(monitors.findAll(null)).thenReturn(Flux.just(silent("a"), silent("b"), silent("c"), fresh));
        // the sweep first asks whether a silent service merely scaled to zero
        when(instances.findByMonitor(anyString())).thenReturn(Flux.empty());

        StepVerifier.create(useCase.sweep(NOW)).expectNext(0L).verifyComplete();
        verify(observation, never()).observe(any(), any(), any());
    }

    @Test
    void oneSilentMonitorAmongManyIsStillDeclaredDown() {
        HealthMonitor fresh1 = HealthMonitor.create("f1", "vmforge", "f1", null, policy(60), NOW);
        HealthMonitor fresh2 = HealthMonitor.create("f2", "vmforge", "f2", null, policy(60), NOW);
        HealthMonitor fresh3 = HealthMonitor.create("f3", "vmforge", "f3", null, policy(60), NOW);
        HealthMonitor silent = silent("silent");
        when(monitors.findAll(null)).thenReturn(Flux.just(silent, fresh1, fresh2, fresh3));
        when(instances.findByMonitor("silent")).thenReturn(Flux.empty());
        when(observation.observe(eq(silent), any(), eq(NOW))).thenReturn(Mono.just(silent));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(1L).verifyComplete();
    }

    @Test
    void aScaledToZeroServiceDoesNotCountAsSilentForTheSafetyValve() {
        // two services really silent, one scaled to zero (every pod left) and six healthy ones:
        // 2 of 8 that can go stale is below the 30% pause; counting the scaled one would make it
        // 3 of 9 and pause staleness for everyone
        HealthMonitor a = silent("a");
        HealthMonitor b = silent("b");
        HealthMonitor scaled = silent("scaled");
        List<HealthMonitor> all = new java.util.ArrayList<>(List.of(a, b, scaled));
        for (int i = 1; i <= 6; i++) {
            all.add(HealthMonitor.create("f" + i, "vmforge", "f" + i, null, policy(60), NOW));
        }
        when(monitors.findAll(null)).thenReturn(Flux.fromIterable(all));
        when(instances.findByMonitor("a")).thenReturn(Flux.empty());
        when(instances.findByMonitor("b")).thenReturn(Flux.empty());
        when(instances.findByMonitor("scaled")).thenReturn(Flux.just(
                instance("scaled", "pod-a", true, NOW.minusSeconds(100)),
                instance("scaled", "pod-b", true, NOW.minusSeconds(110))));
        when(observation.observe(any(), any(), eq(NOW))).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(2L).verifyComplete();
        verify(observation).observe(eq(a), any(), eq(NOW));
        verify(observation).observe(eq(b), any(), eq(NOW));
        verify(observation, never()).observe(eq(scaled), any(), any());
    }

    @Test
    void oneSilentMonitorOfThreeIsStillDeclaredDown() {
        // 1 of 3 is 33%, above the share, but a single silent service is never "everyone"
        HealthMonitor silent = silent("silent");
        HealthMonitor fresh1 = HealthMonitor.create("f1", "vmforge", "f1", null, policy(60), NOW);
        HealthMonitor fresh2 = HealthMonitor.create("f2", "vmforge", "f2", null, policy(60), NOW);
        when(monitors.findAll(null)).thenReturn(Flux.just(silent, fresh1, fresh2));
        when(instances.findByMonitor("silent")).thenReturn(Flux.empty());
        when(observation.observe(eq(silent), any(), eq(NOW))).thenReturn(Mono.just(silent));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(1L).verifyComplete();
        ArgumentCaptor<HealthReport> report = ArgumentCaptor.forClass(HealthReport.class);
        verify(observation).observe(eq(silent), report.capture(), eq(NOW));
        assertThat(report.getValue().status()).isEqualTo(HealthStatus.DOWN);
    }

    @Test
    void aServiceWhosePodsAllLeftIsScaledToZeroNotStale() {
        HealthMonitor silent = silent("silent");
        when(monitors.findAll(null)).thenReturn(Flux.just(silent));
        when(instances.findByMonitor("silent")).thenReturn(Flux.just(
                instance("silent", "pod-a", true, NOW.minusSeconds(100)),
                instance("silent", "pod-b", true, NOW.minusSeconds(110))));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(0L).verifyComplete();
        verify(observation, never()).observe(any(), any(), any());
    }

    @Test
    void aServiceWhosePodsWentSilentIsDownAndNamesThem() {
        HealthMonitor silent = silent("silent");
        when(monitors.findAll(null)).thenReturn(Flux.just(silent));
        when(instances.findByMonitor("silent")).thenReturn(Flux.just(
                instance("silent", "pod-a", true, NOW.minusSeconds(100)),
                instance("silent", "pod-b", false, NOW.minusSeconds(110))));
        when(observation.observe(eq(silent), any(), eq(NOW))).thenReturn(Mono.just(silent));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(1L).verifyComplete();

        ArgumentCaptor<HealthReport> report = ArgumentCaptor.forClass(HealthReport.class);
        verify(observation).observe(eq(silent), report.capture(), eq(NOW));
        assertThat(report.getValue().status()).isEqualTo(HealthStatus.DOWN);
        assertThat(report.getValue().source()).isEqualTo(HealthSource.STALE);
        assertThat(report.getValue().message()).startsWith("1 pod has not reported since").contains("pod-b")
                .doesNotContain("pod-a");
    }
}
