// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type CommunicationClient, type StreamHandlers } from '../outages/api'
import { UNREACHABLE_MESSAGE } from '../outages/errors'
import { OutageFeed } from '../outages/OutageFeed'
import type { FeedItem, Page } from '../outages/types'

function item(id: string, over: Partial<FeedItem> = {}): FeedItem {
  return {
    id,
    tenantId: 'acme',
    publisher: 'oncall',
    type: 'OUTAGE',
    severity: 'MAJOR',
    title: `Notice ${id}`,
    affectedServices: [],
    audience: 'CUSTOMERS',
    status: 'ACTIVE',
    startsAt: '2026-11-01T20:00:00Z',
    updatedAt: '2026-11-01T20:00:00Z',
    ...over,
  }
}

function fakeClient(items: FeedItem[] = [], pageOver: Partial<Page<FeedItem>> = {}) {
  const handlers: StreamHandlers[] = []
  const client: CommunicationClient = {
    publish: vi.fn(),
    retire: vi.fn(async () => ({}) as never),
    feed: vi.fn(async () => ({ items, page: 0, size: 100, totalElements: items.length, hasNext: false, ...pageOver })),
    stream: vi.fn((_f, h: StreamHandlers) => {
      handlers.push(h)
      return () => {}
    }),
  }
  return { client, last: () => handlers[handlers.length - 1] }
}

/** The Live-updates row: the switch and, next to it, the connection badge. */
const switchRow = () => screen.getByRole('switch', { name: 'Live updates' }).closest('label')!
/** The connection badge, a live region of its own inside that row. */
const badge = () => within(switchRow()).getByRole('status')
/** The page's announcement of a resolve: the live region outside that row. */
const announcement = () => screen.getAllByRole('status').find((s) => !switchRow().contains(s))!

