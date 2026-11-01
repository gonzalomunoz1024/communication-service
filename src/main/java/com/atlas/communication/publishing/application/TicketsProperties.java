package com.atlas.communication.publishing.application;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** {@code communication.tickets.*}: what a ServiceNow incident number looks like. */
@ConfigurationProperties(prefix = "communication.tickets")
public record TicketsProperties(@DefaultValue("INC\\d{7}") String numberPattern) {
}
