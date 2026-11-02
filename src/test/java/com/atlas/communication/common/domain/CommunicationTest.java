package com.atlas.communication.common.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;

class CommunicationTest {

    private static final Instant NOW = Instant.parse("2026-10-14T12:00:00Z");

    private static Communication outage(Instant startsAt, Instant expiresAt, boolean draft) {
        return Communication.create("c1", "vmforge", "vmforge-sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "API degradation", "details", List.of("vm-api"), null, draft,
                startsAt, null, expiresAt, "INC0012345", NOW);
    }

    @Test
    void createDefaultsStartToNowAndAudienceToCustomers() {
        Communication c = outage(null, null, false);
        assertThat(c.startsAt()).isEqualTo(NOW);
        assertThat(c.audience()).isEqualTo(Audience.CUSTOMERS);
        assertThat(c.status()).isEqualTo(CommunicationStatus.ACTIVE);
        assertThat(c.history()).hasSize(1);
        assertThat(c.createdAt()).isEqualTo(NOW);
    }

    @Test
    void createDraftStaysDraftEvenWhenStartIsPast() {
        assertThat(outage(NOW.minusSeconds(60), null, true).status())
                .isEqualTo(CommunicationStatus.DRAFT);
    }

    @Test
    void createWithFutureStartIsScheduled() {
        assertThat(outage(NOW.plusSeconds(3600), null, false).status())
                .isEqualTo(CommunicationStatus.SCHEDULED);
    }

    @Test
    void maintenanceDefaultsExpiryToWindowEnd() {
        Instant start = NOW.plusSeconds(3600);
        Instant end = NOW.plusSeconds(7200);
        Communication m = Communication.create("m1", "vmforge", "vmforge-sre",
                CommunicationType.MAINTENANCE, Severity.INFO, "Planned upgrade", null,
                List.of(), null, false, start, end, null, null, NOW);
        assertThat(m.expiresAt()).isEqualTo(end);
        assertThat(m.status()).isEqualTo(CommunicationStatus.SCHEDULED);
    }

