package com.atlas.communication.common.domain;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The ticket in an external tracker that a communication is tied to: for an outage or incident a
 * person publishes, the ServiceNow incident that tracks it. {@code system} names the tracker
 * ({@link #SERVICENOW} unless said otherwise), {@code number} is the ticket as people quote it
 * ({@code INC0012345}), {@code url} is a link straight to it, filled in by the service when it
 * knows the ServiceNow instance. Nothing here talks to ServiceNow: the ticket is a reference the
 * publisher owns, which later phases of the integration can enrich with the ticket's status.
 */
public record Ticket(
        @Size(max = 32) String system,
        @NotBlank @Size(max = 64) String number,
        @Size(max = 2048) String url) {

    public static final String SERVICENOW = "servicenow";

    /** A ServiceNow ticket by number; the policy adds the link when an instance is configured. */
    public static Ticket serviceNow(String number) {
        return new Ticket(SERVICENOW, number, null);
    }
}
