package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.jackson.autoconfigure.JacksonAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.FileSystemResource;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/**
 * The JSON the service writes and reads, built from the shipped {@code application.yml} (the test classpath
 * has its own copy of these settings). Jackson 3 changed defaults that show on the wire; the shipped settings
 * keep what clients got before: properties in declaration order, nulls omitted, ISO-8601 dates, a missing or
 * null boolean meaning false instead of a 400, content after the body ignored, and a character outside the
 * Basic Multilingual Plane written as an escaped surrogate pair.
 */
class JsonWireFormatTest {

    /** The shipped configuration (the test classpath has its own application.yml). */
    private static final String APPLICATION_YML = "src/main/resources/application.yml";

    record Notice(String title, String audience, Instant startsAt, String endsAt) {
    }

    /** A class, not a record: Jackson 3 would sort its properties alphabetically. */
    static final class Probe {
        public final String status = "DOWN";
        public final String service = "payments";
    }

    record Draft(String title, boolean draft) {
    }

    @Test
    void theShippedJacksonSettingsKeepTheWireFormat() throws IOException {
        List<PropertySource<?>> shipped = shipped();
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(JacksonAutoConfiguration.class))
                .withInitializer(context -> shipped.forEach(context.getEnvironment().getPropertySources()::addFirst))
                .run(context -> {
                    JsonMapper json = context.getBean(JsonMapper.class);
                    Notice notice = new Notice("Checkout down \uD83D\uDD25", "CUSTOMERS",
                            Instant.parse("2026-11-02T08:00:00Z"), null);
                    SoftAssertions.assertSoftly(softly -> {
                        softly.assertThat(written(json, notice))
                                .as("nulls omitted, ISO-8601 date, emoji as an escaped surrogate pair")
                                .isEqualTo("{\"title\":\"Checkout down \\uD83D\\uDD25\",\"audience\":\"CUSTOMERS\","
                                        + "\"startsAt\":\"2026-11-02T08:00:00Z\"}");
                        softly.assertThat(written(json, new Probe())).as("properties in declaration order")
                                .isEqualTo("{\"status\":\"DOWN\",\"service\":\"payments\"}");
                        softly.assertThat(read(json, "{\"title\":\"t\"}")).as("a missing boolean")
                                .isEqualTo(new Draft("t", false));
                        softly.assertThat(read(json, "{\"title\":\"t\",\"draft\":null}")).as("a null boolean")
                                .isEqualTo(new Draft("t", false));
                        softly.assertThat(read(json, "{\"title\":\"t\",\"draft\":true} {\"x\":1}"))
                                .as("content after the body").isEqualTo(new Draft("t", true));
                    });
                });
    }

    @Test
    void actuatorBodiesUseTheApplicationJsonSettings() throws IOException {
        // Spring Boot 4's own mapper for actuator bodies sorts keys: /actuator/health would answer
        // {"groups":[…],"status":"UP"} instead of {"status":"UP","groups":[…]} (OperationsEndpointsIT)
        assertThat(shipped().stream()
                .map(source -> source.getProperty("management.endpoints.jackson.isolated-json-mapper"))
                .filter(value -> value != null)
                .map(String::valueOf))
                .containsExactly("false");
    }

    private static String written(JsonMapper json, Object value) {
        return new String(json.writeValueAsBytes(value), StandardCharsets.UTF_8);
    }

    /** The body read as a {@link Draft}, or why it was refused. */
    private static Object read(JsonMapper json, String body) {
        try {
            return json.readValue(body, Draft.class);
        } catch (JacksonException e) {
            return e.getOriginalMessage();
        }
    }

    private static List<PropertySource<?>> shipped() throws IOException {
        return new YamlPropertySourceLoader().load("shipped application.yml", new FileSystemResource(APPLICATION_YML));
    }
}
