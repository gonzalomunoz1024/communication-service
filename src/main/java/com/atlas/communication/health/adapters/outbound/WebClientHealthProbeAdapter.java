package com.atlas.communication.health.adapters.outbound;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.TimeoutException;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import com.atlas.communication.health.domain.ActuatorComponent;
import com.atlas.communication.health.domain.HealthReport;
import com.atlas.communication.health.domain.HealthSource;
import com.atlas.communication.health.domain.HealthStatus;
import com.atlas.communication.health.ports.outbound.HealthProbePort;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import reactor.core.publisher.Mono;

/**
 * HTTP GET probe. A JSON body with a top-level {@code status} (Spring Actuator's
 * {@code /actuator/health}, any version) is read as a health document, components included;
 * anything else is judged by HTTP status alone (2xx up, otherwise down). Transport errors and
 * timeouts are DOWN with the reason as the message.
 */
@Component
public class WebClientHealthProbeAdapter implements HealthProbePort {

    /** Health documents are small; cap the body so a misconfigured URL cannot exhaust memory. */
    static final int BODY_LIMIT_BYTES = 256 * 1024;

    private final WebClient client;
    private final ObjectMapper mapper;

    public WebClientHealthProbeAdapter(WebClient.Builder builder, ObjectMapper mapper) {
        this.client = builder
                .codecs(codecs -> codecs.defaultCodecs().maxInMemorySize(BODY_LIMIT_BYTES))
                .build();
        this.mapper = mapper;
    }

    @Override
    public Mono<HealthReport> probe(String url, Duration timeout, Instant now) {
        return Mono.defer(() -> client.get()
                        .uri(URI.create(url))
                        .accept(MediaType.APPLICATION_JSON, MediaType.ALL)
                        .exchangeToMono(response -> response.bodyToMono(String.class)
                                .defaultIfEmpty("")
                                .map(body -> interpret(response.statusCode().value(), body, now))))
                .timeout(timeout)
                .onErrorResume(ex -> Mono.just(HealthReport.of(HealthStatus.DOWN,
                        "probe failed: " + describe(ex, timeout), HealthSource.PROBE, now)));
    }

    /** Package-private for tests: a status-bearing JSON document wins over the HTTP status. */
    HealthReport interpret(int httpStatus, String body, Instant now) {
        ActuatorComponent document = parse(body);
        if (document != null && document.status() != null) {
            return HealthReport.fromActuator(document.status(), document.children(),
                    "HTTP " + httpStatus, HealthSource.PROBE, now);
        }
        boolean ok = httpStatus >= 200 && httpStatus < 300;
        return HealthReport.of(ok ? HealthStatus.UP : HealthStatus.DOWN, "HTTP " + httpStatus,
                HealthSource.PROBE, now);
    }

    private ActuatorComponent parse(String body) {
        if (body == null || body.isBlank() || !body.trim().startsWith("{")) {
            return null;
        }
        try {
            Map<String, Object> tree = mapper.readValue(body, new TypeReference<Map<String, Object>>() { });
            return ActuatorComponent.fromTree(tree);
        } catch (Exception ex) {
            return null;
        }
    }

    private static String describe(Throwable ex, Duration timeout) {
        if (ex instanceof TimeoutException) {
            return "no response within " + timeout.toMillis() + "ms";
        }
        String message = ex.getMessage();
        return message == null || message.isBlank() ? ex.getClass().getSimpleName() : message;
    }
}
