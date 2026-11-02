import { expect, test, type APIRequestContext } from '@playwright/test'
import { BACKEND, RUN, headers, monitorOf, stack, until, type Monitor } from './helpers'

/** A tenant of its own, so its feed holds only this monitor's notices. */
const TENANT = 'e2e-pull'
const SERVICE = `fakeapp-pull-${RUN}`
/** The fake app's health endpoint as the backend reaches it on the compose network. */
const TARGET = 'http://e2e-app:8080/actuator/health'

/** A notice as the permalink GET /v1/feed/{id} shows it. */
interface Notice {
  id: string
  type: string
  severity: string
  title: string
  body: string
  status: string
  publisher: string
  affectedServices: string[]
  externalRef: string
}

async function noticeOf(request: APIRequestContext, id: string): Promise<Notice> {
  const res = await request.get(`${BACKEND}/v1/feed/${id}`, { headers })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as Notice
}

async function stateOf(request: APIRequestContext, id: string): Promise<Monitor['state']> {
  const res = await request.get(`${BACKEND}/v1/health/monitors/${id}`, { headers })
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as Monitor).state
}

const seconds = (since: number) => ((Date.now() - since) / 1000).toFixed(1)

test('F-31 F-37 F-39 F-40 F-41 a pull monitor probes the fake app every 5 s: DEGRADED twice → HEALTH notice, DOWN twice → OUTAGE in its place, UP twice → retired', async ({ request }) => {
  const registered = await request.post(`${BACKEND}/v1/health/monitors`, {
    headers,
    data: { tenantId: TENANT, service: SERVICE, url: TARGET, intervalSeconds: 5, failureThreshold: 2, recoveryThreshold: 2 },
  })
  expect(registered.status(), await registered.text()).toBe(201)
  const monitor = (await registered.json()) as Monitor
  expect(registered.headers()['location']).toBe(`/v1/health/monitors/${monitor.id}`)
  expect(monitor.url).toBe(TARGET)
  expect(monitor.policy).toMatchObject({ publisher: 'health-monitor', intervalSeconds: 5, failureThreshold: 2, recoveryThreshold: 2, downSeverity: 'MAJOR', degradedSeverity: 'MINOR' })
  const state = () => stateOf(request, monitor.id)

  try {
    // the scheduler probes it over the network: UP, nothing to publish
    await until('the first probe', state, (s) => s.lastStatus === 'UP')

    // DEGRADED: the app answers UP, but its db component is DOWN
    await stack('app-set', 'UP', 'DOWN')
    let flipped = Date.now()
    const degradedOnce = await until('the first DEGRADED probe', state, (s) => s.lastStatus === 'DEGRADED')
    expect(degradedOnce, 'one DEGRADED probe publishes nothing').toMatchObject({ unhealthyStreak: 1 })
    expect(degradedOnce.openCommunicationId).toBeUndefined()
    const degradedTwice = await until('a HEALTH notice', state, (s) => s.openCommunicationId !== undefined)
    console.log(`F-39: HEALTH notice ${seconds(flipped)} s after the app turned DEGRADED`)
    expect(degradedTwice).toMatchObject({ lastStatus: 'DEGRADED', unhealthyStreak: 2, openStatus: 'DEGRADED' })
    const health = await noticeOf(request, degradedTwice.openCommunicationId!)
    expect(health).toMatchObject({
      type: 'HEALTH',
      severity: 'MINOR',
      title: `${SERVICE} is degraded`,
      status: 'ACTIVE',
      publisher: 'health-monitor',
      affectedServices: [SERVICE],
      externalRef: `health:${monitor.id}:1`,
    })
    expect(health.body, 'the notice names the failing component').toContain('db')

    // DOWN: the streak starts again for the new kind of trouble; the HEALTH notice stands until it is confirmed
    await stack('app-set', 'DOWN', 'DOWN')
    flipped = Date.now()
    const downOnce = await until('the first DOWN probe', state, (s) => s.lastStatus === 'DOWN')
    expect(downOnce).toMatchObject({ unhealthyStreak: 1, openCommunicationId: health.id, openStatus: 'DEGRADED' })
    const downTwice = await until('the OUTAGE', state, (s) => s.openStatus === 'DOWN')
    console.log(`F-41: OUTAGE in place of the HEALTH notice ${seconds(flipped)} s after the app went DOWN`)
    expect(downTwice).toMatchObject({ lastStatus: 'DOWN', unhealthyStreak: 2 })
    const outage = await noticeOf(request, downTwice.openCommunicationId!)
    expect(outage).toMatchObject({ type: 'OUTAGE', severity: 'MAJOR', title: `${SERVICE} is down`, status: 'ACTIVE', externalRef: `health:${monitor.id}:2` })
    await expect.poll(async () => (await noticeOf(request, health.id)).status, { message: 'the HEALTH notice, reclassified' }).toBe('RETIRED')

    // UP: one healthy probe is not yet a recovery, the second retires the OUTAGE
    await stack('app-set', 'UP', 'UP')
    flipped = Date.now()
    const upOnce = await until('the first UP probe', state, (s) => s.lastStatus === 'UP')
    expect(upOnce).toMatchObject({ healthyStreak: 1, openCommunicationId: outage.id })
    const upTwice = await until('the recovery', state, (s) => s.openCommunicationId === undefined)
    console.log(`F-39: OUTAGE retired ${seconds(flipped)} s after the app came back`)
    expect(upTwice).toMatchObject({ lastStatus: 'UP', healthyStreak: 2 })
    await expect.poll(async () => (await noticeOf(request, outage.id)).status, { message: 'the OUTAGE, recovered' }).toBe('RETIRED')
  } finally {
    await stack('app-set', 'UP', 'UP')
    const deleted = await request.delete(`${BACKEND}/v1/health/monitors/${monitor.id}`, { headers })
    expect(deleted.status(), await deleted.text()).toBe(204)
  }
  // the sidecar watched the same app meanwhile (monitor e2e/fakeapp): its notices are gone too before the next test
  await expect.poll(async () => (await monitorOf(request, 'fakeapp')).state.openCommunicationId, { timeout: 30_000 }).toBeUndefined()
})
