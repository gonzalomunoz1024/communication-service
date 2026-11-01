package com.atlas.communication.health;

import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Test-only stand-in for a monitored Spring Boot app's {@code /actuator/health}: serves whatever
 * document the test sets, with Actuator's status mapping (UP -> 200, otherwise 503).
 */
@RestController
public class FakeActuatorController {

    public static final String PATH = "/test/actuator/health";

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
}
