package com.atlas.communication.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.TypeMismatchException;
import org.springframework.core.DefaultParameterNameDiscoverer;
import org.springframework.core.MethodParameter;
import org.springframework.core.codec.DecodingException;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.server.ContentTooLargeException;
import org.springframework.web.server.MethodNotAllowedException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebInputException;
import org.springframework.web.server.UnsupportedMediaTypeStatusException;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import reactor.core.publisher.Mono;
import tools.jackson.core.JacksonException;
import tools.jackson.core.JsonParser;
import tools.jackson.core.exc.StreamReadException;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.exc.InvalidFormatException;
import tools.jackson.databind.exc.UnrecognizedPropertyException;
import tools.jackson.databind.json.JsonMapper;

/**
 * What the handler answers on its less travelled branches. A body Jackson rejects is answered
 * with the field's path (nested names, list indexes) and what that kind of field takes; a query
 * parameter Spring cannot convert is named; and an exception that carries less than usual (no
 * path, no parameter name, no location, no target type, no known fields, no reason, no limit)
 * still gets a sentence, never "null".
 */
class GlobalExceptionHandlerMessagesTest {

    enum Severity { MINOR, MAJOR }

    record Window(Instant from, Instant to) { }

    /** One field of each kind the handler describes. */
    record Command(String title, Severity severity, List<Window> windows, List<String> tags, String[] labels,
            Integer limit, int count, long total, Boolean urgent, boolean silent) { }

    record Notice(String title, Severity severity) { }

    /** Records that refuse a field they do not know, as the request bodies do. */
    @JsonIgnoreProperties(ignoreUnknown = false)
    record Slot(Instant from, Instant to) { }

    @JsonIgnoreProperties(ignoreUnknown = false)
    record Plan(String title, Severity severity, Slot first, List<Slot> slots) { }

    /** Stand-ins for handler methods: WebFlux hands the failing method parameter to the exception. */
    static final class Endpoints {

        void create(Command command) { }

        void list(Integer limit) { }
    }

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();
    /** Jackson with the defaults these messages were written against: an unknown field fails. */
    private final ObjectMapper json = JsonMapper.builderWithJackson2Defaults().build();
    /** Jackson as the service sets it up: unknown fields ignored, except by the types that refuse them. */
    private final ObjectMapper serviceJson = JsonMapper.builder().addModule(new RejectUnknownFieldsModule()).build();

