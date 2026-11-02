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

  it('hides the action when the page cannot resolve', () => {
    render(<OutageCard item={item} />)
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
  })
})
