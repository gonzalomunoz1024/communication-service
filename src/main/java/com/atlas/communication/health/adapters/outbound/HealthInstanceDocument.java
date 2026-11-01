package com.atlas.communication.health.adapters.outbound;

import java.time.Instant;
import java.util.List;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import com.atlas.communication.health.domain.ComponentHealth;
import com.atlas.communication.health.domain.HealthInstance;
import com.atlas.communication.health.domain.HealthStatus;

/**
 * Mongo mapping of {@link HealthInstance}. The id is {@code monitorId:instanceId} so a save is
 * an upsert, and the TTL index on {@code lastSeenAt} garbage-collects instances nobody has
 * heard from in a day (a clean shutdown keeps its record, marked {@code left}, until then).
 */
@Document("health_instances")
@CompoundIndex(name = "instance_monitor_idx", def = "{'monitorId': 1, 'instanceId': 1}")
public class HealthInstanceDocument {

    /** Seconds an instance record outlives its last report. */
    public static final int TTL_SECONDS = 24 * 60 * 60;

    @Id
    String id;
    String monitorId;
    String instanceId;
    HealthStatus status;
    List<ComponentHealth> components;
    String message;
    String namespace;
    String node;
    String cluster;
    String version;
    String sidecar;
    boolean left;
    @Indexed(name = "instance_ttl_idx", expireAfter = "1d")
    Instant lastSeenAt;

    public static String idOf(String monitorId, String instanceId) {
        return monitorId + ":" + instanceId;
    }

    public static HealthInstanceDocument fromDomain(HealthInstance i) {
        HealthInstanceDocument doc = new HealthInstanceDocument();
        doc.id = idOf(i.monitorId(), i.instanceId());
        doc.monitorId = i.monitorId();
        doc.instanceId = i.instanceId();
        doc.status = i.status();
        doc.components = i.components();
        doc.message = i.message();
        doc.namespace = i.namespace();
        doc.node = i.node();
        doc.cluster = i.cluster();
        doc.version = i.version();
        doc.sidecar = i.sidecar();
        doc.left = i.left();
        doc.lastSeenAt = i.lastSeenAt();
        return doc;
    }

    public HealthInstance toDomain() {
        return new HealthInstance(monitorId, instanceId, status, components, message, namespace, node,
                cluster, version, sidecar, left, lastSeenAt);
    }
}
