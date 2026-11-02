// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CommunicationClient } from '../outages/api'
import { PublishOutageForm } from '../outages/PublishOutageForm'

const client = (): CommunicationClient => ({ publish: vi.fn(), feed: vi.fn(), retire: vi.fn(), stream: vi.fn(() => () => {}) })
const summary = () => screen.getAllByRole('alert').find((el) => /needs? attention/.test(el.textContent ?? ''))

describe('PublishOutageForm validation', () => {
  it('moves focus to the first invalid field and lists every problem next to the button', async () => {
    const user = userEvent.setup()
    render(<PublishOutageForm client={client()} tenantId="" publisher="" />)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Publish outage' }))

    const title = screen.getByLabelText(/^Title/)
    expect(title).toHaveFocus()
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAccessibleDescription('Title is required')
    expect(summary()).toHaveTextContent('3 fields need attention: Title (Title is required), Tenant (Tenant is required), Publisher (Publisher is required).')

    // the summary's links move focus too, and it shrinks as fields are fixed
    await user.click(screen.getByRole('button', { name: 'Publisher' }))
    expect(screen.getByLabelText(/^Publisher/)).toHaveFocus()
    await user.keyboard('oncall')
    expect(summary()).toHaveTextContent('2 fields need attention: Title (Title is required), Tenant (Tenant is required).')
  })

  it('opens the timing card and focuses the end time a maintenance window lacks', async () => {
    const user = userEvent.setup()
    render(<PublishOutageForm client={client()} tenantId="acme" publisher="oncall" />)
    await user.click(screen.getByRole('radio', { name: 'Maintenance' }))
    await user.type(screen.getByLabelText(/^Title/), 'Database upgrade')
    expect(screen.queryByLabelText(/^Ends/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Publish maintenance' }))
    const ends = screen.getByLabelText(/^Ends/)
    expect(ends).toHaveFocus()
    expect(ends).toHaveAttribute('aria-invalid', 'true')
    expect(ends).toHaveAccessibleDescription('Maintenance needs an end time')
    expect(summary()).toHaveTextContent('One field needs attention: Ends (Maintenance needs an end time).')
  })

  it('focuses the severity group when an outage is filed as Info', async () => {
    const user = userEvent.setup()
    render(<PublishOutageForm client={client()} tenantId="acme" publisher="oncall" />)
    await user.click(screen.getByRole('radio', { name: 'Info' }))
    await user.type(screen.getByLabelText(/^Title/), 'Payments degraded')
    await user.click(screen.getByRole('button', { name: 'Publish outage' }))

    expect(screen.getByRole('radio', { name: 'Info' })).toHaveFocus()
    const group = screen.getByRole('radiogroup', { name: 'Severity' })
    expect(group).toHaveAttribute('aria-invalid', 'true')
    expect(group).toHaveAccessibleDescription('Outages need MINOR or higher')
  })
})
