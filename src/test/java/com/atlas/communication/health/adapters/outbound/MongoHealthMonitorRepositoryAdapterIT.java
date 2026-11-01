package com.atlas.communication.health.adapters.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.data.mongo.DataMongoTest;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;
import org.springframework.data.mongodb.core.index.CompoundIndexDefinition;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.domain.ComponentHealth;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;

import reactor.test.StepVerifier;

@DataMongoTest
class MongoHealthMonitorRepositoryAdapterIT {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");
    private static final HealthMonitor.Policy POLICY = new HealthMonitor.Policy("health-monitor",
            15, 2000, 3, 1, Severity.CRITICAL, Severity.INFO, Audience.INTERNAL, 90);

    @Autowired
    private HealthMonitorMongoRepository repository;
    @Autowired
    private ReactiveMongoTemplate template;

    private MongoHealthMonitorRepositoryAdapter adapter;

    @BeforeEach
    void setUp() {
        adapter = new MongoHealthMonitorRepositoryAdapter(repository);
        // the entity's @CompoundIndex is created on first use in the app; make it explicit here
        template.indexOps(HealthMonitorDocument.class).ensureIndex(new CompoundIndexDefinition(
                new org.bson.Document("tenantId", 1).append("service", 1))
                .named("monitor_tenant_service_idx").unique()).block();
        repository.deleteAll().block();
    }

    private static HealthMonitor monitor(String id, String tenant, String service, String url) {
        return HealthMonitor.create(id, tenant, service, url, POLICY, NOW);
    }

    @Test
    void roundTripsPolicyAndStateIncludingTheOpenNotice() {
        HealthReport report = new HealthReport(HealthStatus.DOWN,
                List.of(new ComponentHealth("db", HealthStatus.DOWN, "error=refused")),
                "HTTP 503", HealthSource.PROBE, NOW);
        HealthMonitor observed = monitor("m1", "vmforge", "vm-api", "http://vm-api/actuator/health")
                .evaluate(report, NOW).monitor()
                .withOpen("c1", HealthStatus.DOWN, report.signature());

        HealthMonitor saved = adapter.save(observed).block();
        assertThat(saved.version()).isNotNull();

        HealthMonitor found = adapter.findById("m1").block();
        assertThat(found.tenantId()).isEqualTo("vmforge");
        assertThat(found.url()).isEqualTo("http://vm-api/actuator/health");
        assertThat(found.policy()).isEqualTo(POLICY);
        assertThat(found.state().lastStatus()).isEqualTo(HealthStatus.DOWN);
        assertThat(found.state().lastProbeAt()).isEqualTo(NOW);
        assertThat(found.state().unhealthyStreak()).isEqualTo(1);
        assertThat(found.state().openCommunicationId()).isEqualTo("c1");
        assertThat(found.state().openStatus()).isEqualTo(HealthStatus.DOWN);
        assertThat(found.state().openSignature()).isEqualTo("DOWN[db=DOWN]");
        assertThat(found.state().incidents()).isEqualTo(1);
        assertThat(found.createdAt()).isEqualTo(NOW);
    }

    @Test
    void pushOnlyMonitorRoundTripsWithNullUrl() {
        adapter.save(monitor("m2", "vmforge", "billing", null)).block();
        HealthMonitor found = adapter.findByTenantAndService("vmforge", "billing").block();
        assertThat(found.url()).isNull();
        assertThat(found.pushOnly()).isTrue();
        assertThat(found.state()).isEqualTo(HealthMonitor.State.INITIAL);
    }

    @Test
    void oneMonitorPerTenantAndService() {
        adapter.save(monitor("m1", "vmforge", "vm-api", null)).block();
        StepVerifier.create(adapter.save(monitor("m2", "vmforge", "vm-api", null)))
                .expectErrorSatisfies(ex -> assertThat(ex)
                        .isInstanceOf(ResponseStatusException.class)
                        .hasMessageContaining("already exists"))
                .verify();
        assertThat(adapter.save(monitor("m3", "otherpod", "vm-api", null)).block()).isNotNull();
    }

    @Test
    void staleVersionIsConflict() {
        HealthMonitor saved = adapter.save(monitor("m1", "vmforge", "vm-api", null)).block();
        adapter.save(saved.withOpen("c1", HealthStatus.DOWN, "DOWN[]")).block();
        StepVerifier.create(adapter.save(saved.withOpen("c2", HealthStatus.DOWN, "DOWN[]")))
                .expectErrorSatisfies(ex -> assertThat(ex)
                        .isInstanceOf(ResponseStatusException.class)
                        .hasMessageContaining("modified concurrently"))
                .verify();
        assertThat(adapter.findById("m1").block().state().openCommunicationId()).isEqualTo("c1");
    }

    @Test
    void findAllFiltersByTenantWhenAsked() {
        adapter.save(monitor("a", "vmforge", "a", null)).block();
        adapter.save(monitor("b", "vmforge", "b", null)).block();
        adapter.save(monitor("c", "otherpod", "c", null)).block();

        assertThat(adapter.findAll(null).map(HealthMonitor::id).collectList().block())
                .containsExactlyInAnyOrder("a", "b", "c");
        assertThat(adapter.findAll("vmforge").map(HealthMonitor::id).collectList().block())
                .containsExactlyInAnyOrder("a", "b");
        assertThat(adapter.findByTenantAndService("vmforge", "zzz").blockOptional()).isEmpty();
    }

    @Test
    void deleteReportsWhetherDocumentExisted() {
        adapter.save(monitor("m1", "vmforge", "vm-api", null)).block();
        assertThat(adapter.deleteById("m1").block()).isTrue();
        assertThat(adapter.deleteById("m1").block()).isFalse();
    }
}
