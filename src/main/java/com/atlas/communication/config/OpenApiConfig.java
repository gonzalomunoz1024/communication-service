package com.atlas.communication.config;

import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

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
import io.swagger.v3.oas.models.responses.ApiResponses;
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

    /** The {@code {"error": "..."}} body of every 4xx and 5xx answer (GlobalExceptionHandler, ClientIdWebFilter). */
    static final String ERROR_SCHEMA = "Error";
    static final String BAD_REQUEST = "BadRequest";
    static final String NOT_FOUND = "NotFound";
    static final String SERVICE_UNAVAILABLE = "ServiceUnavailable";

    /**
     * The error answers the routes share, documented once each instead of "Undocumented": the 400 for a
     * malformed X-Client-Id or a body, parameter or field the service cannot accept (any route), the 401
     * a caller gets without the header (any route), the 404 of every route that takes an id, and the 503
     * while the database is unreachable (any route). A route's own 409 is on the route.
     */
    @Bean
    public OpenApiCustomizer errorResponses() {
        return openApi -> {
            openApi.getComponents()
                    .addSchemas(ERROR_SCHEMA, typed(new Schema<>(), "object")
                            .addProperty("error", typed(new Schema<>(), "string")
                                    .description("What is wrong, in words that say what to send instead"))
                            .addRequiredItem("error"))
                    .addResponses(BAD_REQUEST, error("The request cannot be accepted as sent: a malformed "
                            + ClientIdWebFilter.HEADER + ", a body that is not JSON or has a field this route does not "
                            + "take, or a field or parameter that fails validation. The error names it and says what "
                            + "to send.", "severity: 'SEVERE' is not one of [INFO, MINOR, MAJOR, CRITICAL]"))
                    .addResponses(NOT_FOUND, error("Nothing with this id: no communication, or no monitor on "
                            + "/v1/health routes", "communication 3f0c2a1e-7d4b-4a4e-9c2b-5e1f0a6d8b21 not found"))
                    .addResponses(SERVICE_UNAVAILABLE, error("The database is unreachable: nothing was read or "
                            + "changed; retry later (/actuator/health/readiness answers 503 meanwhile)",
                            "database unavailable"));
            openApi.getPaths().forEach((path, item) -> item.readOperations().forEach(operation -> {
                ApiResponses documented = operation.getResponses() == null ? new ApiResponses() : operation.getResponses();
                Map<String, ApiResponse> responses = new TreeMap<>(documented);
                responses.putIfAbsent("400", new ApiResponse().$ref(BAD_REQUEST));
                responses.putIfAbsent("401", error("No " + ClientIdWebFilter.HEADER
                        + " header (or ?clientId= on the stream)",
                        "missing X-Client-Id header: identify the calling system by its repository name"));
                if (path.contains("{id}")) {
                    responses.putIfAbsent("404", new ApiResponse().$ref(NOT_FOUND));
                }
                responses.putIfAbsent("503", new ApiResponse().$ref(SERVICE_UNAVAILABLE));
                ApiResponses sorted = new ApiResponses();
                responses.forEach(sorted::addApiResponse);
                sorted.setExtensions(documented.getExtensions());
                operation.setResponses(sorted);
            }));
        };
    }

    /** An answer with the shared error body and an example of it. */
    private static ApiResponse error(String description, String example) {
        return new ApiResponse().description(description).content(new Content().addMediaType("application/json",
                new MediaType().schema(new Schema<>().$ref(ERROR_SCHEMA)).example(Map.of("error", example))));
    }

    /** OpenAPI 3.1 writes a schema's types, 3.0 its type: set both. */
    private static Schema<Object> typed(Schema<Object> schema, String type) {
        schema.setType(type);
        schema.setTypes(Set.of(type));
        return schema;
    }
}
