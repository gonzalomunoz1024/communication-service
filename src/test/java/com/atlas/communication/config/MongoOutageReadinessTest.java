package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.actuate.autoconfigure.data.mongo.MongoReactiveHealthContributorAutoConfiguration;
import org.springframework.boot.actuate.autoconfigure.health.HealthContributorAutoConfiguration;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.ReactiveHealthContributor;
import org.springframework.boot.actuate.health.ReactiveHealthIndicator;
import org.springframework.boot.actuate.health.Status;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.data.mongo.MongoReactiveDataAutoConfiguration;
import org.springframework.boot.autoconfigure.mongo.MongoReactiveAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.EnumerablePropertySource;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.FileSystemResource;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

/**
 * What an operator sees while MongoDB is unreachable and the kubelet keeps asking for readiness
 * (GAP-backend2-6, GAP-e2e2-5): the application's own Mongo wiring ({@link MongoClientConfig}
 * with Boot's auto-configuration) and the logging levels of the shipped {@code application.yml},
 * against a local port nobody listens on. Every probe answers DOWN before the server-selection
 * timeout, and the whole outage leaves one line in the log: no stack trace above DEBUG, from
 * the readiness indicator or from the driver.
 */
class MongoOutageReadinessTest {

    /** The shipped configuration (the test classpath has its own application.yml). */
    private static final String APPLICATION_YML = "src/main/resources/application.yml";
    private static final String LEVEL_PREFIX = "logging.level.";
    /** communication.mongo.server-selection-timeout: what a call waits for an unreachable database. */
    private static final Duration SERVER_SELECTION = Duration.ofSeconds(5);
    /** A kubelet's default probe timeout (timeoutSeconds: 1): an answer that takes longer is a timeout, not a 503. */
    private static final Duration KUBELET_PROBE_TIMEOUT = Duration.ofSeconds(1);

    @EnableConfigurationProperties(MongoTimeoutProperties.class)
    static class Timeouts {
    }

    @Test
    void readinessWhileMongoIsUnreachableAnswersDownQuicklyAndLogsOneLineWithoutAStackTrace() throws IOException {
        ApplicationContextRunner runner = new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(MongoReactiveAutoConfiguration.class,
                        MongoReactiveDataAutoConfiguration.class, HealthContributorAutoConfiguration.class,
                        MongoReactiveHealthContributorAutoConfiguration.class))
                .withUserConfiguration(Timeouts.class, MongoClientConfig.class)
                .withPropertyValues("spring.data.mongodb.uri=mongodb://127.0.0.1:" + closedPort() + "/readiness");

        Map<String, Level> shipped = shippedLogLevels();
        Map<Logger, Level> previous = new LinkedHashMap<>();
        shipped.forEach((name, level) -> {
            Logger logger = (Logger) LoggerFactory.getLogger(name);
            previous.put(logger, logger.getLevel());
            logger.setLevel(level);
        });
        Logger root = (Logger) LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        ListAppender<ILoggingEvent> console = new ListAppender<>();
        console.start();
        root.addAppender(console);
        List<Duration> answeredIn = new ArrayList<>();
        try {
            runner.run(context -> {
                Map<String, ReactiveHealthContributor> contributors = context.getBeansOfType(ReactiveHealthContributor.class);
                assertThat(contributors).as("one Mongo indicator for readiness").hasSize(1);
                ReactiveHealthIndicator readiness = (ReactiveHealthIndicator) contributors.values().iterator().next();
                for (int probe = 0; probe < 3; probe++) { // a kubelet probes every 10 s
                    long started = System.nanoTime();
                    Health health = readiness.health().block(Duration.ofSeconds(30));
                    answeredIn.add(Duration.ofNanos(System.nanoTime() - started));
                    assertThat(health).isNotNull();
                    assertThat(health.getStatus()).isEqualTo(Status.DOWN);
                }
            });
        } finally {
            root.detachAppender(console);
            console.stop();
            previous.forEach(Logger::setLevel);
        }

