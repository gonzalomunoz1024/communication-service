package com.atlas.communication.admin.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationQuery;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.common.domain.TenantSummary;
import com.atlas.communication.common.ports.outbound.CommunicationRepositoryPort;
import com.atlas.communication.publishing.application.PublishingUseCase;
import com.atlas.communication.publishing.domain.RetireRequest;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

@ExtendWith(MockitoExtension.class)
class AdminUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");

    @Mock
    private CommunicationRepositoryPort repository;
    @Mock
    private PublishingUseCase publishing;

    private AdminUseCase useCase;

    @BeforeEach
    void setUp() {
        useCase = new AdminUseCase(repository, publishing);
    }

    @Test
    void searchBuildsAdminQueryWithCreatedRange() {
        when(repository.query(any())).thenReturn(Flux.empty());
        when(repository.count(any())).thenReturn(Mono.just(0L));

        StepVerifier.create(useCase.search(null, Set.of(CommunicationStatus.RETIRED),
                        CommunicationType.OUTAGE, "sre", NOW.minusSeconds(3600), NOW, 0, 20))
                .expectNextCount(1)
                .verifyComplete();

        ArgumentCaptor<CommunicationQuery> captor = ArgumentCaptor.forClass(CommunicationQuery.class);
        verify(repository).query(captor.capture());
        CommunicationQuery q = captor.getValue();
        assertThat(q.tenantId()).isNull();
        assertThat(q.statuses()).containsExactly(CommunicationStatus.RETIRED);
        assertThat(q.publisher()).isEqualTo("sre");
        assertThat(q.createdFrom()).isEqualTo(NOW.minusSeconds(3600));
        assertThat(q.activeAt()).isNull();
    }

    @Test
    void retireDelegatesToPublishingRules() {
        Communication retired = Communication.create("c1", "vmforge", "sre",
                CommunicationType.OUTAGE, Severity.MAJOR, "t", null, List.of(), null, false,
                null, null, null, null, NOW).withStatus(CommunicationStatus.RETIRED, "admin", NOW);
        RetireRequest request = new RetireRequest("admin", "cleanup");
        when(publishing.retire("c1", request)).thenReturn(Mono.just(retired));

        StepVerifier.create(useCase.retire("c1", request))
                .assertNext(c -> assertThat(c.status()).isEqualTo(CommunicationStatus.RETIRED))
                .verifyComplete();
        verify(publishing).retire("c1", request);
    }

    @Test
    void purgeMissingIdIs404() {
        when(repository.deleteById("nope")).thenReturn(Mono.just(false));
        StepVerifier.create(useCase.purge("nope"))
                .expectErrorSatisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.NOT_FOUND))
                .verify();
    }

    @Test
    void purgeExistingCompletesEmpty() {
        when(repository.deleteById("c1")).thenReturn(Mono.just(true));
        StepVerifier.create(useCase.purge("c1")).verifyComplete();
    }

    @Test
    void tenantsPassesSummariesThrough() {
        when(repository.summarizeTenants()).thenReturn(Flux.just(
                new TenantSummary("vmforge", Map.of(CommunicationStatus.ACTIVE, 2L), 2)));
        StepVerifier.create(useCase.tenants())
                .assertNext(s -> {
                    assertThat(s.tenantId()).isEqualTo("vmforge");
                    assertThat(s.total()).isEqualTo(2);
                })
                .verifyComplete();
    }
}
