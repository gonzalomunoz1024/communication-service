package com.atlas.communication.common.adapters.outbound;

import java.time.Instant;
import java.util.List;

import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import com.atlas.communication.common.domain.Audience;
import com.atlas.communication.common.domain.AuditEntry;
import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Severity;
import com.atlas.communication.common.domain.Ticket;

/**
 * Mongo mapping of {@link Communication}. {@code severityRank} is denormalized from the
 * severity enum so feeds can sort and range-filter numerically. The unique
 * (tenantId, externalRef) idempotency index is partial ($exists on externalRef) and is
 * created programmatically by the repository adapter — a compound sparse index would still
 * index every document because tenantId is always present.
 */
@Document("communications")
@CompoundIndexes({
        @CompoundIndex(name = "feed_idx", def = "{'tenantId': 1, 'status': 1, 'startsAt': -1}"),
        @CompoundIndex(name = "sweep_expiry_idx", def = "{'status': 1, 'expiresAt': 1}"),
        @CompoundIndex(name = "sweep_activation_idx", def = "{'status': 1, 'startsAt': 1}")
})
public class CommunicationDocument {

    @Id
    String id;
    String tenantId;
    String publisher;
    CommunicationType type;
    Severity severity;
    int severityRank;
    String title;
    String body;
    @Indexed
    List<String> affectedServices;
    Audience audience;
    CommunicationStatus status;
    Instant startsAt;
    Instant endsAt;
    Instant expiresAt;
    String externalRef;
    Ticket ticket;
    Instant createdAt;
    Instant updatedAt;
    @Version
    Long version;
    List<AuditEntry> history;

    public static CommunicationDocument fromDomain(Communication c) {
        CommunicationDocument doc = new CommunicationDocument();
        doc.id = c.id();
        doc.tenantId = c.tenantId();
        doc.publisher = c.publisher();
        doc.type = c.type();
        doc.severity = c.severity();
        doc.severityRank = c.severity().rank();
        doc.title = c.title();
        doc.body = c.body();
        doc.affectedServices = c.affectedServices();
        doc.audience = c.audience();
        doc.status = c.status();
        doc.startsAt = c.startsAt();
        doc.endsAt = c.endsAt();
        doc.expiresAt = c.expiresAt();
        doc.externalRef = c.externalRef();
        doc.ticket = c.ticket();
        doc.createdAt = c.createdAt();
        doc.updatedAt = c.updatedAt();
        doc.version = c.version();
        doc.history = c.history();
        return doc;
    }

    public Communication toDomain() {
        return new Communication(id, tenantId, publisher, type, severity, title, body,
                affectedServices, audience, status, startsAt, endsAt, expiresAt, externalRef, ticket,
                createdAt, updatedAt, version, history);
    }
}
