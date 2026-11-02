import { describe, expect, it } from 'vitest'
import { ApiError, createCommunicationClient, isApiError } from '../outages/api'
import { UNREACHABLE_MESSAGE, duplicateReference, explainError, explainPublishError, isRejection, isUnreachable, nextReference } from '../outages/errors'

describe('explainError', () => {
  it('says the service is unreachable for a failed connection or a proxy error', () => {
    const down = [
      new ApiError(0, 'Failed to fetch'),
      new ApiError(502, '502 Bad Gateway'),
      new ApiError(503, '503 Service Unavailable'),
      new ApiError(504, '504 Gateway Timeout'),
      new TypeError('NetworkError when attempting to fetch resource.'),
    ]
    for (const e of down) {
      expect(isUnreachable(e), String(e)).toBe(true)
      expect(explainError(e)).toBe(UNREACHABLE_MESSAGE)
    }
  })

  it("passes the service's own words through for a rejection", () => {
    const e = new ApiError(409, "duplicate externalRef 'INC0012345' for tenant 'acme'")
    expect(isUnreachable(e)).toBe(false)
    expect(explainError(e)).toBe("duplicate externalRef 'INC0012345' for tenant 'acme'")
    expect(isUnreachable(new ApiError(500, 'unexpected error'))).toBe(false)
    expect(explainError(new Error('boom'))).toBe('boom')
    expect(explainError('odd')).toBe('odd')
  })

  it('says the service failed, not that it rejected anything, for a 5xx', () => {
    // an empty body: the status line would read like a verdict on the input
    expect(explainError(new ApiError(500, '500 Internal Server Error'))).toBe('The service failed (HTTP 500). Try again; if it keeps happening, tell the service owners.')
    // the service gave a reason: quote it, still as a failure of the service
    expect(explainError(new ApiError(500, 'state unavailable.', true))).toBe(
      'The service failed (HTTP 500): state unavailable. Try again; if it keeps happening, tell the service owners.',
    )
    expect(isRejection(new ApiError(500, '500 Internal Server Error'))).toBe(false)
    // 4xx keep the service's words and count as a rejection of the request
    expect(explainError(new ApiError(400, 'title must not be blank', true))).toBe('title must not be blank')
    expect(isRejection(new ApiError(400, 'title must not be blank', true))).toBe(true)
    expect(isRejection(new ApiError(0, 'Failed to fetch'))).toBe(false)
    expect(isRejection(new ApiError(503, '503 Service Unavailable'))).toBe(false)
  })

  it("treats the service's own 503 as a failure it explained, not as the service being unreachable", () => {
    // while its database cannot be reached the service answers 503 {"error":"database unavailable"}: it is running
    const e = new ApiError(503, 'database unavailable', true)
    expect(isUnreachable(e)).toBe(false)
    expect(isRejection(e)).toBe(false)
    expect(explainError(e)).toBe('The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment.')
    // the same status with no body is a proxy answering for a service that is not there
    expect(isUnreachable(new ApiError(503, '503 Service Unavailable'))).toBe(true)
    expect(explainError(new ApiError(503, '503 Service Unavailable'))).toBe(UNREACHABLE_MESSAGE)
    // another reason the service may give for a 503 is quoted as any failure of the service, without claiming it recovers
    expect(explainError(new ApiError(503, 'event log unavailable.', true))).toBe('The service failed (HTTP 503): event log unavailable. Try again; if it keeps happening, tell the service owners.')
    // a 502/504 that carries a reason came from something that answered: the reason is shown, as for any 5xx
    expect(isUnreachable(new ApiError(502, 'upstream reset', true))).toBe(false)
    expect(explainError(new ApiError(502, 'upstream reset', true))).toBe('The service failed (HTTP 502): upstream reset. Try again; if it keeps happening, tell the service owners.')
  })
})