    /** A handler method's parameter; {@code named} is what WebFlux does before it resolves arguments. */
    private static MethodParameter parameter(String method, Class<?> type, boolean named) {
        try {
            MethodParameter parameter = new MethodParameter(Endpoints.class.getDeclaredMethod(method, type), 0);
            // Spring 7 discovers the name by default; without discovery the parameter has none
            parameter.initParameterNameDiscovery(named ? new DefaultParameterNameDiscoverer() : null);
            return parameter;
        } catch (NoSuchMethodException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String error(Mono<ResponseEntity<Map<String, String>>> answer, HttpStatusCode status) {
        ResponseEntity<Map<String, String>> response = answer.block();
        assertThat(response).isNotNull();
        assertThat(response.getStatusCode()).isEqualTo(status);
        assertThat(response.getBody()).isNotNull().containsOnlyKeys("error");
        return response.getBody().get("error");
    }

    private String inputError(ServerWebInputException ex) {
        return error(handler.handleInput(ex), HttpStatus.BAD_REQUEST);
    }

    /** As on the wire: the decoder's exception wraps Jackson's, and names the handler's body parameter. */
    private static ServerWebInputException unreadable(Throwable jackson, MethodParameter parameter) {
        return new ServerWebInputException("Failed to read HTTP message", parameter,
                new DecodingException("JSON decoding error: " + jackson.getMessage(), jackson));
    }

    private String unreadableBody(String body) {
        try {
            json.readValue(body, Command.class);
        } catch (JacksonException e) {
            return inputError(unreadable(e, parameter("create", Command.class, true)));
        }
        throw new AssertionError("Jackson accepted " + body);
    }

    @Test
    void aFieldInsideAListIsNamedByItsPathWithTheIndex() {
        assertThat(unreadableBody("{\"windows\":[{\"from\":\"2026-11-01T12:00:00Z\"},{\"from\":\"tomorrow\"}]}"))
                .isEqualTo("windows[1].from: 'tomorrow' is not an ISO-8601 UTC timestamp like 2026-11-01T12:00:00Z");
        assertThat(unreadableBody("{\"windows\":[\"tomorrow\"]}")).isEqualTo("windows[0]: expected a Window object");
    }

    @Test
    void eachKindOfFieldSaysWhatItTakes() {
        assertThat(unreadableBody("{\"limit\":\"ten\"}")).isEqualTo("limit: 'ten' is not a number");
        assertThat(unreadableBody("{\"count\":\"ten\"}")).isEqualTo("count: 'ten' is not a number");
        assertThat(unreadableBody("{\"total\":\"all\"}")).isEqualTo("total: 'all' is not a number");
        assertThat(unreadableBody("{\"urgent\":\"maybe\"}")).isEqualTo("urgent: 'maybe' is not true or false");
        assertThat(unreadableBody("{\"silent\":\"maybe\"}")).isEqualTo("silent: 'maybe' is not true or false");
        assertThat(unreadableBody("{\"tags\":\"payments\"}")).isEqualTo("tags: expected a JSON array");
        assertThat(unreadableBody("{\"labels\":{\"first\":\"payments\"}}")).isEqualTo("labels: expected a JSON array");
        assertThat(unreadableBody("{\"title\":{\"text\":\"Checkout down\"}}")).isEqualTo("title: expected a string");
    }

    @Test
    void aBodyThatIsNotAnObjectIsNamedAfterTheHandlersParameter() {
        assertThat(unreadableBody("\"Checkout down\"")).isEqualTo("command: expected a Command object");
    }

    @Test
    void withoutAPathOrAParameterNameTheFieldIsCalledBody() {
        InvalidFormatException noPath = new InvalidFormatException((JsonParser) null, "bad value", "tomorrow", Instant.class);
        String expected = "body: 'tomorrow' is not an ISO-8601 UTC timestamp like 2026-11-01T12:00:00Z";

        assertThat(inputError(unreadable(noPath, null))).isEqualTo(expected);
        assertThat(inputError(unreadable(noPath, parameter("create", Command.class, false)))).isEqualTo(expected);

        InvalidFormatException namelessPath = new InvalidFormatException((JsonParser) null, "bad value", "tomorrow", Instant.class);
        namelessPath.prependPath(new JacksonException.Reference(Command.class));
        assertThat(inputError(unreadable(namelessPath, parameter("create", Command.class, true)))).isEqualTo(expected);
    }

    @Test
    void aValueOfUnknownTypeIsAskedForAsAValidValue() {
        InvalidFormatException untyped = new InvalidFormatException((JsonParser) null, "bad value", "soon", null);
        untyped.prependPath(new JacksonException.Reference(Command.class, "startsAt"));

        assertThat(inputError(unreadable(untyped, parameter("create", Command.class, true))))
                .isEqualTo("startsAt: 'soon' is not a valid value");
    }

    @Test
    void malformedJsonWithoutALocationStillSaysWhatIsWrong() {
        StreamReadException noLocation = new StreamReadException((JsonParser) null, "Unexpected end-of-input");

        assertThat(inputError(unreadable(noLocation, parameter("create", Command.class, true))))
                .isEqualTo("malformed JSON: Unexpected end-of-input");
    }

    @Test
    void aNumberTooLargeForItsFieldIsNotCalledMalformedJson() {
        // Jackson 3 reports it as a StreamReadException, the type that also carries malformed JSON
        assertThat(unreadableBody("{\"count\":12345678901234567890}")).doesNotStartWith("malformed JSON");
    }

    @Test
    void anUnknownFieldIsNamedWithTheKnownOnesWhenThereAreAny() {
        try {
            json.readValue("{\"title\":\"Checkout down\",\"sevrity\":\"MAJOR\"}", Notice.class);
            throw new AssertionError("Jackson accepted an unknown field");
        } catch (JacksonException e) {
            assertThat(inputError(unreadable(e, parameter("create", Command.class, true))))
                    .isEqualTo("unknown field 'sevrity'; known fields: severity, title");
        }

        for (List<Object> known : Arrays.asList(null, List.<Object>of())) {
            UnrecognizedPropertyException unknown = new UnrecognizedPropertyException((JsonParser) null,
                    "Unrecognized field", null, Notice.class, "sevrity", known);
            assertThat(inputError(unreadable(unknown, parameter("create", Command.class, true))))
                    .as("known fields %s", known)
                    .isEqualTo("unknown field 'sevrity'");
        }
    }

    private String unreadablePlan(String body) {
        try {
            serviceJson.readValue(body, Plan.class);
        } catch (JacksonException e) {
            return inputError(unreadable(e, null));
        }
        throw new AssertionError("Jackson accepted " + body);
    }

    @Test
    void everyUnknownFieldOfABodyIsNamedSortedWithTheFieldsOfEachObjectHoldingOne() {
        String plan = "first, severity, slots, title";

        assertThat(unreadablePlan("{\"titel\":\"Checkout down\",\"sevrity\":\"MAJOR\",\"severity\":\"MAJOR\"}"))
                .isEqualTo("unknown fields 'sevrity', 'titel'; known fields: " + plan);
        // nested ones by their path (list entries by index), in whatever order the body has them
        String everywhere = "unknown fields 'first.ot', 'slots[1].form', 'titel'; known fields: " + plan
                + "; known fields of first: from, to; known fields of slots[1]: from, to";
        assertThat(unreadablePlan("{\"titel\":\"x\",\"first\":{\"ot\":\"y\"},\"slots\":[{},{\"form\":\"z\"}]}"))
                .isEqualTo(everywhere);
        assertThat(unreadablePlan("{\"slots\":[{},{\"form\":\"z\"}],\"first\":{\"ot\":\"y\"},\"titel\":\"x\"}"))
                .isEqualTo(everywhere);
        // all in one object: its own fields are the hint, as for a single unknown field
        assertThat(unreadablePlan("{\"first\":{\"ot\":\"y\",\"form\":\"z\",\"ot\":\"again\"}}"))
                .isEqualTo("unknown fields 'first.form', 'first.ot'; known fields: from, to");
        assertThat(unreadablePlan("{\"first\":{\"ot\":\"y\"}}")).isEqualTo("unknown field 'first.ot'; known fields: from, to");
    }

    @Test
    void theAnswerAboutUnknownFieldsComesOnceTheRestOfTheBodyBindsSoItNamesThemAll() {
        // a value that does not bind is answered first, whether it comes before or after the unknown fields
        assertThat(unreadablePlan("{\"first\":{\"ot\":\"y\"},\"sevrity\":\"MAJOR\",\"severity\":\"HUGE\"}"))
                .isEqualTo("severity: 'HUGE' is not one of [MINOR, MAJOR]");
        assertThat(unreadablePlan("{\"first\":{\"ot\":\"y\"},\"sevrity\":\"MAJOR\",\"severity\":\"MINOR\"}"))
                .isEqualTo("unknown fields 'first.ot', 'sevrity'; known fields: first, severity, slots, title; "
                        + "known fields of first: from, to");
    }

    @Test
    void anInputErrorWithoutAJacksonCauseAnswersWithItsReason() {
        assertThat(inputError(new ServerWebInputException("No request body", parameter("create", Command.class, true))))
                .isEqualTo("No request body");
    }

    @Test
    void aQueryParameterSpringCannotConvertIsNamedByTheParameter() {
        TypeMismatchException mismatch = new TypeMismatchException("ten", Integer.class);

        assertThat(inputError(new ServerWebInputException("Type mismatch.", parameter("list", Integer.class, true), mismatch)))
                .isEqualTo("limit: 'ten' is not a number");
        assertThat(inputError(new ServerWebInputException("Type mismatch.", parameter("list", Integer.class, false), mismatch)))
                .isEqualTo("parameter: 'ten' is not a number");
        assertThat(inputError(new ServerWebInputException("Type mismatch.", null, mismatch)))
                .isEqualTo("parameter: 'ten' is not a number");
    }

    @Test
    void aBindingFailureWithoutFieldErrorsStillAnswersASentence() {
        WebExchangeBindException noFieldErrors = new WebExchangeBindException(parameter("create", Command.class, true),
                new BeanPropertyBindingResult(new Notice("Checkout down", Severity.MAJOR), "command"));

        assertThat(error(handler.handleBind(noFieldErrors), HttpStatus.BAD_REQUEST)).isEqualTo("invalid request");
    }

    @Test
    void anOversizedBodyNamesTheLimitWhenTheCauseCarriesIt() {
        String unnamed = "request body exceeds the limit (spring.codec.max-in-memory-size)";

        assertThat(error(handler.handleTooLarge(new ContentTooLargeException(
                new DataBufferLimitException("Exceeded limit on max bytes to buffer : 262144"))), HttpStatus.CONTENT_TOO_LARGE))
                .isEqualTo("request body exceeds the limit of 256 KB (spring.codec.max-in-memory-size)");
        assertThat(error(handler.handleTooLarge(new ContentTooLargeException(null)), HttpStatus.CONTENT_TOO_LARGE))
                .isEqualTo(unnamed);
        assertThat(error(handler.handleTooLarge(new ContentTooLargeException(new DataBufferLimitException(null))),
                HttpStatus.CONTENT_TOO_LARGE)).isEqualTo(unnamed);
        assertThat(error(handler.handleTooLarge(new ContentTooLargeException(
                new DataBufferLimitException("Exceeded limit on max bytes to buffer"))), HttpStatus.CONTENT_TOO_LARGE))
                .isEqualTo(unnamed);
    }

    @Test
    void anUnsupportedMediaTypeWithoutDetailsAsksForJson() {
        assertThat(error(handler.handleMediaType(new UnsupportedMediaTypeStatusException("Content type not supported")),
                HttpStatus.UNSUPPORTED_MEDIA_TYPE))
                .isEqualTo("no Content-Type is not supported here; send application/json");
    }

    @Test
    void aMethodNotAllowedWithoutAlternativesListsNone() {
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.method(HttpMethod.TRACE, "/v1/communications"));

        ResponseEntity<Map<String, String>> response = handler.handleMethod(
                new MethodNotAllowedException(HttpMethod.TRACE, List.of()), exchange).block();

        assertThat(response).isNotNull();
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.METHOD_NOT_ALLOWED);
        assertThat(response.getBody()).containsExactly(Map.entry("error", "TRACE is not allowed on /v1/communications"));
        assertThat(response.getHeaders().getAllow()).isEmpty();
    }

    @Test
    void aStatusWithoutAReasonOrAStandardPhraseSaysUnexpectedError() {
        assertThat(error(handler.handleStatus(new ResponseStatusException(HttpStatusCode.valueOf(499))),
                HttpStatusCode.valueOf(499))).isEqualTo("unexpected error");
    }
}
