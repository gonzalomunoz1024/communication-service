import type {
  Communication,
  CommunicationEvent,
  CommunicationEventType,
  CreateCommunication,
  ErrorBody,
  FeedFilter,
  FeedItem,
  Page,
} from './types'

/**
 * A failed call: a non-2xx answer (`message` is the service's {"error": "..."} text when it sent
 * one, else the status line), or `status` 0 when the connection itself failed and there was no
 * answer at all.
 */
export class ApiError extends Error {
  readonly status: number
  /** true when `message` is the service's own {"error"} text, false for a status line or a failed connection */
  readonly fromService: boolean
  /** the service's error body, when it sent one */
  readonly body?: ErrorBody
  constructor(status: number, message: string, fromService = false, body?: ErrorBody) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fromService = fromService
    this.body = body
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

export interface StreamHandlers {
  onEvent: (event: CommunicationEvent) => void
  /**
   * true once the stream works (it delivered a frame, or stayed open STREAM_SETTLE_MS), false when it
   * stops working or an attempt fails
   */
  onConnection?: (open: boolean) => void
  /**
   * An attempt failed (a non-200 answer such as a proxy's 502 or the service's 503, or a stream that
   * ended before it worked) and the client is reopening the stream itself: the attempt number
   * (1-based) and the delay before it.
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

/**
 * Reopen backoff: 1 s, 2 s, 4 s, 8 s, then every 10 s. The cap is how long a page can take to
 * notice that the service is back after a long outage (each attempt is one cheap request that a
 * proxy answers at once while the service is down); it starts again from 1 s once a stream works.
 */
export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_MAX_MS = 10_000

/**
 * How long a stream that has sent no frame must stay open before it counts as working. A 200 alone
 * proves nothing: a service that answered before it found its database unreachable ends the stream
 * when its 5 s database wait gives up (`communication.mongo.server-selection-timeout`), 5.0 to 5.06 s
 * after the open as Chromium sees it. A frame proves it at once; a stream with nothing to send (no
 * notice matches the filter) is trusted after this, a second past that wait.
 */
export const STREAM_SETTLE_MS = 6_000

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

/** The service's {"error"} text when it sent one (true, with its body), else the status line (false). */
async function errorMessage(res: Response): Promise<[string, boolean, ErrorBody?]> {
  try {
    const body = (await res.json()) as ErrorBody
    if (body?.error) {
      const suggestedExternalRef = typeof body.suggestedExternalRef === 'string' ? body.suggestedExternalRef : undefined
      return [body.error, true, { error: body.error, suggestedExternalRef }]
    }
  } catch {
    /* not JSON */
  }
  return [`${res.status} ${res.statusText}`.trim(), false]
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
    if (!res.ok) {
      const [text, fromService, body] = await errorMessage(res)
      throw new ApiError(res.status, text, fromService, body)
    }
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
     * non-200 answer, e.g. a proxy's 502 while the service restarts or the service's own 503 while
     * it cannot reach its database. A 200 is not proof either: a service that answered before it
     * found its database unreachable ends the stream seconds later, and the browser's fixed ~3 s
     * retry would then open, end and open it again for as long as the outage lasts. So a stream
     * counts as working only once it delivers a frame or stays open STREAM_SETTLE_MS; an attempt
     * that fails before that (refused, unreachable, or ended early) is closed and the client
     * reopens the stream itself with exponential backoff, which keeps growing until a stream
     * works. Only a working stream that drops is left to the browser's own retry. Every attempt
     * passes the last sequence number seen as `?lastEventId=` (a fresh EventSource sends no
     * header), failed ones included: an attempt that never worked met a proxy, a restarting
     * service or a database outage, not a refusal, and the first one that gets through is then a
     * real resume. The service never rejects a numeric id; one it cannot resume from (too old, or
     * never issued by its log) is answered with a fresh snapshot, which the feed applies like any
     * other, so there is nothing to drop here. The service's 15 s keepalive comments are not
     * visible through the EventSource API, so a half-open socket that never closes cannot be
     * detected here; proxies end the client connection when the upstream dies (the dev proxy in
     * vite.config.ts does the same), which is what makes the browser notice.
     */
    stream: (filter, { onEvent, onConnection, onRetry }) => {
      let source: EventSource | null = null
      let timer: ReturnType<typeof setTimeout> | undefined
      let settling: ReturnType<typeof setTimeout> | undefined
      let lastSeq: number | undefined
      let attempt = 0
      let working = false
      let stopped = false

      // the stream proved itself: say so once, and retry the next outage, whenever it comes, from 1 s again
      const works = () => {
        clearTimeout(settling)
        if (working) return
        working = true
        attempt = 0
        onConnection?.(true)
      }

      // the server names each frame after its event type, lower-cased
      const listener = (e: MessageEvent<string>) => {
        works()
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
          // answered, which is not yet working: it must outlast the service's database wait or send a frame
          clearTimeout(settling)
          settling = setTimeout(works, STREAM_SETTLE_MS)
        }
        es.onerror = () => {
          if (stopped || source !== es) return
          clearTimeout(settling)
          onConnection?.(false)
          if (working) {
            // a working stream dropped: the browser retries on its own while CONNECTING; CLOSED: it gave up
            working = false
            if (es.readyState === EventSource.CLOSED) reopen()
          } else {
            // a failed attempt, retried with the growing backoff rather than the browser's fixed delay
            reopen()
          }
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
        clearTimeout(settling)
        source?.close()
        source = null
      }
    },
  }
}
