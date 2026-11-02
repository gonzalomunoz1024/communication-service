package com.atlas.communication.health.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.LogCapture;
import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.domain.HealthInstance;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.atlas.communication.health.ports.outbound.HealthInstanceRepositoryPort;
import com.atlas.communication.health.ports.outbound.HealthMonitorRepositoryPort;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class HealthSweepUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    /** What Spring Data hands the sweep once the driver gives up on an unreachable Mongo. */
    private static final String DRIVER_TIMEOUT = "Timed out while waiting for a server that matches"
            + " ReadPreferenceServerSelector{readPreference=primary}. Client view of cluster state is"
            + " {type=UNKNOWN, servers=[{address=localhost:27017, type=UNKNOWN, state=CONNECTING}]";
    private static final HealthProperties.Defaults DEFAULTS = new HealthProperties.Defaults(
            "health-monitor", 30, 5000, 2, 2, Severity.MAJOR, Severity.MINOR, Audience.CUSTOMERS, 50, 90);
    /** No startup grace, so the existing staleness tests see the sweep at work right away. */
    private static final HealthProperties PROPERTIES = new HealthProperties(5000, 0, 0.3, 2,
            Duration.ofHours(24), DEFAULTS);

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

    /** Matches a monitor by id, whatever its state (the sweep probes the monitor as claimed). */
    private static HealthMonitor withId(String id) {
        return argThat(m -> m != null && id.equals(m.id()));
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
        when(monitors.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0))); // every claim wins
        when(observation.probe(any(), eq(NOW))).thenAnswer(inv -> Mono.just(inv.getArgument(0)));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(2L).verifyComplete();
        // each due monitor is claimed first, then probed as claimed
        verify(observation).probe(due.withProbeClaimed(NOW), NOW);
        verify(observation).probe(alsoDue.withProbeClaimed(NOW), NOW);
        verify(observation, never()).probe(withId("recent"), any());
        verify(observation, never()).probe(withId("push"), any());
        verify(monitors, times(2)).save(any());
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
        assertThat(report.getValue().message()).isEqualTo("no health report received since 2026-11-01 11:58:00 UTC");
        verify(observation, never()).observe(eq(fresh), any(), any());
    }

    @Test
    void aFailingMonitorDoesNotStopTheSweep() {
        HealthMonitor broken = probed("broken", null);
        HealthMonitor fine = probed("fine", null);
        when(monitors.findAll(null)).thenReturn(Flux.just(broken, fine));
        when(monitors.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
        when(observation.probe(broken.withProbeClaimed(NOW), NOW)).thenReturn(Mono.error(new IllegalStateException("conflict")));
        when(observation.probe(fine.withProbeClaimed(NOW), NOW)).thenReturn(Mono.just(fine));

        try (LogCapture log = LogCapture.of(HealthSweepUseCase.class)) {
            StepVerifier.create(useCase.sweep(NOW)).expectNext(1L).verifyComplete();
            // anything but a lost version check is worth a warning
            List<ILoggingEvent> warnings = log.atLeast(Level.WARN);
            assertThat(warnings).hasSize(1);
            assertThat(warnings.get(0).getFormattedMessage()).startsWith("skipping monitor broken");
        }
    }

    // --- every instance of this service runs the sweep ---

    /** What the Mongo adapter turns a save with a stale version into (optimistic lock). */
    private static ResponseStatusException versionConflict(String id) {
        return new ResponseStatusException(HttpStatus.CONFLICT,
                "monitor " + id + " was modified concurrently; reload and retry");
    }

    @Test
    void twoInstancesSweepingTheSameDueMonitorProbeItOnceAndTheLoserStaysQuiet() {
        // both instances read the monitor in the same tick, before either wrote anything: the
        // first save of it wins, the second fails the version check like Mongo's optimistic lock
        HealthMonitor due = probed("slow-app", NOW.minusSeconds(30));
        when(monitors.findAll(null)).thenReturn(Flux.just(due));
        when(monitors.save(any()))
                .thenAnswer(inv -> Mono.just(inv.getArgument(0)))
                .thenReturn(Mono.error(versionConflict("slow-app")));
        when(observation.probe(any(), eq(NOW))).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
        HealthSweepUseCase otherInstance = new HealthSweepUseCase(monitors, instances, observation,
                PROPERTIES, Clock.fixed(NOW, ZoneOffset.UTC));

        try (LogCapture log = LogCapture.of(HealthSweepUseCase.class)) {
            Long first = useCase.sweep(NOW).block();
            Long second = otherInstance.sweep(NOW).block();

            verify(observation, times(1)).probe(any(), any());
            // the winner probes the monitor it claimed: its own save then checks the claim's version
            verify(observation).probe(argThat(m -> m != null && NOW.equals(m.state().lastProbeAt())), eq(NOW));
            assertThat(first).isEqualTo(1L);
            assertThat(second).as("the instance that lost the claim evaluated nothing").isZero();
            assertThat(log.atLeast(Level.WARN)).as("losing the race to another instance is not worth a warning")
                    .isEmpty();
            assertThat(log.events()).filteredOn(e -> e.getLevel() == Level.DEBUG)
                    .extracting(ILoggingEvent::getFormattedMessage)
                    .anySatisfy(message -> assertThat(message).contains("slow-app").contains("another instance"));
        }
    }

    @Test
    void emptySweepIsQuiet() {
        when(monitors.findAll(null)).thenReturn(Flux.empty());
        StepVerifier.create(useCase.sweep(NOW)).expectNext(0L).verifyComplete();
    }

    // --- the database is unreachable ---

    @Test
    void aSweepThatCannotReachTheDatabaseLogsOneWarningWithoutAStackTraceAndCarriesOn() {
        when(monitors.findAll(null)).thenReturn(Flux.error(new DataAccessResourceFailureException(DRIVER_TIMEOUT)));

        try (LogCapture log = LogCapture.of(HealthSweepUseCase.class)) {
            // the scheduled entry point: nothing escapes to Spring's scheduler (which would log
            // ERROR with a stack trace on every run) and the next tick runs as usual
            assertThatCode(() -> useCase.sweepScheduled()).doesNotThrowAnyException();

            List<ILoggingEvent> warnings = log.atLeast(Level.WARN);
            assertThat(warnings).hasSize(1);
            assertThat(warnings.get(0).getLevel()).isEqualTo(Level.WARN);
            assertThat(warnings.get(0).getFormattedMessage())
                    .isEqualTo("health sweep skipped: database unavailable: " + DRIVER_TIMEOUT);
            assertThat(warnings.get(0).getThrowableProxy()).as("stack trace stays at DEBUG").isNull();
            assertThat(log.events()).filteredOn(e -> e.getLevel() == Level.DEBUG && e.getThrowableProxy() != null)
                    .as("the stack trace is available at DEBUG").hasSize(1);
        }
    }

    @Test
    void aSweepFailingForAnotherReasonStillSurfaces() {
        when(monitors.findAll(null)).thenReturn(Flux.error(new IllegalStateException("a bug")));
        assertThatThrownBy(() -> useCase.sweepScheduled())
                .isInstanceOf(IllegalStateException.class).hasMessage("a bug");
    }

    // --- staleness guards ---

    @Test
    void silenceIsNotTrustedDuringTheStartupGrace() {
        HealthSweepUseCase justStarted = new HealthSweepUseCase(monitors, instances, observation,
                new HealthProperties(5000, 300_000, 0.3, 2, Duration.ofHours(24), DEFAULTS),
                Clock.fixed(NOW, ZoneOffset.UTC));
        HealthMonitor due = probed("due", null);
        when(monitors.findAll(null)).thenReturn(Flux.just(silent("silent"), due));
        when(monitors.save(any())).thenAnswer(inv -> Mono.just(inv.getArgument(0)));
        when(observation.probe(withId("due"), any())).thenReturn(Mono.just(due)); // probes are not affected

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

    // --- the valve forgets monitors that have been silent for longer than stale-forget-after ---

    /** A push-only monitor (staleness window 60 s) whose last report came {@code silentFor} ago. */
    private static HealthMonitor silentSince(String id, Duration silentFor) {
        Instant reportedAt = NOW.minus(silentFor);
        HealthMonitor m = HealthMonitor.create(id, "vmforge", id, null, policy(60), reportedAt.minusSeconds(3600));
        return m.evaluate(HealthReport.of(HealthStatus.UP, null, HealthSource.PUSH, reportedAt), reportedAt).monitor();
    }

    private static HealthMonitor reporting(String id) {
        return HealthMonitor.create(id, "vmforge", id, null, policy(60), NOW);
    }

    @Test
    void monitorsSilentForDaysDoNotKeepTheValvePausedForEveryoneElse() {
        // 14 abandoned monitors (decommissioned services, test monitors nobody deleted: silent for
        // two days) and one service that went quiet two minutes ago. Counted, they make 15 of 15
        // silent and nothing would ever be declared DOWN again in this database.
        List<HealthMonitor> all = new ArrayList<>();
        for (int i = 1; i <= 14; i++) {
            all.add(silentSince("old" + i, Duration.ofDays(2)));
        }
        HealthMonitor fresh = silentSince("fresh", Duration.ofMinutes(2));
        all.add(fresh);
        when(monitors.findAll(null)).thenReturn(Flux.fromIterable(all));
        when(instances.findByMonitor(anyString())).thenReturn(Flux.empty());
        when(observation.observe(eq(fresh), any(), eq(NOW))).thenReturn(Mono.just(fresh));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(1L).verifyComplete();

        ArgumentCaptor<HealthReport> report = ArgumentCaptor.forClass(HealthReport.class);
        verify(observation).observe(eq(fresh), report.capture(), eq(NOW));
        assertThat(report.getValue().status()).isEqualTo(HealthStatus.DOWN);
        verify(observation, never()).observe(argThat(m -> m.id().startsWith("old")), any(), any());
    }

    @Test
    void aForgottenMonitorIsLeftAloneEvenWhenSilenceIsTrusted() {
        // one monitor silent for three days among three healthy ones: 1 of 4 would be declared
        // DOWN every sweep (a notice for a service that no longer exists); forgotten, it is not
        // observed, not saved and not deleted
        HealthMonitor old = silentSince("old", Duration.ofDays(3));
        when(monitors.findAll(null)).thenReturn(Flux.just(old, reporting("f1"), reporting("f2"), reporting("f3")));
        // nothing asks about it once it is forgotten (lenient: these stubs document what must not happen)
        lenient().when(instances.findByMonitor("old")).thenReturn(Flux.empty());
        lenient().when(observation.observe(eq(old), any(), any())).thenReturn(Mono.just(old));

        StepVerifier.create(useCase.sweep(NOW)).expectNext(0L).verifyComplete();
        verify(observation, never()).observe(any(), any(), any());
        verify(monitors, never()).save(any());
        verify(monitors, never()).deleteById(any());
    }

    @Test
    void monitorsSilentForMinutesOrHoursStillCountTowardsTheValve() {
        // 3 of 5 went quiet inside the window (minutes to 23 hours): still an implausible share
        when(monitors.findAll(null)).thenReturn(Flux.just(
                silentSince("a", Duration.ofMinutes(5)), silentSince("b", Duration.ofMinutes(10)),
                silentSince("c", Duration.ofHours(23)), reporting("d"), reporting("e")));
        when(instances.findByMonitor(anyString())).thenReturn(Flux.empty());

        StepVerifier.create(useCase.sweep(NOW)).expectNext(0L).verifyComplete();
        verify(observation, never()).observe(any(), any(), any());
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
