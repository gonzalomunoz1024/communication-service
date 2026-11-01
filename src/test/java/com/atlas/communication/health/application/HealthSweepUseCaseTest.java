package com.atlas.communication.health.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class HealthSweepUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    @Mock
    private HealthMonitorRepositoryPort monitors;
    @Mock
    private HealthObservationUseCase observation;

    private HealthSweepUseCase useCase;

    @BeforeEach
    void setUp() {
        useCase = new HealthSweepUseCase(monitors, observation, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static HealthMonitor.Policy policy(Integer staleAfterSeconds) {
        return new HealthMonitor.Policy("health-monitor", 30, 5000, 2, 2, Severity.MAJOR,
                Severity.MINOR, Audience.CUSTOMERS, staleAfterSeconds);
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
}
