package com.atlas.communication.config;

import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebInputException;

import reactor.core.publisher.Mono;

/**
 * Central error mapping: IllegalArgumentException -> 400, binding/input errors -> 400,
 * ResponseStatusException -> its status, everything else -> 500. Body is {"error": "..."}.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

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
        return Mono.just(ResponseEntity.badRequest().body(Map.of("error", safe(ex.getReason()))));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public Mono<ResponseEntity<Map<String, String>>> handleStatus(ResponseStatusException ex) {
        return Mono.just(ResponseEntity.status(ex.getStatusCode())
                .body(Map.of("error", safe(ex.getReason()))));
    }

    @ExceptionHandler(Exception.class)
    public Mono<ResponseEntity<Map<String, String>>> handleGeneric(Exception ex) {
        return Mono.just(ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", safe(ex.getMessage()))));
    }

    private static String safe(String msg) {
        return msg == null ? "unexpected error" : msg;
    }
}
