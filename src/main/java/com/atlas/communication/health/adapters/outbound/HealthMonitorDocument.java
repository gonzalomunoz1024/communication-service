package com.atlas.communication.health.adapters.outbound;

import java.time.Instant;

import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import com.atlas.communication.health.domain.HealthMonitor;

/**
 * Mongo mapping of {@link HealthMonitor}. Policy and state are embedded; the unique
 * (tenantId, service) index makes one monitor per service, and {@code @Version} makes the
 * notice claim exclusive across nodes.
 */
@Document("health_monitors")
@CompoundIndex(name = "monitor_tenant_service_idx", def = "{'tenantId': 1, 'service': 1}", unique = true)
public class HealthMonitorDocument {

    @Id
    String id;
    String tenantId;
    String service;
    String url;
    HealthMonitor.Policy policy;
    HealthMonitor.State state;
    Instant createdAt;
    Instant updatedAt;
    @Version
    Long version;

    public static HealthMonitorDocument fromDomain(HealthMonitor m) {
        HealthMonitorDocument doc = new HealthMonitorDocument();
        doc.id = m.id();
        doc.tenantId = m.tenantId();
        doc.service = m.service();
        doc.url = m.url();
        doc.policy = m.policy();
        doc.state = m.state();
        doc.createdAt = m.createdAt();
        doc.updatedAt = m.updatedAt();
        doc.version = m.version();
        return doc;
    }

    public HealthMonitor toDomain() {
        return new HealthMonitor(id, tenantId, service, url, policy, state, createdAt, updatedAt, version);
    }
}