        List<ILoggingEvent> visible = console.list.stream()
                .filter(e -> e.getLevel().isGreaterOrEqual(Level.INFO))
                .filter(e -> e.getLoggerName().startsWith("org.mongodb") || e.getLoggerName().startsWith("org.springframework.boot.actuate")
                        || e.getLoggerName().startsWith("com.atlas.communication"))
                .toList();
        assertThat(visible).as("no stack trace above DEBUG (probes answered in %s): %s", answeredIn, describe(visible))
                .noneMatch(e -> e.getThrowableProxy() != null);
        assertThat(visible).filteredOn(e -> e.getLevel().isGreaterOrEqual(Level.WARN))
                .as("one line for the whole outage, not one per probe (probes answered in %s): %s", answeredIn,
                        describe(visible))
                .hasSize(1);
        assertThat(answeredIn).as("each probe answers before the server-selection timeout")
                .allSatisfy(took -> assertThat(took).isLessThan(SERVER_SELECTION));
    }

    @Test
    void readinessWhileMongoIsUnreachableAnswersWithinAKubeletsDefaultProbeTimeout() throws IOException {
        // the shipped communication.mongo.* settings, so the timeout that ships is the one measured
        ApplicationContextRunner runner = new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(MongoReactiveAutoConfiguration.class,
                        MongoReactiveDataAutoConfiguration.class, HealthContributorAutoConfiguration.class,
                        MongoReactiveHealthContributorAutoConfiguration.class))
                .withUserConfiguration(Timeouts.class, MongoClientConfig.class)
                .withPropertyValues(shippedProperties("communication.mongo."))
                .withPropertyValues("spring.data.mongodb.uri=mongodb://127.0.0.1:" + closedPort() + "/readiness");

        List<Duration> answeredIn = new ArrayList<>();
        runner.run(context -> {
            ReactiveHealthIndicator readiness = (ReactiveHealthIndicator) context
                    .getBeansOfType(ReactiveHealthContributor.class).values().iterator().next();
            for (int probe = 0; probe < 3; probe++) {
                long started = System.nanoTime();
                Health health = readiness.health().block(Duration.ofSeconds(30));
                answeredIn.add(Duration.ofNanos(System.nanoTime() - started));
                assertThat(health).isNotNull();
                assertThat(health.getStatus()).isEqualTo(Status.DOWN);
            }
        });
        assertThat(answeredIn).as("each DOWN answers within a kubelet's default probe timeout, leaving room"
                + " for the HTTP answer: %s", answeredIn)
                .allSatisfy(took -> assertThat(took).isLessThan(KUBELET_PROBE_TIMEOUT));
    }

    /** The entries of the shipped application.yml under {@code prefix}, as {@code name=value}. */
    private static String[] shippedProperties(String prefix) throws IOException {
        List<String> properties = new ArrayList<>();
        for (PropertySource<?> source : new YamlPropertySourceLoader().load("shipped",
                new FileSystemResource(APPLICATION_YML))) {
            if (source instanceof EnumerablePropertySource<?> enumerable) {
                for (String name : enumerable.getPropertyNames()) {
                    if (name.startsWith(prefix)) {
                        properties.add(name + "=" + enumerable.getProperty(name));
                    }
                }
            }
        }
        assertThat(properties).as("shipped %s* settings", prefix).isNotEmpty();
        return properties.toArray(String[]::new);
    }

    /** The logging.level.* entries of the shipped application.yml. */
    private static Map<String, Level> shippedLogLevels() throws IOException {
        Map<String, Level> levels = new LinkedHashMap<>();
        for (PropertySource<?> source : new YamlPropertySourceLoader().load("shipped",
                new FileSystemResource(APPLICATION_YML))) {
            if (source instanceof EnumerablePropertySource<?> enumerable) {
                for (String name : enumerable.getPropertyNames()) {
                    if (name.startsWith(LEVEL_PREFIX)) {
                        levels.put(name.substring(LEVEL_PREFIX.length()),
                                Level.toLevel(String.valueOf(enumerable.getProperty(name))));
                    }
                }
            }
        }
        return levels;
    }

    /** A local port with nothing listening on it: connections are refused at once. */
    private static int closedPort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            return socket.getLocalPort();
        }
    }

    private static String describe(List<ILoggingEvent> events) {
        return events.stream().map(e -> "\n  " + e.getLevel() + " " + e.getLoggerName() + " " + e.getFormattedMessage()
                + (e.getThrowableProxy() == null ? "" : " [+ stack trace " + e.getThrowableProxy().getClassName() + "]"))
                .toList().toString();
    }
}