    @Test
    void maintenanceRequiresWindowEnd() {
        assertThatThrownBy(() -> Communication.create("m1", "vmforge", "sre",
                CommunicationType.MAINTENANCE, Severity.INFO, "Planned", null, List.of(), null,
                false, NOW, null, null, null, NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("MAINTENANCE requires endsAt");
    }

    @Test
    void incidentAndOutageRequireAtLeastMinorSeverity() {
        assertThatThrownBy(() -> Communication.create("c2", "vmforge", "sre",
                CommunicationType.INCIDENT, Severity.INFO, "oops", null, List.of(), null,
                false, null, null, null, null, NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("severity MINOR or higher");
    }

    @Test
    void endsBeforeStartIsRejected() {
        assertThatThrownBy(() -> Communication.create("m1", "vmforge", "sre",
                CommunicationType.MAINTENANCE, Severity.INFO, "Planned", null, List.of(), null,
                false, NOW.plusSeconds(100), NOW.plusSeconds(50), null, null, NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("endsAt 2026-10-14T12:00:50Z must be after startsAt 2026-10-14T12:01:40Z");
    }

    @Test
    void anEndNotAfterTheStartNamesBothValuesAndAStartThatDefaulted() {
        // no startsAt: the window starts now, which the publisher did not write, so the message says so
        assertThatThrownBy(() -> Communication.create("m1", "vmforge", "sre", CommunicationType.MAINTENANCE,
                Severity.INFO, "Planned", null, List.of(), null, false, null,
                Instant.parse("2026-10-01T09:00:00Z"), null, null, NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("endsAt 2026-10-01T09:00:00Z must be after startsAt, which defaulted to now "
                        + "(2026-10-14T12:00:00Z)");
        // an update that moves the end before the stored start: the stored value, named as such
        Communication window = Communication.create("m1", "vmforge", "sre", CommunicationType.MAINTENANCE,
                Severity.INFO, "Planned", null, List.of(), null, false, NOW.plusSeconds(3600),
                NOW.plusSeconds(7200), null, null, NOW);
        assertThatThrownBy(() -> window.withContent(null, null, null, null, null, null,
                NOW.plusSeconds(1800), null, "sre", NOW.plusSeconds(10)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("endsAt 2026-10-14T12:30:00Z must be after startsAt 2026-10-14T13:00:00Z");
    }

    @Test
    void anExpiryNotAfterTheStartNamesBothValuesAndAStartThatDefaulted() {
        // no startsAt: the window starts now, which the publisher did not write, so the message says so
        assertThatThrownBy(() -> Communication.create("c1", "vmforge", "sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "down", null, List.of(), null, false, null, null,
                Instant.parse("2026-10-01T09:00:00Z"), null, NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("expiresAt 2026-10-01T09:00:00Z must be after startsAt, which defaulted to now "
                        + "(2026-10-14T12:00:00Z)");
        // startsAt given: both values, nothing about a default
        assertThatThrownBy(() -> Communication.create("c1", "vmforge", "sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "down", null, List.of(), null, false, NOW.plusSeconds(3600), null,
                NOW.plusSeconds(3600), null, NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("expiresAt 2026-10-14T13:00:00Z must be after startsAt 2026-10-14T13:00:00Z");
        // an update that moves the expiry before the stored start: the stored value, named as such
        Communication outage = Communication.create("c1", "vmforge", "sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "down", null, List.of(), null, false, null, null, null, null, NOW);
        assertThatThrownBy(() -> outage.withContent(null, null, null, null, null, null, null,
                NOW.minusSeconds(60), "sre", NOW.plusSeconds(10)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("expiresAt 2026-10-14T11:59:00Z must be after startsAt 2026-10-14T12:00:00Z");
    }

    @Test
    void titleLengthIsCapped() {
        assertThatThrownBy(() -> outageTitled("x".repeat(201)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("title exceeds");
        assertThat(outageTitled("x".repeat(200)).title()).hasSize(200);
    }

    private static Communication outageTitled(String title) {
        return Communication.create("c1", "vmforge", "sre", CommunicationType.OUTAGE,
                Severity.MAJOR, title, null, List.of(), null, false, null, null, null, null, NOW);
    }

    @Test
    void ticketIsKeptThroughContentAndStatusChanges() {
        Ticket ticket = Ticket.serviceNow("INC0012345");
        Communication c = Communication.create("c1", "vmforge", "sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "down", null, List.of(), null, false, null, null, null, null, ticket, NOW);
        assertThat(c.ticket()).isEqualTo(ticket);
        assertThat(c.withContent(Severity.CRITICAL, null, null, null, null, null, null, null, "sre", NOW)
                .ticket()).isEqualTo(ticket);
        assertThat(c.withStatus(CommunicationStatus.RETIRED, "sre", NOW).ticket()).isEqualTo(ticket);
        assertThat(outage(null, null, false).ticket()).isNull();
    }

    @Test
    void withTicketAttachesOrReplacesAndAuditsOnlyRealChanges() {
        Ticket ticket = Ticket.serviceNow("INC0012345");
        Communication without = outage(null, null, false);
        assertThat(without.withTicket(null, "sre", NOW)).isSameAs(without);

        Instant later = NOW.plusSeconds(30);
        Communication attached = without.withTicket(ticket, "sre", later);
        assertThat(attached.ticket()).isEqualTo(ticket);
        assertThat(attached.updatedAt()).isEqualTo(later);
        assertThat(attached.history()).hasSize(2);
        assertThat(attached.history().get(1).action()).isEqualTo("ticket attached: INC0012345");

        assertThat(attached.withTicket(ticket, "sre", later.plusSeconds(1))).isSameAs(attached);
        Communication changed = attached.withTicket(Ticket.serviceNow("INC0099999"), "sre", later);
        assertThat(changed.ticket().number()).isEqualTo("INC0099999");
        assertThat(changed.history().get(2).action()).isEqualTo("ticket changed to INC0099999");
    }

    @Test
    void aTicketNeedsANumber() {
        assertThatThrownBy(() -> Communication.create("c1", "vmforge", "sre", CommunicationType.OUTAGE,
                Severity.MAJOR, "down", null, List.of(), null, false, null, null, null, null,
                new Ticket("servicenow", " ", null), NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ticket.number is required");
    }

    @Test
    void effectiveStatusDerivesFromTimeNotStoredStatus() {
        Communication c = outage(NOW, NOW.plusSeconds(600), false);
        assertThat(c.effectiveStatus(NOW)).isEqualTo(CommunicationStatus.ACTIVE);
        // exactly at expiresAt -> EXPIRED, even though stored status is still ACTIVE
        assertThat(c.effectiveStatus(NOW.plusSeconds(600))).isEqualTo(CommunicationStatus.EXPIRED);
        assertThat(c.effectiveStatus(NOW.minusSeconds(1))).isEqualTo(CommunicationStatus.SCHEDULED);
        assertThat(c.activeAt(NOW.plusSeconds(599))).isTrue();
        assertThat(c.activeAt(NOW.plusSeconds(600))).isFalse();
    }

    @Test
    void effectiveStatusHonorsStoredTerminalAndDraftStates() {
        Communication retired = outage(NOW, null, false).withStatus(CommunicationStatus.RETIRED, "admin", NOW);
        assertThat(retired.effectiveStatus(NOW)).isEqualTo(CommunicationStatus.RETIRED);
        Communication draft = outage(NOW.minusSeconds(60), null, true);
        assertThat(draft.effectiveStatus(NOW)).isEqualTo(CommunicationStatus.DRAFT);
    }

    @Test
    void stateMachineBlocksIllegalTransitions() {
        Communication active = outage(null, null, false);
        assertThat(active.canTransitionTo(CommunicationStatus.EXPIRED)).isTrue();
        assertThat(active.canTransitionTo(CommunicationStatus.RETIRED)).isTrue();
        assertThat(active.canTransitionTo(CommunicationStatus.DRAFT)).isFalse();

        Communication expired = active.withStatus(CommunicationStatus.EXPIRED, "sweeper", NOW);
        assertThat(expired.canTransitionTo(CommunicationStatus.RETIRED)).isFalse();
        assertThatThrownBy(() -> expired.withStatus(CommunicationStatus.ACTIVE, "x", NOW))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("illegal transition");
    }

    @Test
    void transitionsAppendAuditAndBumpUpdatedAt() {
        Instant later = NOW.plusSeconds(30);
        Communication retired = outage(null, null, false)
                .withStatus(CommunicationStatus.RETIRED, "admin", later);
        assertThat(retired.updatedAt()).isEqualTo(later);
        assertThat(retired.history()).hasSize(2);
        assertThat(retired.history().get(1).actor()).isEqualTo("admin");
        assertThat(retired.history().get(1).action()).contains("ACTIVE -> RETIRED");
    }

    @Test
    void transitionNoteIsRecordedInAudit() {
        Communication retired = outage(null, null, false)
                .withStatus(CommunicationStatus.RETIRED, "health-monitor", "recovered: UP", NOW);
        assertThat(retired.history().get(1).action()).isEqualTo("ACTIVE -> RETIRED: recovered: UP");
        Communication noNote = outage(null, null, false)
                .withStatus(CommunicationStatus.RETIRED, "admin", " ", NOW);
        assertThat(noNote.history().get(1).action()).isEqualTo("ACTIVE -> RETIRED");
    }

    @Test
    void contentUpdateKeepsUnsetFieldsAndValidates() {
        Communication c = outage(null, NOW.plusSeconds(600), false);
        Communication updated = c.withContent(Severity.CRITICAL, null, "new body", null, null,
                null, null, null, "sre", NOW.plusSeconds(10));
        assertThat(updated.severity()).isEqualTo(Severity.CRITICAL);
        assertThat(updated.title()).isEqualTo(c.title());
        assertThat(updated.body()).isEqualTo("new body");
        assertThat(updated.externalRef()).isEqualTo(c.externalRef());

        assertThatThrownBy(() -> c.withContent(Severity.INFO, null, null, null, null,
                null, null, null, "sre", NOW))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void historyIsCappedAtFifty() {
        Communication c = outage(NOW.plusSeconds(999999), null, true);
        for (int i = 0; i < 80; i++) {
            c = c.withContent(null, "t" + i, null, null, null, null, null, null, "sre",
                    NOW.plusSeconds(i));
        }
        assertThat(c.history()).hasSize(Communication.HISTORY_MAX);
        assertThat(c.history().get(Communication.HISTORY_MAX - 1).action()).isEqualTo("updated");
    }
}
