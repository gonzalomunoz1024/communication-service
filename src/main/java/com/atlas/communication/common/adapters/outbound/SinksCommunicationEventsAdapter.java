package com.atlas.communication.common.adapters.outbound;

import java.time.Clock;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.stereotype.Component;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;
import com.atlas.communication.common.ports.outbound.CommunicationEventsPort;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

/**
 * In-process multicast bus. No replay: SSE subscribers get a snapshot on subscribe, so a hot
 * stream from "now" onward is sufficient and reconnects are self-healing.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SinksCommunicationEventsAdapter implements CommunicationEventsPort {

    private final Clock clock;
    private final AtomicLong sequence = new AtomicLong();
    // directBestEffort: no warm-up buffer (events with zero subscribers are dropped, never
    // replayed to the first subscriber) and slow subscribers miss events instead of blocking
    // publishers; the snapshot-on-subscribe contract makes both safe.
    private final Sinks.Many<CommunicationEvent> sink =
            Sinks.many().multicast().directBestEffort();

    @Override
    public CommunicationEvent emit(CommunicationEventType type, Communication communication) {
        CommunicationEvent event = new CommunicationEvent(
                sequence.incrementAndGet(), type, clock.instant(), communication);
        Sinks.EmitResult result = sink.tryEmitNext(event);
        if (result.isFailure() && result != Sinks.EmitResult.FAIL_ZERO_SUBSCRIBER) {
            log.warn("dropped communication event seq={} type={} id={}: {}",
                    event.seq(), type, communication.id(), result);
        }
        return event;
    }

    @Override
    public Flux<CommunicationEvent> stream() {
        return sink.asFlux();
    }
}
