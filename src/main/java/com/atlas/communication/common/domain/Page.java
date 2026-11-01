package com.atlas.communication.common.domain;

import java.util.List;

/** A stable offset-paged result, plus the service-wide paging rules. */
public record Page<T>(List<T> items, int page, int size, long totalElements, boolean hasNext) {

    public static final int MAX_SIZE = 100;

    public static <T> Page<T> of(List<T> items, int page, int size, long totalElements) {
        return new Page<>(items, page, size, totalElements, (long) (page + 1) * size < totalElements);
    }

    public static int validPage(int page) {
        if (page < 0) {
            throw new IllegalArgumentException("page must be >= 0");
        }
        return page;
    }

    /** Rejects non-positive sizes, silently caps oversized requests at {@link #MAX_SIZE}. */
    public static int validSize(int size) {
        if (size < 1) {
            throw new IllegalArgumentException("size must be >= 1");
        }
        return Math.min(size, MAX_SIZE);
    }

    public <R> Page<R> map(java.util.function.Function<T, R> mapper) {
        return new Page<>(items.stream().map(mapper).toList(), page, size, totalElements, hasNext);
    }
}
