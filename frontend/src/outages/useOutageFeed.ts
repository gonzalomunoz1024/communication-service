import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CommunicationClient } from './api'
import { explainError } from './errors'
import { applyEvent, nextChange, reconcile, removeItem, revise, sortFeed } from './feed-state'
import type { FeedFilter, FeedItem } from './types'

/**
 * What the page can vouch for: `live` while the stream works and the list's last load succeeded,
 * `degraded` while the stream works but the list could not be loaded, `connecting` until a stream
 * works, `reconnecting` while it is reopened after it stopped working or an attempt failed.
 */
export type Connection = 'off' | 'connecting' | 'live' | 'reconnecting' | 'degraded'

export interface OutageFeed {
  items: FeedItem[]
  loading: boolean
  /** why the list could not be loaded; a reload of the same list keeps it until that reload answers */
  error: string | null
  connection: Connection
  /** how many times the page has reopened the stream itself since it was last live (0 otherwise) */
  reconnectAttempt: number
  /** how many items the service has for the filter (the page's totalElements), once loaded */
  total?: number
  /** the list is only the first page (100 items) and the service has more */
  truncated: boolean
  /** reload the list; while the stream is down this also reopens it right away instead of waiting out the backoff */
  refresh: () => void
  /** drop an item locally (after a retire from this page) */
  remove: (id: string) => void
}

/** What the last GET /v1/feed produced, tagged with the filter and the request it answered. */
interface Loaded {
  key: string
  requestId: string
  items: FeedItem[]
  error: string | null
  total?: number
  hasNext?: boolean
}

/** What the stream last reported, tagged with the subscription it belongs to. */
interface StreamState {
  streamKey: string
  phase: 'live' | 'reconnecting'
  attempt: number
}

const EMPTY: Loaded = { key: '', requestId: '', items: [], error: null }

/**
 * The visible feed for a filter: one GET /v1/feed page, then, when `live`, the SSE stream
 * keeps it current (its snapshot frames re-upsert what the GET returned, harmlessly). After
 * the stream has been down and works again, the list is reloaded once, because events may have
 * been missed meanwhile; frames that arrive during that reload are kept. Attempts that fail
 * while the stream is down reload nothing.
 */
export function useOutageFeed(client: CommunicationClient, filter: FeedFilter, live: boolean): OutageFeed {
  const key = JSON.stringify(filter)
  // the same filter by value, with a stable identity for the effects below
  const stableFilter = useMemo(() => JSON.parse(key) as FeedFilter, [key])
  const blank = !stableFilter.tenantId.trim()
  const canStream = live && !blank && typeof EventSource !== 'undefined'

  const [tick, setTick] = useState(0)
  const [streamNonce, setStreamNonce] = useState(0)
  const requestId = `${key}#${tick}`
  const streamKey = `${key}#${streamNonce}`
  const [loaded, setLoaded] = useState<Loaded>(EMPTY)
  const [stream, setStream] = useState<StreamState | null>(null)
  // the instant statuses are projected at; moved forward by the boundary timer below
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (blank) return
    let cancelled = false
    const since = Date.now()
    client
      .feed(stableFilter)
      .then((page) => {
        if (cancelled) return
        setLoaded((prev) => ({
          key,
          requestId,
          items: reconcile(prev.items, page.items, since, stableFilter.tenantId),
          error: null,
          total: page.totalElements,
          hasNext: page.hasNext,
        }))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLoaded((prev) => ({ ...prev, key, requestId, error: explainError(e) }))
      })
    return () => {
      cancelled = true
    }
  }, [client, stableFilter, blank, key, requestId])

  useEffect(() => {
    if (!canStream) return
    let down = false
    return client.stream(stableFilter, {
      onEvent: (event) => setLoaded((prev) => ({ ...prev, items: applyEvent(prev.items, event) })),
      onConnection: (open) => {
        if (open) {
          setStream({ streamKey, phase: 'live', attempt: 0 })
          if (down) {
            // events may have been lost while the stream was down: reload once, then stay live
            down = false
            setTick((t) => t + 1)
          }
        } else {
          down = true
          setStream((prev) => ({ streamKey, phase: 'reconnecting', attempt: prev?.streamKey === streamKey ? prev.attempt : 0 }))
        }
      },
      onRetry: (attempt) => setStream({ streamKey, phase: 'reconnecting', attempt }),
    })
  }, [client, stableFilter, canStream, streamKey])

  // a card must leave at its expiry (and an upcoming one turn active at its start) even when no
  // frame says so yet: wake up at the next boundary and project the statuses again
  useEffect(() => {
    const at = nextChange(loaded.items, now)
    if (at === undefined) return
    const t = setTimeout(() => setNow(Date.now()), Math.min(Math.max(at - Date.now(), 0) + 50, 2_147_483_647))
    return () => clearTimeout(t)
  }, [loaded.items, now])

  const settled = loaded.requestId === requestId
  // the last failure of this list stays until a reload of it answers (Try again, Refresh, the reload
  // after the stream works again), rather than a skeleton between two answers that say the same
  const error = !blank && loaded.key === key ? loaded.error : null
  const current = stream?.streamKey === streamKey ? stream : null
  const phase: Connection = !canStream ? 'off' : (current?.phase ?? 'connecting')
  // a working stream does not make the page live while its list could not be loaded
  const connection: Connection = phase === 'live' && error ? 'degraded' : phase
  const reconnectAttempt = current?.phase === 'reconnecting' ? current.attempt : 0
  const reconnecting = connection === 'reconnecting'

  const refresh = useCallback(() => {
    setTick((t) => t + 1)
    if (reconnecting) setStreamNonce((n) => n + 1)
  }, [reconnecting])
  const remove = useCallback((id: string) => setLoaded((prev) => ({ ...prev, items: removeItem(prev.items, id) })), [])

  return {
    items: blank ? [] : sortFeed(revise(loaded.items, now)),
    loading: !blank && !settled,
    error,
    connection,
    reconnectAttempt,
    total: settled && !blank ? loaded.total : undefined,
    truncated: settled && !blank && !!loaded.hasNext,
    refresh,
    remove,
  }
}
