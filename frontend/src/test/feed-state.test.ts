import { describe, expect, it } from 'vitest'
import { UPCOMING_WINDOW_MS, applyEvent, effectiveStatus, inFeed, nextChange, reconcile, revise, sortFeed, toFeedItem } from '../outages/feed-state'
import type { Communication, CommunicationEvent, FeedItem } from '../outages/types'

const now = Date.parse('2026-11-01T21:00:00Z')

function comm(over: Partial<Communication> = {}): Communication {
  return {
    id: 'c1',
    tenantId: 'acme',
    publisher: 'oncall',
    type: 'OUTAGE',
    severity: 'MAJOR',
    title: 't',
    affectedServices: ['payments'],
    audience: 'CUSTOMERS',
    status: 'ACTIVE',
    startsAt: '2026-11-01T20:00:00Z',
    createdAt: '2026-11-01T20:00:00Z',
    updatedAt: '2026-11-01T20:00:00Z',
    ...over,
  }
}
const event = (type: CommunicationEvent['type'], c: Communication): CommunicationEvent => ({ seq: 1, type, at: new Date(now).toISOString(), communication: c })

describe('effectiveStatus', () => {
  it('derives time-based states instead of trusting the stored one', () => {
    expect(effectiveStatus(comm({ status: 'SCHEDULED' }), now)).toBe('ACTIVE')
    expect(effectiveStatus(comm({ startsAt: '2026-11-01T22:00:00Z' }), now)).toBe('SCHEDULED')
    expect(effectiveStatus(comm({ expiresAt: '2026-11-01T20:30:00Z' }), now)).toBe('EXPIRED')
    expect(effectiveStatus(comm({ status: 'RETIRED' }), now)).toBe('RETIRED')
    expect(effectiveStatus(comm({ status: 'DRAFT' }), now)).toBe('DRAFT')
  })
})

describe('applyEvent', () => {
  it('inserts, then updates by id', () => {
    const a = applyEvent([], event('CREATED', comm()), now)
    expect(a).toHaveLength(1)
    const b = applyEvent(a, event('UPDATED', comm({ title: 'new', updatedAt: '2026-11-01T20:05:00Z' })), now)
    expect(b).toHaveLength(1)
    expect(b[0].title).toBe('new')
  })
  it('ignores an update older than what is shown', () => {
    const a = applyEvent([], event('CREATED', comm({ title: 'newer', updatedAt: '2026-11-01T20:05:00Z' })), now)
    const b = applyEvent(a, event('UPDATED', comm({ title: 'older' })), now)
    expect(b[0].title).toBe('newer')
  })
  it('removes retired and expired items', () => {
    const a = applyEvent([], event('CREATED', comm()), now)
    expect(applyEvent(a, event('RETIRED', comm({ status: 'RETIRED' })), now)).toEqual([])
    expect(applyEvent(a, event('EXPIRED', comm({ status: 'EXPIRED' })), now)).toEqual([])
  })
  it('does not add a draft', () => {
    expect(applyEvent([], event('CREATED', comm({ status: 'DRAFT' })), now)).toEqual([])
  })
  it('lists scheduled maintenance inside the upcoming window, like GET /v1/feed', () => {
    const inThreeDays = new Date(now + 3 * 86_400_000).toISOString()
    const inTenDays = new Date(now + 10 * 86_400_000).toISOString()
    const soon = applyEvent([], event('CREATED', comm({ type: 'MAINTENANCE', severity: 'INFO', status: 'SCHEDULED', startsAt: inThreeDays })), now)
    expect(soon.map((i) => [i.id, i.status])).toEqual([['c1', 'SCHEDULED']])
    expect(applyEvent([], event('CREATED', comm({ type: 'MAINTENANCE', severity: 'INFO', status: 'SCHEDULED', startsAt: inTenDays })), now)).toEqual([])
  })
  it('does not list a scheduled outage, incident or change until it starts', () => {
    const inOneHour = new Date(now + 3_600_000).toISOString()
    for (const type of ['OUTAGE', 'INCIDENT', 'CHANGE'] as const) {
      expect(applyEvent([], event('CREATED', comm({ type, status: 'SCHEDULED', startsAt: inOneHour })), now)).toEqual([])
    }
    // ...and drops one that is pushed into the future by an update
    const shown = applyEvent([], event('CREATED', comm()), now)
    expect(applyEvent(shown, event('UPDATED', comm({ startsAt: inOneHour, updatedAt: '2026-11-01T20:30:00Z' })), now)).toEqual([])
  })
  it('keeps the ticket when projecting', () => {
    const ticket = { system: 'servicenow', number: 'INC0012345', url: 'https://acme.service-now.com/x' }
    expect(toFeedItem(comm({ ticket }), now).ticket).toEqual(ticket)
    expect(toFeedItem(comm(), now).ticket).toBeUndefined()
  })
  it('drops history when projecting', () => {
    const item = toFeedItem(comm({ history: [{ at: 'x', actor: 'y', action: 'z' }], version: 3 }), now)
    expect('history' in item).toBe(false)
    expect('version' in item).toBe(false)
  })
})

