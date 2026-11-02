package com.atlas.communication.publishing.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Optional retire metadata; recorded in the audit history. Unknown fields are a 400, not ignored. */
@JsonIgnoreProperties(ignoreUnknown = false)
public record RetireRequest(String actor, String note) {

    public static final RetireRequest EMPTY = new RetireRequest(null, null);
}
