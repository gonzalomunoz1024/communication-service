package com.atlas.communication.common.adapters.outbound;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

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
    /** Beside {@code error} in the 409 for a reused externalRef: the first follow-up value still free. */
    public static final String SUGGESTED_EXTERNAL_REF = "suggestedExternalRef";
    /** How many follow-up values the 409 checks for a free one. */
    static final int FOLLOW_UP_CANDIDATES = 50;
    /**
     * A reference that already counts its follow-ups ({@code INC0012345-2}); a longer number at
     * the end is part of the reference itself ({@code CHG-2026}).
     */
    private static final Pattern COUNTED_FOLLOW_UP = Pattern.compile("(.+)-([1-9][0-9]?)");

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
        template.indexOps(CommunicationDocument.class).createIndex(externalRefIndex).block();
    }

    @Override
    public Mono<Communication> save(Communication communication) {
        return repository.save(CommunicationDocument.fromDomain(communication))
                .map(CommunicationDocument::toDomain)
                .onErrorResume(DuplicateKeyException.class, ex -> externalRefTaken(communication))
                .onErrorMap(OptimisticLockingFailureException.class, ex -> new ResponseStatusException(
                        HttpStatus.CONFLICT, "communication " + communication.id()
                                + " was modified concurrently; reload and retry"));
    }

    /**
     * The only unique key besides the id is (tenantId, externalRef), and it is permanent: the 409
     * names the notice that holds the reference and says how to retry the same publish or start
     * a follow-up, so nobody retires a notice hoping to free its reference. The follow-up it
     * suggests is the first value the tenant does not hold yet ({@code <ref>-2}, {@code -3}, …, or
     * counting on from {@code n} for a reference that ends in {@code -n}), also returned as
     * {@value #SUGGESTED_EXTERNAL_REF}; past {@value #FOLLOW_UP_CANDIDATES} taken values it says so
     * and suggests none.
     */
    private Mono<Communication> externalRefTaken(Communication communication) {
        String ref = communication.externalRef();
        String tenant = communication.tenantId();
        if (ref == null) {
            return Mono.error(new ResponseStatusException(HttpStatus.CONFLICT,
                    "communication " + communication.id() + " already exists"));
        }
        List<String> followUps = followUps(ref);
        Mono<String> holder = repository.findFirstByTenantIdAndExternalRef(tenant, ref)
                .map(existing -> " by notice " + existing.id)
                .defaultIfEmpty("");
        Query takenFollowUps = new Query(Criteria.where("tenantId").is(tenant).and("externalRef").in(followUps));
        takenFollowUps.fields().include("externalRef");
        Mono<Set<String>> taken = template.find(takenFollowUps, CommunicationDocument.class)
                .map(doc -> doc.externalRef)
                .collect(Collectors.toSet());
        return Mono.zip(holder, taken).flatMap(found -> {
            String free = followUps.stream().filter(value -> !found.getT2().contains(value)).findFirst().orElse(null);
            String example = free != null ? "for example " + free + ", which is still free"
                    : followUps.get(0) + " to " + followUps.get(followUps.size() - 1) + " are taken as well";
            ResponseStatusException conflict = new ResponseStatusException(HttpStatus.CONFLICT,
                    "externalRef '" + ref + "' is already used" + found.getT1() + " in tenant " + tenant
                            + ". externalRef is a permanent idempotency key: repeat it only to retry the"
                            + " same publish; give a follow-up notice a new value (" + example + ").");
            if (free != null) {
                conflict.getBody().setProperty(SUGGESTED_EXTERNAL_REF, free);
            }
            return Mono.error(conflict);
        });
    }

    /** {@code INC1}: INC1-2 to INC1-51; {@code INC1-2}: INC1-3 to INC1-52. */
    static List<String> followUps(String ref) {
        Matcher counted = COUNTED_FOLLOW_UP.matcher(ref);
        boolean counts = counted.matches();
        String base = counts ? counted.group(1) : ref;
        int last = counts ? Integer.parseInt(counted.group(2)) : 1;
        return IntStream.rangeClosed(last + 1, last + FOLLOW_UP_CANDIDATES)
                .mapToObj(n -> base + "-" + n)
                .toList();
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
