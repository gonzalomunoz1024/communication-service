package com.atlas.communication.health.domain;

import java.time.Instant;
import java.util.List;
import java.util.Objects;

/**
 * The last word from one instance (pod) of a monitored service. {@code status} is the
 * instance's effective status (UP with failing components is DEGRADED) and {@code components}
 * lists only what was failing. An instance that said goodbye is kept with {@code left} set so
 * the sweep can tell "scaled to zero" from "all pods went silent"; a TTL on the store removes
 * old records eventually.
 */
public record HealthInstance(
        String monitorId,
        String instanceId,
        HealthStatus status,
        List<ComponentHealth> components,
        String message,
        String namespace,
        String node,
        String cluster,
        String version,
        String sidecar,
        boolean left,
        Instant lastSeenAt) {

    public HealthInstance {
        Objects.requireNonNull(monitorId, "monitorId");
        Objects.requireNonNull(instanceId, "instanceId");
        Objects.requireNonNull(lastSeenAt, "lastSeenAt");
        status = status == null ? HealthStatus.UNKNOWN : status;
        components = components == null ? List.of() : List.copyOf(components);
    }

    /** Records what an instance just reported. */
    public static HealthInstance from(String monitorId, ReportInstance instance, HealthReport report,
            Instant now) {
        return new HealthInstance(monitorId, instance.id(), report.effectiveStatus(), report.failing(),
                report.message(), instance.namespace(), instance.node(), instance.cluster(),
                instance.version(), instance.sidecar(), instance.leaving(), now);
    }

    /** Present and heard from within the staleness window. */
    public boolean live(Instant now, int staleAfterSeconds) {
        return !left && lastSeenAt.plusSeconds(staleAfterSeconds).isAfter(now);
    }
}
