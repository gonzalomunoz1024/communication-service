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

  it('names the filters, announces a resolve and keeps focus on the list', async () => {
    const user = userEvent.setup()
    const f = fakeClient([item('a'), item('b')])
    render(<OutageFeed client={f.client} tenantId="acme" actor="oncall" />)
    expect(await screen.findByText('Notice a')).toBeInTheDocument()
    expect(screen.getByLabelText('Service')).toHaveAttribute('placeholder', 'Any service')
    expect(screen.getByLabelText('Type')).toHaveValue('OUTAGE')
    expect(screen.getByLabelText('Minimum severity')).toHaveValue('')
    const status = screen.getByRole('status')
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
    expect(screen.getByRole('status')).toHaveTextContent('Resolved “Notice a”. It has left every consumer\'s feed.')
    // the card that held focus is gone and so is the list: focus must land on what replaced it, not on <body>
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.contains(screen.getByText('All clear'))).toBe(true)
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
})
