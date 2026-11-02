import { expect, test } from '@playwright/test'
import { BACKEND, TENANT, card, expectNotReloaded, headers, openFeed, stack } from './helpers'

const SERVICE = 'fakeapp'
const TITLE = `${SERVICE} is down`

interface Monitor {
  id: string
  service: string
  url?: string
  policy: { publisher: string; failureThreshold: number; recoveryThreshold: number }
  state: { lastStatus: string; openCommunicationId?: string }
}

interface Instance {
  instanceId: string
  status: string
  left: boolean
}

test('F-91 the app goes DOWN → the sidecar reports it → an OUTAGE card from health-sidecar → the app recovers → the card leaves', async ({ page, request }) => {
  await openFeed(page, TENANT)
  await expect(card(page, TITLE)).toHaveCount(0)

  // the backend already knows the pod: stack.sh up waited for its first UP
  const monitors = (await (await request.get(`${BACKEND}/v1/health/monitors?tenantId=${TENANT}`, { headers })).json()) as Monitor[]
  const monitor = monitors.find((m) => m.service === SERVICE)
  expect(monitor, `monitor for ${TENANT}/${SERVICE}`).toBeDefined()
  expect(monitor!.url, 'push-only: registered by the sidecar, not probed').toBeUndefined()
  expect(monitor!.policy).toMatchObject({ publisher: 'health-sidecar', failureThreshold: 2, recoveryThreshold: 2 })
  expect(monitor!.state.lastStatus).toBe('UP')

  await stack('app-set', 'DOWN', 'DOWN')
  const flipped = Date.now()
  try {
    // the tuned debounce: a probe within 2 s and a second look 0.5 s later send the first DOWN report, the next probe the second
    const notice = card(page, TITLE)
    await expect(notice).toBeVisible({ timeout: 15_000 })
    console.log(`F-91: the OUTAGE card appeared ${((Date.now() - flipped) / 1000).toFixed(1)} s after the app went DOWN`)
    await expectNotReloaded(page)
    await expect(notice.getByText('Outage', { exact: true })).toBeVisible()
    await expect(notice.getByText(SERVICE, { exact: true })).toBeVisible()
    await expect(notice.getByText('health-sidecar')).toBeVisible()
    await expect(notice.getByText('Major', { exact: true })).toBeVisible()
    // the rollup names the pod that is down
    await expect(notice).toContainText('fakeapp-0')
    await test.info().attach('f91-outage-card', { body: await page.screenshot(), contentType: 'image/png' })

    const down = (await (await request.get(`${BACKEND}/v1/health/monitors/${monitor!.id}/instances`, { headers })).json()) as Instance[]
    expect(down).toContainEqual(expect.objectContaining({ instanceId: 'fakeapp-0', status: 'DOWN', left: false }))
  } finally {
    await stack('app-set', 'UP', 'UP')
  }
  const recovered = Date.now()
  // the UI's rule: a retired notice leaves the feed when its `retired` frame arrives
  await expect(card(page, TITLE)).toHaveCount(0, { timeout: 15_000 })
  console.log(`F-91: the card left ${((Date.now() - recovered) / 1000).toFixed(1)} s after the app came back`)
  await expectNotReloaded(page)

  const after = (await (await request.get(`${BACKEND}/v1/health/monitors?tenantId=${TENANT}`, { headers })).json()) as Monitor[]
  const settled = after.find((m) => m.service === SERVICE)!
  expect(settled.state.lastStatus).toBe('UP')
  expect(settled.state.openCommunicationId).toBeUndefined()
  const instances = await request.get(`${BACKEND}/v1/health/monitors/${settled.id}/instances`, { headers })
  expect(instances.status()).toBe(200)
  const pods = (await instances.json()) as Instance[]
  expect(pods.length).toBeGreaterThanOrEqual(1)
  expect(pods).toContainEqual(expect.objectContaining({ instanceId: 'fakeapp-0', status: 'UP', left: false }))
})
