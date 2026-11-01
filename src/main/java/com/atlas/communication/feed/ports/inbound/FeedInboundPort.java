package com.atlas.communication.feed.ports.inbound;

import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.feed.domain.FeedItem;
import com.atlas.communication.feed.domain.FeedQuery;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/** Query side: what consumers (VMForge UI, other pods) read and subscribe to. */
public interface FeedInboundPort {

    Mono<Page<FeedItem>> feed(FeedQuery query);

    /** One item by id; DRAFT and unknown ids are 404. EXPIRED/RETIRED stay retrievable. */
    Mono<FeedItem> item(String id);

    /** Snapshot of currently visible items, then live lifecycle events matching the filters. */
    Flux<CommunicationEvent> stream(FeedQuery query);
}
