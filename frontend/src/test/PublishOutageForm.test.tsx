// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type CommunicationClient } from '../outages/api'
import { UNREACHABLE_MESSAGE } from '../outages/errors'
import { PublishOutageForm } from '../outages/PublishOutageForm'
import type { Communication } from '../outages/types'

const client = (): CommunicationClient => ({ publish: vi.fn(), feed: vi.fn(), retire: vi.fn(), stream: vi.fn(() => () => {}) })
/** What the service answers to a publish from the tests below. */
const publishedOutage = (): Communication => ({
  id: 'c9',
  tenantId: 'acme',
  publisher: 'oncall',
  type: 'OUTAGE',
  severity: 'MAJOR',
  title: 'Payments API returning 503s',
  affectedServices: [],
  audience: 'CUSTOMERS',
  status: 'ACTIVE',
  startsAt: '2026-11-01T20:00:00Z',
  createdAt: '2026-11-01T20:00:00Z',
  updatedAt: '2026-11-01T20:00:00Z',
})
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

describe('PublishOutageForm server errors', () => {
  const publish = async (c: CommunicationClient) => {
    const user = userEvent.setup()
    render(<PublishOutageForm client={c} tenantId="acme" publisher="oncall" />)
    await user.type(screen.getByLabelText(/^Title/), 'Payments API returning 503s')
    await user.click(screen.getByRole('button', { name: 'Publish outage' }))
    return screen.findByRole('alert')
  }

  it('says the service is unreachable instead of quoting a proxy status', async () => {
    const c = client()
    vi.mocked(c.publish).mockRejectedValue(new ApiError(502, '502 Bad Gateway'))
    const alert = await publish(c)
    expect(alert).toHaveTextContent(UNREACHABLE_MESSAGE)
    expect(alert).not.toHaveTextContent('rejected')
    expect(alert).not.toHaveTextContent('502')
  })

  it("quotes the service's reason for a rejection", async () => {
    const c = client()
    vi.mocked(c.publish).mockRejectedValue(new ApiError(400, 'title must not be blank'))
    expect(await publish(c)).toHaveTextContent('The service rejected this. title must not be blank')
  })

  it('calls a 5xx a failure of the service, not a rejection', async () => {
    const c = client()
    vi.mocked(c.publish).mockRejectedValue(new ApiError(500, '500 Internal Server Error'))
    const alert = await publish(c)
    expect(alert).toHaveTextContent('The service failed (HTTP 500). Try again; if it keeps happening, tell the service owners.')
    expect(alert).not.toHaveTextContent('rejected')
  })

  it('moves focus to the banner and scrolls it into view, since it lands below the buttons', async () => {
    // jsdom has no layout and no scrollIntoView; the component must tolerate that and call it when present
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const c = client()
      vi.mocked(c.publish).mockRejectedValue(new ApiError(409, "duplicate externalRef 'INC0012345' for tenant 'acme'"))
      const alert = await publish(c)
      await waitFor(() => expect(alert).toHaveFocus())
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      expect(scrollIntoView.mock.contexts).toContain(alert)
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})

describe('PublishOutageForm accessibility', () => {
  it('names the Type and Severity groups by their visible labels and keeps headings in order', () => {
    render(<PublishOutageForm client={client()} tenantId="acme" publisher="oncall" />)
    expect(screen.getByRole('radiogroup', { name: 'Type' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Severity' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(["What's happening", 'Who and where', 'Timing'])
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
  })

  it('promises a chip for the ServiceNow incident, and a link only when the service knows the instance', () => {
    render(<PublishOutageForm client={client()} tenantId="acme" publisher="oncall" />)
    expect(screen.getByLabelText(/^ServiceNow incident/)).toHaveAccessibleDescription(
      'Optional. The INC tracking this; consumers see it as a chip on the notice, linked when the service knows your ServiceNow instance.',
    )
  })

  it('makes the whole Save-as-draft row the click target of its switch', async () => {
    const user = userEvent.setup()
    render(<PublishOutageForm client={client()} tenantId="acme" publisher="oncall" />)
    const toggle = screen.getByRole('switch', { name: 'Save as draft' })
    const row = toggle.closest('label')!
    expect(row).toHaveTextContent('Save as draft (not visible to consumers)')
    // the switch itself is 30x18 px; the labelled row is at least 24 px tall and reads as clickable
    expect(row).toHaveClass('min-h-6', 'cursor-pointer')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByText('Save as draft (not visible to consumers)'))
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
  })

  it('moves focus to the outcome once published', async () => {
    const user = userEvent.setup()
    const c = client()
    const saved: Communication = {
      id: 'c9',
      tenantId: 'acme',
      publisher: 'oncall',
      type: 'OUTAGE',
      severity: 'MAJOR',
      title: 'Payments API returning 503s',
      affectedServices: [],
      audience: 'CUSTOMERS',
      status: 'ACTIVE',
      startsAt: '2026-11-01T20:00:00Z',
      createdAt: '2026-11-01T20:00:00Z',
      updatedAt: '2026-11-01T20:00:00Z',
    }
    vi.mocked(c.publish).mockResolvedValue(saved)
    render(<PublishOutageForm client={c} tenantId="acme" publisher="oncall" />)
    await user.type(screen.getByLabelText(/^Title/), 'Payments API returning 503s')
    await user.click(screen.getByRole('button', { name: 'Publish outage' }))
    const heading = await screen.findByRole('heading', { name: 'Outage published' })
    expect(heading).toHaveFocus()
  })

  it('moves focus to the Title field on "Publish another"', async () => {
    const user = userEvent.setup()
    const c = client()
    vi.mocked(c.publish).mockResolvedValue(publishedOutage())
    render(<PublishOutageForm client={c} tenantId="acme" publisher="oncall" />)
    await user.type(screen.getByLabelText(/^Title/), 'Payments API returning 503s')
    await user.click(screen.getByRole('button', { name: 'Publish outage' }))
    await user.click(await screen.findByRole('button', { name: 'Publish another' }))
    // the confirmation (and the button that was pressed) is gone: the empty form's first field takes over
    const title = screen.getByLabelText(/^Title/)
    expect(title).toHaveValue('')
    expect(title).toHaveFocus()
  })
})

describe('PublishOutageForm duplicate reference', () => {
  const publishIncident = async (c: CommunicationClient) => {
    const user = userEvent.setup()
    render(<PublishOutageForm client={c} tenantId="acme" publisher="oncall" onViewFeed={() => {}} />)
    await user.type(screen.getByLabelText(/^Title/), 'Payments API returning 503s')
    await user.type(screen.getByLabelText(/^ServiceNow incident/), 'INC0012345')
    await user.click(screen.getByRole('button', { name: 'Publish outage' }))
    return screen.findByRole('alert')
  }

  it('explains a 409 for a reused incident number: the reference is permanent, a follow-up needs a new one', async () => {
    const c = client()
    vi.mocked(c.publish).mockRejectedValue(new ApiError(409, "duplicate externalRef 'INC0012345' for tenant 'acme'"))
    const alert = await publishIncident(c)
    expect(alert).toHaveTextContent(
      'The service rejected this. INC0012345 is already the reference of a notice in tenant acme (the ServiceNow incident number doubles as the reference). References are permanent, even after a notice is retired, so a follow-up for the same incident needs another External reference, such as INC0012345-2.',
    )
    // the key is a permanent idempotency index: retiring the other notice would not free it
    expect(alert.textContent).not.toMatch(/\bRetire\b|retire (that|it|the) notice/)
    // the input is kept for the correction
    expect(screen.getByLabelText(/^ServiceNow incident/)).toHaveValue('INC0012345')
  })

  it("shows the service's own words when its 409 already explains the permanent key and names the notice", async () => {
    const c = client()
    const explained = "externalRef 'INC0012345' is already used in tenant 'acme' by communication c42 (RETIRED); the key is permanent, so a follow-up needs another externalRef"
    vi.mocked(c.publish).mockRejectedValue(new ApiError(409, explained))
    const alert = await publishIncident(c)
    expect(alert).toHaveTextContent(`The service rejected this. ${explained}`)
    expect(alert).not.toHaveTextContent(/retire that/i)
  })
})
