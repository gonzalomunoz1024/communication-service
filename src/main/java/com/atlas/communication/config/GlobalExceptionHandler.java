package com.atlas.communication.config;

import java.time.Instant;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
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
import org.springframework.web.server.ContentTooLargeException;
import org.springframework.web.server.MethodNotAllowedException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.ServerWebInputException;
import org.springframework.web.server.UnsupportedMediaTypeStatusException;

import com.atlas.communication.config.RejectUnknownFieldsModule.UnknownFieldsException;
import com.mongodb.MongoSocketException;
import com.mongodb.MongoTimeoutException;

import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Mono;
import tools.jackson.core.JacksonException;
import tools.jackson.core.TokenStreamLocation;
import tools.jackson.core.exc.InputCoercionException;
import tools.jackson.core.exc.StreamReadException;
import tools.jackson.databind.exc.InvalidFormatException;
import tools.jackson.databind.exc.InvalidNullException;
import tools.jackson.databind.exc.MismatchedInputException;
import tools.jackson.databind.exc.UnrecognizedPropertyException;

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
    public static final String DATABASE_UNAVAILABLE = "database unavailable";

    /**
     * Whether {@code ex} says the database cannot be reached: the failures
     * {@link #handleDatabaseUnavailable} answers with 503 (keep the two lists in step). A stream
     * whose answer is already committed cannot be given a 503 and uses this to end itself instead.
     */
    public static boolean isDatabaseUnavailable(Throwable ex) {
        return ex instanceof DataAccessResourceFailureException || ex instanceof MongoTimeoutException
                || ex instanceof MongoSocketException;
    }

    /**
     * The database cannot be reached (no server found within the selection timeout, connection
     * refused or timed out): 503 with a plain sentence. Spring Data hands these over translated as
     * {@link DataAccessResourceFailureException}; the driver's own forms are mapped too. The
     * driver's message names the cluster's addresses, so it goes to the log, not to the caller.
     * The body is JSON whatever the request accepts: a stream that cannot open answers this before
     * its first byte, and an event-stream frame would hide the status from an EventSource client.
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
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("error", DATABASE_UNAVAILABLE)));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleBadRequest(IllegalArgumentException ex) {
        return Mono.just(ResponseEntity.badRequest().body(Map.of("error", safe(ex.getMessage()))));
    }

    @ExceptionHandler(WebExchangeBindException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleBind(WebExchangeBindException ex) {
        String message = ex.getFieldErrors().stream()
                .map(f -> {
                    String rule = f.getDefaultMessage();
                    // a message that names its field reads as a sentence ("expectedVersion is required: …")
                    return rule != null && rule.startsWith(f.getField() + " ") ? rule : f.getField() + ": " + rule;
                })
                .sorted()
                .collect(Collectors.joining("; "));
        return Mono.just(ResponseEntity.badRequest()
                .body(Map.of("error", message.isEmpty() ? "invalid request" : message)));
    }

    @ExceptionHandler(ServerWebInputException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleInput(ServerWebInputException ex) {
        return Mono.just(ResponseEntity.badRequest().body(Map.of("error", describeInput(ex))));
    }

    @ExceptionHandler(ContentTooLargeException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleTooLarge(ContentTooLargeException ex) {
        String limit = "";
        if (ex.getCause() instanceof DataBufferLimitException cause && cause.getMessage() != null) {
            // "Exceeded limit on max bytes to buffer : 262144"
            String digits = cause.getMessage().replaceAll("\\D", "");
            if (!digits.isEmpty()) {
                limit = " of " + (Long.parseLong(digits) / 1024) + " KB";
            }
        }
        return Mono.just(ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE).body(Map.of("error",
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

    /**
     * The reason as {@code error}; fields the thrower put on the problem detail come beside it
     * (the 409 for a reused externalRef adds {@code suggestedExternalRef}).
     */
    @ExceptionHandler(ResponseStatusException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleStatus(ResponseStatusException ex) {
        String reason = ex.getReason();
        if (reason == null && ex.getStatusCode() instanceof HttpStatus status) {
            reason = status.getReasonPhrase().toLowerCase(Locale.ROOT);
        }
        Map<String, String> body = new LinkedHashMap<>();
        body.put("error", safe(reason));
        Map<String, Object> fields = ex.getBody().getProperties();
        if (fields != null) {
            fields.forEach((name, value) -> body.putIfAbsent(name, String.valueOf(value)));
        }
        return Mono.just(ResponseEntity.status(ex.getStatusCode()).body(body));
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
            if (t instanceof UnknownFieldsException all) {
                return unknownFields(all.names(), all.knownFields());
            }
            if (t instanceof UnrecognizedPropertyException upe) {
                // the dotted path, so a typo inside a nested object reads "ticket.ulr"
                String name = upe.getPath().isEmpty() ? upe.getPropertyName()
                        : field(upe.getPath(), null);
                Collection<Object> known = upe.getKnownPropertyIds();
                return unknownFields(Collections.singletonList(name),
                        Collections.singletonMap("", known == null ? List.of() : known));
            }
            if (t instanceof InvalidNullException ine) {
                // a JSON null where the type takes none, e.g. an entry of affectedServices
                return field(ine.getPath(), ex.getMethodParameter()) + ": must not be null";
            }
            if (t instanceof MismatchedInputException mie) {
                return field(mie.getPath(), ex.getMethodParameter()) + ": expected "
                        + expected(mie.getTargetType());
            }
            // what Jackson 2 called a JsonParseException; a number too large for its field is not one
            if (t instanceof StreamReadException jpe && !(t instanceof InputCoercionException)) {
                TokenStreamLocation at = jpe.getLocation();
                // a location Jackson does not know is TokenStreamLocation.NA, line -1
                String where = at == null || at.getLineNr() < 1 ? ""
                        : " at line " + at.getLineNr() + ", column " + at.getColumnNr();
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

    /**
     * "unknown field 'sevrity'; known fields: …", or every unknown field of the body, sorted, with
     * the known fields of each object holding one: "unknown fields 'sevrity', 'ticket.ulr'; known
     * fields: …; known fields of ticket: number, system, url".
     */
    private static String unknownFields(List<String> names, Map<String, ? extends Collection<Object>> knownFields) {
        StringBuilder out = new StringBuilder(names.size() == 1 ? "unknown field " : "unknown fields ")
                .append(names.stream().map(name -> "'" + name + "'").collect(Collectors.joining(", ")));
        new TreeMap<>(knownFields).forEach((object, known) -> {
            if (!known.isEmpty()) {
                out.append(object.isEmpty() || knownFields.size() == 1 ? "; known fields: "
                        : "; known fields of " + object + ": ")
                        .append(known.stream().map(Object::toString).sorted().collect(Collectors.joining(", ")));
            }
        });
        return out.toString();
    }

    private static String field(List<JacksonException.Reference> path, MethodParameter parameter) {
        if (path == null || path.isEmpty()) {
            return parameter != null && parameter.getParameterName() != null ? parameter.getParameterName() : "body";
        }
        StringBuilder out = new StringBuilder();
        for (JacksonException.Reference ref : path) {
            if (ref.getPropertyName() != null) {
                if (!out.isEmpty()) {
                    out.append('.');
                }
                out.append(ref.getPropertyName());
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
