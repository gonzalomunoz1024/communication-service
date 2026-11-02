package com.atlas.communication.common.adapters.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.mongodb.test.autoconfigure.DataMongoTest;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationQuery;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.common.domain.TenantSummary;

import reactor.test.StepVerifier;

@DataMongoTest
class MongoCommunicationRepositoryAdapterIT {

    private static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");

    @Autowired
    private CommunicationMongoRepository repository;
    @Autowired
    private ReactiveMongoTemplate template;

    private MongoCommunicationRepositoryAdapter adapter;

    @BeforeEach
    void setUp() {
        adapter = new MongoCommunicationRepositoryAdapter(repository, template);
        adapter.ensureIndexes();
        repository.deleteAll().block();
    }

    private static Communication outage(String id, String tenant, String externalRef,
            Instant startsAt, Instant expiresAt) {
        return Communication.create(id, tenant, "sre", CommunicationType.OUTAGE, Severity.MAJOR,
                "outage " + id, "body", List.of("vm-api"), null, false,
                startsAt, null, expiresAt, externalRef, NOW);
    }

    @Test
    void roundTripsAllFields() {
        Communication saved = adapter.save(outage("c1", "vmforge", "INC1", NOW, NOW.plusSeconds(600)))
                .block();
        assertThat(saved.version()).isNotNull();

        Communication found = adapter.findById("c1").block();
        assertThat(found.tenantId()).isEqualTo("vmforge");
        assertThat(found.type()).isEqualTo(CommunicationType.OUTAGE);
        assertThat(found.severity()).isEqualTo(Severity.MAJOR);
        assertThat(found.affectedServices()).containsExactly("vm-api");
        assertThat(found.expiresAt()).isEqualTo(NOW.plusSeconds(600));
        assertThat(found.history()).hasSize(1);
    }

    @Test
    void duplicateExternalRefWithinTenantIsConflict() {
        adapter.save(outage("c1", "vmforge", "INC1", NOW, null)).block();
        StepVerifier.create(adapter.save(outage("c2", "vmforge", "INC1", NOW, null)))
                .expectErrorSatisfies(ex -> assertThat(ex)
                        .isInstanceOf(ResponseStatusException.class)
                        // names the holder and says the key is permanent, so nobody retires c1 hoping to free INC1
                        .hasMessageContaining("externalRef 'INC1' is already used by notice c1 in tenant vmforge")
                        .hasMessageContaining("permanent idempotency key")
                        .hasMessageContaining("INC1-2"))
                .verify();
        // same ref in another tenant is fine
        assertThat(adapter.save(outage("c3", "otherpod", "INC1", NOW, null)).block()).isNotNull();
    }

