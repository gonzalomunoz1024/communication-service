package com.atlas.communication.health;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import reactor.core.publisher.Mono;

/**
 * Test-only stand-in for a monitored Spring Boot app's {@code /actuator/health}: serves whatever
 * document the test sets, with Actuator's status mapping (UP -> 200, otherwise 503), at once or,
 * on {@link #SLOW_PATH}, after {@link #SLOW_DELAY} like an app under load.
 */
@RestController
public class FakeActuatorController {

    public static final String PATH = "/test/actuator/health";
    public static final String SLOW_PATH = "/test/actuator/slow-health";
    public static final Duration SLOW_DELAY = Duration.ofSeconds(3);

    private final AtomicReference<Map<String, Object>> document =
            new AtomicReference<>(Map.of("status", "UP"));

    public void set(Map<String, Object> health) {
        document.set(health);
    }

    @GetMapping(PATH)
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> current = document.get();
        boolean up = "UP".equals(current.get("status"));
        return ResponseEntity.status(up ? 200 : 503).body(current);
    }

    @GetMapping(SLOW_PATH)
    public Mono<ResponseEntity<Map<String, Object>>> slowHealth() {
        return Mono.delay(SLOW_DELAY).map(tick -> health());
    }
}
