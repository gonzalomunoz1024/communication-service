package com.atlas.communication.health.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

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
import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.domain.ComponentHealth;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;
import com.atlas.communication.health.ports.outbound.HealthProbePort;
import com.atlas.communication.publishing.application.PublishingUseCase;
import com.atlas.communication.publishing.domain.CreateCommunicationCommand;
import com.atlas.communication.publishing.domain.RetireRequest;
import com.atlas.communication.publishing.domain.UpdateCommunicationCommand;

import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class HealthObservationUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    /** Thresholds of 1 so every observation is decisive; debouncing is covered by HealthMonitorTest. */
    private static final HealthMonitor.Policy POLICY = new HealthMonitor.Policy("vmforge-sre",
            30, 5000, 1, 1, Severity.MAJOR, Severity.MINOR, Audience.INTERNAL, null, null);

    @Mock
    private HealthMonitorRepositoryPort monitors;
    @Mock
    private HealthProbePort probes;
    @Mock
    private PublishingUseCase publishing;

    private HealthObservationUseCase useCase;

    @BeforeEach
    void setUp() {
        useCase = new HealthObservationUseCase(monitors, probes, publishing);
    }

    private static HealthMonitor monitor() {
        return HealthMonitor.create("m1", "vmforge", "vm-api", "http://vm-api/actuator/health", POLICY, NOW);
    }

    private static HealthReport down(List<ComponentHealth> components) {
        return new HealthReport(HealthStatus.DOWN, components, "HTTP 503", HealthSource.PROBE, NOW);
    }

    private static ComponentHealth failing(String name) {
        return new ComponentHealth(name, HealthStatus.DOWN, null);
    }

    private static HealthMonitor openDown(String communicationId, String signature) {
        return monitor().evaluate(down(List.of()), NOW).monitor()
                .withOpen(communicationId, HealthStatus.DOWN, signature);
    }

    private static Communication communication(String id, CommunicationStatus status, long version) {
        Communication c = Communication.create(id, "vmforge", "vmforge-sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "vm-api is down", "body", List.of("vm-api"), null, false,
                null, null, null, "health:m1:1", NOW);
        Communication versioned = new Communication(c.id(), c.tenantId(), c.publisher(), c.type(),
                c.severity(), c.title(), c.body(), c.affectedServices(), c.audience(), c.status(),
                c.startsAt(), c.endsAt(), c.expiresAt(), c.externalRef(), c.ticket(), c.createdAt(),
                c.updatedAt(), version, c.history());
        return status == CommunicationStatus.ACTIVE ? versioned
                : versioned.withStatus(status, "admin", NOW);
    }

    private void saveReturnsArgument() {
        when(monitors.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
    }

    @Test
    void openClaimsTheMonitorBeforePublishingAnOutage() {
        saveReturnsArgument();
        when(publishing.create(anyString(), any())).thenAnswer(inv ->
                Mono.just(communication(inv.getArgument(0), CommunicationStatus.ACTIVE, 0)));

        StepVerifier.create(useCase.observe(monitor(), down(List.of(failing("db"))), NOW))
                .assertNext(m -> {
                    assertThat(m.state().hasOpen()).isTrue();
                    assertThat(m.state().openStatus()).isEqualTo(HealthStatus.DOWN);
                    assertThat(m.state().openSignature()).isEqualTo("DOWN[db=DOWN]");
                    assertThat(m.state().incidents()).isEqualTo(1);
                })
                .verifyComplete();

        InOrder order = inOrder(monitors, publishing);
        ArgumentCaptor<HealthMonitor> claimed = ArgumentCaptor.forClass(HealthMonitor.class);
        order.verify(monitors).save(claimed.capture());
        ArgumentCaptor<String> id = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<CreateCommunicationCommand> cmd = ArgumentCaptor.forClass(CreateCommunicationCommand.class);
        order.verify(publishing).create(id.capture(), cmd.capture());

        assertThat(id.getValue()).isEqualTo(claimed.getValue().state().openCommunicationId());
        assertThat(cmd.getValue().tenantId()).isEqualTo("vmforge");
        assertThat(cmd.getValue().publisher()).isEqualTo("vmforge-sre");
        assertThat(cmd.getValue().type()).isEqualTo(CommunicationType.OUTAGE);
        assertThat(cmd.getValue().severity()).isEqualTo(Severity.MAJOR);
        assertThat(cmd.getValue().title()).isEqualTo("vm-api is down");
        assertThat(cmd.getValue().body()).contains("\ndb: DOWN\n");
        assertThat(cmd.getValue().affectedServices()).containsExactly("vm-api");
        assertThat(cmd.getValue().audience()).isEqualTo(Audience.INTERNAL);
        assertThat(cmd.getValue().draft()).isFalse();
        assertThat(cmd.getValue().externalRef()).isEqualTo("health:m1:1");
    }

    @Test
    void lostClaimRacePublishesNothing() {
        when(monitors.save(any())).thenReturn(Mono.error(
                new ResponseStatusException(HttpStatus.CONFLICT, "modified concurrently")));

        StepVerifier.create(useCase.observe(monitor(), down(List.of()), NOW))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.CONFLICT))
                .verify();
        verify(publishing, never()).create(anyString(), any());
    }

    @Test
    void publishFailureReleasesTheClaim() {
        saveReturnsArgument();
        when(publishing.create(anyString(), any())).thenReturn(Mono.error(new IllegalStateException("store down")));

        StepVerifier.create(useCase.observe(monitor(), down(List.of()), NOW))
                .expectError(IllegalStateException.class)
                .verify();

        ArgumentCaptor<HealthMonitor> saved = ArgumentCaptor.forClass(HealthMonitor.class);
        verify(monitors, times(2)).save(saved.capture());
        assertThat(saved.getAllValues().get(0).state().hasOpen()).isTrue();
        assertThat(saved.getAllValues().get(1).state().hasOpen()).isFalse();
    }

    @Test
    void recoveryRetiresTheNoticeWithANote() {
        saveReturnsArgument();
        when(publishing.retire(eq("c1"), any())).thenReturn(
                Mono.just(communication("c1", CommunicationStatus.RETIRED, 1)));

        HealthReport up = HealthReport.of(HealthStatus.UP, "HTTP 200", HealthSource.PROBE, NOW);
        StepVerifier.create(useCase.observe(openDown("c1", "DOWN[]"), up, NOW))
                .assertNext(m -> {
                    assertThat(m.state().hasOpen()).isFalse();
                    assertThat(m.state().lastStatus()).isEqualTo(HealthStatus.UP);
                })
                .verifyComplete();

        ArgumentCaptor<RetireRequest> request = ArgumentCaptor.forClass(RetireRequest.class);
        verify(publishing).retire(eq("c1"), request.capture());
        assertThat(request.getValue().actor()).as("the monitor's publisher").isEqualTo("vmforge-sre");
        assertThat(request.getValue().note()).isEqualTo("recovered: UP (HTTP 200)");
        verify(publishing, never()).create(anyString(), any());
    }

    @Test
    void recoveryToleratesANoticeThatIsAlreadyGone() {
        saveReturnsArgument();
        when(publishing.retire(eq("c1"), any())).thenReturn(Mono.error(
                new ResponseStatusException(HttpStatus.NOT_FOUND, "gone")));

        HealthReport up = HealthReport.of(HealthStatus.UP, null, HealthSource.PROBE, NOW);
        StepVerifier.create(useCase.observe(openDown("c1", "DOWN[]"), up, NOW))
                .assertNext(m -> assertThat(m.state().hasOpen()).isFalse())
                .verifyComplete();
    }

    @Test
    void newFailingComponentsUpdateTheOpenNoticeInPlace() {
        saveReturnsArgument();
        when(publishing.get("c1")).thenReturn(Mono.just(communication("c1", CommunicationStatus.ACTIVE, 3)));
        when(publishing.update(eq("c1"), any())).thenReturn(
                Mono.just(communication("c1", CommunicationStatus.ACTIVE, 4)));

        HealthReport report = down(List.of(failing("db"), failing("redis")));
        StepVerifier.create(useCase.observe(openDown("c1", "DOWN[db=DOWN]"), report, NOW))
                .assertNext(m -> {
                    assertThat(m.state().openCommunicationId()).isEqualTo("c1");
                    assertThat(m.state().openSignature()).isEqualTo("DOWN[db=DOWN,redis=DOWN]");
                })
                .verifyComplete();

        ArgumentCaptor<UpdateCommunicationCommand> cmd = ArgumentCaptor.forClass(UpdateCommunicationCommand.class);
        verify(publishing).update(eq("c1"), cmd.capture());
        assertThat(cmd.getValue().expectedVersion()).isEqualTo(3L);
        assertThat(cmd.getValue().actor()).as("the monitor's publisher").isEqualTo("vmforge-sre");
        assertThat(cmd.getValue().severity()).isEqualTo(Severity.MAJOR);
        assertThat(cmd.getValue().body()).contains("\nredis: DOWN\n");
        verify(publishing, never()).create(anyString(), any());
    }

    @Test
    void operatorRetiredNoticeIsRespectedAndStateCleared() {
        saveReturnsArgument();
        when(publishing.get("c1")).thenReturn(Mono.just(communication("c1", CommunicationStatus.RETIRED, 3)));

        HealthReport report = down(List.of(failing("db")));
        StepVerifier.create(useCase.observe(openDown("c1", "DOWN[]"), report, NOW))
                .assertNext(m -> {
                    assertThat(m.state().hasOpen()).isFalse();
                    // the observation that noticed the retire is itself failing: the new count starts at 1
                    assertThat(m.state().unhealthyStreak()).isEqualTo(1);
                })
                .verifyComplete();
        verify(publishing, never()).update(anyString(), any());
    }

    @Test
    void operatorRetiredNoticeIsNoticedEvenWhenTheFailingSetIsUnchanged() {
        saveReturnsArgument();
        when(publishing.get("c1")).thenReturn(Mono.just(communication("c1", CommunicationStatus.RETIRED, 3)));

        // same failure as the open notice: nothing to update, but the notice is gone by hand
        HealthReport report = down(List.of(failing("db")));
        HealthMonitor cleared = useCase.observe(openDown("c1", report.signature()), report, NOW).block();
        assertThat(cleared).isNotNull();
        assertThat(cleared.state().hasOpen()).isFalse();
        assertThat(cleared.state().unhealthyStreak()).isEqualTo(1); // this failing observation is the first of the new count
        verify(publishing, never()).update(anyString(), any());
        verify(publishing, never()).create(anyString(), any());

        // counting restarts: the next threshold crossing opens a fresh notice (incident #2)
        when(publishing.create(anyString(), any())).thenAnswer(inv ->
                Mono.just(communication(inv.getArgument(0), CommunicationStatus.ACTIVE, 0)));
        StepVerifier.create(useCase.observe(cleared, report, NOW))
                .assertNext(m -> {
                    assertThat(m.state().hasOpen()).isTrue();
                    assertThat(m.state().openCommunicationId()).isNotEqualTo("c1");
                    assertThat(m.state().incidents()).isEqualTo(2);
                })
                .verifyComplete();
    }

    /** Threshold 3: how many failing observations an operator's retire buys before the notice reopens. */
    private static final HealthMonitor.Policy POLICY3 = new HealthMonitor.Policy("vmforge-sre",
            30, 5000, 3, 1, Severity.MAJOR, Severity.MINOR, Audience.INTERNAL, null, null);

    @Test
    void afterAnOperatorsRetireTheNoticeReopensOnTheThresholdthFailingObservation() {
        saveReturnsArgument();
        HealthReport report = down(List.of(failing("db")));
        HealthMonitor open = HealthMonitor.create("m1", "vmforge", "vm-api", "http://vm-api/actuator/health", POLICY3, NOW);
        for (int i = 0; i < 3; i++) {
            open = open.evaluate(report, NOW).monitor();
        }
        open = open.withOpen("c1", HealthStatus.DOWN, report.signature());
        when(publishing.get("c1")).thenReturn(Mono.just(communication("c1", CommunicationStatus.RETIRED, 3)));

        // the first failing observation after the retire notices it and is the first of the new count
        HealthMonitor first = useCase.observe(open, report, NOW).block();
        assertThat(first).isNotNull();
        assertThat(first.state().hasOpen()).isFalse();
        assertThat(first.state().unhealthyStreak()).isEqualTo(1);

        // the second is still below the threshold
        HealthMonitor second = useCase.observe(first, report, NOW).block();
        assertThat(second).isNotNull();
        assertThat(second.state().hasOpen()).isFalse();
        assertThat(second.state().unhealthyStreak()).isEqualTo(2);
        verify(publishing, never()).create(anyString(), any());

        // the third (= failureThreshold) opens a fresh notice, incident #2: "counts again", not threshold + 1
        when(publishing.create(anyString(), any())).thenAnswer(inv ->
                Mono.just(communication(inv.getArgument(0), CommunicationStatus.ACTIVE, 0)));
        HealthMonitor third = useCase.observe(second, report, NOW).block();
        assertThat(third).isNotNull();
        assertThat(third.state().hasOpen()).isTrue();
        assertThat(third.state().incidents()).isEqualTo(2);
    }

    @Test
    void anOpenNoticeThatIsStillActiveIsLeftAloneWhenNothingChanged() {
        saveReturnsArgument();
        when(publishing.get("c1")).thenReturn(Mono.just(communication("c1", CommunicationStatus.ACTIVE, 3)));

        HealthReport report = down(List.of(failing("db")));
        StepVerifier.create(useCase.observe(openDown("c1", report.signature()), report, NOW))
                .assertNext(m -> {
                    assertThat(m.state().openCommunicationId()).isEqualTo("c1");
                    assertThat(m.state().unhealthyStreak()).isEqualTo(2);
                })
                .verifyComplete();
        verify(publishing, never()).update(anyString(), any());
        verify(publishing, never()).create(anyString(), any());
        verify(publishing, never()).retire(anyString(), any());
    }

    @Test
    void purgedNoticeIsRecreatedUnderTheClaimedId() {
        saveReturnsArgument();
        when(publishing.get("c1")).thenReturn(Mono.error(
                new ResponseStatusException(HttpStatus.NOT_FOUND, "purged")));
        when(publishing.create(eq("c1"), any())).thenReturn(
                Mono.just(communication("c1", CommunicationStatus.ACTIVE, 0)));

        StepVerifier.create(useCase.observe(openDown("c1", "DOWN[]"), down(List.of(failing("db"))), NOW))
                .assertNext(m -> assertThat(m.state().openSignature()).isEqualTo("DOWN[db=DOWN]"))
                .verifyComplete();
        verify(publishing).create(eq("c1"), any());
    }

    @Test
    void changeOfKindRetiresTheOldNoticeAndOpensANewOne() {
        saveReturnsArgument();
        when(publishing.retire(eq("c1"), any())).thenReturn(
                Mono.just(communication("c1", CommunicationStatus.RETIRED, 1)));
        when(publishing.create(anyString(), any())).thenAnswer(inv ->
                Mono.just(communication(inv.getArgument(0), CommunicationStatus.ACTIVE, 0)));

        HealthReport degraded = HealthReport.of(HealthStatus.DEGRADED, "WARN", HealthSource.PROBE, NOW);
        StepVerifier.create(useCase.observe(openDown("c1", "DOWN[]"), degraded, NOW))
                .assertNext(m -> {
                    assertThat(m.state().openCommunicationId()).isNotEqualTo("c1");
                    assertThat(m.state().openStatus()).isEqualTo(HealthStatus.DEGRADED);
                    assertThat(m.state().incidents()).isEqualTo(2);
                })
                .verifyComplete();

        ArgumentCaptor<RetireRequest> retire = ArgumentCaptor.forClass(RetireRequest.class);
        verify(publishing).retire(eq("c1"), retire.capture());
        assertThat(retire.getValue().note()).startsWith("reclassified as DEGRADED");
        assertThat(retire.getValue().actor()).as("the monitor's publisher").isEqualTo("vmforge-sre");
        ArgumentCaptor<CreateCommunicationCommand> cmd = ArgumentCaptor.forClass(CreateCommunicationCommand.class);
        verify(publishing).create(anyString(), cmd.capture());
        assertThat(cmd.getValue().type()).isEqualTo(CommunicationType.HEALTH);
        assertThat(cmd.getValue().severity()).isEqualTo(Severity.MINOR);
        assertThat(cmd.getValue().title()).isEqualTo("vm-api is degraded");
        assertThat(cmd.getValue().externalRef()).isEqualTo("health:m1:2");
    }

    @Test
    void aNoticeIsUpdatedAndRetiredUnderTheNameItWasPublishedWith() {
        // auto-registered from a sidecar's first report: the monitor publishes as health-sidecar, and
        // its later update and the recovery must be signed with that name too, not with a second one
        HealthMonitor.Policy sidecar = new HealthMonitor.Policy("health-sidecar", 30, 5000, 1, 1,
                Severity.MAJOR, Severity.MINOR, Audience.CUSTOMERS, 90, null);
        HealthMonitor monitor = HealthMonitor.create("m2", "podtest", "fake-app", null, sidecar, NOW);
        saveReturnsArgument();
        when(publishing.create(anyString(), any())).thenAnswer(inv ->
                Mono.just(communication(inv.getArgument(0), CommunicationStatus.ACTIVE, 0)));

        HealthMonitor open = useCase.observe(monitor, new HealthReport(HealthStatus.DOWN, List.of(failing("db")),
                "0 of 1 pod UP (DOWN: fake-app-1)", HealthSource.ROLLUP, NOW), NOW).block();
        assertThat(open).isNotNull();
        String id = open.state().openCommunicationId();
        when(publishing.get(id)).thenReturn(Mono.just(communication(id, CommunicationStatus.ACTIVE, 0)));
        when(publishing.update(eq(id), any())).thenReturn(Mono.just(communication(id, CommunicationStatus.ACTIVE, 1)));
        HealthMonitor updated = useCase.observe(open, new HealthReport(HealthStatus.DOWN,
                List.of(failing("db"), failing("redis")), "0 of 1 pod UP (DOWN: fake-app-1)",
                HealthSource.ROLLUP, NOW), NOW).block();
        assertThat(updated).isNotNull();
        when(publishing.retire(eq(id), any())).thenReturn(Mono.just(communication(id, CommunicationStatus.RETIRED, 2)));
        useCase.observe(updated, HealthReport.of(HealthStatus.UP, "1 of 1 pod UP", HealthSource.ROLLUP, NOW), NOW).block();

        ArgumentCaptor<CreateCommunicationCommand> created = ArgumentCaptor.forClass(CreateCommunicationCommand.class);
        verify(publishing).create(eq(id), created.capture());
        ArgumentCaptor<UpdateCommunicationCommand> update = ArgumentCaptor.forClass(UpdateCommunicationCommand.class);
        verify(publishing).update(eq(id), update.capture());
        ArgumentCaptor<RetireRequest> retire = ArgumentCaptor.forClass(RetireRequest.class);
        verify(publishing).retire(eq(id), retire.capture());
        assertThat(created.getValue().publisher()).isEqualTo("health-sidecar");
        assertThat(update.getValue().actor()).as("update actor").isEqualTo("health-sidecar");
        assertThat(retire.getValue().actor()).as("retire actor").isEqualTo("health-sidecar");
    }

    @Test
    void probeUsesTheMonitorsTimeoutAndAppliesTheResult() {
        saveReturnsArgument();
        when(probes.probe("http://vm-api/actuator/health", Duration.ofMillis(5000), NOW))
                .thenReturn(Mono.just(HealthReport.of(HealthStatus.UP, "HTTP 200", HealthSource.PROBE, NOW)));

        StepVerifier.create(useCase.probe(monitor(), NOW))
                .assertNext(m -> {
                    assertThat(m.state().lastStatus()).isEqualTo(HealthStatus.UP);
                    assertThat(m.state().lastProbeAt()).isEqualTo(NOW);
                })
                .verifyComplete();
        verify(publishing, never()).create(anyString(), any());
    }

    @Test
    void closeRetiresOnlyWhenSomethingIsOpen() {
        when(publishing.retire(eq("c1"), any())).thenReturn(
                Mono.just(communication("c1", CommunicationStatus.RETIRED, 1)));

        StepVerifier.create(useCase.close(openDown("c1", "DOWN[]"), "monitor deleted", NOW))
                .assertNext(m -> assertThat(m.state().hasOpen()).isFalse())
                .verifyComplete();
        StepVerifier.create(useCase.close(monitor(), "monitor deleted", NOW))
                .expectNextCount(1)
                .verifyComplete();
        verify(publishing, times(1)).retire(anyString(), any());
    }
}