describe('inFeed', () => {
  it('matches the service rule at the window boundary', () => {
    const edge = { status: 'SCHEDULED', type: 'MAINTENANCE', startsAt: new Date(now + UPCOMING_WINDOW_MS).toISOString() } as const
    expect(inFeed(edge, now)).toBe(true)
    expect(inFeed({ ...edge, startsAt: new Date(now + UPCOMING_WINDOW_MS + 1000).toISOString() }, now)).toBe(false)
    expect(inFeed({ ...edge, type: 'OUTAGE' }, now)).toBe(false)
    expect(inFeed({ status: 'ACTIVE', type: 'OUTAGE', startsAt: '2026-11-01T20:00:00Z' }, now)).toBe(true)
    expect(inFeed({ status: 'EXPIRED', type: 'OUTAGE', startsAt: '2026-11-01T20:00:00Z' }, now)).toBe(false)
  })
})

describe('reconcile', () => {
  const since = Date.parse('2026-11-01T21:00:00Z')
  const page = [toFeedItem(comm({ id: 'p1' }), now)]
  it('takes the page and keeps items the stream touched after the request started', () => {
    const local = [
      toFeedItem(comm({ id: 'p1', title: 'stale copy' }), now),
      toFeedItem(comm({ id: 'old', updatedAt: '2026-11-01T20:59:59Z' }), now),
      toFeedItem(comm({ id: 'fresh', updatedAt: '2026-11-01T21:00:01Z' }), now),
    ]
    expect(reconcile(local, page, since, 'acme').map((i) => i.id)).toEqual(['p1', 'fresh'])
    expect(reconcile(local, page, since, 'acme')[0].title).toBe('t')
  })
  it('never carries another tenant over', () => {
    const local = [toFeedItem(comm({ id: 'x', tenantId: 'other', updatedAt: '2026-11-01T21:00:01Z' }), now)]
    expect(reconcile(local, page, since, 'acme').map((i) => i.id)).toEqual(['p1'])
  })
})

describe('revise and nextChange', () => {
  it('moves statuses across start and expiry boundaries and drops what left the feed', () => {
    const items = [
      toFeedItem(comm({ id: 'live', expiresAt: '2026-11-01T21:30:00Z' }), now),
      toFeedItem(comm({ id: 'soon', type: 'MAINTENANCE', severity: 'INFO', status: 'SCHEDULED', startsAt: '2026-11-01T22:00:00Z' }), now),
    ]
    expect(items.map((i) => i.status)).toEqual(['ACTIVE', 'SCHEDULED'])
    expect(revise(items, now)).toBe(items) // nothing due: the same array, so nothing re-renders
    expect(nextChange(items, now)).toBe(Date.parse('2026-11-01T21:30:00Z'))

    const expiry = Date.parse('2026-11-01T21:30:00Z')
    const afterExpiry = revise(items, expiry)
    expect(afterExpiry.map((i) => [i.id, i.status])).toEqual([['soon', 'SCHEDULED']])
    expect(nextChange(afterExpiry, expiry)).toBe(Date.parse('2026-11-01T22:00:00Z'))

    const start = Date.parse('2026-11-01T22:00:00Z')
    const afterStart = revise(afterExpiry, start)
    expect(afterStart.map((i) => [i.id, i.status])).toEqual([['soon', 'ACTIVE']])
    expect(nextChange(afterStart, start)).toBeUndefined()
  })
})

describe('sortFeed', () => {
  it('orders active before scheduled, then by severity, then latest start', () => {
    const items: FeedItem[] = [
      toFeedItem(comm({ id: 'sched', startsAt: '2026-11-01T22:00:00Z', severity: 'CRITICAL' }), now),
      toFeedItem(comm({ id: 'minor', severity: 'MINOR' }), now),
      toFeedItem(comm({ id: 'major-old', startsAt: '2026-11-01T19:00:00Z' }), now),
      toFeedItem(comm({ id: 'major-new' }), now),
    ]
    expect(sortFeed(items).map((i) => i.id)).toEqual(['major-new', 'major-old', 'minor', 'sched'])
  })
})
