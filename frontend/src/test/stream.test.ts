import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECONNECT_MAX_MS, createCommunicationClient, reconnectDelay } from '../outages/api'
import type { CommunicationEvent } from '../outages/types'

/** Enough of the browser's EventSource to drive the client's reconnect logic by hand. */
class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []
  readyState = FakeEventSource.CONNECTING
  closed = false
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private listeners = new Map<string, (e: MessageEvent<string>) => void>()
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, listener: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, listener)
  }
  close() {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }
  // test helpers
  open() {
    this.readyState = FakeEventSource.OPEN
    this.onopen?.()
  }
  /** the browser lost the connection and retries by itself */
  drop() {
    this.readyState = FakeEventSource.CONNECTING
    this.onerror?.()
  }
  /** the browser gave up (a non-200 answer to its reconnect) */
  giveUp() {
    this.readyState = FakeEventSource.CLOSED
    this.onerror?.()
  }
  frame(type: string, event: Partial<CommunicationEvent>) {
    this.listeners.get(type)?.({ data: JSON.stringify(event) } as MessageEvent<string>)
  }
}

const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]

describe('reconnectDelay', () => {
  it('doubles from one second and caps at thirty', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(reconnectDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, RECONNECT_MAX_MS])
  })
})

describe('stream liveness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const client = () => createCommunicationClient('http://svc', { clientId: 'checkout-web' })

  it('reports open and the browser-side reconnects without reopening anything itself', () => {
    const onConnection = vi.fn()
    const onRetry = vi.fn()
    const stop = client().stream({ tenantId: 'acme' }, { onEvent: () => {}, onConnection, onRetry })
    latest().open()
    expect(onConnection).toHaveBeenLastCalledWith(true)
    latest().drop()
    expect(onConnection).toHaveBeenLastCalledWith(false)
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(onRetry).not.toHaveBeenCalled()
    stop()
  })

  it('reopens with backoff and the last sequence number once the browser has given up', () => {
    const onRetry = vi.fn()
    const stop = client().stream({ tenantId: 'acme' }, { onEvent: () => {}, onRetry })
    const first = latest()
    first.open()
    first.frame('snapshot', { seq: 7, type: 'SNAPSHOT' })
    first.frame('created', { seq: 12, type: 'CREATED' })

    first.giveUp()
    expect(first.closed).toBe(true)
    expect(onRetry).toHaveBeenLastCalledWith(1, 1_000)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(latest().url).toBe('http://svc/v1/feed/stream?tenantId=acme&clientId=checkout-web&lastEventId=12')

    latest().giveUp()
    expect(onRetry).toHaveBeenLastCalledWith(2, 2_000)
    vi.advanceTimersByTime(2_000)
    latest().giveUp()
    expect(onRetry).toHaveBeenLastCalledWith(3, 4_000)
    vi.advanceTimersByTime(4_000)
    expect(FakeEventSource.instances).toHaveLength(4)

    // a successful open resets the backoff
    latest().open()
    latest().giveUp()
    expect(onRetry).toHaveBeenLastCalledWith(1, 1_000)
    stop()
  })

  it('starts from a fresh snapshot when no frame was ever received', () => {
    const stop = client().stream({ tenantId: 'acme' }, { onEvent: () => {} })
    latest().giveUp()
    vi.advanceTimersByTime(1_000)
    expect(latest().url).toBe('http://svc/v1/feed/stream?tenantId=acme&clientId=checkout-web')
    stop()
  })

  it('stops reopening once unsubscribed', () => {
    const stop = client().stream({ tenantId: 'acme' }, { onEvent: () => {} })
    latest().giveUp()
    stop()
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latest().closed).toBe(true)
  })

  it('delivers parsed frames and skips malformed ones', () => {
    const onEvent = vi.fn()
    const stop = client().stream({ tenantId: 'acme' }, { onEvent })
    latest().frame('created', { seq: 1, type: 'CREATED' })
    ;(latest() as unknown as { listeners: Map<string, (e: MessageEvent<string>) => void> }).listeners
      .get('updated')
      ?.({ data: '{not json' } as MessageEvent<string>)
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ seq: 1, type: 'CREATED' }))
    stop()
  })
})
