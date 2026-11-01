package com.atlas.communication.config;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * A single injectable {@link Clock} so time-dependent logic stays deterministic in tests.
 * Use cases receive this bean instead of calling {@code Instant.now()} directly.
 */
@Configuration
public class ClockConfig {
    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
