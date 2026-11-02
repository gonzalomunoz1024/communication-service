package com.atlas.communication.health.adapters.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.data.mongo.DataMongoTest;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.index.IndexInfo;

import com.atlas.communication.health.domain.ComponentHealth;
import com.atlas.communication.health.domain.HealthInstance;
import com.atlas.communication.health.domain.HealthStatus;

@DataMongoTest
class MongoHealthInstanceRepositoryAdapterIT {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    @Autowired
    private HealthInstanceMongoRepository repository;
    @Autowired
    private ReactiveMongoTemplate template;

    private MongoHealthInstanceRepositoryAdapter adapter;

    @BeforeEach
    void setUp() {
        adapter = new MongoHealthInstanceRepositoryAdapter(repository);
        // the entity's indexes are created on first use in the app; make them explicit here
        template.indexOps(HealthInstanceDocument.class).createIndex(new Index()
                .on("lastSeenAt", Sort.Direction.ASC)
                .named("instance_ttl_idx")
                .expire(HealthInstanceDocument.TTL_SECONDS)).block();
        repository.deleteAll().block();
    }

    private static HealthInstance instance(String monitorId, String pod, HealthStatus status, boolean left,
            Instant seen) {
        return new HealthInstance(monitorId, pod, status,
                List.of(new ComponentHealth("db", HealthStatus.DOWN, "error=refused")), "msg",
                "retail-billing", "worker-1", "ocp-east", "1.4.2", "1.0.0", left, seen);
    }

    @Test
    void saveReplacesTheSameInstanceAndRoundTripsEveryField() {
        adapter.save(instance("m1", "pod-a", HealthStatus.UP, false, NOW.minusSeconds(30))).block();
        adapter.save(instance("m1", "pod-a", HealthStatus.DOWN, false, NOW)).block();

        List<HealthInstance> found = adapter.findByMonitor("m1").collectList().block();
        assertThat(found).hasSize(1);
        HealthInstance pod = found.get(0);
        assertThat(pod.status()).isEqualTo(HealthStatus.DOWN);
        assertThat(pod.lastSeenAt()).isEqualTo(NOW);
        assertThat(pod.components()).containsExactly(new ComponentHealth("db", HealthStatus.DOWN, "error=refused"));
        assertThat(pod.cluster()).isEqualTo("ocp-east");
        assertThat(pod.sidecar()).isEqualTo("1.0.0");
        assertThat(pod.left()).isFalse();
    }

    @Test
    void findByMonitorIsScopedAndOrderedAndDeleteByMonitorClears() {
        adapter.save(instance("m1", "pod-b", HealthStatus.UP, false, NOW)).block();
        adapter.save(instance("m1", "pod-a", HealthStatus.UP, true, NOW)).block();
        adapter.save(instance("m2", "pod-a", HealthStatus.UP, false, NOW)).block();

        assertThat(adapter.findByMonitor("m1").map(HealthInstance::instanceId).collectList().block())
                .containsExactly("pod-a", "pod-b");
        assertThat(adapter.findByMonitor("m1").filter(HealthInstance::left).count().block()).isEqualTo(1L);

        adapter.deleteByMonitor("m1").block();
        assertThat(adapter.findByMonitor("m1").count().block()).isZero();
        assertThat(adapter.findByMonitor("m2").count().block()).isEqualTo(1L);
    }

    @Test
    void recordsExpireADayAfterTheyWereLastSeen() {
        List<IndexInfo> indexes = template.indexOps(HealthInstanceDocument.class).getIndexInfo()
                .collectList().block();
        assertThat(indexes).anySatisfy(index -> {
            assertThat(index.getName()).isEqualTo("instance_ttl_idx");
            assertThat(index.getExpireAfter()).hasValueSatisfying(ttl ->
                    assertThat(ttl.getSeconds()).isEqualTo(HealthInstanceDocument.TTL_SECONDS));
        });
    }
}
