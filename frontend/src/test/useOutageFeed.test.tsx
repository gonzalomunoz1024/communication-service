// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunicationClient, StreamHandlers } from '../outages/api'
import type { Communication, FeedItem, Page } from '../outages/types'
import { useOutageFeed } from '../outages/useOutageFeed'

function item(id: string, over: Partial<FeedItem> = {}): FeedItem {
  return {
    id,
    tenantId: 'acme',
    publisher: 'oncall',
    type: 'OUTAGE',
    severity: 'MAJOR',
    title: id,
    affectedServices: [],
    audience: 'CUSTOMERS',
    status: 'ACTIVE',
    startsAt: '2026-11-01T20:00:00Z',
    updatedAt: '2026-11-01T20:00:00Z',
    ...over,
  }
}
const page = (items: FeedItem[]): Page<FeedItem> => ({ items, page: 0, size: 100, totalElements: items.length, hasNext: false })

/** A client whose stream handlers the test drives by hand. */
function fakeClient(items: FeedItem[] = []) {
  const handlers: StreamHandlers[] = []
  const stops: ReturnType<typeof vi.fn>[] = []
  const client: CommunicationClient = {
    publish: vi.fn(),
    retire: vi.fn(),
    feed: vi.fn(async () => page(items)),
    stream: vi.fn((_filter, h: StreamHandlers) => {
      handlers.push(h)
      const stop = vi.fn()
      stops.push(stop)
      return stop
    }),
  }
  return { client, handlers, stops, last: () => handlers[handlers.length - 1] }
}

describe('useOutageFeed', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', class {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads the page, then follows the stream state', async () => {
    const f = fakeClient([item('a')])
    const { result } = renderHook(() => useOutageFeed(f.client, { tenantId: 'acme' }, true))
    expect(result.current.loading).toBe(true)
    expect(result.current.connection).toBe('connecting')
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items.map((i) => i.id)).toEqual(['a'])

    act(() => f.last().onConnection?.(true))
    expect(result.current.connection).toBe('live')
    act(() => f.last().onConnection?.(false))
    expect(result.current.connection).toBe('reconnecting')
    expect(result.current.reconnectAttempt).toBe(0)
    act(() => f.last().onRetry?.(3, 4_000))
    expect(result.current.connection).toBe('reconnecting')
    expect(result.current.reconnectAttempt).toBe(3)
  })

  it('reloads the list once the stream is back after being down', async () => {
    const f = fakeClient([item('a')])
    const { result } = renderHook(() => useOutageFeed(f.client, { tenantId: 'acme' }, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(f.client.feed).toHaveBeenCalledTimes(1)

    act(() => f.last().onConnection?.(true))
    expect(f.client.feed).toHaveBeenCalledTimes(1) // the first open is not a recovery

    act(() => f.last().onConnection?.(false))
    act(() => f.last().onConnection?.(true))
    await waitFor(() => expect(f.client.feed).toHaveBeenCalledTimes(2))
    expect(result.current.connection).toBe('live')
    expect(result.current.reconnectAttempt).toBe(0)
  })

  it('refresh reopens the stream right away while it is down, and only then', async () => {
    const f = fakeClient()
    const { result } = renderHook(() => useOutageFeed(f.client, { tenantId: 'acme' }, true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => f.last().onConnection?.(true))
    act(() => result.current.refresh())
    expect(f.client.stream).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(f.client.feed).toHaveBeenCalledTimes(2))

    act(() => f.last().onConnection?.(false))
    act(() => f.last().onRetry?.(2, 2_000))
    act(() => result.current.refresh())
    expect(f.stops[0]).toHaveBeenCalled()
    expect(f.client.stream).toHaveBeenCalledTimes(2)
    expect(result.current.connection).toBe('connecting')
    expect(result.current.reconnectAttempt).toBe(0)
  })

  it('retires a card at its expiry and starts a scheduled one on time, without a frame', async () => {
    const t0 = Date.now()
    const f = fakeClient([
      item('a', { expiresAt: new Date(t0 + 250).toISOString() }),
      item('b', { type: 'MAINTENANCE', severity: 'INFO', status: 'SCHEDULED', startsAt: new Date(t0 + 450).toISOString() }),
    ])
    const { result } = renderHook(() => useOutageFeed(f.client, { tenantId: 'acme' }, false))
    const shown = () => result.current.items.map((i) => [i.id, i.status])
    await waitFor(() => expect(shown()).toEqual([['a', 'ACTIVE'], ['b', 'SCHEDULED']]))
    await waitFor(() => expect(shown()).toEqual([['b', 'SCHEDULED']]))
    await waitFor(() => expect(shown()).toEqual([['b', 'ACTIVE']]))
    expect(f.client.feed).toHaveBeenCalledTimes(1)
  })

  it('reports when the service has more than the first page', async () => {
    const f = fakeClient()
    vi.mocked(f.client.feed).mockResolvedValue({ items: [item('a')], page: 0, size: 100, totalElements: 240, hasNext: true })
    const { result } = renderHook(() => useOutageFeed(f.client, { tenantId: 'acme' }, false))
    expect(result.current.truncated).toBe(false)
    await waitFor(() => expect(result.current.truncated).toBe(true))
    expect(result.current.total).toBe(240)
  })

  it('applies frames, surfaces load errors and clears everything for a blank tenant', async () => {
    const f = fakeClient([item('a')])
    const { result, rerender } = renderHook(({ tenant }: { tenant: string }) => useOutageFeed(f.client, { tenantId: tenant }, true), {
      initialProps: { tenant: 'acme' },
    })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    const created: Communication = { ...item('b'), createdAt: '2026-11-01T21:00:00Z' }
    act(() => f.last().onEvent({ seq: 5, type: 'CREATED', at: '2026-11-01T21:00:00Z', communication: created }))
    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b'])
    act(() => result.current.remove('a'))
    expect(result.current.items.map((i) => i.id)).toEqual(['b'])

    rerender({ tenant: '' })
    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.connection).toBe('off')

    ;(f.client.feed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('503 Service Unavailable'))
    rerender({ tenant: 'other' })
    await waitFor(() => expect(result.current.error).toBe('503 Service Unavailable'))
  })
})
