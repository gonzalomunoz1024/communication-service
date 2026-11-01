package com.atlas.communication.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI communicationOpenApi() {
        return new OpenAPI().info(new Info()
                .title("Communication Service")
                .description("Shared customer communications platform: publish incidents, changes, "
                        + "outages, maintenance windows and health notices; consume them via feed and SSE.")
                .version("v1"));
    }
}
