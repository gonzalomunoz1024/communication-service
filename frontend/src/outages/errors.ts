import { ApiError } from './api'

/** Shown when the service does not answer at all: the bare status line ("502 Bad Gateway") reads like a rejection. */
export const UNREACHABLE_MESSAGE = 'The service is unreachable right now. Check that communication-service is running, then try again.'

/**
 * True when the failure is the service not being there: the connection failed, or something in
 * front of it (a proxy, the dev server) answered 502/503/504 without the service's {"error"} body.
 * A 5xx that carries that body came from the running service, which said why it failed.
 */
export function isUnreachable(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 0 || (!e.fromService && (e.status === 502 || e.status === 503 || e.status === 504))
  return e instanceof TypeError // what fetch rejects with when the connection fails
}

/** True for a 4xx: the service understood the request and refused it, so its text is about the input. */
export function isRejection(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 400 && e.status < 500
}

/** The reason the service gives for its 503 while it cannot reach its database ({"error":"database unavailable"}). */
const DATABASE_REASON = /\bdatabase\b/i

/**
 * The text to show a person for a failed call: the service's own words for a rejection, a
 * failure of the service named as such for a 5xx, plain words otherwise.
 */
export function explainError(e: unknown): string {
  if (isUnreachable(e)) return UNREACHABLE_MESSAGE
  if (e instanceof ApiError && e.status >= 500) {
    // a fault in the service, not in the input: the status line alone would read like a verdict
    const reason = e.fromService ? e.message.trim().replace(/\.$/, '') : ''
    if (e.status === 503 && DATABASE_REASON.test(reason)) {
      // the service is up and says its database is not; it reconnects by itself, nobody needs to restart it
      return `The service cannot reach its database right now (HTTP 503): ${reason}. It recovers on its own; try again in a moment.`
    }
    return `The service failed (HTTP ${e.status})${reason ? `: ${reason}` : ''}. Try again; if it keeps happening, tell the service owners.`
  }
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
