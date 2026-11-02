import type {
  Communication,
  CommunicationEvent,
  CommunicationEventType,
  CreateCommunication,
  FeedFilter,
  FeedItem,
  Page,
} from './types'

/**
 * A failed call: a non-2xx answer (`message` is the service's {"error": "..."} text when it sent
 * one), or `status` 0 when the connection itself failed and there was no answer at all.
 */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

export interface StreamHandlers {
  onEvent: (event: CommunicationEvent) => void
  /** true once the stream is open, false while the browser is reconnecting */
  onConnection?: (open: boolean) => void
  /**
   * The browser gave up on its own retries (a non-200 answer to a reconnect, e.g. a proxy's 502
   * while the service restarts) and the client is reopening the stream itself: the attempt
   * number (1-based) and the delay before it.
   */
  onRetry?: (attempt: number, delayMs: number) => void
}

export interface CommunicationClient {
  publish: (body: CreateCommunication) => Promise<Communication>
  feed: (filter: FeedFilter, page?: number, size?: number) => Promise<Page<FeedItem>>
  retire: (id: string, actor?: string, note?: string) => Promise<Communication>
  /** subscribes to /v1/feed/stream; returns the unsubscribe */
  stream: (filter: FeedFilter, handlers: StreamHandlers) => () => void
}

const EVENT_TYPES: CommunicationEventType[] = ['SNAPSHOT', 'CREATED', 'UPDATED', 'ACTIVATED', 'EXPIRED', 'RETIRED']

/** Reopen backoff: 1 s, 2 s, 4 s … capped at 30 s. */
export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_MAX_MS = 30_000

/** Delay before the client's own reopen attempt `attempt` (1-based). */
export function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1))
}

/** Query string for the feed filters; empty values are left out. */
export function feedQuery(filter: FeedFilter, extra: Record<string, string | number> = {}): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...filter, ...extra })) {
    if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k, String(v).trim())
  }
  return q.toString()
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) return body.error
  } catch {
    /* not JSON */
  }
  return `${res.status} ${res.statusText}`.trim()
}

/** Sent as `X-Client-Id` on every request; the service rejects calls that carry none. */
export const DEFAULT_CLIENT_ID = 'communication-frontend'

export interface ClientOptions {
  /** how this app identifies itself to the service (its repository name); defaults to DEFAULT_CLIENT_ID */
  clientId?: string
  fetchImpl?: typeof fetch
}

/**
 * A typed client for communication-service.
 * @param baseUrl origin the service is served from; '' means same origin (the Vite proxy in dev)
 */
export function createCommunicationClient(
  baseUrl = '',
  { clientId = DEFAULT_CLIENT_ID, fetchImpl = (...a) => fetch(...a) }: ClientOptions = {},
): CommunicationClient {
  const root = baseUrl.replace(/\/$/, '')

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
      res = await fetchImpl(`${root}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'X-Client-Id': clientId,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      })
    } catch (e) {
      // the connection failed (service down, DNS, CORS): there is no status to show
      throw new ApiError(0, e instanceof Error ? e.message : String(e))
    }
    if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
    return (await res.json()) as T
  }

  return {
    publish: (body) => request<Communication>('/v1/communications', { method: 'POST', body: JSON.stringify(body) }),

    feed: (filter, page = 0, size = 100) => request<Page<FeedItem>>(`/v1/feed?${feedQuery(filter, { page, size })}`),

    retire: (id, actor, note) =>
      request<Communication>(`/v1/communications/${encodeURIComponent(id)}/retire`, {
        method: 'POST',
        body: JSON.stringify({ actor: actor || undefined, note: note || undefined }),
      }),

    /*
     * Liveness: the browser's EventSource reconnects by itself after a dropped connection (with
     * `Last-Event-ID`, so the service replays what was missed) but gives up for good after any
     * non-200 answer, e.g. a proxy's 502 while the service restarts. When that happens the client
     * reopens the stream itself with exponential backoff, passing the last sequence number it saw
     * as `?lastEventId=` (a fresh EventSource sends no header). The service's 15 s keepalive
     * comments are not visible through the EventSource API, so a half-open socket that never
     * closes cannot be detected here; proxies end the client connection when the upstream dies
     * (the dev proxy in vite.config.ts does the same), which is what makes the browser notice.
     */
    stream: (filter, { onEvent, onConnection, onRetry }) => {
      let source: EventSource | null = null
      let timer: ReturnType<typeof setTimeout> | undefined
      let lastSeq: number | undefined
      let attempt = 0
      let stopped = false

      // the server names each frame after its event type, lower-cased
      const listener = (e: MessageEvent<string>) => {
        let event: CommunicationEvent
        try {
          event = JSON.parse(e.data) as CommunicationEvent
        } catch {
          return // a malformed frame is skipped, the stream carries on
        }
        if (typeof event.seq === 'number') lastSeq = lastSeq === undefined ? event.seq : Math.max(lastSeq, event.seq)
        onEvent(event)
      }

      const open = () => {
        // EventSource cannot set headers, so the stream identifies itself in the query instead
        const extra: Record<string, string | number> = { clientId }
        if (lastSeq !== undefined) extra.lastEventId = lastSeq
        const es = new EventSource(`${root}/v1/feed/stream?${feedQuery(filter, extra)}`)
        source = es
        EVENT_TYPES.forEach((t) => es.addEventListener(t.toLowerCase(), listener))
        es.onopen = () => {
          attempt = 0
          onConnection?.(true)
        }
        es.onerror = () => {
          onConnection?.(false)
          // CONNECTING: the browser retries on its own; CLOSED: it gave up, so we take over
          if (es.readyState === EventSource.CLOSED && !stopped && source === es) reopen()
        }
      }

      const reopen = () => {
        source?.close()
        source = null
        attempt += 1
        const delay = reconnectDelay(attempt)
        onRetry?.(attempt, delay)
        timer = setTimeout(open, delay)
      }

      open()
      return () => {
        stopped = true
        clearTimeout(timer)
        source?.close()
        source = null
      }
    },
  }
}
