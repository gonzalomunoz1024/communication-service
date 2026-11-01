package com.atlas.communication.publishing.domain;

/** Optional retire metadata; recorded in the audit history. */
public record RetireRequest(String actor, String note) {

    public static final RetireRequest EMPTY = new RetireRequest(null, null);
}
