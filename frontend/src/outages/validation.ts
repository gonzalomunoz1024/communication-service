import { SEVERITIES, type CommunicationType, type CreateCommunication, type Severity, type Audience } from './types'

/** Limits from Communication / CreateCommunicationCommand. */
export const TITLE_MAX = 200
export const BODY_MAX_BYTES = 16 * 1024
export const SERVICES_MAX = 20

/** What the publish form edits: strings straight from the inputs. */
export interface OutageDraft {
  tenantId: string
  publisher: string
  type: CommunicationType
  severity: Severity
  title: string
  body: string
  /** comma or newline separated */
  services: string
  audience: Audience
  /** datetime-local values ('' = not set) */
  startsAt: string
  endsAt: string
  expiresAt: string
  externalRef: string
  draft: boolean
}

export function emptyDraft(tenantId = '', publisher = ''): OutageDraft {
  return {
    tenantId,
    publisher,
    type: 'OUTAGE',
    severity: 'MAJOR',
    title: '',
    body: '',
    services: '',
    audience: 'CUSTOMERS',
    startsAt: '',
    endsAt: '',
    expiresAt: '',
    externalRef: '',
    draft: false,
  }
}

export type DraftErrors = Partial<Record<keyof OutageDraft, string>>

export function parseServices(raw: string): string[] {
  const seen = new Set<string>()
  for (const s of raw.split(/[,\n]/)) {
    const v = s.trim()
    if (v) seen.add(v)
  }
  return [...seen]
}

/** datetime-local ("2026-11-01T21:30") is local time; the API wants an instant. */
export function localToIso(value: string): string | undefined {
  if (!value) return undefined
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}

/** The same invariants the service enforces, so most mistakes never leave the page. */
export function validate(d: OutageDraft, now = Date.now()): DraftErrors {
  const e: DraftErrors = {}
  if (!d.tenantId.trim()) e.tenantId = 'Tenant is required'
  if (!d.publisher.trim()) e.publisher = 'Publisher is required'
  if (!d.title.trim()) e.title = 'Title is required'
  else if (d.title.length > TITLE_MAX) e.title = `At most ${TITLE_MAX} characters`
  if (new TextEncoder().encode(d.body).length > BODY_MAX_BYTES) e.body = 'Body is larger than 16 KB'
  if (parseServices(d.services).length > SERVICES_MAX) e.services = `At most ${SERVICES_MAX} services`
  if ((d.type === 'OUTAGE' || d.type === 'INCIDENT') && SEVERITIES.indexOf(d.severity) < SEVERITIES.indexOf('MINOR')) {
    e.severity = `${d.type === 'OUTAGE' ? 'Outages' : 'Incidents'} need MINOR or higher`
  }
  const start = d.startsAt ? new Date(d.startsAt).getTime() : now
  if (d.type === 'MAINTENANCE' && !d.endsAt) e.endsAt = 'Maintenance needs an end time'
  if (d.endsAt && new Date(d.endsAt).getTime() <= start) e.endsAt = 'Must be after the start'
  if (d.expiresAt && new Date(d.expiresAt).getTime() <= start) e.expiresAt = 'Must be after the start'
  return e
}

/** The POST /v1/communications body for a valid draft. */
export function toRequest(d: OutageDraft): CreateCommunication {
  const services = parseServices(d.services)
  return {
    tenantId: d.tenantId.trim(),
    publisher: d.publisher.trim(),
    type: d.type,
    severity: d.severity,
    title: d.title.trim(),
    body: d.body.trim() || undefined,
    affectedServices: services.length ? services : undefined,
    audience: d.audience,
    draft: d.draft || undefined,
    startsAt: localToIso(d.startsAt),
    endsAt: localToIso(d.endsAt),
    expiresAt: localToIso(d.expiresAt),
    externalRef: d.externalRef.trim() || undefined,
  }
}
