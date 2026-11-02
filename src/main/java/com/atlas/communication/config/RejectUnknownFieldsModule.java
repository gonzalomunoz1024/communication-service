package com.atlas.communication.config;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import tools.jackson.core.JsonParser;
import tools.jackson.core.TokenStreamContext;
import tools.jackson.databind.BeanDescription;
import tools.jackson.databind.DeserializationConfig;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.deser.DeserializationProblemHandler;
import tools.jackson.databind.deser.ValueDeserializerModifier;
import tools.jackson.databind.deser.std.DelegatingDeserializer;
import tools.jackson.databind.exc.UnrecognizedPropertyException;
import tools.jackson.databind.module.SimpleModule;

/**
 * Unknown JSON fields are ignored service-wide (Jackson 3 leaves
 * {@code FAIL_ON_UNKNOWN_PROPERTIES} off), which health reports rely on: a forwarded Actuator
 * document carries keys of its own ({@code groups}, whatever a producer adds). A type that declares
 * {@code @JsonIgnoreProperties(ignoreUnknown = false)} gets the opposite: a body with fields it does
 * not know is a 400 that names every one of them (a nested one by its path, {@code ticket.ulr})
 * and lists the known ones, so a misspelled optional field ({@code sevrity}, {@code expiryAt})
 * cannot silently change what is published, and a client that sends a whole GET document back
 * learns in one answer what to leave out. Jackson alone reads that declaration as "defer to the
 * global setting", hence this module: its handler collects the unknown fields of such a type while
 * the body is read, and the outermost such type, once read, throws them as one
 * {@link UnknownFieldsException}. A value that does not bind fails the read before that, so the
 * answer about unknown fields, when it comes, names them all. Any {@code @JsonIgnoreProperties}
 * without {@code ignoreUnknown = true} counts as the declaration. Boot registers every
 * {@link tools.jackson.databind.JacksonModule} bean with its JsonMapper.
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
        context.addHandler(new CollectDeclaredUnknownFields());
        context.addDeserializerModifier(new ReportDeclaredUnknownFields());
    }

    static boolean rejectsUnknownFields(Class<?> type) {
        JsonIgnoreProperties ignorals = type.getAnnotation(JsonIgnoreProperties.class);
        return ignorals != null && !ignorals.ignoreUnknown();
    }

    /**
     * Notes each unknown field of a declaring type and skips its value. Read outside the
     * {@link ReportUnknownFields} of its type, the first one ends the read, as Jackson would.
     */
    static final class CollectDeclaredUnknownFields extends DeserializationProblemHandler {

        @Override
        public boolean handleUnknownProperty(DeserializationContext ctxt, JsonParser p,
                ValueDeserializer<?> deserializer, Object beanOrClass, String propertyName) {
            Class<?> type = beanOrClass instanceof Class<?> declared ? declared : beanOrClass.getClass();
            if (!rejectsUnknownFields(type)) {
                return false;
            }
            Collection<Object> known = deserializer == null ? null : deserializer.getKnownPropertyNames();
            UnknownFields unknown = (UnknownFields) ctxt.getAttribute(UnknownFields.class);
            if (unknown == null || unknown.reading != type) {
                throw UnrecognizedPropertyException.from(p, beanOrClass, propertyName, known);
            }
            unknown.add(propertyName, known);
            p.skipChildren();
            return true;
        }
    }

    /** Puts {@link ReportUnknownFields} around the deserializer of every declaring type. */
    static final class ReportDeclaredUnknownFields extends ValueDeserializerModifier {

        private static final long serialVersionUID = 1L;

        @Override
        public ValueDeserializer<?> modifyDeserializer(DeserializationConfig config, BeanDescription.Supplier beanDesc,
                ValueDeserializer<?> deserializer) {
            return rejectsUnknownFields(beanDesc.getBeanClass()) ? new ReportUnknownFields(deserializer) : deserializer;
        }
    }

    /**
     * Tells the handler which object is being read and where it sits in the body; the outermost one
     * keeps what the handler collects in the read's own attributes and, once read, throws it.
     */
    static final class ReportUnknownFields extends DelegatingDeserializer {

        ReportUnknownFields(ValueDeserializer<?> delegatee) {
            super(delegatee);
        }

        @Override
        protected ValueDeserializer<?> newDelegatingInstance(ValueDeserializer<?> newDelegatee) {
            return new ReportUnknownFields(newDelegatee);
        }

        @Override
        public Object deserialize(JsonParser p, DeserializationContext ctxt) {
            UnknownFields enclosing = (UnknownFields) ctxt.getAttribute(UnknownFields.class);
            UnknownFields unknown = enclosing == null ? new UnknownFields() : enclosing;
            Class<?> outerType = unknown.reading;
            String outerPath = unknown.path;
            unknown.reading = handledType();
            unknown.path = pathOf(p.streamReadContext());
            if (enclosing == null) {
                ctxt.setAttribute(UnknownFields.class, unknown);
            }
            try {
                Object value = super.deserialize(p, ctxt);
                if (enclosing == null && !unknown.names.isEmpty()) {
                    throw new UnknownFieldsException(p, handledType(), unknown);
                }
                return value;
            } finally {
                unknown.reading = outerType;
                unknown.path = outerPath;
                if (enclosing == null) {
                    ctxt.setAttribute(UnknownFields.class, null);
                }
            }
        }

        /** Where the object being read sits: "" for the body itself, "ticket", "slots[1]". */
        private static String pathOf(TokenStreamContext object) {
            TokenStreamContext parent = object.getParent();
            if (parent == null || parent.inRoot()) {
                return "";
            }
            String above = pathOf(parent);
            if (parent.inArray()) {
                return above + "[" + parent.getCurrentIndex() + "]";
            }
            return above.isEmpty() ? parent.currentName() : above + "." + parent.currentName();
        }
    }

    /** What the handler collected during one read. */
    static final class UnknownFields {

        /** Each unknown field by its path, with the path of the object holding it. */
        private final TreeMap<String, String> names = new TreeMap<>();
        /** The known fields of each object holding an unknown one, by that object's path. */
        private final Map<String, List<Object>> knownFields = new TreeMap<>();
        private Class<?> reading;
        private String path = "";

        void add(String name, Collection<Object> known) {
            names.put(path.isEmpty() ? name : path + "." + name, path);
            knownFields.putIfAbsent(path, known == null ? List.of() : List.copyOf(known));
        }
    }

    /**
     * Every unknown field of one body. As Jackson's own exception it names the first of them with
     * the fields of the object that holds it.
     */
    public static final class UnknownFieldsException extends UnrecognizedPropertyException {

        private static final long serialVersionUID = 1L;

        private final transient List<String> names;
        private final transient Map<String, List<Object>> knownFields;

        UnknownFieldsException(JsonParser p, Class<?> type, UnknownFields unknown) {
            super(p, "Unrecognized fields " + unknown.names.keySet() + " (class " + type.getName() + ")",
                    p.currentTokenLocation(), type, unknown.names.firstKey(),
                    unknown.knownFields.get(unknown.names.firstEntry().getValue()));
            this.names = List.copyOf(unknown.names.keySet());
            this.knownFields = Map.copyOf(unknown.knownFields);
        }

        /** Sorted; a nested field by its path ({@code ticket.ulr}, {@code slots[1].form}). */
        public List<String> names() {
            return names;
        }

        /** The known fields of each object holding an unknown one, by that object's path ("" for the body). */
        public Map<String, List<Object>> knownFields() {
            return knownFields;
        }
    }
}
