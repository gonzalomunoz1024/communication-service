import { expect, test, type Page } from '@playwright/test'
import { BACKEND, RUN, TENANT, card, expectNotReloaded, headers, markDocument, openFeed, outage, publish, retire, stack, type Published } from './helpers'

const seconds = (since: number) => ((Date.now() - since) / 1000).toFixed(1)

/** The page's stream requests (EventSource opens /v1/feed/stream with the filter) and its list loads. */
const STREAM = /\/v1\/feed\/stream\?/
const LIST = /\/v1\/feed\?/

/** What a feed page showed from one moment on: the connection badge's text and the error state's reason, if any. */
interface View {
  at: number
  badge: string | null
  error: 'database unavailable' | 'another reason' | null
}

/**
 * Records every change of what the page shows, from its first document on: after each DOM change a
 * MutationObserver reads the badge next to the Live-updates switch and whether "Couldn't load the feed"
 * is on screen with the database reason, so a state that lasted only a moment is in the record too.
 * The record stays in the page (viewsOf reads it).
 */
async function recordViews(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const views: View[] = []
    ;(window as unknown as { __e2eViews: View[] }).__e2eViews = views
    let last = ''
    new MutationObserver(() => {
      const badge = document.querySelector('[role="switch"][aria-label="Live updates"]')?.parentElement?.querySelector('[role="status"]')?.textContent?.trim() ?? null
      const text = document.body?.textContent ?? ''
      const error = !text.includes("Couldn't load the feed") ? null : text.includes('database unavailable') ? 'database unavailable' : 'another reason'
      const key = `${badge}|${error}`
      if (key === last) return
      last = key
      views.push({ at: Date.now(), badge, error })
    }).observe(document, { subtree: true, childList: true, characterData: true })
  })
}

async function viewsOf(page: Page): Promise<View[]> {
  return page.evaluate(() => (window as unknown as { __e2eViews?: View[] }).__e2eViews ?? [])
}

/** A record as one line, each state timed from `from`. */
function timeline(views: View[], from: number): string {
  return views.map((v) => `+${((v.at - from) / 1000).toFixed(1)} s ${v.badge ?? '(no badge)'}${v.error ? ` | Couldn't load the feed (${v.error})` : ''}`).join(', ')
}

test('F-92 F-57 the database goes away → 503 "database unavailable" → a page opened meanwhile says why, offers Try again and never says Live, the open page keeps its stream → the database is back → both recover by themselves', async ({ page, context, request }) => {
  const published: Published[] = []
  // the page that is open when the database goes away; from here on it should neither reopen its stream nor reload
  await openFeed(page, TENANT)
  let streamOpens = 0
  let feedLoads = 0
  page.on('request', (r) => {
    if (STREAM.test(r.url())) streamOpens += 1
    if (r.method() === 'GET' && LIST.test(r.url())) feedLoads += 1
  })
  const before = await publish(request, outage(`F-92 published before the database went away ${RUN}`))
  published.push(before)
  await expect(card(page, before.title)).toBeVisible({ timeout: 10_000 })

  await stack('stop-mongo')
  const stoppedAt = Date.now()
  try {
    // the service is up and says why it cannot answer, within its 5 s database timeout
    const asked = Date.now()
    const res = await request.get(`${BACKEND}/v1/feed?tenantId=${TENANT}`, { headers })
    const answeredIn = Date.now() - asked
    console.log(`F-92: GET /v1/feed answered ${res.status()} in ${(answeredIn / 1000).toFixed(1)} s with the database stopped`)
    expect(res.status()).toBe(503)
    expect(await res.json()).toEqual({ error: 'database unavailable' })
    expect(answeredIn, 'the 503 arrives within the database timeout').toBeLessThan(8_000)

    // someone opens the feed meanwhile: the error state gives the service's reason and a way to retry
    const late = await context.newPage()
    await recordViews(late)
    let lateStreams = 0
    let lateLoads = 0
    late.on('request', (r) => {
      if (STREAM.test(r.url())) lateStreams += 1
      if (r.method() === 'GET' && LIST.test(r.url())) lateLoads += 1
    })
    const lateOpened = Date.now()
    await late.goto('/#/feed')
    await markDocument(late)
    await late.getByRole('textbox', { name: 'Tenant', exact: true }).fill(TENANT)
    await expect(late.getByText("Couldn't load the feed")).toBeVisible({ timeout: 20_000 })
    await expect(late.getByText(/database unavailable/)).toBeVisible()
    await expect(late.getByRole('button', { name: 'Try again' })).toBeVisible()
    console.log(`F-57: the late page showed the error state ${seconds(stoppedAt)} s into the outage`)
    await test.info().attach('f92-database-down', { body: await late.screenshot(), contentType: 'image/png' })

    // the page that was open keeps its cards and its stream: nothing reopened, nothing reloaded
    await expect(card(page, before.title)).toBeVisible()
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    expect(streamOpens, 'stream requests of the open page during the outage').toBe(0)
    expect(feedLoads, 'GET /v1/feed of the open page during the outage').toBe(0)

    // The database stays away until the late page has tried its stream three times (its first request and
    // two retries). Nothing it opens meanwhile can deliver the feed, so all along it keeps the database
    // message and its badge never says Live; the record holds every change, however short.
    await expect.poll(() => lateStreams, { message: "the late page's stream requests during the outage", timeout: 45_000 }).toBeGreaterThanOrEqual(3)
    const duringOutage = await viewsOf(late)
    const outageTimeline = timeline(duringOutage, lateOpened)
    console.log(`F-92: the late page while the database was down (${lateStreams} stream requests, ${lateLoads} list loads): ${outageTimeline}`)
    expect.soft(duringOutage.filter((v) => v.badge?.startsWith('Live')), `the late page's badge said Live before the database was back: ${outageTimeline}`).toEqual([])
    const failed = duringOutage.findIndex((v) => v.error !== null)
    expect.soft(duringOutage.slice(failed).filter((v) => v.error !== 'database unavailable'), `the late page lost the database message before the database was back: ${outageTimeline}`).toEqual([])

    // the database comes back; nobody restarts the service or clicks anything
    await stack('start-mongo')
    const backAt = Date.now()
    console.log(`F-92: the backend was ready again ${seconds(stoppedAt)} s after the database stopped`)
    // the late page recovers on its own, in the same document: the error state gives way to the list, and it is live
    await expect(card(late, before.title)).toBeVisible({ timeout: 30_000 })
    await expect(late.getByText("Couldn't load the feed")).toHaveCount(0)
    await expect(late.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expectNotReloaded(late)
    console.log(`F-92: the late page showed the feed ${seconds(backAt)} s after the backend was ready, then: ${timeline((await viewsOf(late)).slice(duringOutage.length), lateOpened)}`)
    // and the open page's stream, open all along, carries what is published next
    const after = await publish(request, outage(`F-92 published after the database came back ${RUN}`))
    published.push(after)
    await expect(card(page, after.title)).toBeVisible({ timeout: 10_000 })
    console.log(`F-92: the open page showed a new notice ${seconds(backAt)} s after the backend was ready`)
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await expectNotReloaded(page)
    expect(streamOpens, 'stream requests of the open page since the database stopped').toBe(0)
    expect(feedLoads, 'GET /v1/feed of the open page since the database stopped').toBe(0)
  } finally {
    // quick when the database runs already; brings it back when the test stopped half-way
    await stack('start-mongo')
    for (const notice of published) await retire(request, notice.id, 'e2e cleanup')
  }
})
