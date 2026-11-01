package com.atlas.communication.config;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Mono;

/**
 * Every {@code /v1/**} request must say who is calling: {@value #HEADER} carrying the caller's
 * repository name, or {@value #QUERY_PARAM} for browser {@code EventSource} clients that cannot
 * set headers. Missing → 401, malformed → 400, both as {@code {"error": "..."}}.
 * <p>
 * This is identification, not authentication: nothing is verified. The id is exposed to handlers
 * as the exchange attribute {@link #ATTRIBUTE} and in the Reactor context under the same key, and
 * logged at debug level per request.
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ClientIdWebFilter implements WebFilter {

    public static final String HEADER = "X-Client-Id";
    public static final String QUERY_PARAM = "clientId";
    public static final String ATTRIBUTE = ClientIdWebFilter.class.getName() + ".clientId";

    private static final String PATH_PREFIX = "/v1/";
    private static final Pattern VALID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._/-]{0,99}");

    private final boolean required;
    private final ObjectMapper mapper;

    public ClientIdWebFilter(@Value("${communication.client-id.required:true}") boolean required,
            ObjectMapper mapper) {
        this.required = required;
        this.mapper = mapper;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        if (!required || !applies(request)) {
            return chain.filter(exchange);
        }
        String clientId = clientId(request);
        if (clientId == null) {
            return reject(exchange, HttpStatus.UNAUTHORIZED, "missing " + HEADER
                    + " header: identify the calling system by its repository name"
                    + " (EventSource clients may send ?" + QUERY_PARAM + "= instead)");
        }
        if (!VALID.matcher(clientId).matches()) {
            return reject(exchange, HttpStatus.BAD_REQUEST, HEADER
                    + " must be 1-100 characters: letters, digits, '.', '_', '-' or '/'");
        }
        log.debug("client={} {} {}", clientId, request.getMethod(), request.getPath().value());
        exchange.getAttributes().put(ATTRIBUTE, clientId);
        return chain.filter(exchange).contextWrite(ctx -> ctx.put(ATTRIBUTE, clientId));
    }

    private static boolean applies(ServerHttpRequest request) {
        return request.getPath().value().startsWith(PATH_PREFIX)
                && request.getMethod() != HttpMethod.OPTIONS;
    }

    private static String clientId(ServerHttpRequest request) {
        String header = request.getHeaders().getFirst(HEADER);
        if (header != null && !header.isBlank()) {
            return header.trim();
        }
        String param = request.getQueryParams().getFirst(QUERY_PARAM);
        return param == null || param.isBlank() ? null : param.trim();
    }

    private Mono<Void> reject(ServerWebExchange exchange, HttpStatus status, String message) {
        ServerHttpRequest request = exchange.getRequest();
        log.info("rejected {} {} with {}: {}", request.getMethod(), request.getPath().value(),
                status.value(), message);
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(status);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        return response.writeWith(Mono.just(response.bufferFactory().wrap(errorBody(message))));
    }

    private byte[] errorBody(String message) {
        try {
            return mapper.writeValueAsBytes(Map.of("error", message));
        } catch (JsonProcessingException e) {
            return "{\"error\":\"client id required\"}".getBytes(StandardCharsets.UTF_8);
        }
    }
}
