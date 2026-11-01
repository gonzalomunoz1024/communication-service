package com.atlas.communication.publishing.ports.inbound;

import java.util.Set;

import com.atlas.communication.common.domain.Communication;
import com.atlas.communication.common.domain.CommunicationStatus;
import com.atlas.communication.common.domain.CommunicationType;
import com.atlas.communication.common.domain.Page;
import com.atlas.communication.publishing.domain.CreateCommunicationCommand;
import com.atlas.communication.publishing.domain.RetireRequest;
import com.atlas.communication.publishing.domain.UpdateCommunicationCommand;

import reactor.core.publisher.Mono;

/** Command side: publisher teams manage the lifecycle of their communications. */
public interface PublishingInboundPort {

    Mono<Communication> create(CreateCommunicationCommand command);

    Mono<Communication> get(String id);

    Mono<Page<Communication>> list(String tenantId, Set<CommunicationStatus> statuses,
            CommunicationType type, int page, int size);

    Mono<Communication> update(String id, UpdateCommunicationCommand command);

    Mono<Communication> publish(String id);

    Mono<Communication> retire(String id, RetireRequest request);
}
