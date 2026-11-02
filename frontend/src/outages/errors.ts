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

/** The service's bare 409 for a reused key: only the key and the tenant, no explanation. */
const BARE_DUPLICATE_REF = /^duplicate externalRef '([^']*)' for tenant '([^']*)'$/

/**
 * explainError for a publish. `(tenantId, externalRef)` is a permanent idempotency key: a retired
 * notice keeps its reference, so nothing can be retired to free it and a follow-up for the same
 * incident needs another value. When the service's 409 already says so (and names the notice
 * that holds the key) its text is shown as it is; when it sends only the bare key, the
 * explanation is given here, in the form's terms, because the field people filled in is the
 * ServiceNow incident number, which doubles as the reference.
 */
export function explainPublishError(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) {
    const m = BARE_DUPLICATE_REF.exec(e.message.trim())
    if (m) {
      return `${m[1]} is already the reference of a notice in tenant ${m[2]} (the ServiceNow incident number doubles as the reference). References are permanent, even after a notice is retired, so a follow-up for the same incident needs another External reference, such as ${m[1]}-2.`
    }
  }
  return explainError(e)
}
