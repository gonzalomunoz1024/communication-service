// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Communication } from '../outages/types'

class StubEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readyState = 0
  constructor(readonly url: string) {}
  addEventListener() {}
  close() {}
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The service as the shell sees it: publish echoes the body, the feed lists what was published to that tenant. */
function stubService() {
  const published: Communication[] = []
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    const path = new URL(url, 'http://ui').pathname
    if (path === '/v1/communications' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Communication
      const saved: Communication = {
        ...body,
        id: `c${published.length + 1}`,
        status: 'ACTIVE',
        affectedServices: body.affectedServices ?? [],
        startsAt: body.startsAt ?? '2026-11-01T20:00:00Z',
        createdAt: '2026-11-01T20:00:00Z',
        updatedAt: '2026-11-01T20:00:00Z',
      }
      published.push(saved)
      return json(saved, 201)
    }
    if (path === '/v1/feed') {
      const q = new URL(url, 'http://ui').searchParams
      const items = published.filter((c) => c.tenantId === q.get('tenantId') && (!q.get('type') || c.type === q.get('type')))
      return json({ items, page: 0, size: 100, totalElements: items.length, hasNext: false })
    }
    return json({ error: `unexpected ${url}` }, 500)
  })
  return { fetchMock, calls }
}

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', StubEventSource)
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => vi.unstubAllGlobals())

  it('"View in feed" opens the feed of the tenant that was published to, filtered to that type', async () => {
    const svc = stubService()
    vi.stubGlobal('fetch', svc.fetchMock)
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Outage Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Tenant' })).toHaveValue('acme')

    await user.click(screen.getByRole('tab', { name: /Publish/ }))
    const form = document.querySelector('form')!
    await user.click(within(form).getByRole('radio', { name: 'Change' }))
    await user.type(within(form).getByLabelText(/^Title/), 'New checkout flow')
    await user.clear(within(form).getByLabelText(/^Tenant/))
    await user.type(within(form).getByLabelText(/^Tenant/), 'other')
    await user.type(within(form).getByLabelText(/^Publisher/), 'web-oncall')
    await user.click(screen.getByRole('button', { name: 'Publish change' }))

    expect(await screen.findByText('Change published')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View in feed' }))

    // the shell now shows tenant "other" with the type filter on Change, and the new item is listed
    expect(screen.getByRole('textbox', { name: 'Tenant' })).toHaveValue('other')
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('CHANGE')
    expect(await screen.findByText('New checkout flow')).toBeInTheDocument()
    await waitFor(() => expect(svc.calls.some((c) => /GET \/v1\/feed\?tenantId=other&type=CHANGE/.test(c))).toBe(true))
    expect(window.location.hash).toBe('#/feed')
  })
})
