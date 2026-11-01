package com.atlas.communication.publishing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

import com.atlas.communication.common.domain.Ticket;
import com.atlas.communication.servicenow.application.ServiceNowProperties;

class TicketPolicyTest {

    private static final String LINK = "https://acme.service-now.com/nav_to.do?uri="
            + "incident.do%3Fsysparm_query%3Dnumber%3DINC0012345";

    private static TicketPolicy policy(String instanceUrl) {
        return new TicketPolicy(new TicketsProperties("INC\\d{7}"), new ServiceNowProperties(instanceUrl));
    }

    @Test
    void noTicketIsFine() {
        assertThat(policy("https://acme.service-now.com").normalise(null)).isNull();
    }

    @Test
    void normalisationTrimsUpperCasesDefaultsTheSystemAndLinksIntoTheInstance() {
        Ticket normalised = policy("https://acme.service-now.com/").normalise(new Ticket(null, " inc0012345 ", null));
        assertThat(normalised).isEqualTo(new Ticket("servicenow", "INC0012345", LINK));
        assertThat(policy("https://acme.service-now.com").normalise(new Ticket(" ServiceNow ", "INC0012345", " "))
                .url()).isEqualTo(LINK);
    }

    @Test
    void withoutAnInstanceThereIsNoLinkAndAGivenLinkIsKept() {
        assertThat(policy(null).normalise(Ticket.serviceNow("INC0012345")).url()).isNull();
        assertThat(policy("  ").normalise(Ticket.serviceNow("INC0012345")).url()).isNull();
        assertThat(policy("https://acme.service-now.com")
                .normalise(new Ticket("servicenow", "INC0012345", "https://tickets.example/INC0012345")).url())
                .isEqualTo("https://tickets.example/INC0012345");
    }

    @Test
    void serviceNowNumbersMustLookLikeIncidents() {
        TicketPolicy policy = policy(null);
        assertThatThrownBy(() -> policy.normalise(Ticket.serviceNow("INC-4821")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("INC-4821")
                .hasMessageContaining("not a ServiceNow incident number");
        assertThatThrownBy(() -> policy.normalise(Ticket.serviceNow("CHG0012345")))
                .hasMessageContaining("CHG0012345");
        assertThatThrownBy(() -> policy.normalise(new Ticket(null, "  ", null)))
                .hasMessageContaining("ticket.number is required");
    }

    @Test
    void linksMustBeHttp() {
        assertThatThrownBy(() -> policy(null).normalise(new Ticket(null, "INC0012345", "javascript:alert(1)")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ticket.url");
    }

    @Test
    void otherTrackersAreFreeFormAndNeverLinked() {
        Ticket jira = policy("https://acme.service-now.com").normalise(new Ticket(" Jira ", " ops-123 ", null));
        assertThat(jira).isEqualTo(new Ticket("jira", "ops-123", null));
    }

    @Test
    void thePatternIsConfigurable() {
        TicketPolicy relaxed = new TicketPolicy(new TicketsProperties("[A-Z]+-\\d+"),
                new ServiceNowProperties(null));
        assertThat(relaxed.normalise(Ticket.serviceNow("inc-42")).number()).isEqualTo("INC-42");
        assertThatThrownBy(() -> relaxed.normalise(Ticket.serviceNow("INC0012345")))
                .hasMessageContaining("matching [A-Z]+-\\d+");
    }
}
