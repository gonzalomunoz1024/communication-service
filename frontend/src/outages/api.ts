import type {
  Communication,
  CommunicationEvent,
  CommunicationEventType,
  CreateCommunication,
  FeedFilter,
  FeedItem,
  Page,
} from './types'

/** A non-2xx answer; `message` is the service's {"error": "..."} text when it sent one. */
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
}

export interface CommunicationClient {
  publish: (body: CreateCommunication) => Promise<Communication>
  feed: (filter: FeedFilter, page?: number, size?: number) => Promise<Page<FeedItem>>
  retire: (id: string, actor?: string, note?: string) => Promise<Communication>
  /** subscribes to /v1/feed/stream; returns the unsubscribe */
  stream: (filter: FeedFilter, handlers: StreamHandlers) => () => void
}

const EVENT_TYPES: CommunicationEventType[] = ['SNAPSHOT', 'CREATED', 'UPDATED', 'ACTIVATED', 'EXPIRED', 'RETIRED']

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
    const res = await fetchImpl(`${root}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'X-Client-Id': clientId,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
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

    stream: (filter, { onEvent, onConnection }) => {
      // EventSource cannot set headers, so the stream identifies itself in the query instead
      const source = new EventSource(`${root}/v1/feed/stream?${feedQuery(filter, { clientId })}`)
      // the server names each frame after its event type, lower-cased
      const listener = (e: MessageEvent<string>) => {
        try {
          onEvent(JSON.parse(e.data) as CommunicationEvent)
        } catch {
          /* a malformed frame is skipped, the stream carries on */
        }
      }
      EVENT_TYPES.forEach((t) => source.addEventListener(t.toLowerCase(), listener))
      source.onopen = () => onConnection?.(true)
      source.onerror = () => onConnection?.(false)
      return () => source.close()
    },
  }
}