describe('OutageFeed', () => {
  beforeEach(() => vi.stubGlobal('EventSource', class {}))
  afterEach(() => vi.unstubAllGlobals())

  it('shows the connection state, including the reopen attempt', async () => {
    const f = fakeClient([item('a')])
    render(<OutageFeed client={f.client} tenantId="acme" />)
    expect(await screen.findByText('Notice a')).toBeInTheDocument()
    expect(screen.getByText('Connecting')).toBeInTheDocument()
    act(() => f.last().onConnection?.(true))
    expect(screen.getByText('Live')).toBeInTheDocument()
    act(() => f.last().onConnection?.(false))
    expect(screen.getByText('Reconnecting')).toBeInTheDocument()
    act(() => f.last().onRetry?.(3, 4_000))
    expect(screen.getByText('Reconnecting (3)')).toBeInTheDocument()
  })

  it('announces the connection state in a live region of its own, which never repeats the resolve announcement', async () => {
    const user = userEvent.setup()
    const f = fakeClient([item('a'), item('b')])
    render(<OutageFeed client={f.client} tenantId="acme" actor="oncall" />)
    expect(await screen.findByText('Notice a')).toBeInTheDocument()
    const region = badge()
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent(/^Connecting$/)
    act(() => f.last().onConnection?.(true))
    expect(region).toHaveTextContent(/^Live$/)
    act(() => f.last().onConnection?.(false))
    expect(region).toHaveTextContent(/^Reconnecting$/)
    act(() => f.last().onRetry?.(3, 4_000))
    // the same region, with new text: that is what a screen reader announces
    expect(badge()).toBe(region)
    expect(region).toHaveTextContent(/^Reconnecting \(3\)$/)
    act(() => f.last().onConnection?.(true))
    expect(region).toHaveTextContent(/^Live$/)

    const card = screen.getByText('Notice a').closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Resolve' }))
    await user.click(within(card).getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(announcement()).toHaveTextContent('Resolved “Notice a”.'))
    // one live region says it: the badge keeps saying what the stream does
    expect(screen.getAllByRole('status').filter((s) => /Resolved/.test(s.textContent ?? ''))).toHaveLength(1)
    expect(region).toHaveTextContent(/^Live$/)
  })

  it('says it is waiting for a tenant rather than paused when none is entered, and paused only when switched off', async () => {
    const user = userEvent.setup()
    const f = fakeClient()
    const { rerender } = render(<OutageFeed client={f.client} tenantId="" />)
    expect(screen.getByRole('switch', { name: 'Live updates' })).toHaveAttribute('aria-checked', 'true')
    expect(badge()).toHaveTextContent(/^Waiting for a tenant$/)
    expect(screen.queryByText('Paused')).toBeNull()
    expect(f.client.stream).not.toHaveBeenCalled()

    await user.click(screen.getByRole('switch', { name: 'Live updates' }))
    expect(badge()).toHaveTextContent(/^Paused$/)
    rerender(<OutageFeed client={f.client} tenantId="acme" />)
    expect(badge()).toHaveTextContent(/^Paused$/)
    await user.click(screen.getByRole('switch', { name: 'Live updates' }))
    expect(badge()).toHaveTextContent(/^Connecting$/)
    expect(f.client.stream).toHaveBeenCalledTimes(1)
  })

  it('makes the whole Live-updates row the click target of its switch, at least 24 px tall like the form', async () => {
    const user = userEvent.setup()
    const f = fakeClient()
    render(<OutageFeed client={f.client} tenantId="acme" />)
    const toggle = screen.getByRole('switch', { name: 'Live updates' })
    // the switch itself is 30x18 px; the labelled row around it is at least 24 px tall and reads as clickable
    expect(switchRow()).toHaveClass('min-h-6', 'cursor-pointer')
    await user.click(within(switchRow()).getByText('Connecting'))
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('names the filters, announces a resolve and keeps focus on the list', async () => {
    const user = userEvent.setup()
    const f = fakeClient([item('a'), item('b')])
    render(<OutageFeed client={f.client} tenantId="acme" actor="oncall" />)
    expect(await screen.findByText('Notice a')).toBeInTheDocument()
    expect(screen.getByLabelText('Service')).toHaveAttribute('placeholder', 'Any service')
    expect(screen.getByLabelText('Type')).toHaveValue('OUTAGE')
    expect(screen.getByLabelText('Minimum severity')).toHaveValue('')
    const status = announcement()
    expect(status).toHaveTextContent('')

    const card = screen.getByText('Notice a').closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Resolve' }))
    await user.type(within(card).getByPlaceholderText('Resolution note (optional)'), 'fixed')
    await user.click(within(card).getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(screen.queryByText('Notice a')).toBeNull())
    expect(f.client.retire).toHaveBeenCalledWith('a', 'oncall', 'fixed')
    expect(status).toHaveTextContent('Resolved “Notice a”. It has left every consumer\'s feed.')
    expect(document.activeElement?.contains(screen.getByText('Notice b'))).toBe(true)
  })

  it('keeps keyboard focus on the page after resolving the only notice', async () => {
    const user = userEvent.setup()
    const f = fakeClient([item('a')])
    render(<OutageFeed client={f.client} tenantId="acme" actor="oncall" />)
    const card = (await screen.findByText('Notice a')).closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Resolve' }))
    await user.click(within(card).getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(screen.queryByText('Notice a')).toBeNull())
    expect(announcement()).toHaveTextContent('Resolved “Notice a”. It has left every consumer\'s feed.')
    // the card that held focus is gone and so is the list: focus must land on what replaced it, not on <body>
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.contains(screen.getByText('All clear'))).toBe(true)
  })

  it('resolves from the keyboard alone: focus follows the confirmation and lands on the list when the card leaves', async () => {
    const user = userEvent.setup()
    const f = fakeClient([item('a'), item('b')])
    render(<OutageFeed client={f.client} tenantId="acme" actor="oncall" />)
    const card = (await screen.findByText('Notice a')).closest('article')!
    within(card).getByRole('button', { name: 'Resolve' }).focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(within(card).getByPlaceholderText('Resolution note (optional)'))
    await user.keyboard('fixed{Tab}{Tab}{Enter}')
    await waitFor(() => expect(screen.queryByText('Notice a')).toBeNull())
    expect(f.client.retire).toHaveBeenCalledWith('a', 'oncall', 'fixed')
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.contains(screen.getByText('Notice b'))).toBe(true)
  })

  it('says when the service has more than the first page', async () => {
    const f = fakeClient([item('a')], { totalElements: 240, hasNext: true })
    render(<OutageFeed client={f.client} tenantId="acme" />)
    expect(await screen.findByText('Showing the first 1 of 240 notices. Narrow the filters to see the rest.')).toBeInTheDocument()
  })

  it('explains an empty feed in terms of what the feed lists', async () => {
    const f = fakeClient([])
    render(<OutageFeed client={f.client} tenantId="acme" />)
    expect(await screen.findByText('No outage is active for acme. A scheduled outage appears here when it starts.')).toBeInTheDocument()
  })

  it('explains an unreachable service instead of showing the status line', async () => {
    const f = fakeClient()
    vi.mocked(f.client.feed).mockRejectedValue(new ApiError(503, '503 Service Unavailable'))
    render(<OutageFeed client={f.client} tenantId="acme" />)
    expect(await screen.findByText("Couldn't load the feed")).toBeInTheDocument()
    expect(screen.getByText(UNREACHABLE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/503/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('announces a failed load as an alert, a new one for every failed retry, and keeps keyboard focus on Try again', async () => {
    const user = userEvent.setup()
    const f = fakeClient([item('a')])
    vi.mocked(f.client.feed).mockRejectedValueOnce(new ApiError(503, 'database unavailable', true))
    render(<OutageFeed client={f.client} tenantId="acme" />)
    const first = await screen.findByRole('alert')
    expect(first).toHaveTextContent("Couldn't load the feed")
    expect(first).toHaveTextContent('The service cannot reach its database right now (HTTP 503): database unavailable.')

    // Try again from the keyboard: the alert stays while the reload runs, and a new failure is a new alert
    let fail: (e: unknown) => void = () => {}
    vi.mocked(f.client.feed).mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    within(first).getByRole('button', { name: 'Try again' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('alert')).toBe(first)
    await act(async () => fail(new ApiError(503, 'database unavailable', true)))
    const second = screen.getByRole('alert')
    expect(second).not.toBe(first)
    expect(second).toHaveTextContent("Couldn't load the feed")
    expect(within(second).getByRole('button', { name: 'Try again' })).toHaveFocus()

    // the next attempt works: the list takes the alert's place, and focus moves to it rather than to <body>
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Notice a')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.contains(screen.getByText('Notice a'))).toBe(true)
  })

  it("says the service cannot reach its database for its own 503, and the badge does not say Live beside it", async () => {
    const f = fakeClient()
    vi.mocked(f.client.feed).mockRejectedValue(new ApiError(503, 'database unavailable', true))
    render(<OutageFeed client={f.client} tenantId="acme" />)
    expect(await screen.findByText("Couldn't load the feed")).toBeInTheDocument()
    expect(screen.getByText('The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment.')).toBeInTheDocument()
    expect(screen.queryByText(UNREACHABLE_MESSAGE)).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // a failed GET does not tear the stream down, but a page whose list could not be loaded is not live
    expect(screen.getByText('Connecting')).toBeInTheDocument()
    act(() => f.last().onConnection?.(true))
    expect(badge()).toHaveTextContent(/^Service degraded$/)
    expect(screen.queryByText('Live')).toBeNull()
  })

  it('keeps the error on screen through the reload after the stream comes back, then lists the notices and says Live', async () => {
    const f = fakeClient([item('a')])
    vi.mocked(f.client.feed).mockRejectedValueOnce(new ApiError(503, 'database unavailable', true))
    render(<OutageFeed client={f.client} tenantId="acme" />)
    expect(await screen.findByText("Couldn't load the feed")).toBeInTheDocument()
    let answer: (p: Page<FeedItem>) => void = () => {}
    vi.mocked(f.client.feed).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    // the stream was down and works again: the list reloads once, and until it answers the reason stays
    act(() => f.last().onConnection?.(false))
    act(() => f.last().onConnection?.(true))
    await waitFor(() => expect(f.client.feed).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/cannot reach its database/)).toBeInTheDocument()
    expect(document.querySelector('div[aria-busy="true"]')).toBeNull()
    expect(badge()).toHaveTextContent(/^Service degraded$/)
    await act(async () => answer({ items: [item('a')], page: 0, size: 100, totalElements: 1, hasNext: false }))
    expect(screen.getByText('Notice a')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load the feed")).toBeNull()
    expect(badge()).toHaveTextContent(/^Live$/)
  })
})
