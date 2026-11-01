import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, DEFAULT_CLIENT_ID, createCommunicationClient, feedQuery } from '../outages/api'

describe('feedQuery', () => {
  it('drops empty filters', () => {
    expect(feedQuery({ tenantId: 'acme', service: '', type: undefined, severity: 'MAJOR' }, { page: 0, size: 50 })).toBe('tenantId=acme&severity=MAJOR&page=0&size=50')
  })
})

describe('createCommunicationClient', () => {
  it('posts JSON, says who is calling and returns the body', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('http://svc/v1/communications')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('X-Client-Id')).toBe(DEFAULT_CLIENT_ID)
      expect(JSON.parse(String(init?.body))).toMatchObject({ tenantId: 'acme' })
      return new Response(JSON.stringify({ id: 'c1' }), { status: 201 })
    })
    const client = createCommunicationClient('http://svc/', { fetchImpl: fetchImpl as unknown as typeof fetch })
    const saved = await client.publish({ tenantId: 'acme', publisher: 'p', type: 'OUTAGE', severity: 'MAJOR', title: 't' })
    expect(saved.id).toBe('c1')
  })

  it('sends a custom client id on every call', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('X-Client-Id')).toBe('checkout-web')
      return new Response(JSON.stringify({ items: [], page: 0, size: 100, totalElements: 0, hasNext: false }), { status: 200 })
    })
    const client = createCommunicationClient('', { clientId: 'checkout-web', fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.feed({ tenantId: 'acme' })
    await client.retire('c1', 'web-oncall', 'fixed')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('surfaces the service error text', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'OUTAGE requires severity MINOR or higher' }), { status: 400 }))
    const client = createCommunicationClient('', { fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.feed({ tenantId: 'acme' })).rejects.toMatchObject({ status: 400, message: 'OUTAGE requires severity MINOR or higher' })
    await expect(client.feed({ tenantId: 'acme' })).rejects.toBeInstanceOf(ApiError)
  })

  describe('stream', () => {
    const opened: string[] = []
    class FakeEventSource {
      constructor(url: string) {
        opened.push(url)
      }
      addEventListener() {}
      close() {}
    }
    afterEach(() => {
      vi.unstubAllGlobals()
      opened.length = 0
    })

    it('identifies itself in the query because EventSource cannot set headers', () => {
      vi.stubGlobal('EventSource', FakeEventSource)
      const client = createCommunicationClient('http://svc', { clientId: 'checkout-web' })
      const stop = client.stream({ tenantId: 'acme', service: 'payments-api' }, { onEvent: () => {} })
      expect(opened).toEqual(['http://svc/v1/feed/stream?tenantId=acme&service=payments-api&clientId=checkout-web'])
      stop()
    })
  })
})