describe('explainPublishError', () => {
  it("explains a bare duplicate-externalRef 409 in the form's terms: the key is permanent, so a follow-up needs a new reference", () => {
    const e = new ApiError(409, "duplicate externalRef 'INC0012345' for tenant 'acme'")
    const text = explainPublishError(e)
    expect(text).toBe(
      'INC0012345 is already the reference of a notice in tenant acme (the ServiceNow incident number doubles as the reference). References are permanent, even after a notice is retired, so a follow-up for the same incident needs another External reference, such as INC0012345-2.',
    )
    expect(text).not.toMatch(/retire that/i)
  })
  it("explains a duplicate reference in the form's terms whatever the service's sentence says around it", () => {
    const explained =
      "externalRef 'INC0012345' is already used in tenant 'acme' by communication c42 (RETIRED); the key is permanent, so a follow-up needs another externalRef"
    expect(explainPublishError(new ApiError(409, explained))).toBe(
      'INC0012345 is already the reference of a notice in tenant acme (the ServiceNow incident number doubles as the reference). References are permanent, even after a notice is retired, so a follow-up for the same incident needs another External reference, such as INC0012345-2.',
    )
    expect(duplicateReference(new ApiError(409, explained))?.said).toBe(explained)
  })
  it("explains the service's current duplicate-reference sentence without its notice id or client-library terms", () => {
    // the 409 body the service sends today (communication-service-iter2.jar, POST /v1/communications twice with one ticket)
    const said =
      "externalRef 'INC0012345' is already used by notice 37f5f540-93b0-4641-8034-326848d8e50d in tenant fixfe3. externalRef is a permanent idempotency key: repeat it only to retry the same publish; give a follow-up notice a new value (for example INC0012345-2)."
    const e = new ApiError(409, said, true)
    expect(duplicateReference(e)).toEqual({ reference: 'INC0012345', tenantId: 'fixfe3', fromTicket: true, next: 'INC0012345-2', said })
    const text = explainPublishError(e)
    expect(text).toBe(
      'INC0012345 is already the reference of a notice in tenant fixfe3 (the ServiceNow incident number doubles as the reference). References are permanent, even after a notice is retired, so a follow-up for the same incident needs another External reference, such as INC0012345-2.',
    )
    expect(text).not.toMatch(/37f5f540|idempotency|retry the same publish|externalRef/)
  })
  it('names the External reference the person typed, and suggests the next follow-up number, from the request that was sent', () => {
    const said =
      "externalRef 'INC0012345-2' is already used by notice 42fe0701-4438-4ae6-9173-c060fdf38f63 in tenant acme. externalRef is a permanent idempotency key: repeat it only to retry the same publish; give a follow-up notice a new value (for example INC0012345-2-2)."
    const sent = { tenantId: 'acme', publisher: 'oncall', type: 'OUTAGE', severity: 'MAJOR', title: 't', externalRef: 'INC0012345-2', ticket: { system: 'servicenow', number: 'INC0012345' } } as const
    expect(explainPublishError(new ApiError(409, said, true), sent)).toBe(
      'INC0012345-2 is already the External reference of a notice in tenant acme. References are permanent, even after a notice is retired, so a follow-up needs another External reference, such as INC0012345-3.',
    )
    // the ticket number became the reference because External reference was left empty
    const fromTicket = { ...sent, externalRef: undefined }
    expect(duplicateReference(new ApiError(409, said.replaceAll('INC0012345-2', 'INC0012345'), true), fromTicket)).toMatchObject({ reference: 'INC0012345', fromTicket: true, next: 'INC0012345-2' })
  })
  it('reads the reference and the tenant from the sentence when no request is at hand, with or without the holder', () => {
    const noHolder = new ApiError(409, "externalRef 'O'Brien-7' is already used in tenant acme.eu. externalRef is a permanent idempotency key: give a follow-up notice a new value.", true)
    expect(duplicateReference(noHolder)).toMatchObject({ reference: "O'Brien-7", tenantId: 'acme.eu', next: "O'Brien-8" })
    // not a duplicate key: another 409, or a 400 that names the field
    expect(duplicateReference(new ApiError(409, 'communication c1 was modified concurrently; reload and retry', true))).toBeNull()
    expect(duplicateReference(new ApiError(400, 'externalRef: size must be between 0 and 128', true))).toBeNull()
    expect(explainPublishError(new ApiError(400, 'externalRef: size must be between 0 and 128', true))).toBe('externalRef: size must be between 0 and 128')
  })
  it("falls back to the service's own words when it cannot tell which reference is taken", () => {
    // a wording the form cannot read and no request at hand: the service's sentence rather than a guess
    const e = new ApiError(409, 'externalRef already taken', true)
    expect(duplicateReference(e)).toBeNull()
    expect(explainPublishError(e)).toBe('externalRef already taken')
  })
  it('suggests the next follow-up number, and -2 for anything else', () => {
    expect(['INC0012345', 'INC0012345-1', 'INC0012345-2', 'INC0012345-9', 'payments-2026-11-01', 'payments-2026-11-12', 'v2'].map(nextReference)).toEqual([
      'INC0012345-2',
      'INC0012345-2',
      'INC0012345-3',
      'INC0012345-10',
      'payments-2026-11-01-2',
      'payments-2026-11-12-2',
      'v2-2',
    ])
  })
  it('leaves every other error to explainError', () => {
    expect(explainPublishError(new ApiError(409, 'communication c1 was modified concurrently; reload and retry'))).toBe('communication c1 was modified concurrently; reload and retry')
    expect(explainPublishError(new ApiError(503, '503 Service Unavailable'))).toBe(UNREACHABLE_MESSAGE)
    expect(explainPublishError(new ApiError(503, 'database unavailable', true))).toBe(
      'The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment.',
    )
  })
})

