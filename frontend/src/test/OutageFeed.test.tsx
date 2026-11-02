// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
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
