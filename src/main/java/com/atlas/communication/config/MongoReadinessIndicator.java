package com.atlas.communication.config;

import java.time.Duration;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.ReactiveHealthIndicator;
import org.springframework.data.mongodb.core.ReactiveMongoOperations;

import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Mono;

/**
 * Readiness' view of MongoDB ({@code mongo} in the readiness group), in place of Spring Boot's
 * indicator. Boot's waits the whole server-selection timeout for an unreachable database and then
 * logs a WARN with a full stack trace, on every probe (a kubelet probes every 10 s). This one
 * pings with a short timeout and logs one line when the database stops answering and one when it
 * answers again; the stack trace of each failed ping is at DEBUG.
 */
@Slf4j
public class MongoReadinessIndicator implements ReactiveHealthIndicator {

    private static final String PING = "{ ping: 1 }";

    private final ReactiveMongoOperations mongo;
    private final Duration timeout;
    /** Whether the last ping went unanswered: the line is logged on the change, not per probe. */
    private final AtomicBoolean unanswered = new AtomicBoolean();

    public MongoReadinessIndicator(ReactiveMongoOperations mongo, Duration timeout) {
        this.mongo = mongo;
        this.timeout = timeout;
    }

    @Override
    public Mono<Health> health() {
        return mongo.executeCommand(PING)
                .timeout(timeout)
                .then(Mono.fromSupplier(this::answered))
                .onErrorResume(ex -> Mono.just(unanswered(ex)));
    }

    private Health answered() {
        if (unanswered.compareAndSet(true, false)) {
            log.info("readiness UP: MongoDB answers again");
        }
        return Health.up().build();
    }

    private Health unanswered(Throwable ex) {
        String reason = ex instanceof TimeoutException
                ? "no answer within " + timeout.toMillis() + " ms"
                : ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
        if (unanswered.compareAndSet(false, true)) {
            log.warn("readiness DOWN: MongoDB did not answer a ping: {}", reason);
        }
        log.debug("readiness ping failed", ex);
        return Health.down().withDetail("error", reason).build();
    }
}
