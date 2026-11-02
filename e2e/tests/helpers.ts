import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

/** The stack's addresses (docker-compose.yml, stack.sh) and how the suite identifies itself to the API. */
export const BACKEND = 'http://127.0.0.1:28080'
export const CLIENT_ID = 'e2e-suite'
export const TENANT = 'e2e'
/** Suffix for everything a run publishes, so a stack that was kept between runs still gets unique titles. */
export const RUN = Date.now().toString(36)

export const headers = { 'X-Client-Id': CLIENT_ID }

const E2E_DIR = path.resolve(__dirname, '..')
const execFileAsync = promisify(execFile)

/** Runs ./stack.sh with the given arguments and returns its output. */
export async function stack(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(path.join(E2E_DIR, 'stack.sh'), args, { cwd: E2E_DIR, timeout: 180_000 })
  return stdout
}

/** A publisher's notice as POST /v1/communications takes it: an active MAJOR outage unless overridden. */
export function outage(title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { tenantId: TENANT, publisher: CLIENT_ID, type: 'OUTAGE', severity: 'MAJOR', title, affectedServices: ['checkout-web'], ...extra }
}

export interface Published {
  id: string
  title: string
  version: number
}

/** Publishes over HTTP as another system would and returns the created notice. */
export async function publish(request: APIRequestContext, body: Record<string, unknown>): Promise<Published> {
  const res = await request.post(`${BACKEND}/v1/communications`, { headers, data: body })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as Published
}

/** Retires a notice; one that is already retired answers 200 (idempotent) or 409 (past its expiry), both fine for cleanup. */
export async function retire(request: APIRequestContext, id: string, note: string): Promise<void> {
  const res = await request.post(`${BACKEND}/v1/communications/${id}/retire`, { headers, data: { actor: CLIENT_ID, note } })
  expect([200, 409], await res.text()).toContain(res.status())
}

/** Opens the feed tab for a tenant (chosen in the header, as a person does) and waits until the stream is live. */
export async function openFeed(page: Page, tenant = TENANT): Promise<void> {
  await page.goto('/#/feed')
  await page.getByRole('textbox', { name: 'Tenant', exact: true }).fill(tenant)
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 })
  await markDocument(page)
}

/** Marks the page's current document for expectNotReloaded. */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate((run) => {
    ;(window as unknown as { __e2eRun?: string }).__e2eRun = run
  }, RUN)
}

/** The page is the same document openFeed (or markDocument) left: a reload (or navigation) would have lost the marker. */
export async function expectNotReloaded(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { __e2eRun?: string }).__e2eRun)).toBe(RUN)
}

/** The feed card whose text contains the title. */
export function card(page: Page, title: string) {
  return page.locator('article', { hasText: title })
}

/** A health monitor as GET /v1/health/monitors returns it (the fields the suite reads; absent ones are null). */
export interface Monitor {
  id: string
  tenantId: string
  service: string
  url?: string
  policy: {
    publisher: string
    intervalSeconds: number
    failureThreshold: number
    recoveryThreshold: number
    downSeverity: string
    degradedSeverity: string
  }
  state: {
    lastStatus: string
    unhealthyStreak: number
    healthyStreak: number
    openCommunicationId?: string
    openStatus?: string
  }
}

/** One pod's record under a monitor (GET /v1/health/monitors/{id}/instances). */
export interface Instance {
  instanceId: string
  status: string
  left: boolean
  message?: string
}

/** A tenant's monitor for a service, read now. */
export async function monitorOf(request: APIRequestContext, service: string, tenant = TENANT): Promise<Monitor> {
  const res = await request.get(`${BACKEND}/v1/health/monitors?tenantId=${tenant}`, { headers })
  expect(res.status(), await res.text()).toBe(200)
  const monitor = ((await res.json()) as Monitor[]).find((m) => m.service === service)
  expect(monitor, `monitor ${tenant}/${service}`).toBeDefined()
  return monitor!
}

/** One pod's record under a monitor, read now; undefined until the pod has reported. */
export async function podOf(request: APIRequestContext, monitorId: string, instanceId: string): Promise<Instance | undefined> {
  const res = await request.get(`${BACKEND}/v1/health/monitors/${monitorId}/instances`, { headers })
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as Instance[]).find((i) => i.instanceId === instanceId)
}

/**
 * Reads every 250 ms until `done` holds and returns that reading, so a test can assert on the very
 * state that met the condition (expect.poll only says that one did); fails after `timeoutMs`.
 */
export async function until<T>(what: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await read()
    if (done(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`gave up after ${timeoutMs / 1000} s waiting until ${what}; last reading: ${JSON.stringify(last)}`)
}
