import type { Communication, CommunicationEvent, CommunicationStatus, FeedItem } from './types'
import { SEVERITIES } from './types'

/**
 * The status a reader sees at `now`, as Communication#effectiveStatus computes it server-side:
 * SSE payloads carry the stored status, which lags until the sweeper runs.
 */
export function effectiveStatus(c: Pick<Communication, 'status' | 'startsAt' | 'expiresAt'>, now = Date.now()): CommunicationStatus {
  if (c.status === 'DRAFT' || c.status === 'RETIRED' || c.status === 'EXPIRED') return c.status
  if (c.expiresAt && now >= Date.parse(c.expiresAt)) return 'EXPIRED'
  if (now < Date.parse(c.startsAt)) return 'SCHEDULED'
  return 'ACTIVE'
}

/** Projects a full communication onto the feed shape (drops history/version). */
export function toFeedItem(c: Communication, now = Date.now()): FeedItem {
  return {
    id: c.id,
    tenantId: c.tenantId,
    publisher: c.publisher,
    type: c.type,
    severity: c.severity,
    title: c.title,
    body: c.body,
    affectedServices: c.affectedServices ?? [],
    audience: c.audience,
    status: effectiveStatus(c, now),
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    expiresAt: c.expiresAt,
    externalRef: c.externalRef,
    ticket: c.ticket,
    updatedAt: c.updatedAt,
  }
}

/**
 * How far ahead scheduled maintenance is listed: mirrors `communication.feed.upcoming-window`
 * in the service's application.yml (P7D). Keep the two in step.
 */
export const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The visibility rule of GET /v1/feed (CommunicationQuery.visibleAt): everything live, plus
 * scheduled MAINTENANCE that starts within the upcoming window. Scheduled outages, incidents
 * and changes appear only once they start. Stream frames go through the same rule, so the
 * live list and a reload agree.
 */
export function inFeed(item: Pick<FeedItem, 'status' | 'type' | 'startsAt'>, now = Date.now()): boolean {
  if (item.status === 'ACTIVE') return true
  if (item.status !== 'SCHEDULED') return false
  return item.type === 'MAINTENANCE' && Date.parse(item.startsAt) <= now + UPCOMING_WINDOW_MS
}

/**
 * Applies one stream event to the feed: upsert by id while the communication is in the feed,
 * drop it once it is retired, expired, a draft or scheduled outside what the feed lists.
 * Older updates never overwrite newer ones.
 */
export function applyEvent(items: FeedItem[], event: CommunicationEvent, now = Date.now()): FeedItem[] {
  const next = toFeedItem(event.communication, now)
  const i = items.findIndex((it) => it.id === next.id)
  if (!inFeed(next, now)) return i === -1 ? items : items.filter((it) => it.id !== next.id)
  if (i === -1) return [...items, next]
  if (Date.parse(items[i].updatedAt) > Date.parse(next.updatedAt)) return items
  const copy = items.slice()
  copy[i] = next
  return copy
}

/** Removes one item (after a retire from this page, before the stream confirms it). */
export function removeItem(items: FeedItem[], id: string): FeedItem[] {
  return items.filter((it) => it.id !== id)
}

/**
 * Replaces the list with a freshly loaded page, keeping local items the stream updated after
 * the request started (`since`, ms): a frame that arrived while the GET was in flight is newer
 * than the page and must not be lost. Items of another tenant never survive the swap.
 */
export function reconcile(local: FeedItem[], page: FeedItem[], since: number, tenantId: string): FeedItem[] {
  const onPage = new Set(page.map((it) => it.id))
  const fresh = local.filter((it) => !onPage.has(it.id) && it.tenantId === tenantId && Date.parse(it.updatedAt) >= since)
  return [...page, ...fresh]
}

const STATUS_ORDER: Record<CommunicationStatus, number> = { ACTIVE: 0, SCHEDULED: 1, DRAFT: 2, EXPIRED: 3, RETIRED: 4 }

/** Active before scheduled, then most severe, then most recently started. */
export function sortFeed(items: FeedItem[]): FeedItem[] {
  return items.slice().sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) ||
      Date.parse(b.startsAt) - Date.parse(a.startsAt),
  )
}
