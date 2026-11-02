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
  /** every stream the page opened, in order */
  static opened: string[] = []
  readyState = 0
  constructor(readonly url: string) {
    StubEventSource.opened.push(url)
  }
  addEventListener() {}
  close() {}
}

const tenantOf = (url: string) => new URL(url, 'http://ui').searchParams.get('tenantId')

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
    StubEventSource.opened = []
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('"View in feed" opens the feed of the tenant that was published to, filtered to that type', async () => {
    const svc = stubService()
    vi.stubGlobal('fetch', svc.fetchMock)
    localStorage.setItem('comm-tenant', 'acme') // the tenant this browser used last
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

  it('"View in feed" puts keyboard focus on the feed\'s list, while switching tabs leaves it on the tabs', async () => {
    const svc = stubService()
    vi.stubGlobal('fetch', svc.fetchMock)
    localStorage.setItem('comm-tenant', 'acme')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: /Publish/ }))
    const form = document.querySelector('form')!
    await user.type(within(form).getByLabelText(/^Title/), 'Checkout errors')
    await user.type(within(form).getByLabelText(/^Publisher/), 'web-oncall')
    await user.click(screen.getByRole('button', { name: 'Publish outage' }))
    ;(await screen.findByRole('button', { name: 'View in feed' })).focus()
    await user.keyboard('{Enter}')
    // the button that was pressed left with the confirmation: focus starts on the feed's results, not on <body>
    expect(document.activeElement).not.toBe(document.body)
    expect(await screen.findByText('Checkout errors')).toBeInTheDocument()
    expect(document.activeElement?.contains(screen.getByText('Checkout errors'))).toBe(true)

    // only "View in feed" moves focus into the feed: from the keyboard, the tabs keep it
    screen.getByRole('tab', { name: /Feed/ }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /Publish/ })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /Feed/ })).toHaveFocus()
  })

  describe('the header tenant field', () => {
    const feedGets = (calls: string[]) => calls.filter((c) => c.startsWith('GET /v1/feed?')).map((c) => tenantOf(c.slice(4)))

    it('loads the feed and opens the stream once for a tenant typed, not once per keystroke', async () => {
      const svc = stubService()
      vi.stubGlobal('fetch', svc.fetchMock)
      const user = userEvent.setup({ delay: 40 }) // a quick typist
      render(<App />)
      await user.type(screen.getByRole('textbox', { name: 'Tenant' }), 'ux2-sre')
      // the feed follows once typing pauses
      await waitFor(() => expect(feedGets(svc.calls)).toEqual(['ux2-sre']))
      expect(StubEventSource.opened.map(tenantOf)).toEqual(['ux2-sre'])
      await new Promise((r) => setTimeout(r, 600))
      expect(feedGets(svc.calls)).toEqual(['ux2-sre'])
      expect(StubEventSource.opened.map(tenantOf)).toEqual(['ux2-sre'])
      // the tenant is still remembered for the next visit
      expect(localStorage.getItem('comm-tenant')).toBe('ux2-sre')
    })

    it('follows at once on Enter and when the field loses focus', async () => {
      const svc = stubService()
      vi.stubGlobal('fetch', svc.fetchMock)
      const user = userEvent.setup()
      render(<App />)
      const tenant = screen.getByRole('textbox', { name: 'Tenant' })
      await user.type(tenant, 'acme{Enter}')
      expect(feedGets(svc.calls)).toEqual(['acme'])
      await user.type(tenant, '-eu')
      await user.tab()
      expect(feedGets(svc.calls)).toEqual(['acme', 'acme-eu'])
      await new Promise((r) => setTimeout(r, 600))
      expect(feedGets(svc.calls)).toEqual(['acme', 'acme-eu'])
      expect(StubEventSource.opened.map(tenantOf)).toEqual(['acme', 'acme-eu'])
    })
  })

  describe('the tenant the page opens on', () => {
    const prompt = 'Enter the tenant your consumers read; the service owners assign it.'

    it('is none on a first visit, with a prompt that goes once a tenant is typed and remembered', async () => {
      vi.stubGlobal('fetch', stubService().fetchMock)
      const user = userEvent.setup()
      render(<App />)
      const tenant = screen.getByRole('textbox', { name: 'Tenant' })
      expect(tenant).toHaveValue('')
      expect(screen.getByText(prompt)).toBeInTheDocument()
      expect(screen.getByText('Choose a tenant')).toBeInTheDocument()
      await user.type(tenant, 'acme')
      expect(localStorage.getItem('comm-tenant')).toBe('acme')
      expect(screen.queryByText(prompt)).toBeNull()
    })

    it('is the tenant used last in this browser', () => {
      vi.stubGlobal('fetch', stubService().fetchMock)
      localStorage.setItem('comm-tenant', 'other')
      render(<App />)
      expect(screen.getByRole('textbox', { name: 'Tenant' })).toHaveValue('other')
      expect(screen.queryByText(prompt)).toBeNull()
    })

    it('is VITE_DEFAULT_TENANT when the build sets one, ahead of the remembered tenant', () => {
      vi.stubGlobal('fetch', stubService().fetchMock)
      vi.stubEnv('VITE_DEFAULT_TENANT', 'acme')
      localStorage.setItem('comm-tenant', 'other')
      render(<App />)
      expect(screen.getByRole('textbox', { name: 'Tenant' })).toHaveValue('acme')
    })
  })
})
