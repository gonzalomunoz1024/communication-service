/**
 * Wire types for communication-service (/v1). Mirrors the Java records in
 * com.atlas.communication.*: keep in step with CreateCommunicationCommand, FeedItem,
 * CommunicationEvent and Page.
 */

export const COMMUNICATION_TYPES = ['OUTAGE', 'INCIDENT', 'MAINTENANCE', 'CHANGE', 'HEALTH'] as const
export type CommunicationType = (typeof COMMUNICATION_TYPES)[number]

/** Ordered: index is rank (INFO lowest). */
export const SEVERITIES = ['INFO', 'MINOR', 'MAJOR', 'CRITICAL'] as const
export type Severity = (typeof SEVERITIES)[number]

export const AUDIENCES = ['CUSTOMERS', 'PUBLIC', 'INTERNAL'] as const
export type Audience = (typeof AUDIENCES)[number]

export type CommunicationStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'RETIRED'

export type CommunicationEventType = 'SNAPSHOT' | 'CREATED' | 'UPDATED' | 'ACTIVATED' | 'EXPIRED' | 'RETIRED'

/** POST /v1/communications body. Instants are ISO-8601 strings. */
export interface CreateCommunication {
  tenantId: string
  publisher: string
  type: CommunicationType
  severity: Severity
  title: string
  body?: string
  affectedServices?: string[]
  audience?: Audience
  draft?: boolean
  startsAt?: string
  endsAt?: string
  expiresAt?: string
  externalRef?: string
}

/** Fields shared by the feed projection and the full aggregate. */
interface CommunicationFields {
  id: string
  tenantId: string
  publisher: string
  type: CommunicationType
  severity: Severity
  title: string
  body?: string
  affectedServices: string[]
  audience: Audience
  status: CommunicationStatus
  startsAt: string
  endsAt?: string
  expiresAt?: string
  externalRef?: string
  updatedAt: string
}

/** GET /v1/feed item: `status` is the effective status at read time. */
export type FeedItem = CommunicationFields

export interface AuditEntry {
  at: string
  actor: string
  action: string
}

/** The full aggregate (publish responses, SSE payloads): `status` is the stored status. */
export interface Communication extends CommunicationFields {
  createdAt: string
  version?: number
  history?: AuditEntry[]
}

export interface Page<T> {
  items: T[]
  page: number
  size: number
  totalElements: number
  hasNext: boolean
}

/** One frame of GET /v1/feed/stream. */
export interface CommunicationEvent {
  seq: number
  type: CommunicationEventType
  at: string
  communication: Communication
}

export interface FeedFilter {
  tenantId: string
  service?: string
  type?: CommunicationType
  /** minimum severity */
  severity?: Severity
  audience?: Audience
}
