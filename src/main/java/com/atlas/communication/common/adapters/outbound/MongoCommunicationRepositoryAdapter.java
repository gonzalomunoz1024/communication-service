package com.atlas.communication.common.adapters.outbound;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;
import org.springframework.data.mongodb.core.aggregation.Aggregation;
import org.springframework.data.mongodb.core.index.CompoundIndexDefinition;
import org.springframework.data.mongodb.core.index.IndexDefinition;
import org.springframework.data.mongodb.core.index.PartialIndexFilter;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationQuery;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.TenantSummary;
import com.atlas.communication.common.ports.outbound.CommunicationRepositoryPort;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Mongo-backed repository. Dynamic filters are translated to {@link Criteria}; storage
 * conflicts become 409s so use cases stay storage-agnostic.
 */
@Component
@RequiredArgsConstructor
public class MongoCommunicationRepositoryAdapter implements CommunicationRepositoryPort {

    private static final Sort FEED_SORT = Sort.by(
            Sort.Order.desc("severityRank"), Sort.Order.desc("startsAt"), Sort.Order.desc("_id"));

    private final CommunicationMongoRepository repository;
    private final ReactiveMongoTemplate template;

    /**
     * Unique idempotency index on (tenantId, externalRef), partial on externalRef existing —
     * annotation-driven index creation cannot express partial filters.
     */
    @PostConstruct
    public void ensureIndexes() {
        IndexDefinition externalRefIndex = new CompoundIndexDefinition(
                new org.bson.Document("tenantId", 1).append("externalRef", 1))
                .named("external_ref_idx")
                .unique()
                .partial(PartialIndexFilter.of(Criteria.where("externalRef").exists(true)));
        template.indexOps(CommunicationDocument.class).ensureIndex(externalRefIndex).block();
    }

    @Override
    public Mono<Communication> save(Communication communication) {
        return repository.save(CommunicationDocument.fromDomain(communication))
                .map(CommunicationDocument::toDomain)
                .onErrorMap(DuplicateKeyException.class, ex -> new ResponseStatusException(
                        HttpStatus.CONFLICT, "duplicate externalRef '" + communication.externalRef()
                                + "' for tenant '" + communication.tenantId() + "'"))
                .onErrorMap(OptimisticLockingFailureException.class, ex -> new ResponseStatusException(
                        HttpStatus.CONFLICT, "communication " + communication.id()
                                + " was modified concurrently; reload and retry"));
    }

    @Override
    public Mono<Communication> findById(String id) {
        return repository.findById(id).map(CommunicationDocument::toDomain);
    }

    @Override
    public Flux<Communication> query(CommunicationQuery query) {
        Query mongoQuery = new Query(toCriteria(query))
                .with(FEED_SORT)
                .skip((long) query.page() * query.size())
                .limit(query.size());
        return template.find(mongoQuery, CommunicationDocument.class)
                .map(CommunicationDocument::toDomain);
    }

    @Override
    public Mono<Long> count(CommunicationQuery query) {
        return template.count(new Query(toCriteria(query)), CommunicationDocument.class);
    }

    @Override
    public Flux<Communication> dueForActivation(Instant now) {
        Query dueQuery = new Query(Criteria.where("status").is(CommunicationStatus.SCHEDULED.name())
                .and("startsAt").lte(now));
        return template.find(dueQuery, CommunicationDocument.class)
                .map(CommunicationDocument::toDomain);
    }

    @Override
    public Flux<Communication> dueForExpiry(Instant now) {
        Query dueQuery = new Query(Criteria.where("status").is(CommunicationStatus.ACTIVE.name())
                .and("expiresAt").ne(null).lte(now));
        return template.find(dueQuery, CommunicationDocument.class)
                .map(CommunicationDocument::toDomain);
    }

    @Override
    public Mono<Boolean> deleteById(String id) {
        return template.remove(new Query(Criteria.where("_id").is(id)), CommunicationDocument.class)
                .map(result -> result.getDeletedCount() > 0);
    }

    @Override
    public Flux<TenantSummary> summarizeTenants() {
        Aggregation aggregation = Aggregation.newAggregation(
                Aggregation.group("tenantId", "status").count().as("count"));
        return template.aggregate(aggregation, "communications", org.bson.Document.class)
                .collectMultimap(doc -> ((org.bson.Document) doc.get("_id")).getString("tenantId"))
                .flatMapMany(byTenant -> Flux.fromIterable(byTenant.entrySet())
                        .map(entry -> summarize(entry.getKey(), entry.getValue()))
                        .sort((a, b) -> a.tenantId().compareTo(b.tenantId())));
    }

    private static TenantSummary summarize(String tenant, Iterable<org.bson.Document> rows) {
        Map<CommunicationStatus, Long> counts = new EnumMap<>(CommunicationStatus.class);
        long total = 0;
        for (org.bson.Document row : rows) {
            CommunicationStatus status = CommunicationStatus.valueOf(
                    ((org.bson.Document) row.get("_id")).getString("status"));
            long count = ((Number) row.get("count")).longValue();
            counts.put(status, count);
            total += count;
        }
        return new TenantSummary(tenant, counts, total);
    }

    private static Criteria toCriteria(CommunicationQuery q) {
        List<Criteria> all = new ArrayList<>();
        if (q.tenantId() != null) {
            all.add(Criteria.where("tenantId").is(q.tenantId()));
        }
        if (q.statuses() != null && !q.statuses().isEmpty()) {
            all.add(Criteria.where("status").in(q.statuses().stream().map(Enum::name).toList()));
        }
        if (q.type() != null) {
            all.add(Criteria.where("type").is(q.type().name()));
        }
        if (q.minSeverity() != null) {
            all.add(Criteria.where("severityRank").gte(q.minSeverity().rank()));
        }
        if (q.audience() != null) {
            all.add(Criteria.where("audience").is(q.audience().name()));
        }
        if (q.publisher() != null) {
            all.add(Criteria.where("publisher").is(q.publisher()));
        }
        if (q.service() != null) {
            all.add(Criteria.where("affectedServices").is(q.service()));
        }
        if (q.createdFrom() != null) {
            all.add(Criteria.where("createdAt").gte(q.createdFrom()));
        }
        if (q.createdTo() != null) {
            all.add(Criteria.where("createdAt").lte(q.createdTo()));
        }
        if (q.activeAt() != null) {
            all.add(visibility(q.activeAt(), q.upcomingUntil()));
        }
        return all.isEmpty() ? new Criteria() : new Criteria().andOperator(all);
    }

    /**
     * Feed visibility: currently-live items by pure time predicates (immune to sweeper lag),
     * optionally OR'd with upcoming scheduled maintenance inside the lookahead window.
     */
    private static Criteria visibility(Instant activeAt, Instant upcomingUntil) {
        Criteria live = new Criteria().andOperator(
                Criteria.where("status").in(Arrays.asList(
                        CommunicationStatus.SCHEDULED.name(), CommunicationStatus.ACTIVE.name())),
                Criteria.where("startsAt").lte(activeAt),
                new Criteria().orOperator(
                        Criteria.where("expiresAt").is(null),
                        Criteria.where("expiresAt").gt(activeAt)));
        if (upcomingUntil == null) {
            return live;
        }
        Criteria upcomingMaintenance = new Criteria().andOperator(
                Criteria.where("type").is(CommunicationType.MAINTENANCE.name()),
                Criteria.where("status").is(CommunicationStatus.SCHEDULED.name()),
                Criteria.where("startsAt").gt(activeAt),
                Criteria.where("startsAt").lte(upcomingUntil));
        return new Criteria().orOperator(live, upcomingMaintenance);
    }
}
