import { ApiError } from './api'

/** Shown when the service does not answer at all: the bare status line ("502 Bad Gateway") reads like a rejection. */
export const UNREACHABLE_MESSAGE = 'The service is unreachable right now. Check that communication-service is running, then try again.'

/**
 * True when the failure is the service not being there (the connection failed, or a proxy in
 * front of it answered 502/503/504), as opposed to the service rejecting the request.
 */
export function isUnreachable(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504
  return e instanceof TypeError // what fetch rejects with when the connection fails
}

/** The text to show a person for a failed call: the service's own words for a rejection, plain words otherwise. */
export function explainError(e: unknown): string {
  if (isUnreachable(e)) return UNREACHABLE_MESSAGE
  if (e instanceof Error) return e.message
  return String(e)
}

const DUPLICATE_REF = /duplicate externalRef '([^']*)' for tenant '([^']*)'/

/**
 * explainError for a publish: the service's 409 for a reused externalRef is put in the form's
 * terms, because the field people filled in is the ServiceNow incident number, which doubles as
 * the reference.
 */
export function explainPublishError(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) {
    const m = DUPLICATE_REF.exec(e.message)
    if (m) {
      return `A notice with the reference ${m[1]} already exists for tenant ${m[2]} (the ServiceNow incident number doubles as the reference). Retire that notice first, or set another external reference.`
    }
  }
  return explainError(e)
}
