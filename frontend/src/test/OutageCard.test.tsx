// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OutageCard } from '../outages/OutageCard'
import type { FeedItem } from '../outages/types'

const item: FeedItem = {
  id: 'c1',
  tenantId: 'acme',
  publisher: 'payments-oncall',
  type: 'OUTAGE',
  severity: 'MAJOR',
  title: 'Payments API returning 503s',
  body: 'Card payments fail for roughly 30% of requests.',
  affectedServices: ['payments-api'],
  audience: 'CUSTOMERS',
  status: 'ACTIVE',
  startsAt: new Date(Date.now() - 60_000).toISOString(),
  updatedAt: new Date(Date.now() - 60_000).toISOString(),
  ticket: { system: 'servicenow', number: 'INC0012345' },
}

describe('OutageCard', () => {
  it('renders the notice and resolves it with a note after confirmation', async () => {
    const onRetire = vi.fn(async () => {})
    render(<OutageCard item={item} onRetire={onRetire} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Payments API returning 503s' })).toBeInTheDocument()
    expect(screen.getByText('INC0012345')).toBeInTheDocument()
    expect(screen.getByText('payments-api')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    await user.type(screen.getByPlaceholderText('Resolution note (optional)'), 'fixed')
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(onRetire).toHaveBeenCalledWith(item, 'fixed')
  })

  it('offers Withdraw instead of Resolve for a notice that has not started', async () => {
    const onRetire = vi.fn(async () => {})
    const scheduled: FeedItem = { ...item, status: 'SCHEDULED', type: 'MAINTENANCE', startsAt: new Date(Date.now() + 3_600_000).toISOString() }
    render(<OutageCard item={scheduled} onRetire={onRetire} />)
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(screen.getByText(/Withdrawing retires it before it starts/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(onRetire).toHaveBeenCalledWith(scheduled, '')
  })

  it('says who resolves and whose feed the notice leaves before asking to confirm', async () => {
    render(<OutageCard item={item} onRetire={vi.fn(async () => {})} actor="web-oncall" />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(screen.getByText("Resolve as web-oncall? It leaves tenant acme's feed at once and cannot be reopened.")).toBeInTheDocument()
  })

  it('names the tenant in the withdraw confirmation too, and leaves the actor out when none is known', async () => {
    const scheduled: FeedItem = { ...item, status: 'SCHEDULED', type: 'MAINTENANCE', startsAt: new Date(Date.now() + 3_600_000).toISOString() }
    render(<OutageCard item={scheduled} onRetire={vi.fn(async () => {})} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(screen.getByText("Withdraw? Withdrawing retires it before it starts: tenant acme's consumers never see it and it cannot be reopened.")).toBeInTheDocument()
  })

  it('shows an upcoming notice as Scheduled, with its start once and in sentence case', () => {
    const scheduled: FeedItem = { ...item, status: 'SCHEDULED', type: 'MAINTENANCE', startsAt: new Date(Date.now() + 59 * 60_000).toISOString() }
    render(<OutageCard item={scheduled} />)
    const tag = screen.getByText('Scheduled')
    expect(tag).toHaveClass('text-state-queued-fg')
    expect(tag).not.toHaveClass('capitalize')
    expect(screen.getAllByText(/Starts in 59m/)).toHaveLength(1)
  })

  it('labels an automated notice "Automatic" instead of showing its internal health: reference', () => {
    // as the service publishes it when a monitored service goes DOWN (confidence/evidence/iter-2/usability/sidecar-pod.txt P6)
    const automated: FeedItem = {
      ...item,
      id: 'n7',
      publisher: 'health-sidecar',
      title: 'payments-api is down',
      body: 'Automated health check reported DOWN at 2026-11-02T04:07:48Z (rolled up from the service pods). This notice is managed automatically.',
      externalRef: 'health:2c1b983f-a8a2-4bf5-97e5-1e69f6fe9b27:1',
      ticket: undefined,
    }
    render(<OutageCard item={automated} />)
    expect(screen.queryByText(/health:/)).toBeNull()
    expect(screen.getByTitle('Raised by an automated health check')).toHaveTextContent(/^Automatic$/)
  })

  it('still shows a reference a person chose, once, and not when it is the ticket number', () => {
    const { unmount } = render(<OutageCard item={{ ...item, externalRef: 'payments-2026-11-01' }} />)
    expect(screen.getByText('payments-2026-11-01')).toBeInTheDocument()
    expect(screen.queryByText('Automatic')).toBeNull()
    unmount()
    render(<OutageCard item={{ ...item, externalRef: 'INC0012345' }} />)
    expect(screen.getAllByText('INC0012345')).toHaveLength(1)
  })

  it('hides the action when the page cannot resolve', () => {
    render(<OutageCard item={item} />)
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
  })

  it('moves keyboard focus into the confirmation, under its question, and back to the action on Cancel', async () => {
    const user = userEvent.setup()
    render(<OutageCard item={item} onRetire={vi.fn(async () => {})} actor="web-oncall" />)
    screen.getByRole('button', { name: 'Resolve' }).focus()
    await user.keyboard('{Enter}')
    // the button that had focus gave way to the confirmation: focus lands on its first control, not on <body>
    const note = screen.getByPlaceholderText('Resolution note (optional)')
    expect(document.activeElement).toBe(note)
    expect(note).toHaveAccessibleName('Resolution note (optional)')
    // the question names the group the focus entered, so a screen reader reads it out
    const group = screen.getByRole('group', { name: "Resolve as web-oncall? It leaves tenant acme's feed at once and cannot be reopened." })
    expect(group).toContainElement(note)

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('group')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resolve' }))
  })

  it('cancels the confirmation on Escape as Cancel does, with focus back on the action, but not while the call runs', async () => {
    const user = userEvent.setup()
    let finish: () => void = () => {}
    const onRetire = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<OutageCard item={item} onRetire={onRetire} actor="web-oncall" />)
    screen.getByRole('button', { name: 'Resolve' }).focus()
    await user.keyboard('{Enter}fixed{Escape}')
    // like Cancel: the confirmation closes and focus returns to the button that opened it
    expect(screen.queryByRole('group')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resolve' }))
    expect(onRetire).not.toHaveBeenCalled()

    // from the confirmation's buttons as well
    await user.keyboard('{Enter}{Tab}{Escape}')
    expect(screen.queryByRole('group')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resolve' }))

    // while the resolve runs Cancel is disabled, and Escape leaves the confirmation open too
    await user.keyboard('{Enter}')
    const group = screen.getByRole('group')
    await user.click(within(group).getByRole('button', { name: 'Resolve' }))
    expect(onRetire).toHaveBeenCalledTimes(1)
    within(group).getByPlaceholderText('Resolution note (optional)').focus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('group')).toBe(group)
    await act(async () => finish())
  })

  it('does the same for Withdraw, and gives focus back to the confirming button when the service refuses', async () => {
    const user = userEvent.setup()
    const scheduled: FeedItem = { ...item, status: 'SCHEDULED', type: 'MAINTENANCE', startsAt: new Date(Date.now() + 3_600_000).toISOString() }
    let refuse: (e: Error) => void = () => {}
    const onRetire = vi.fn(() => new Promise<void>((_, reject) => (refuse = reject)))
    render(<OutageCard item={scheduled} onRetire={onRetire} />)
    screen.getByRole('button', { name: 'Withdraw' }).focus()
    await user.keyboard('{Enter}')
    const reason = screen.getByPlaceholderText('Reason (optional)')
    expect(document.activeElement).toBe(reason)
    const group = screen.getByRole('group')
    expect(group).toHaveAccessibleName("Withdraw? Withdrawing retires it before it starts: tenant acme's consumers never see it and it cannot be reopened.")
    const confirmButton = within(group).getByRole('button', { name: 'Withdraw' })

    await user.keyboard('{Tab}{Tab}{Enter}')
    expect(onRetire).toHaveBeenCalledWith(scheduled, '')
    // a browser drops focus from a button disabled while the call runs (jsdom keeps it), so the card must
    // hand it back itself once the call fails
    expect(confirmButton).toBeDisabled()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      await act(async () => refuse(new Error('already expired')))
      expect(screen.getByRole('alert')).toHaveTextContent('already expired')
      expect(focus.mock.contexts).toEqual([confirmButton])
      expect(document.activeElement).toBe(confirmButton)
    } finally {
      focus.mockRestore()
    }
  })
})