    @Test
    void theConflictSuggestsTheFirstFollowUpValueTheTenantDoesNotHoldYet() {
        adapter.save(outage("c1", "vmforge", "INC1", NOW, null)).block();
        adapter.save(outage("c2", "vmforge", "INC1-2", NOW, null)).block();
        adapter.save(outage("c3", "otherpod", "INC1-3", NOW, null)).block(); // another tenant's is no obstacle
        adapter.save(outage("c4", "vmforge", "CHG-2026", NOW, null)).block();

        // a third notice for one incident, sent with the incident's reference or with the second
        // notice's: both count on to the first value nobody in the tenant holds
        for (String reused : List.of("INC1", "INC1-2")) {
            StepVerifier.create(adapter.save(outage("c5", "vmforge", reused, NOW, null)))
                    .expectErrorSatisfies(ex -> {
                        assertThat(ex).as(reused).isInstanceOf(ResponseStatusException.class)
                                .hasMessageContaining("externalRef '" + reused + "' is already used by notice")
                                .hasMessageContaining("(for example INC1-3, which is still free)");
                        assertThat(((ResponseStatusException) ex).getBody().getProperties()).as(reused)
                                .containsExactly(Map.entry("suggestedExternalRef", "INC1-3"));
                    })
                    .verify();
        }
        // a number longer than two digits is part of the reference, not a follow-up counter
        StepVerifier.create(adapter.save(outage("c5", "vmforge", "CHG-2026", NOW, null)))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getBody().getProperties())
                        .containsExactly(Map.entry("suggestedExternalRef", "CHG-2026-2")))
                .verify();
        assertThat(adapter.save(outage("c5", "vmforge", "INC1-3", NOW, null)).block()).isNotNull();
    }

    @Test
    void pastFiftyTakenFollowUpValuesTheConflictSaysSoAndSuggestsNone() {
        adapter.save(outage("c1", "vmforge", "INC9", NOW, null)).block();
        for (int n = 2; n <= 51; n++) {
            adapter.save(outage("c" + n, "vmforge", "INC9-" + n, NOW, null)).block();
        }

        StepVerifier.create(adapter.save(outage("c99", "vmforge", "INC9", NOW, null)))
                .expectErrorSatisfies(ex -> {
                    assertThat(ex).isInstanceOf(ResponseStatusException.class)
                            .hasMessageContaining("externalRef 'INC9' is already used by notice c1 in tenant vmforge")
                            .hasMessageContaining("(INC9-2 to INC9-51 are taken as well)");
                    Map<String, Object> fields = ((ResponseStatusException) ex).getBody().getProperties();
                    assertThat(fields == null ? Map.of() : fields).doesNotContainKey("suggestedExternalRef");
                })
                .verify();
    }

    @Test
    void theExternalRefStaysTakenAfterItsHolderIsRetired() {
        Communication holder = adapter.save(outage("c1", "vmforge", "INC1", NOW, null)).block();
        assertThat(holder).isNotNull();
        adapter.save(holder.withStatus(CommunicationStatus.RETIRED, "ops", NOW.plusSeconds(60))).block();

        // the key is permanent: a follow-up needs its own value, and the 409 still names the holder
        StepVerifier.create(adapter.save(outage("c2", "vmforge", "INC1", NOW, null)))
                .expectErrorSatisfies(ex -> assertThat(ex)
                        .isInstanceOf(ResponseStatusException.class)
                        .hasMessageContaining("already used by notice c1"))
                .verify();
        assertThat(adapter.save(outage("c2", "vmforge", "INC1-2", NOW, null)).block()).isNotNull();
    }

    @Test
    void staleVersionIsConflict() {
        Communication saved = adapter.save(outage("c1", "vmforge", null, NOW, null)).block();
        adapter.save(saved.withContent(null, "first", null, null, null, null, null, null, "a", NOW))
                .block();
        StepVerifier.create(adapter.save(
                        saved.withContent(null, "second", null, null, null, null, null, null, "b", NOW)))
                .expectErrorSatisfies(ex -> assertThat(ex)
                        .isInstanceOf(ResponseStatusException.class)
                        .hasMessageContaining("modified concurrently"))
                .verify();
    }

    @Test
    void visibilityPredicateFiltersByTimeNotStoredStatus() {
        // live now
        adapter.save(outage("live", "vmforge", null, NOW.minusSeconds(60), NOW.plusSeconds(600))).block();
        // expired by time but stored status still ACTIVE (sweeper hasn't run)
        adapter.save(outage("stale", "vmforge", null, NOW.minusSeconds(600), NOW.minusSeconds(60))).block();
        // scheduled future outage (not maintenance) — hidden
        adapter.save(outage("future", "vmforge", null, NOW.plusSeconds(600), null)).block();
        // upcoming maintenance inside window — shown
        adapter.save(Communication.create("maint", "vmforge", "sre", CommunicationType.MAINTENANCE,
                Severity.INFO, "upgrade", null, List.of(), null, false,
                NOW.plusSeconds(3600), NOW.plusSeconds(7200), null, null, NOW)).block();
        // other tenant — hidden
        adapter.save(outage("other", "otherpod", null, NOW.minusSeconds(60), null)).block();

        CommunicationQuery query = CommunicationQuery.visibleAt("vmforge", NOW,
                NOW.plusSeconds(86400), null, null, null, null, 0, 20);
        List<String> ids = adapter.query(query).map(Communication::id).collectList().block();
        assertThat(ids).containsExactlyInAnyOrder("live", "maint");
        assertThat(adapter.count(query).block()).isEqualTo(2);
    }

    @Test
    void sortsBySeverityThenRecency() {
        adapter.save(outage("minor", "vmforge", null, NOW.minusSeconds(10), null)
                .withContent(Severity.MINOR, null, null, null, null, null, null, null, "a", NOW)).block();
        adapter.save(outage("critical", "vmforge", null, NOW.minusSeconds(60), null)
                .withContent(Severity.CRITICAL, null, null, null, null, null, null, null, "a", NOW)).block();

        List<String> ids = adapter.query(CommunicationQuery.visibleAt("vmforge", NOW, null,
                null, null, null, null, 0, 20)).map(Communication::id).collectList().block();
        assertThat(ids).containsExactly("critical", "minor");
    }

    @Test
    void sweeperScansFindDueDocuments() {
        adapter.save(outage("due", "vmforge", null, NOW.minusSeconds(600), NOW.minusSeconds(60))).block();
        adapter.save(outage("notdue", "vmforge", null, NOW.minusSeconds(600), NOW.plusSeconds(600))).block();
        adapter.save(Communication.create("sched", "vmforge", "sre", CommunicationType.MAINTENANCE,
                Severity.INFO, "upgrade", null, List.of(), null, false,
                NOW.minusSeconds(30), NOW.plusSeconds(7200), null, null, NOW.minusSeconds(60))).block();

        assertThat(adapter.dueForExpiry(NOW).map(Communication::id).collectList().block())
                .containsExactly("due");
        assertThat(adapter.dueForActivation(NOW).map(Communication::id).collectList().block())
                .containsExactly("sched");
    }

    @Test
    void summarizesTenants() {
        adapter.save(outage("a1", "vmforge", null, NOW, null)).block();
        adapter.save(outage("a2", "vmforge", null, NOW.plusSeconds(600), null)).block();
        adapter.save(outage("b1", "otherpod", null, NOW, null)).block();

        List<TenantSummary> summaries = adapter.summarizeTenants().collectList().block();
        assertThat(summaries).hasSize(2);
        TenantSummary vmforge = summaries.stream()
                .filter(s -> s.tenantId().equals("vmforge")).findFirst().orElseThrow();
        assertThat(vmforge.total()).isEqualTo(2);
        assertThat(vmforge.counts()).containsEntry(CommunicationStatus.ACTIVE, 1L)
                .containsEntry(CommunicationStatus.SCHEDULED, 1L);
    }

    @Test
    void deleteReportsWhetherDocumentExisted() {
        adapter.save(outage("c1", "vmforge", null, NOW, null)).block();
        assertThat(adapter.deleteById("c1").block()).isTrue();
        assertThat(adapter.deleteById("c1").block()).isFalse();
    }
}
