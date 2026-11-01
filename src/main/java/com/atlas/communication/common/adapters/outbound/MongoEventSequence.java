package com.atlas.communication.common.adapters.outbound;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.ReactiveMongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;
import reactor.core.publisher.Mono;

/** One atomically incremented counter document ({@code counters/communication_events}). */
@Component
@RequiredArgsConstructor
public class MongoEventSequence implements EventSequence {

    static final String COLLECTION = "counters";
    static final String COUNTER_ID = "communication_events";

    private final ReactiveMongoTemplate template;

    @Override
    public Mono<Long> next() {
        return template.findAndModify(
                        Query.query(Criteria.where("_id").is(COUNTER_ID)),
                        new Update().inc("value", 1L),
                        FindAndModifyOptions.options().upsert(true).returnNew(true),
                        Counter.class, COLLECTION)
                .map(counter -> counter.value);
    }

    @Override
    public Mono<Long> current() {
        return template.findById(COUNTER_ID, Counter.class, COLLECTION)
                .map(counter -> counter.value)
                .defaultIfEmpty(0L);
    }

    static class Counter {
        @Id
        String id;
        long value;
    }
}
