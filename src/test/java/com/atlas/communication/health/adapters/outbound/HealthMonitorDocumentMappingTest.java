package com.atlas.communication.health.adapters.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.bson.Document;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.convert.MappingMongoConverter;
import org.springframework.data.mongodb.core.convert.MongoCustomConversions;
import org.springframework.data.mongodb.core.convert.NoOpDbRefResolver;
import org.springframework.data.mongodb.core.mapping.MongoMappingContext;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.health.domain.ComponentHealth;
import com.atlas.communication.health.domain.HealthMonitor;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;

/**
 * Pins the Spring Data mapping of the monitor document (nested policy/state records, enums,
 * nullable fields) without a database, so a mapping regression fails fast in the unit suite.
 */
class HealthMonitorDocumentMappingTest {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    private final MappingMongoConverter converter = converter();

    /** The converter as Spring Boot wires it: custom conversions registered so Instant is a simple type. */
    private static MappingMongoConverter converter() {
        MongoCustomConversions conversions = new MongoCustomConversions(List.of());
        MongoMappingContext context = new MongoMappingContext();
        context.setSimpleTypeHolder(conversions.getSimpleTypeHolder());
        context.afterPropertiesSet();
        MappingMongoConverter converter = new MappingMongoConverter(NoOpDbRefResolver.INSTANCE, context);
        converter.setCustomConversions(conversions);
        converter.afterPropertiesSet();
        return converter;
    }

    @Test
    void nestedRecordsAndEnumsSurviveWriteAndRead() {
        HealthMonitor.Policy policy = new HealthMonitor.Policy("health-monitor", 15, 2000, 3, 1,
                Severity.CRITICAL, Severity.INFO, Audience.INTERNAL, 90);
        HealthReport report = new HealthReport(HealthStatus.DOWN,
                List.of(new ComponentHealth("db", HealthStatus.DOWN, "error=refused")),
                "HTTP 503", HealthSource.PROBE, NOW);
        HealthMonitor monitor = HealthMonitor.create("m1", "vmforge", "vm-api",
                        "http://vm-api/actuator/health", policy, NOW)
                .evaluate(report, NOW).monitor()
                .withOpen("c1", HealthStatus.DOWN, report.signature());

        Document bson = new Document();
        converter.write(HealthMonitorDocument.fromDomain(monitor), bson);
        assertThat(bson.getString("tenantId")).isEqualTo("vmforge");
        assertThat(bson.get("policy", Document.class).getString("downSeverity")).isEqualTo("CRITICAL");
        assertThat(bson.get("state", Document.class).getString("openSignature")).isEqualTo("DOWN[db=DOWN]");

        HealthMonitor back = converter.read(HealthMonitorDocument.class, bson).toDomain();
        assertThat(back.policy()).isEqualTo(policy);
        assertThat(back.state()).isEqualTo(monitor.state());
        assertThat(back.url()).isEqualTo(monitor.url());
        assertThat(back.createdAt()).isEqualTo(NOW);
    }

    @Test
    void pushOnlyMonitorWithInitialStateRoundTrips() {
        HealthMonitor monitor = HealthMonitor.create("m2", "vmforge", "billing", null,
                new HealthMonitor.Policy("svc", 30, 5000, 2, 2, Severity.MAJOR, Severity.MINOR,
                        Audience.CUSTOMERS, null), NOW);
        Document bson = new Document();
        converter.write(HealthMonitorDocument.fromDomain(monitor), bson);
        HealthMonitor back = converter.read(HealthMonitorDocument.class, bson).toDomain();
        assertThat(back.url()).isNull();
        assertThat(back.policy().staleAfterSeconds()).isNull();
        assertThat(back.state()).isEqualTo(HealthMonitor.State.INITIAL);
    }
}
