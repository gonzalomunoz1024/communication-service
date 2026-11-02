package com.atlas.communication;

import java.util.List;

import org.slf4j.LoggerFactory;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

/**
 * Captures what one class logs, so a test can assert on levels, messages and whether a stack
 * trace was attached. Opens the logger at DEBUG for its lifetime and restores it on close.
 */
public final class LogCapture implements AutoCloseable {

    private final Logger logger;
    private final Level previous;
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

    private LogCapture(String name) {
        logger = (Logger) LoggerFactory.getLogger(name);
        previous = logger.getLevel();
        logger.setLevel(Level.DEBUG);
        appender.start();
        logger.addAppender(appender);
    }

    public static LogCapture of(Class<?> type) {
        return new LogCapture(type.getName());
    }

    /** For a logger whose class is not accessible from a test, such as one inside a library. */
    public static LogCapture of(String loggerName) {
        return new LogCapture(loggerName);
    }

    public List<ILoggingEvent> events() {
        return List.copyOf(appender.list);
    }

    /** Events at {@code level} or above, in order. */
    public List<ILoggingEvent> atLeast(Level level) {
        return events().stream().filter(e -> e.getLevel().isGreaterOrEqual(level)).toList();
    }

    @Override
    public void close() {
        logger.detachAppender(appender);
        appender.stop();
        logger.setLevel(previous);
    }
}
