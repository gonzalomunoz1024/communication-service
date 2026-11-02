package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import reactor.test.StepVerifier;

/** The wording of an error body must not depend on the locale of the JVM the service runs in. */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();
    private Locale defaultLocale;

    @BeforeEach
    void rememberDefaultLocale() {
        defaultLocale = Locale.getDefault();
    }

    @AfterEach
    void restoreDefaultLocale() {
        Locale.setDefault(defaultLocale);
    }

    @Test
    void aStatusWithoutReasonLowerCasesItsPhraseTheSameWayInEveryLocale() {
        // Turkish lower-cases a capital I to a dotless ı: "Internal Server Error" would otherwise
        // come out as "ınternal server error" on a pod whose JVM runs with that default locale
        Locale.setDefault(Locale.forLanguageTag("tr-TR"));

        StepVerifier.create(handler.handleStatus(new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR)))
                .assertNext(response -> {
                    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
                    assertThat(response.getBody()).containsEntry("error", "internal server error");
                })
                .verifyComplete();
    }

    @Test
    void aStatusWithAReasonKeepsTheReason() {
        StepVerifier.create(handler.handleStatus(
                        new ResponseStatusException(HttpStatus.NOT_FOUND, "no such monitor: m1")))
                .assertNext(response -> {
                    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(response.getBody()).containsEntry("error", "no such monitor: m1");
                })
                .verifyComplete();
    }
}
