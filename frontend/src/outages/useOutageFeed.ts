import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommunicationClient } from './api'
import { applyEvent, removeItem, sortFeed } from './feed-state'
import type { FeedFilter, FeedItem } from './types'

export type Connection = 'off' | 'connecting' | 'live' | 'reconnecting'

export interface OutageFeed {
  items: FeedItem[]
  loading: boolean
  error: string | null
  connection: Connection
  refresh: () => void
  /** drop an item locally (after a retire from this page) */
  remove: (id: string) => void
}

/**
 * The visible feed for a filter: one GET /v1/feed page, then, when `live`, the SSE stream
 * keeps it current (its snapshot frames re-upsert what the GET returned, harmlessly).
 */
export function useOutageFeed(client: CommunicationClient, filter: FeedFilter, live: boolean): OutageFeed {
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<Connection>('off')
  const [tick, setTick] = useState(0)
  const key = JSON.stringify(filter)
  const latest = useRef(0)

  useEffect(() => {
    if (!filter.tenantId.trim()) {
      setItems([])
      setError(null)
      return
    }
    const call = ++latest.current
    setLoading(true)
    setError(null)
    client
      .feed(filter)
      .then((page) => call === latest.current && setItems(page.items))
      .catch((e: unknown) => call === latest.current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => call === latest.current && setLoading(false))
  }, [client, key, tick])

  useEffect(() => {
    if (!live || !filter.tenantId.trim() || typeof EventSource === 'undefined') {
      setConnection('off')
      return
    }
    setConnection('connecting')
    return client.stream(filter, {
      onEvent: (event) => setItems((prev) => applyEvent(prev, event)),
      onConnection: (open) => setConnection(open ? 'live' : 'reconnecting'),
    })
  }, [client, key, live])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  const remove = useCallback((id: string) => setItems((prev) => removeItem(prev, id)), [])

  return { items: sortFeed(items), loading, error, connection, refresh, remove }
}
