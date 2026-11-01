package com.atlas.communication.common.adapters.outbound;

import java.time.Instant;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationEvent;
import com.atlas.communication.common.domain.CommunicationEventType;

/**
 * One entry of the shared event log. {@code _id} is the global sequence number, so the natural
 * order of the collection is the order of events. The TTL index on {@code at} is created by
 * {@link MongoCommunicationEventsAdapter} with the configured retention.
 */
@Document("communication_events")
@CompoundIndex(name = "events_tenant_seq_idx", def = "{'tenantId': 1, '_id': 1}")
public class CommunicationEventDocument {

    @Id
    Long seq;
    CommunicationEventType type;
    Instant at;
    String tenantId;
    Communication communication;

    static CommunicationEventDocument fromDomain(CommunicationEvent event) {
        CommunicationEventDocument doc = new CommunicationEventDocument();
        doc.seq = event.seq();
        doc.type = event.type();
        doc.at = event.at();
        doc.tenantId = event.communication().tenantId();
        doc.communication = event.communication();
        return doc;
    }

    CommunicationEvent toDomain() {
        return new CommunicationEvent(seq, type, at, communication);
    }
}
