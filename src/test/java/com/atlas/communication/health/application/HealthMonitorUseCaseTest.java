package com.atlas.communication.health.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
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
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthReportCommand;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.atlas.communication.health.domain.RegisterMonitorCommand;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class HealthMonitorUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    private static final HealthProperties PROPERTIES = new HealthProperties(5000,
            new HealthProperties.Defaults("health-monitor", 30, 5000, 2, 2, Severity.MAJOR,
                    Severity.MINOR, Audience.CUSTOMERS));

    @Mock
    private HealthMonitorRepositoryPort monitors;
    @Mock
    private HealthObservationUseCase observation;

    private HealthMonitorUseCase useCase;

    @BeforeEach
    void setUp() {
        useCase = new HealthMonitorUseCase(monitors, observation, PROPERTIES,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static RegisterMonitorCommand register(String url, Integer intervalSeconds) {
        return new RegisterMonitorCommand("vmforge", "vm-api", url, null, intervalSeconds, null,
                null, null, null, null, null, null);
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
                Map.of("redis", new ActuatorComponent("DOWN", null, null)), "cache lost", null, "billing-svc");
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
                        null, null, observedAt, null)))
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
                        null, null, null, null)))
                .expectNext(winner)
                .verifyComplete();
    }

    @Test
    void deleteClosesTheOpenNoticeBeforeRemovingTheMonitor() {
        HealthMonitor monitor = existing();
        when(monitors.findById("m1")).thenReturn(Mono.just(monitor));
        when(observation.close(monitor, "monitor deleted", NOW)).thenReturn(Mono.just(monitor));
        when(monitors.deleteById("m1")).thenReturn(Mono.just(true));

        StepVerifier.create(useCase.delete("m1")).verifyComplete();
        InOrder order = inOrder(observation, monitors);
        order.verify(observation).close(monitor, "monitor deleted", NOW);
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
}
