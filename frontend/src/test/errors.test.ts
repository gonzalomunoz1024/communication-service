import { describe, expect, it } from 'vitest'
import { ApiError, createCommunicationClient, isApiError } from '../outages/api'
import { UNREACHABLE_MESSAGE, explainError, explainPublishError, isUnreachable } from '../outages/errors'

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
  it("shows the service's own explanation of a duplicate reference when it sends one", () => {
    const explained =
      "externalRef 'INC0012345' is already used in tenant 'acme' by communication c42 (RETIRED); the key is permanent, so a follow-up needs another externalRef"
    expect(explainPublishError(new ApiError(409, explained))).toBe(explained)
  })
  it('leaves every other error to explainError', () => {
    expect(explainPublishError(new ApiError(409, 'communication c1 was modified concurrently; reload and retry'))).toBe('communication c1 was modified concurrently; reload and retry')
    expect(explainPublishError(new ApiError(503, '503 Service Unavailable'))).toBe(UNREACHABLE_MESSAGE)
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
})
