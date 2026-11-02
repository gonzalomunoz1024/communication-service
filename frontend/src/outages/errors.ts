import { ApiError } from './api'
import type { CreateCommunication } from './types'

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

/** A 409 for a reused (tenantId, externalRef) key, in the form's terms. */
export interface DuplicateReference {
  /** the reference that is taken */
  reference: string
  tenantId: string
  /** the reference is the ServiceNow incident number (External reference was left empty) */
  fromTicket: boolean
  /**
   * a value to suggest for the follow-up notice: the service's `suggestedExternalRef`, else
   * nextReference(); none when the service says the follow-up values it checked are all taken
   */
  next?: string
  /** the service's own sentence (it names the notice that holds the key by id) */
  said: string
}

/**
 * The value to suggest once `reference` is taken, from a service that neither names one nor says
 * they are all taken: a follow-up's number goes up (INC0012345-2 → INC0012345-3), anything else gets
 * -2 (the end of a date such as payments-2026-11-12 is not a count, so it is left alone). Only the
 * service knows whether that value is free as well.
 */
export function nextReference(reference: string): string {
  const m = /^(.+)-([1-9])$/.exec(reference)
  return m ? `${m[1]}-${Number(m[2]) + 1}` : `${reference}-2`
}

/**
 * How the service says it found no free follow-up value; it then sends no suggestedExternalRef:
 * "give a follow-up notice a new value (INC9-2 to INC9-51 are taken as well)".
 */
const NONE_FREE = /\(([^()]+ are taken as well)\)/

/**
 * Recognises the 409 for a reused (tenantId, externalRef) key by its status and the word
 * externalRef, whatever the rest of the sentence says (the service names the notice that holds the
 * key and the idempotency rule; an older one said only "duplicate externalRef 'X' for tenant 'T'").
 * The reference and the tenant come from the request when it is given, else from the sentence.
 * Null for any other failure.
 */
export function duplicateReference(e: unknown, sent?: CreateCommunication): DuplicateReference | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !/\bexternalRef\b/.test(e.message)) return null
  const said = e.message.trim()
  const typed = sent?.externalRef?.trim()
  const reference = typed || sent?.ticket?.number || /externalRef '(.+?)' (?:is already used|for tenant)/.exec(said)?.[1]
  const tenantId = sent?.tenantId.trim() || /\b(?:in|for) tenant '?([^\s']+)/.exec(said)?.[1].replace(/[.;,:]+$/, '')
  if (!reference || !tenantId) return null
  // the service names the first follow-up the tenant does not hold yet (INC…-3 when INC…-2 is taken too),
  // or says it found none free; a service that does neither leaves the counting to nextReference()
  const suggested = e.body?.suggestedExternalRef?.trim()
  const next = suggested || (NONE_FREE.test(said) ? undefined : nextReference(reference))
  return { reference, tenantId, fromTicket: sent ? !typed && !!sent.ticket : true, next, said }
}

/**
 * explainError for a publish. `(tenantId, externalRef)` is a permanent idempotency key: a retired
 * notice keeps its reference, so nothing can be retired to free it and a follow-up for the same
 * incident needs another value. The service's 409 says so in API terms (a notice id, "retry the
 * same publish"), so it is explained here in the form's terms, naming the field the reference
 * came from (usually the ServiceNow incident number, which doubles as the reference) and a value
 * to use instead; the service's sentence stays available as `duplicateReference(e, sent).said`.
 * Pass the request that was sent so the explanation names the right field.
 */
export function explainPublishError(e: unknown, sent?: CreateCommunication): string {
  const taken = duplicateReference(e, sent)
  if (!taken) return explainError(e)
  const { reference, tenantId, next } = taken
  // a value to use, or the service's own words when the follow-up values it checked are all taken
  const instead = next ? `, such as ${next}` : ` (${NONE_FREE.exec(taken.said)?.[1] ?? ''})`
  return taken.fromTicket
    ? `${reference} is already the reference of a notice in tenant ${tenantId} (the ServiceNow incident number doubles as the reference). References are permanent, even after a notice is retired, so a follow-up for the same incident needs another External reference${instead}.`
    : `${reference} is already the External reference of a notice in tenant ${tenantId}. References are permanent, even after a notice is retired, so a follow-up needs another External reference${instead}.`
}
