import { describe, expect, it } from 'vitest'
import { emptyDraft, localToIso, parseServices, toRequest, validate } from '../outages/validation'

const base = { ...emptyDraft('acme', 'oncall'), title: 'Payments down' }

describe('validate', () => {
  it('accepts a minimal outage', () => {
    expect(validate(base)).toEqual({})
  })
  it('requires tenant, publisher and title', () => {
    const e = validate(emptyDraft())
    expect(e.tenantId).toBeDefined()
    expect(e.publisher).toBeDefined()
    expect(e.title).toBeDefined()
  })
  it('enforces the severity floor for outages and incidents only', () => {
    expect(validate({ ...base, severity: 'INFO' }).severity).toMatch(/MINOR/)
    expect(validate({ ...base, type: 'INCIDENT', severity: 'INFO' }).severity).toMatch(/MINOR/)
    expect(validate({ ...base, type: 'CHANGE', severity: 'INFO' })).toEqual({})
  })
  it('requires an end for maintenance and orders the times', () => {
    expect(validate({ ...base, type: 'MAINTENANCE' }).endsAt).toBeDefined()
    expect(validate({ ...base, startsAt: '2026-11-02T10:00', endsAt: '2026-11-02T09:00' }).endsAt).toBeDefined()
    expect(validate({ ...base, startsAt: '2026-11-02T10:00', expiresAt: '2026-11-02T10:00' }).expiresAt).toBeDefined()
    expect(validate({ ...base, startsAt: '2026-11-02T10:00', endsAt: '2026-11-02T11:00' })).toEqual({})
  })
  it('caps the title at 200 characters and the service list at 20', () => {
    expect(validate({ ...base, title: 'x'.repeat(201) }).title).toBeDefined()
    expect(validate({ ...base, services: Array.from({ length: 21 }, (_, i) => `s${i}`).join(',') }).services).toBeDefined()
  })
})

describe('parseServices', () => {
  it('splits on commas and newlines, trims, dedupes', () => {
    expect(parseServices(' payments-api, checkout\ncheckout ,, ')).toEqual(['payments-api', 'checkout'])
  })
})

describe('toRequest', () => {
  it('leaves optional fields out and sends instants', () => {
    const r = toRequest({ ...base, services: 'a, b', startsAt: '2026-11-02T10:00' })
    expect(r).toMatchObject({ tenantId: 'acme', publisher: 'oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'Payments down', affectedServices: ['a', 'b'] })
    expect(r.body).toBeUndefined()
    expect(r.draft).toBeUndefined()
    expect(r.endsAt).toBeUndefined()
    expect(r.startsAt).toBe(localToIso('2026-11-02T10:00'))
    expect(r.startsAt).toMatch(/Z$/)
  })
  it('sends draft only when set', () => {
    expect(toRequest({ ...base, draft: true }).draft).toBe(true)
  })
})
