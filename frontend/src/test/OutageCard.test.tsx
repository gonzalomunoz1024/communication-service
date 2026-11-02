// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
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

  it('hides the action when the page cannot resolve', () => {
    render(<OutageCard item={item} />)
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
  })
})
