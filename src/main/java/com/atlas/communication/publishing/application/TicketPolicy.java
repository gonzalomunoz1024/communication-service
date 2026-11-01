package com.atlas.communication.publishing.application;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

import com.atlas.communication.common.domain.Ticket;
import com.atlas.communication.servicenow.application.ServiceNowProperties;

/**
 * What the service does with the ticket a publisher chooses to attach. Tickets are optional on
 * every communication; one given is normalised: trimmed, the system defaulted to ServiceNow, a
 * ServiceNow number upper-cased and checked against {@code communication.tickets.number-pattern},
 * and linked into the instance when {@code communication.servicenow.instance-url} is set and no
 * url came with it. Nothing here calls ServiceNow.
 */
@Component
public class TicketPolicy {

    private static final String DEFAULT_PATTERN = "INC\\d{7}";
    private static final String EXAMPLE = "INC0012345";

    private final Pattern numberPattern;
    private final String instanceUrl;

    public TicketPolicy(TicketsProperties tickets, ServiceNowProperties serviceNow) {
        this.numberPattern = Pattern.compile(tickets.numberPattern() == null
                ? DEFAULT_PATTERN : tickets.numberPattern());
        this.instanceUrl = serviceNow.baseUrl();
    }

    /**
     * Trims, defaults the system, upper-cases and checks a ServiceNow number, adds the link.
     * Null stays null.
     *
     * @throws IllegalArgumentException (a 400) when the ticket is malformed
     */
    public Ticket normalise(Ticket ticket) {
        if (ticket == null) {
            return null;
        }
        String number = blankToNull(ticket.number());
        if (number == null) {
            throw new IllegalArgumentException("ticket.number is required");
        }
        String url = blankToNull(ticket.url());
        if (url != null && !url.startsWith("https://") && !url.startsWith("http://")) {
            throw new IllegalArgumentException("ticket.url must be an http(s) link");
        }
        String system = blankToNull(ticket.system());
        system = system == null ? Ticket.SERVICENOW : system.toLowerCase(Locale.ROOT);
        if (Ticket.SERVICENOW.equals(system)) {
            number = number.toUpperCase(Locale.ROOT);
            if (!numberPattern.matcher(number).matches()) {
                throw new IllegalArgumentException("ticket.number '" + number
                        + "' is not a ServiceNow incident number (" + expected() + ")");
            }
            if (url == null && instanceUrl != null) {
                url = link(number);
            }
        }
        return new Ticket(system, number, url);
    }

    /** A link to the incident form of the configured instance, looked up by number. */
    String link(String number) {
        return instanceUrl + "/nav_to.do?uri="
                + URLEncoder.encode("incident.do?sysparm_query=number=" + number, StandardCharsets.UTF_8);
    }

    private String expected() {
        return DEFAULT_PATTERN.equals(numberPattern.pattern())
                ? "like " + EXAMPLE : "matching " + numberPattern.pattern();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
