package com.atlas.communication.common.domain;

/** Ordered severity; ordinal defines rank (INFO lowest, CRITICAL highest). */
public enum Severity {
    INFO,
    MINOR,
    MAJOR,
    CRITICAL;

    public boolean atLeast(Severity other) {
        return ordinal() >= other.ordinal();
    }

    public int rank() {
        return ordinal();
    }
}
