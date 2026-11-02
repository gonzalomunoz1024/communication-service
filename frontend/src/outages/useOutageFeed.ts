import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CommunicationClient } from './api'
import { explainError } from './errors'
import { applyEvent, reconcile, removeItem, sortFeed } from './feed-state'
import type { FeedFilter, FeedItem } from './types'

export type Connection = 'off' | 'connecting' | 'live' | 'reconnecting'

export interface OutageFeed {
  items: FeedItem[]
  loading: boolean
  error: string | null
  connection: Connection
  /** how many times the page has reopened the stream itself since it was last live (0 otherwise) */
  reconnectAttempt: number
  /** reload the list; while the stream is down this also reopens it right away instead of waiting out the backoff */
  refresh: () => void
  /** drop an item locally (after a retire from this page) */
  remove: (id: string) => void
}

/** What the last GET /v1/feed produced, tagged with the request it answered. */
interface Loaded {
  requestId: string
  items: FeedItem[]
  error: string | null
}

/** What the stream last reported, tagged with the subscription it belongs to. */
interface StreamState {
  streamKey: string
  phase: 'live' | 'reconnecting'
  attempt: number
}

const EMPTY: Loaded = { requestId: '', items: [], error: null }

/**
 * The visible feed for a filter: one GET /v1/feed page, then, when `live`, the SSE stream
 * keeps it current (its snapshot frames re-upsert what the GET returned, harmlessly). After
 * the stream has been down and comes back, the list is reloaded once, because events may have
 * been missed meanwhile; frames that arrive during that reload are kept.
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

  useEffect(() => {
    if (blank) return
    let cancelled = false
    const since = Date.now()
    client
      .feed(stableFilter)
      .then((page) => {
        if (cancelled) return
        setLoaded((prev) => ({ requestId, items: reconcile(prev.items, page.items, since, stableFilter.tenantId), error: null }))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLoaded((prev) => ({ requestId, items: prev.items, error: explainError(e) }))
      })
    return () => {
      cancelled = true
    }
  }, [client, stableFilter, blank, requestId])

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

  const current = stream?.streamKey === streamKey ? stream : null
  const connection: Connection = !canStream ? 'off' : (current?.phase ?? 'connecting')
  const reconnectAttempt = current?.phase === 'reconnecting' ? current.attempt : 0
  const reconnecting = connection === 'reconnecting'

  const refresh = useCallback(() => {
    setTick((t) => t + 1)
    if (reconnecting) setStreamNonce((n) => n + 1)
  }, [reconnecting])
  const remove = useCallback((id: string) => setLoaded((prev) => ({ ...prev, items: removeItem(prev.items, id) })), [])

  const settled = loaded.requestId === requestId
  return {
    items: blank ? [] : sortFeed(loaded.items),
    loading: !blank && !settled,
    error: settled ? loaded.error : null,
    connection,
    reconnectAttempt,
    refresh,
    remove,
  }
}
