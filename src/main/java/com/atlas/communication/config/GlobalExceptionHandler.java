package com.atlas.communication.config;

import java.time.Instant;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.beans.TypeMismatchException;
import org.springframework.core.MethodParameter;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.reactive.resource.NoResourceFoundException;
import org.springframework.web.server.MethodNotAllowedException;
import org.springframework.web.server.PayloadTooLargeException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.ServerWebInputException;
import org.springframework.web.server.UnsupportedMediaTypeStatusException;

import com.fasterxml.jackson.core.JsonLocation;
import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import com.mongodb.MongoSocketException;
import com.mongodb.MongoTimeoutException;

import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Mono;

/**
 * Central error mapping: IllegalArgumentException -> 400, binding/input errors -> 400,
 * ResponseStatusException -> its status, an unreachable database -> 503, everything else -> 500.
 * Body is {"error": "..."}.
 * <p>
 * Input errors name the field and what was expected: an unknown enum value lists the accepted
 * ones, a bad timestamp says which field and the format, malformed JSON gives line and column, an
 * oversized body names the limit, an unknown path or verb says so instead of talking about
 * "static resources".
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** What a caller is told while the database cannot be reached; the detail goes to the log. */
    static final String DATABASE_UNAVAILABLE = "database unavailable";

    /**
     * The database cannot be reached (no server found within the selection timeout, connection
     * refused or timed out): 503 with a plain sentence. Spring Data hands these over translated as
     * {@link DataAccessResourceFailureException}; the driver's own forms are mapped too. The
     * driver's message names the cluster's addresses, so it goes to the log, not to the caller.
     */
    @ExceptionHandler({DataAccessResourceFailureException.class, MongoTimeoutException.class,
            MongoSocketException.class})
    public Mono<ResponseEntity<Map<String, String>>> handleDatabaseUnavailable(RuntimeException ex,
            ServerWebExchange exchange) {
        ServerHttpRequest request = exchange.getRequest();
        log.warn("{} {} -> 503, {}: {}", request.getMethod(), request.getPath().value(),
                DATABASE_UNAVAILABLE, ex.getMessage());
        log.debug(DATABASE_UNAVAILABLE, ex);
        return Mono.just(ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", DATABASE_UNAVAILABLE)));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleBadRequest(IllegalArgumentException ex) {
        return Mono.just(ResponseEntity.badRequest().body(Map.of("error", safe(ex.getMessage()))));
    }

    @ExceptionHandler(WebExchangeBindException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleBind(WebExchangeBindException ex) {
        String message = ex.getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage())
                .sorted()
                .collect(Collectors.joining("; "));
        return Mono.just(ResponseEntity.badRequest()
                .body(Map.of("error", message.isEmpty() ? "invalid request" : message)));
    }

    @ExceptionHandler(ServerWebInputException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleInput(ServerWebInputException ex) {
        return Mono.just(ResponseEntity.badRequest().body(Map.of("error", describeInput(ex))));
    }

    @ExceptionHandler(PayloadTooLargeException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleTooLarge(PayloadTooLargeException ex) {
        String limit = "";
        if (ex.getCause() instanceof DataBufferLimitException cause && cause.getMessage() != null) {
            // "Exceeded limit on max bytes to buffer : 262144"
            String digits = cause.getMessage().replaceAll("\\D", "");
            if (!digits.isEmpty()) {
                limit = " of " + (Long.parseLong(digits) / 1024) + " KB";
            }
        }
        return Mono.just(ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of("error",
                "request body exceeds the limit" + limit + " (spring.codec.max-in-memory-size)")));
    }

    @ExceptionHandler(UnsupportedMediaTypeStatusException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleMediaType(UnsupportedMediaTypeStatusException ex) {
        List<MediaType> supported = ex.getSupportedMediaTypes();
        String send = supported.isEmpty() ? MediaType.APPLICATION_JSON_VALUE
                : supported.stream().map(MediaType::toString).collect(Collectors.joining(" or "));
        String got = ex.getContentType() == null ? "no Content-Type" : "Content-Type '" + ex.getContentType() + "'";
        return Mono.just(ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(Map.of("error", got + " is not supported here; send " + send)));
    }

    @ExceptionHandler(MethodNotAllowedException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleMethod(MethodNotAllowedException ex,
            ServerWebExchange exchange) {
        String allowed = ex.getSupportedMethods().stream().map(Object::toString).sorted()
                .collect(Collectors.joining(", "));
        return Mono.just(ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .headers(h -> h.setAllow(ex.getSupportedMethods()))
                .body(Map.of("error", ex.getHttpMethod() + " is not allowed on "
                        + exchange.getRequest().getPath().value()
                        + (allowed.isEmpty() ? "" : "; allowed: " + allowed))));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleNotFound(NoResourceFoundException ex,
            ServerWebExchange exchange) {
        return Mono.just(ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error",
                "no such endpoint: " + exchange.getRequest().getMethod() + " "
                        + exchange.getRequest().getPath().value()
                        + " (the API is documented at /swagger-ui.html)")));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleStatus(ResponseStatusException ex) {
        String reason = ex.getReason();
        if (reason == null && ex.getStatusCode() instanceof HttpStatus status) {
            reason = status.getReasonPhrase().toLowerCase(Locale.ROOT);
        }
        return Mono.just(ResponseEntity.status(ex.getStatusCode())
                .body(Map.of("error", safe(reason))));
    }

    @ExceptionHandler(Exception.class)
    public Mono<ResponseEntity<Map<String, String>>> handleGeneric(Exception ex) {
        return Mono.just(ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", safe(ex.getMessage()))));
    }

    /** Turns "Failed to read HTTP message" into the field, the offending value and what was expected. */
    static String describeInput(ServerWebInputException ex) {
        for (Throwable t = ex.getCause(); t != null; t = t.getCause()) {
            if (t instanceof InvalidFormatException ife) {
                return field(ife.getPath(), ex.getMethodParameter()) + ": '" + ife.getValue()
                        + "' is not " + expected(ife.getTargetType());
            }
            if (t instanceof UnrecognizedPropertyException upe) {
                Collection<Object> known = upe.getKnownPropertyIds();
                return "unknown field '" + upe.getPropertyName() + "'"
                        + (known == null || known.isEmpty() ? "" : "; known fields: " + known.stream()
                                .map(Object::toString).sorted().collect(Collectors.joining(", ")));
            }
            if (t instanceof MismatchedInputException mie) {
                return field(mie.getPath(), ex.getMethodParameter()) + ": expected "
                        + expected(mie.getTargetType());
            }
            if (t instanceof JsonParseException jpe) {
                JsonLocation at = jpe.getLocation();
                String where = at == null ? "" : " at line " + at.getLineNr() + ", column " + at.getColumnNr();
                return "malformed JSON" + where + ": " + jpe.getOriginalMessage();
            }
            if (t instanceof TypeMismatchException tme) {
                MethodParameter parameter = ex.getMethodParameter();
                String name = tme.getPropertyName() != null ? tme.getPropertyName()
                        : parameter != null && parameter.getParameterName() != null
                                ? parameter.getParameterName() : "parameter";
                return name + ": '" + tme.getValue() + "' is not " + expected(tme.getRequiredType());
            }
        }
        return safe(ex.getReason());
    }

    private static String field(List<JsonMappingException.Reference> path, MethodParameter parameter) {
        if (path == null || path.isEmpty()) {
            return parameter != null && parameter.getParameterName() != null ? parameter.getParameterName() : "body";
        }
        StringBuilder out = new StringBuilder();
        for (JsonMappingException.Reference ref : path) {
            if (ref.getFieldName() != null) {
                if (!out.isEmpty()) {
                    out.append('.');
                }
                out.append(ref.getFieldName());
            } else if (ref.getIndex() >= 0) {
                out.append('[').append(ref.getIndex()).append(']');
            }
        }
        return out.isEmpty() ? "body" : out.toString();
    }

    private static String expected(Class<?> type) {
        if (type == null) {
            return "a valid value";
        }
        if (type.isEnum()) {
            return "one of " + Arrays.stream(type.getEnumConstants()).map(Object::toString)
                    .collect(Collectors.joining(", ", "[", "]"));
        }
        if (type == Instant.class) {
            return "an ISO-8601 UTC timestamp like 2026-11-01T12:00:00Z";
        }
        if (Number.class.isAssignableFrom(type) || type == int.class || type == long.class) {
            return "a number";
        }
        if (type == Boolean.class || type == boolean.class) {
            return "true or false";
        }
        if (Collection.class.isAssignableFrom(type) || type.isArray()) {
            return "a JSON array";
        }
        if (type == String.class) {
            return "a string";
        }
        return "a " + type.getSimpleName() + " object";
    }

    private static String safe(String msg) {
        return msg == null ? "unexpected error" : msg;
    }
}
