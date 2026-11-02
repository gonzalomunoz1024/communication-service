package com.atlas.communication.config;

import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;

@Configuration
public class OpenApiConfig {

    /**
     * Lets Swagger UI's "Authorize" button send {@link ClientIdWebFilter#HEADER} on every call. Named
     * after the header so the dialog says what to fill in.
     */
    static final String CLIENT_ID_SCHEME = ClientIdWebFilter.HEADER;

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
                        .description("Click Authorize and paste the repository name of the system you are calling "
                                + "from (e.g. vmforge-tools). Required on every /v1 request; identification only, "
                                + "nothing is verified. EventSource clients send ?clientId= instead.")))
                .addSecurityItem(new SecurityRequirement().addList(CLIENT_ID_SCHEME));
    }

    /** Every operation documents the 401 a caller gets without the header, once, instead of "Undocumented". */
    @Bean
    public OpenApiCustomizer missingClientIdResponse() {
        Schema<?> error = new Schema<>().type("object")
                .addProperty("error", new Schema<>().type("string")
                        .example("missing X-Client-Id header: identify the calling system by its repository name"));
        return openApi -> openApi.getPaths().values().forEach(path -> path.readOperations().forEach(operation ->
                operation.getResponses().addApiResponse("401", new ApiResponse()
                        .description("No " + ClientIdWebFilter.HEADER + " header (or ?clientId= on the stream)")
                        .content(new Content().addMediaType("application/json", new MediaType().schema(error))))));
    }
}
