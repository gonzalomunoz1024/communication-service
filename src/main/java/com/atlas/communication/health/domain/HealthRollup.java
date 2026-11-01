package com.atlas.communication.health.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * One service status from many instance reports, computed before the monitor's debounce runs.
 *
 * <p>Instances heard from within the staleness window are live; live instances other than
 * UNKNOWN ones (still starting) are tallied. The rules, in order:
 * <ul>
 * <li>nothing tallied: UNKNOWN (no information; the monitor ignores it)</li>
 * <li>every tallied instance UP: UP</li>
 * <li>no instance UP: DOWN, or DEGRADED if any instance is DEGRADED (still serving in part)</li>
 * <li>some UP: DEGRADED if any instance reports a failing dependency or fewer than
 * {@code minHealthyPercent} of the tallied instances are UP; otherwise UP, because readiness
 * already keeps callers away from the bad pods</li>
 * </ul>
 */
public record HealthRollup(
        HealthStatus status,
        int live,
        int tallied,
        int up,
        int degraded,
        int down,
        List<ComponentHealth> failing,
        List<String> unhealthy,
        String message) {

    /** Share of live pods that must be UP for the service to count as UP. */
    public static final int DEFAULT_MIN_HEALTHY_PERCENT = 50;

    /** Pod names listed in a message before "+n more". */
    static final int NAMES_MAX = 5;

    public static HealthRollup of(List<HealthInstance> instances, int staleAfterSeconds,
            Integer minHealthyPercent, Instant now) {
        int threshold = minHealthyPercent == null ? DEFAULT_MIN_HEALTHY_PERCENT : minHealthyPercent;
        List<HealthInstance> live = instances.stream()
                .filter(i -> i.live(now, staleAfterSeconds))
                .sorted((a, b) -> a.instanceId().compareTo(b.instanceId()))
                .toList();
        List<HealthInstance> tallied = live.stream()
                .filter(i -> i.status() != HealthStatus.UNKNOWN)
                .toList();
        int up = (int) tallied.stream().filter(i -> i.status() == HealthStatus.UP).count();
        int degraded = (int) tallied.stream().filter(i -> i.status() == HealthStatus.DEGRADED).count();
        int down = tallied.size() - up - degraded;

        HealthStatus status;
        if (tallied.isEmpty()) {
            status = HealthStatus.UNKNOWN;
        } else if (up == tallied.size()) {
            status = HealthStatus.UP;
        } else if (up == 0) {
            status = degraded > 0 ? HealthStatus.DEGRADED : HealthStatus.DOWN;
        } else if (degraded > 0 || up * 100L < (long) threshold * tallied.size()) {
            status = HealthStatus.DEGRADED;
        } else {
            status = HealthStatus.UP;
        }

        List<ComponentHealth> failing = status == HealthStatus.UP ? List.of() : failingUnion(tallied);
        List<String> unhealthy = tallied.stream()
                .filter(i -> i.status() != HealthStatus.UP)
                .map(HealthInstance::instanceId)
                .toList();
        String message = message(status, live.size(), tallied, up);
        return new HealthRollup(status, live.size(), tallied.size(), up, degraded, down, failing,
                unhealthy, message);
    }

    /** The report the monitor's state machine evaluates. */
    public HealthReport toReport(Instant now) {
        return new HealthReport(status, failing, message, HealthSource.ROLLUP, now);
    }

    /** Failing components across instances, one entry per component name. */
    private static List<ComponentHealth> failingUnion(List<HealthInstance> instances) {
        Map<String, ComponentHealth> byName = new LinkedHashMap<>();
        for (HealthInstance instance : instances) {
            for (ComponentHealth component : instance.components()) {
                byName.putIfAbsent(component.name(), component);
            }
        }
        return new ArrayList<>(byName.values());
    }

    private static String message(HealthStatus status, int live, List<HealthInstance> tallied, int up) {
        if (live == 0) {
            return "no live pod reports";
        }
        if (tallied.isEmpty()) {
            return live + (live == 1 ? " pod starting" : " pods starting") + ", none reporting yet";
        }
        StringBuilder sb = new StringBuilder();
        sb.append(up).append(" of ").append(live).append(live == 1 ? " pod" : " pods").append(" UP");
        List<String> parts = new ArrayList<>();
        for (HealthStatus unhealthy : List.of(HealthStatus.DOWN, HealthStatus.DEGRADED)) {
            List<String> names = tallied.stream()
                    .filter(i -> i.status() == unhealthy)
                    .map(HealthInstance::instanceId)
                    .toList();
            if (!names.isEmpty()) {
                parts.add(unhealthy + ": " + names.stream().limit(NAMES_MAX).collect(Collectors.joining(", "))
                        + (names.size() > NAMES_MAX ? " +" + (names.size() - NAMES_MAX) + " more" : ""));
            }
        }
        int starting = live - tallied.size();
        if (starting > 0) {
            parts.add(starting + " starting");
        }
        if (!parts.isEmpty()) {
            sb.append(" (").append(String.join("; ", parts)).append(')');
        }
        return sb.toString();
    }
}
