import { expect, test } from '@playwright/test'
import { BACKEND, RUN, headers, outage, retire } from './helpers'

// The HTTP contract other systems rely on, checked against the containerised backend before the browser flows.
test.describe('API contract smoke', () => {
  test('F-27 a /v1 call without X-Client-Id is refused with an {error} body', async ({ request }) => {
    const res = await request.post(`${BACKEND}/v1/communications`, { data: outage(`unidentified ${RUN}`) })
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })

  test('F-09 a reused externalRef is a 409 with an {error} body', async ({ request }) => {
    const body = outage(`F-09 reference ${RUN}`, { externalRef: `e2e-ref-${RUN}` })
    const first = await request.post(`${BACKEND}/v1/communications`, { headers, data: body })
    expect(first.status(), await first.text()).toBe(201)
    const { id } = (await first.json()) as { id: string }
    try {
      const again = await request.post(`${BACKEND}/v1/communications`, { headers, data: body })
      expect(again.status()).toBe(409)
      // the wording is the service's to choose; the shape is the contract
      expect(await again.json()).toEqual({ error: expect.any(String) })
    } finally {
      await retire(request, id, 'e2e cleanup')
    }
  })

  test('F-92 the readiness probe answers 200 without a client id', async ({ request }) => {
    const res = await request.get(`${BACKEND}/actuator/health/readiness`)
    expect(res.status()).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'UP' })
  })
})
