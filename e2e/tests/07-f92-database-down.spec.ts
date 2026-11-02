import { expect, test } from '@playwright/test'
import { BACKEND, RUN, TENANT, card, expectNotReloaded, headers, openFeed, outage, publish, retire, stack, type Published } from './helpers'

const seconds = (since: number) => ((Date.now() - since) / 1000).toFixed(1)

test('F-92 F-57 the database goes away → 503 "database unavailable" → a page opened meanwhile says why and offers Try again, the open page keeps its stream → the database is back → both recover by themselves', async ({ page, context, request }) => {
  const published: Published[] = []
  // the page that is open when the database goes away; from here on it should neither reopen its stream nor reload
  await openFeed(page, TENANT)
  let streamOpens = 0
  let feedLoads = 0
  page.on('request', (r) => {
    if (/\/v1\/feed\/stream\?/.test(r.url())) streamOpens += 1
    if (r.method() === 'GET' && /\/v1\/feed\?/.test(r.url())) feedLoads += 1
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
    await late.goto('/#/feed')
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

    // the database comes back; nobody restarts the service or clicks anything
    await stack('start-mongo')
    const backAt = Date.now()
    console.log(`F-92: the backend was ready again ${seconds(stoppedAt)} s after the database stopped`)
    // the late page recovers on its own: the error state gives way to the list
    await expect(card(late, before.title)).toBeVisible({ timeout: 30_000 })
    await expect(late.getByText("Couldn't load the feed")).toHaveCount(0)
    console.log(`F-92: the late page showed the feed ${seconds(backAt)} s after the backend was ready`)
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
