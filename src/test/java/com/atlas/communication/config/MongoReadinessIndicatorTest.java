package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;

import org.bson.Document;
import org.junit.jupiter.api.Test;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.Status;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.mongodb.core.ReactiveMongoOperations;

import com.atlas.communication.LogCapture;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

/**
 * Readiness asks MongoDB for a ping. While the database is unreachable a kubelet keeps probing:
 * every probe answers DOWN, and the outage leaves one WARN line when it starts and one INFO line
 * when it ends, never a stack trace above DEBUG.
 */
class MongoReadinessIndicatorTest {

    private static final String PING = "{ ping: 1 }";
    private static final Duration TIMEOUT = Duration.ofSeconds(1);
    /** What Spring Data hands over once the driver gives up on an unreachable Mongo. */
    private static final String DRIVER_TIMEOUT = "Timed out while waiting for a server that matches"
            + " ReadPreferenceServerSelector{readPreference=primary}. Client view of cluster state is"
            + " {type=UNKNOWN, servers=[{address=mongo:27017, type=UNKNOWN, state=CONNECTING}]";

    private final ReactiveMongoOperations mongo = mock(ReactiveMongoOperations.class);
    private final MongoReadinessIndicator readiness = new MongoReadinessIndicator(mongo, TIMEOUT);

    private static Mono<Document> answer() {
        return Mono.just(new Document("ok", 1.0));
    }

    private static Mono<Document> unreachable() {
        return Mono.error(new DataAccessResourceFailureException(DRIVER_TIMEOUT));
    }

    private Status probe() {
        Health health = readiness.health().block(Duration.ofSeconds(5));
        assertThat(health).isNotNull();
        return health.getStatus();
    }

    @Test
    void upWhileTheDatabaseAnswersAndNothingIsLogged() {
        when(mongo.executeCommand(PING)).thenReturn(answer());

        try (LogCapture log = LogCapture.of(MongoReadinessIndicator.class)) {
            assertThat(probe()).isEqualTo(Status.UP);
            assertThat(probe()).isEqualTo(Status.UP);
            assertThat(log.events()).isEmpty();
        }
    }

    @Test
    void anOutageLogsOneWarningWhenItStartsAndOneLineWhenItEnds() {
        when(mongo.executeCommand(PING))
                .thenReturn(answer())
                .thenReturn(unreachable())
                .thenReturn(unreachable())
                .thenReturn(unreachable())
                .thenReturn(answer())
                .thenReturn(answer())
                .thenReturn(unreachable());

        try (LogCapture log = LogCapture.of(MongoReadinessIndicator.class)) {
            assertThat(probe()).isEqualTo(Status.UP);
            // three probes during the outage: DOWN each time, one line for all of them
            assertThat(probe()).isEqualTo(Status.DOWN);
            assertThat(probe()).isEqualTo(Status.DOWN);
            assertThat(probe()).isEqualTo(Status.DOWN);
            assertThat(probe()).isEqualTo(Status.UP);
            assertThat(probe()).isEqualTo(Status.UP);
            // the next outage is reported again
            assertThat(probe()).isEqualTo(Status.DOWN);

            List<ILoggingEvent> lines = log.atLeast(Level.INFO);
            assertThat(lines).extracting(ILoggingEvent::getLevel)
                    .containsExactly(Level.WARN, Level.INFO, Level.WARN);
            assertThat(lines.get(0).getFormattedMessage())
                    .isEqualTo("readiness DOWN: MongoDB did not answer a ping: " + DRIVER_TIMEOUT);
            assertThat(lines.get(1).getFormattedMessage()).isEqualTo("readiness UP: MongoDB answers again");
            assertThat(lines).as("no stack trace above DEBUG").allSatisfy(e -> assertThat(e.getThrowableProxy()).isNull());
            assertThat(log.events()).filteredOn(e -> e.getLevel() == Level.DEBUG)
                    .as("each failed ping's stack trace is at DEBUG").hasSize(4)
                    .allSatisfy(e -> assertThat(e.getThrowableProxy()).isNotNull());
        }
    }

    @Test
    void aFailureWithoutAMessageIsNamedByItsType() {
        when(mongo.executeCommand(PING)).thenReturn(Mono.error(new DataAccessResourceFailureException(null)));

        try (LogCapture log = LogCapture.of(MongoReadinessIndicator.class)) {
            Health health = readiness.health().block(Duration.ofSeconds(5));

            assertThat(health).isNotNull();
            assertThat(health.getStatus()).isEqualTo(Status.DOWN);
            assertThat(health.getDetails()).containsEntry("error", "DataAccessResourceFailureException");
            assertThat(log.atLeast(Level.WARN)).extracting(ILoggingEvent::getFormattedMessage)
                    .containsExactly("readiness DOWN: MongoDB did not answer a ping: DataAccessResourceFailureException");
        }
    }

    @Test
    void aPingWithoutAnswerIsDownAfterTheReadinessTimeoutNotTheServerSelectionTimeout() {
        when(mongo.executeCommand(PING)).thenReturn(Mono.never());

        try (LogCapture log = LogCapture.of(MongoReadinessIndicator.class)) {
            StepVerifier.withVirtualTime(readiness::health)
                    .expectSubscription()
                    .expectNoEvent(TIMEOUT.minusMillis(1))
                    .thenAwait(Duration.ofMillis(1))
                    .assertNext(health -> {
                        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
                        assertThat(health.getDetails()).containsEntry("error", "no answer within 1000 ms");
                    })
                    .verifyComplete();
            assertThat(log.atLeast(Level.WARN)).extracting(ILoggingEvent::getFormattedMessage)
                    .containsExactly("readiness DOWN: MongoDB did not answer a ping: no answer within 1000 ms");
        }
    }
}