describe('client with the service down', () => {
  it('turns a failed connection into an ApiError with status 0', async () => {
    const client = createCommunicationClient('http://svc', { fetchImpl: () => Promise.reject(new TypeError('fetch failed')) })
    const err: unknown = await client.feed({ tenantId: 'acme' }).catch((e: unknown) => e)
    expect(isApiError(err) && err.status === 0 && err.message === 'fetch failed').toBe(true)
    expect(isUnreachable(err)).toBe(true)
    expect(explainError(err)).toBe(UNREACHABLE_MESSAGE)
  })

  it('tells a 5xx with an empty body from one the service explained', async () => {
    const answer = (res: Response) => createCommunicationClient('http://svc', { fetchImpl: () => Promise.resolve(res) })
    const bare: unknown = await answer(new Response('', { status: 500, statusText: 'Internal Server Error' }))
      .feed({ tenantId: 'acme' })
      .catch((e: unknown) => e)
    expect(isApiError(bare) && bare.status === 500 && !bare.fromService).toBe(true)
    expect(explainError(bare)).toBe('The service failed (HTTP 500). Try again; if it keeps happening, tell the service owners.')

    const explained: unknown = await answer(new Response(JSON.stringify({ error: 'event log unavailable' }), { status: 500 }))
      .feed({ tenantId: 'acme' })
      .catch((e: unknown) => e)
    expect(isApiError(explained) && explained.fromService && explained.message === 'event log unavailable').toBe(true)
    expect(explainError(explained)).toBe('The service failed (HTTP 500): event log unavailable. Try again; if it keeps happening, tell the service owners.')
  })

  it("keeps the reason of a 503 that carries the service's {\"error\"} body apart from a proxy's bare 503", async () => {
    const answer = (res: Response) => createCommunicationClient('http://svc', { fetchImpl: () => Promise.resolve(res) })
    const fromService: unknown = await answer(new Response(JSON.stringify({ error: 'database unavailable' }), { status: 503, statusText: 'Service Unavailable' }))
      .feed({ tenantId: 'acme' })
      .catch((e: unknown) => e)
    expect(isApiError(fromService) && fromService.status === 503 && fromService.fromService && fromService.message === 'database unavailable').toBe(true)
    expect(isUnreachable(fromService)).toBe(false)
    expect(explainError(fromService)).toBe('The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment.')

    const fromProxy: unknown = await answer(new Response('<html>503 Service Unavailable</html>', { status: 503, statusText: 'Service Unavailable' }))
      .feed({ tenantId: 'acme' })
      .catch((e: unknown) => e)
    expect(isApiError(fromProxy) && fromProxy.status === 503 && !fromProxy.fromService).toBe(true)
    expect(isUnreachable(fromProxy)).toBe(true)
    expect(explainError(fromProxy)).toBe(UNREACHABLE_MESSAGE)
  })
})
