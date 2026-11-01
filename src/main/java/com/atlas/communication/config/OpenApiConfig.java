package com.atlas.communication.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;

@Configuration
public class OpenApiConfig {

    /** Lets Swagger UI's "Authorize" button send {@link ClientIdWebFilter#HEADER} on every call. */
    static final String CLIENT_ID_SCHEME = "clientId";

    @Bean
    public OpenAPI communicationOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("Communication Service")
                        .description("Shared customer communications platform: publish incidents, changes, "
                                + "outages, maintenance windows and health notices; consume them via feed and SSE.")
                        .version("v1"))
                .components(new Components().addSecuritySchemes(CLIENT_ID_SCHEME, new SecurityScheme()
                        .type(SecurityScheme.Type.APIKEY)
                        .in(SecurityScheme.In.HEADER)
                        .name(ClientIdWebFilter.HEADER)
                        .description("Repository name of the calling system; required on every /v1 request")))
                .addSecurityItem(new SecurityRequirement().addList(CLIENT_ID_SCHEME));
    }
}
