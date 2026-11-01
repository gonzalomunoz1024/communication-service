import { describe, expect, it, vi } from 'vitest'
import { ApiError, createCommunicationClient, feedQuery } from '../outages/api'

describe('feedQuery', () => {
  it('drops empty filters', () => {
    expect(feedQuery({ tenantId: 'acme', service: '', type: undefined, severity: 'MAJOR' }, { page: 0, size: 50 })).toBe('tenantId=acme&severity=MAJOR&page=0&size=50')
  })
})

describe('createCommunicationClient', () => {
  it('posts JSON and returns the body', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('http://svc/v1/communications')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toMatchObject({ tenantId: 'acme' })
      return new Response(JSON.stringify({ id: 'c1' }), { status: 201 })
    })
    const client = createCommunicationClient('http://svc/', fetchImpl as unknown as typeof fetch)
    const saved = await client.publish({ tenantId: 'acme', publisher: 'p', type: 'OUTAGE', severity: 'MAJOR', title: 't' })
    expect(saved.id).toBe('c1')
  })
  it('surfaces the service error text', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'OUTAGE requires severity MINOR or higher' }), { status: 400 }))
    const client = createCommunicationClient('', fetchImpl as unknown as typeof fetch)
    await expect(client.feed({ tenantId: 'acme' })).rejects.toMatchObject({ status: 400, message: 'OUTAGE requires severity MINOR or higher' })
    await expect(client.feed({ tenantId: 'acme' })).rejects.toBeInstanceOf(ApiError)
  })
})
