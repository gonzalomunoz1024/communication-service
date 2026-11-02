package com.atlas.communication.config;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import tools.jackson.core.JsonParser;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.deser.DeserializationProblemHandler;
import tools.jackson.databind.exc.UnrecognizedPropertyException;
import tools.jackson.databind.module.SimpleModule;

/**
 * Unknown JSON fields are ignored service-wide (Jackson 3 leaves
 * {@code FAIL_ON_UNKNOWN_PROPERTIES} off), which health reports rely on: a forwarded Actuator
 * document carries keys of its own ({@code groups}, whatever a producer adds). A type that declares
 * {@code @JsonIgnoreProperties(ignoreUnknown = false)} gets the opposite: a field it does not know
 * is a 400 naming the field and listing the known ones, so a misspelled optional field
 * ({@code sevrity}, {@code expiryAt}) cannot silently change what is published. Jackson alone reads
 * that declaration as "defer to the global setting", hence this handler. Any
 * {@code @JsonIgnoreProperties} without {@code ignoreUnknown = true} counts as the declaration.
 * Boot registers every {@link tools.jackson.databind.JacksonModule} bean with its JsonMapper.
 */
@Component
public class RejectUnknownFieldsModule extends SimpleModule {

    private static final long serialVersionUID = 1L;

    public RejectUnknownFieldsModule() {
        super(RejectUnknownFieldsModule.class.getSimpleName());
    }

    @Override
    public void setupModule(SetupContext context) {
        super.setupModule(context);
        context.addHandler(new RejectDeclaredUnknownFields());
    }

    /** Throws what Jackson throws with FAIL_ON_UNKNOWN_PROPERTIES on, for the declaring types only. */
    static final class RejectDeclaredUnknownFields extends DeserializationProblemHandler {

        @Override
        public boolean handleUnknownProperty(DeserializationContext ctxt, JsonParser p,
                ValueDeserializer<?> deserializer, Object beanOrClass, String propertyName) {
            Class<?> type = beanOrClass instanceof Class<?> declared ? declared : beanOrClass.getClass();
            JsonIgnoreProperties ignorals = type.getAnnotation(JsonIgnoreProperties.class);
            if (ignorals != null && !ignorals.ignoreUnknown()) {
                throw UnrecognizedPropertyException.from(p, beanOrClass, propertyName,
                        deserializer == null ? null : deserializer.getKnownPropertyNames());
            }
            return false;
        }
    }
}
