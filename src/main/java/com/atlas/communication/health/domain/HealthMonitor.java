package com.atlas.communication.health.domain;

import java.net.URI;
import java.time.Instant;
import java.util.Locale;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;

/**
 * A monitored service and the debounced state machine that turns its health observations
 * into communications. Immutable like {@link com.atlas.communication.common.domain.Communication}.
 *
 * <p>A monitor with a {@code url} is probed on its interval (pull). A monitor without one is
 * push-only: the service reports its own health, and may optionally be declared DOWN when it
 * has been silent for {@code staleAfterSeconds}.
 *
 * <p>Debouncing: {@code failureThreshold} consecutive observations of the same unhealthy
 * status open (or re-classify) a notice; {@code recoveryThreshold} consecutive UP
 * observations resolve it. UNKNOWN observations carry no information and are ignored.
 */
public record HealthMonitor(
        String id,
        String tenantId,
        String service,
        String url,
        Policy policy,
        State state,
        Instant createdAt,
        Instant updatedAt,
        Long version) {

    public static final int MIN_INTERVAL_SECONDS = 5;
    public static final int MIN_TIMEOUT_MS = 100;
    public static final int MAX_TIMEOUT_MS = 60_000;

    /** How a monitor observes and what it publishes. */
    public record Policy(
            String publisher,
            int intervalSeconds,
            int timeoutMs,
            int failureThreshold,
            int recoveryThreshold,
            Severity downSeverity,
            Severity degradedSeverity,
            Audience audience,
            Integer staleAfterSeconds) {

        void validate() {
            require(publisher != null && !publisher.isBlank(), "publisher is required");
            require(intervalSeconds >= MIN_INTERVAL_SECONDS,
                    "intervalSeconds must be at least " + MIN_INTERVAL_SECONDS);
            require(timeoutMs >= MIN_TIMEOUT_MS && timeoutMs <= MAX_TIMEOUT_MS,
                    "timeoutMs must be between " + MIN_TIMEOUT_MS + " and " + MAX_TIMEOUT_MS);
            require(failureThreshold >= 1, "failureThreshold must be at least 1");
            require(recoveryThreshold >= 1, "recoveryThreshold must be at least 1");
            require(downSeverity != null, "downSeverity is required");
            require(downSeverity == null || downSeverity.atLeast(Severity.MINOR),
                    "downSeverity must be MINOR or higher (it publishes an OUTAGE)");
            require(degradedSeverity != null, "degradedSeverity is required");
            require(audience != null, "audience is required");
            require(staleAfterSeconds == null || staleAfterSeconds >= 1,
                    "staleAfterSeconds must be at least 1");
        }
    }

    /** Runtime state: streaks for debouncing plus the currently open notice. */
    public record State(
            HealthStatus lastStatus,
            Instant lastReportAt,
            Instant lastProbeAt,
            String lastSummary,
            int unhealthyStreak,
            int healthyStreak,
            String openCommunicationId,
            HealthStatus openStatus,
            String openSignature,
            int incidents) {

        public static final State INITIAL = new State(HealthStatus.UNKNOWN, null, null, null,
                0, 0, null, null, null, 0);

        public boolean hasOpen() {
            return openCommunicationId != null;
        }
    }

    public HealthMonitor {
        state = state == null ? State.INITIAL : state;
    }

    public static HealthMonitor create(String id, String tenantId, String service, String url,
            Policy policy, Instant now) {
        HealthMonitor monitor = new HealthMonitor(id, tenantId, service, normalizeUrl(url), policy,
                State.INITIAL, now, now, null);
        monitor.validateInvariants();
        return monitor;
    }

    public boolean pushOnly() {
        return url == null;
    }

    /** A probed monitor is due once its interval has elapsed since the last probe. */
    public boolean probeDue(Instant now) {
        if (url == null) {
            return false;
        }
        Instant last = state.lastProbeAt();
        return last == null || !last.plusSeconds(policy.intervalSeconds()).isAfter(now);
    }

    /**
     * A push-only monitor with a staleness window is stale once that window has elapsed since
     * the last real report (or since registration, if it never reported).
     */
    public boolean stale(Instant now) {
        if (url != null || policy.staleAfterSeconds() == null) {
            return false;
        }
        return !staleBaseline().plusSeconds(policy.staleAfterSeconds()).isAfter(now);
    }

    public Instant staleBaseline() {
        return state.lastReportAt() == null ? createdAt : state.lastReportAt();
    }

    /** Feeds one observation through the state machine; pure, no side effects. */
    public HealthEvaluation evaluate(HealthReport report, Instant now) {
        HealthStatus status = report.effectiveStatus();
        State s = state;
        Instant reportAt = report.source() == HealthSource.STALE ? s.lastReportAt() : report.observedAt();
        Instant probeAt = report.source() == HealthSource.PROBE ? now : s.lastProbeAt();
        String summary = report.summary();

        if (status == HealthStatus.UNKNOWN) {
            State next = new State(s.lastStatus(), reportAt, probeAt, summary,
                    s.unhealthyStreak(), s.healthyStreak(),
                    s.openCommunicationId(), s.openStatus(), s.openSignature(), s.incidents());
            return new HealthEvaluation(withState(next, now), HealthTransition.NONE);
        }
        if (status == HealthStatus.UP) {
            int healthy = s.healthyStreak() + 1;
            HealthTransition transition = s.hasOpen() && healthy >= policy.recoveryThreshold()
                    ? HealthTransition.RESOLVE : HealthTransition.NONE;
            State next = new State(status, reportAt, probeAt, summary, 0, healthy,
                    s.openCommunicationId(), s.openStatus(), s.openSignature(), s.incidents());
            return new HealthEvaluation(withState(next, now), transition);
        }
        int unhealthy = s.lastStatus() == status ? s.unhealthyStreak() + 1 : 1;
        HealthTransition transition = HealthTransition.NONE;
        if (unhealthy >= policy.failureThreshold()) {
            if (!s.hasOpen()) {
                transition = HealthTransition.OPEN;
            } else if (s.openStatus() != status) {
                transition = HealthTransition.REPLACE;
            } else if (!report.signature().equals(s.openSignature())) {
                transition = HealthTransition.UPDATE;
            }
        }
        State next = new State(status, reportAt, probeAt, summary, unhealthy, 0,
                s.openCommunicationId(), s.openStatus(), s.openSignature(), s.incidents());
        return new HealthEvaluation(withState(next, now), transition);
    }

    /** Records a newly claimed notice; bumps the incident counter used for externalRef. */
    public HealthMonitor withOpen(String communicationId, HealthStatus openStatus, String signature) {
        State s = state;
        return withState(new State(s.lastStatus(), s.lastReportAt(), s.lastProbeAt(), s.lastSummary(),
                s.unhealthyStreak(), s.healthyStreak(), communicationId, openStatus, signature,
                s.incidents() + 1), updatedAt);
    }

    public HealthMonitor withOpenSignature(String signature) {
        State s = state;
        return withState(new State(s.lastStatus(), s.lastReportAt(), s.lastProbeAt(), s.lastSummary(),
                s.unhealthyStreak(), s.healthyStreak(), s.openCommunicationId(), s.openStatus(),
                signature, s.incidents()), updatedAt);
    }

    /** Clears the open notice. Streaks are kept so a still-failing service re-opens on schedule. */
    public HealthMonitor withClosed() {
        State s = state;
        return withState(new State(s.lastStatus(), s.lastReportAt(), s.lastProbeAt(), s.lastSummary(),
                s.unhealthyStreak(), s.healthyStreak(), null, null, null, s.incidents()), updatedAt);
    }

    /** Clears the open notice and resets the failure streak (an operator closed it by hand). */
    public HealthMonitor withClosedByOperator() {
        State s = state;
        return withState(new State(s.lastStatus(), s.lastReportAt(), s.lastProbeAt(), s.lastSummary(),
                0, s.healthyStreak(), null, null, null, s.incidents()), updatedAt);
    }

    /** The idempotency key of the current incident's communication. */
    public String externalRef() {
        return "health:" + id + ":" + state.incidents();
    }

    private HealthMonitor withState(State next, Instant now) {
        return new HealthMonitor(id, tenantId, service, url, policy, next, createdAt, now, version);
    }

    public void validateInvariants() {
        require(tenantId != null && !tenantId.isBlank(), "tenantId is required");
        require(service != null && !service.isBlank(), "service is required");
        require(policy != null, "policy is required");
        policy.validate();
        if (url != null) {
            URI uri;
            try {
                uri = URI.create(url);
            } catch (IllegalArgumentException ex) {
                throw new IllegalArgumentException("url must be an absolute http(s) URL: " + url);
            }
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            require(uri.getHost() != null && (scheme.equals("http") || scheme.equals("https")),
                    "url must be an absolute http(s) URL: " + url);
        }
    }

    private static String normalizeUrl(String url) {
        return url == null || url.isBlank() ? null : url.trim();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalArgumentException(message);
        }
    }
}
