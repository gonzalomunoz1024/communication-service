import type { Tone } from '../ui'
import type { CommunicationStatus, CommunicationType, Severity } from './types'

export const SEVERITY_TONE: Record<Severity, Tone> = {
  INFO: 'neutral',
  MINOR: 'accent',
  MAJOR: 'warning',
  CRITICAL: 'critical',
}

export const STATUS_TONE: Record<CommunicationStatus, Tone> = {
  ACTIVE: 'critical',
  SCHEDULED: 'accent',
  DRAFT: 'neutral',
  EXPIRED: 'neutral',
  RETIRED: 'healthy',
}

/** "OUTAGE" → "Outage" */
export function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase()
}

export const TYPE_HINT: Record<CommunicationType, string> = {
  OUTAGE: 'A service is down or unusable',
  INCIDENT: 'Degraded or partially failing',
  MAINTENANCE: 'Planned window; needs an end time',
  CHANGE: 'A notable change consumers should know about',
  HEALTH: 'Raised by automated health checks',
}
