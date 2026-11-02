package com.atlas.communication.health.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.domain.ActuatorComponent;
import com.atlas.communication.health.domain.HealthInstance;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthReportCommand;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.atlas.communication.health.domain.RegisterMonitorCommand;
import com.atlas.communication.health.domain.ReportInstance;
import com.atlas.communication.health.ports.outbound.HealthInstanceRepositoryPort;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class HealthMonitorUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    private static final HealthProperties PROPERTIES = new HealthProperties(5000, 300000, 0.3, 2,
            new HealthProperties.Defaults("health-monitor", 30, 5000, 2, 2, Severity.MAJOR,
                    Severity.MINOR, Audience.CUSTOMERS, 50, 90));

    @Mock
    private HealthMonitorRepositoryPort monitors;
    @Mock
    private HealthInstanceRepositoryPort instances;
    @Mock
    private HealthObservationUseCase observation;

    private HealthMonitorUseCase useCase;

    @BeforeEach
    void setUp() {
        useCase = new HealthMonitorUseCase(monitors, instances, observation, PROPERTIES,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static RegisterMonitorCommand register(String url, Integer intervalSeconds) {
        return new RegisterMonitorCommand("vmforge", "vm-api", url, null, intervalSeconds, null,
                null, null, null, null, null, null, null);
    }

    private static HealthMonitor existing() {
        return HealthMonitor.create("m1", "vmforge", "billing", null, PROPERTIES.defaults().asPolicy(), NOW);
    }

    @Test
    void registerFillsPolicyFromDefaultsThenOverrides() {
        when(monitors.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.register(register("http://vm-api/actuator/health", 10)))
                .assertNext(m -> {
                    assertThat(m.id()).isNotBlank();
                    assertThat(m.createdAt()).isEqualTo(NOW);
                    assertThat(m.url()).isEqualTo("http://vm-api/actuator/health");
                    assertThat(m.policy().intervalSeconds()).isEqualTo(10);
                    assertThat(m.policy().timeoutMs()).isEqualTo(5000);
                    assertThat(m.policy().publisher()).isEqualTo("health-monitor");
                    assertThat(m.policy().downSeverity()).isEqualTo(Severity.MAJOR);
                    assertThat(m.policy().staleAfterSeconds()).isNull();
                })
                .verifyComplete();
    }

    @Test
    void registerRejectsAnInvalidPolicy() {
        StepVerifier.create(useCase.register(register(null, 1)))
                .expectError(IllegalArgumentException.class)
                .verify();
        verify(monitors, never()).save(any());
    }

    @Test
    void firstPushAutoRegistersAPushOnlyMonitorAndObserves() {
        when(monitors.findByTenantAndService("vmforge", "billing")).thenReturn(Mono.empty());
        when(monitors.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
        when(observation.observe(any(), any(), eq(NOW))).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        HealthReportCommand cmd = new HealthReportCommand("vmforge", "billing", "DOWN",
                Map.of("redis", new ActuatorComponent("DOWN", null, null)), "cache lost", null, "billing-svc", null);
        StepVerifier.create(useCase.report(cmd))
                .assertNext(m -> {
                    assertThat(m.pushOnly()).isTrue();
                    assertThat(m.policy().publisher()).isEqualTo("billing-svc");
                    assertThat(m.policy().failureThreshold()).isEqualTo(2);
                })
                .verifyComplete();

        ArgumentCaptor<HealthReport> report = ArgumentCaptor.forClass(HealthReport.class);
        verify(observation).observe(any(), report.capture(), eq(NOW));
        assertThat(report.getValue().status()).isEqualTo(HealthStatus.DOWN);
        assertThat(report.getValue().source()).isEqualTo(HealthSource.PUSH);
        assertThat(report.getValue().observedAt()).isEqualTo(NOW);
        assertThat(report.getValue().failing()).hasSize(1);
        assertThat(report.getValue().message()).isEqualTo("cache lost");
    }

    @Test
    void pushToAKnownServiceUsesItsMonitor() {
        HealthMonitor monitor = existing();
        when(monitors.findByTenantAndService("vmforge", "billing")).thenReturn(Mono.just(monitor));
        when(observation.observe(eq(monitor), any(), eq(NOW))).thenReturn(Mono.just(monitor));

        Instant observedAt = NOW.minusSeconds(5);
        StepVerifier.create(useCase.report(new HealthReportCommand("vmforge", "billing", "UP",
                        null, null, observedAt, null, null)))
                .expectNext(monitor)
                .verifyComplete();
        verify(monitors, never()).save(any());
        ArgumentCaptor<HealthReport> report = ArgumentCaptor.forClass(HealthReport.class);
        verify(observation).observe(eq(monitor), report.capture(), eq(NOW));
        assertThat(report.getValue().observedAt()).isEqualTo(observedAt);
    }

    @Test
    void concurrentFirstPushesConvergeOnTheWinnersMonitor() {
        HealthMonitor winner = existing();
        when(monitors.findByTenantAndService("vmforge", "billing"))
                .thenReturn(Mono.empty(), Mono.just(winner));
        when(monitors.save(any())).thenReturn(Mono.error(
                new ResponseStatusException(HttpStatus.CONFLICT, "already exists")));
        when(observation.observe(eq(winner), any(), eq(NOW))).thenReturn(Mono.just(winner));

        StepVerifier.create(useCase.report(new HealthReportCommand("vmforge", "billing", "DOWN",
                        null, null, null, null, null)))
                .expectNext(winner)
                .verifyComplete();
    }

    @Test
    void deleteClosesTheOpenNoticeBeforeRemovingTheMonitor() {
        HealthMonitor monitor = existing();
        when(monitors.findById("m1")).thenReturn(Mono.just(monitor));
        when(observation.close(monitor, "monitor deleted", NOW)).thenReturn(Mono.just(monitor));
        when(instances.deleteByMonitor("m1")).thenReturn(Mono.empty());
        when(monitors.deleteById("m1")).thenReturn(Mono.just(true));

        StepVerifier.create(useCase.delete("m1")).verifyComplete();
        InOrder order = inOrder(observation, instances, monitors);
        order.verify(observation).close(monitor, "monitor deleted", NOW);
        order.verify(instances).deleteByMonitor("m1");
        order.verify(monitors).deleteById("m1");
    }

    @Test
    void unknownMonitorIs404() {
        when(monitors.findById("nope")).thenReturn(Mono.empty());
        StepVerifier.create(useCase.delete("nope"))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.NOT_FOUND))
                .verify();
    }

    @Test
    void probeNowRejectsPushOnlyMonitors() {
        when(monitors.findById("m1")).thenReturn(Mono.just(existing()));
        StepVerifier.create(useCase.probeNow("m1"))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.CONFLICT))
                .verify();
        verify(observation, never()).probe(any(), any());
    }

    @Test
    void probeNowDelegatesForProbedMonitors() {
        HealthMonitor probed = HealthMonitor.create("m3", "vmforge", "vm-api",
                "http://vm-api/actuator/health", PROPERTIES.defaults().asPolicy(), NOW);
        when(monitors.findById("m3")).thenReturn(Mono.just(probed));
        when(observation.probe(probed, NOW)).thenReturn(Mono.just(probed));

        StepVerifier.create(useCase.probeNow("m3")).expectNext(probed).verifyComplete();
    }

    @Test
    void listPassesTheTenantFilterThrough() {
        when(monitors.findAll("vmforge")).thenReturn(Flux.just(existing()));
        StepVerifier.create(useCase.list("vmforge")).expectNextCount(1).verifyComplete();
    }

    // --- reports that name their instance (the health sidecar) ---

    private static HealthReportCommand podReport(String pod, String status, boolean leaving) {
        return new HealthReportCommand("vmforge", "billing", status, null, null, null, "health-sidecar",
                new ReportInstance(pod, "retail-billing", "worker-1", "ocp-east", "1.4.2", "1.0.0", leaving));
    }

    private static HealthInstance instance(String pod, HealthStatus status, Instant lastSeenAt) {
        return new HealthInstance("m1", pod, status, List.of(), null, null, null, null, null, null,
                false, lastSeenAt);
    }

    @Test
    void firstInstanceReportAutoRegistersWithTheInstanceStalenessWindow() {
        when(monitors.findByTenantAndService("vmforge", "billing")).thenReturn(Mono.empty());
        when(monitors.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
        when(instances.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
        when(instances.findByMonitor(any())).thenAnswer(inv -> Flux.just(new HealthInstance(
                inv.getArgument(0), "pod-a", HealthStatus.UP, null, null, null, null, null, null, null, false, NOW)));
        when(observation.observe(any(), any(), eq(NOW))).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.report(podReport("pod-a", "UP", false)))
                .assertNext(m -> {
                    assertThat(m.pushOnly()).isTrue();
                    assertThat(m.policy().publisher()).isEqualTo("health-sidecar");
                    assertThat(m.policy().staleAfterSeconds()).isEqualTo(90);
                    assertThat(m.policy().minHealthyPercent()).isEqualTo(50);
                })
                .verifyComplete();

        ArgumentCaptor<HealthInstance> saved = ArgumentCaptor.forClass(HealthInstance.class);
        verify(instances).save(saved.capture());
        assertThat(saved.getValue().instanceId()).isEqualTo("pod-a");
        assertThat(saved.getValue().status()).isEqualTo(HealthStatus.UP);
        assertThat(saved.getValue().cluster()).isEqualTo("ocp-east");
        assertThat(saved.getValue().sidecar()).isEqualTo("1.0.0");
        assertThat(saved.getValue().lastSeenAt()).isEqualTo(NOW);
        assertThat(saved.getValue().left()).isFalse();

        ArgumentCaptor<HealthReport> report = ArgumentCaptor.forClass(HealthReport.class);
        verify(observation).observe(any(), report.capture(), eq(NOW));
        assertThat(report.getValue().source()).isEqualTo(HealthSource.ROLLUP);
        assertThat(report.getValue().status()).isEqualTo(HealthStatus.UP);
        assertThat(report.getValue().message()).isEqualTo("1 of 1 pod UP");
    }

    @Test
    void instanceReportsAreRolledUpBeforeTheMonitorSeesThem() {
        HealthMonitor monitor = existing();
        when(monitors.findByTenantAndService("vmforge", "billing")).thenReturn(Mono.just(monitor));
        when(instances.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
        when(instances.findByMonitor("m1")).thenReturn(Flux.just(
                instance("pod-a", HealthStatus.UP, NOW),
                instance("pod-b", HealthStatus.DOWN, NOW),
                instance("pod-c", HealthStatus.UP, NOW.minusSeconds(600)))); // silent: not live
        when(observation.observe(eq(monitor), any(), eq(NOW))).thenReturn(Mono.just(monitor));

        StepVerifier.create(useCase.report(podReport("pod-b", "DOWN", false)))
                .expectNext(monitor)
                .verifyComplete();

        ArgumentCaptor<HealthReport> report = ArgumentCaptor.forClass(HealthReport.class);
        verify(observation).observe(eq(monitor), report.capture(), eq(NOW));
        assertThat(report.getValue().status()).isEqualTo(HealthStatus.UP); // half the pods: still UP
        assertThat(report.getValue().message()).isEqualTo("1 of 2 pods UP (DOWN: pod-b)");
        assertThat(report.getValue().source()).isEqualTo(HealthSource.ROLLUP);
        verify(monitors, never()).save(any());
    }

    @Test
    void aLeavingInstanceIsKeptMarkedLeft() {
        HealthMonitor monitor = existing();
        when(monitors.findByTenantAndService("vmforge", "billing")).thenReturn(Mono.just(monitor));
        when(instances.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
        when(instances.findByMonitor("m1")).thenReturn(Flux.empty());
        when(observation.observe(eq(monitor), any(), eq(NOW))).thenReturn(Mono.just(monitor));

        StepVerifier.create(useCase.report(podReport("pod-a", "UP", true)))
                .expectNext(monitor)
                .verifyComplete();

        ArgumentCaptor<HealthInstance> saved = ArgumentCaptor.forClass(HealthInstance.class);
        verify(instances).save(saved.capture());
        assertThat(saved.getValue().left()).isTrue();
        ArgumentCaptor<HealthReport> report = ArgumentCaptor.forClass(HealthReport.class);
        verify(observation).observe(eq(monitor), report.capture(), eq(NOW));
        assertThat(report.getValue().status()).isEqualTo(HealthStatus.UNKNOWN);
    }

    @Test
    void aConcurrentUpdateIsRetriedWithAFreshMonitor() {
        HealthMonitor monitor = existing();
        when(monitors.findByTenantAndService("vmforge", "billing")).thenReturn(Mono.just(monitor));
        when(observation.observe(eq(monitor), any(), eq(NOW))).thenReturn(
                Mono.error(new ResponseStatusException(HttpStatus.CONFLICT, "modified concurrently")),
                Mono.just(monitor));

        StepVerifier.create(useCase.report(new HealthReportCommand("vmforge", "billing", "UP",
                        null, null, null, null, null)))
                .expectNext(monitor)
                .verifyComplete();
        verify(monitors, times(2)).findByTenantAndService("vmforge", "billing");
    }

    @Test
    void aPersistentConflictIsReturnedAfterTheRetries() {
        HealthMonitor monitor = existing();
        when(monitors.findByTenantAndService("vmforge", "billing")).thenReturn(Mono.just(monitor));
        when(observation.observe(eq(monitor), any(), eq(NOW))).thenReturn(
                Mono.error(new ResponseStatusException(HttpStatus.CONFLICT, "modified concurrently")));

        // virtual time: the pauses between attempts add up to seconds of real time otherwise
        StepVerifier.withVirtualTime(() -> useCase.report(new HealthReportCommand("vmforge", "billing", "UP",
                        null, null, null, null, null)))
                .expectSubscription()
                .thenAwait(Duration.ofMinutes(1))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.CONFLICT))
                .verify();
        verify(observation, times(HealthMonitorUseCase.REPORT_ATTEMPTS)).observe(eq(monitor), any(), eq(NOW));
    }

    @Test
    void conflictingReportsAreRetriedMoreThanThreeTimesWithAPauseInBetween() {
        HealthMonitor monitor = existing();
        when(monitors.findByTenantAndService("vmforge", "billing")).thenReturn(Mono.just(monitor));
        Mono<HealthMonitor> conflict = Mono.error(
                new ResponseStatusException(HttpStatus.CONFLICT, "modified concurrently"));
        // four pods got there first: the fifth attempt goes through
        when(observation.observe(eq(monitor), any(), eq(NOW))).thenReturn(
                conflict, conflict, conflict, conflict, Mono.just(monitor));

        StepVerifier.withVirtualTime(() -> useCase.report(new HealthReportCommand("vmforge", "billing", "UP",
                        null, null, null, null, null)))
                .expectSubscription()
                // the first retry is not immediate: a herd of pods must spread out
                .expectNoEvent(Duration.ofMillis(5))
                .thenAwait(Duration.ofMinutes(1))
                .expectNext(monitor)
                .verifyComplete();
        verify(observation, times(5)).observe(eq(monitor), any(), eq(NOW));
    }

    @Test
    void instancesListsAMonitorsPodsAnd404sForUnknownMonitors() {
        when(monitors.findById("m1")).thenReturn(Mono.just(existing()));
        when(instances.findByMonitor("m1")).thenReturn(Flux.just(instance("pod-a", HealthStatus.UP, NOW)));
        StepVerifier.create(useCase.instances("m1")).expectNextCount(1).verifyComplete();

        when(monitors.findById("nope")).thenReturn(Mono.empty());
        StepVerifier.create(useCase.instances("nope"))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.NOT_FOUND))
                .verify();
    }
}
