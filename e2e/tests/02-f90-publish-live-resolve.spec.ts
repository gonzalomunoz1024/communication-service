import { expect, test } from '@playwright/test'
import { BACKEND, RUN, TENANT, card, expectNotReloaded, headers, openFeed } from './helpers'

test('F-90 publish in the UI → live in another tab without reload → resolve in the UI → gone from the feed', async ({ page, context, request }) => {
  const title = `F-90 card payments failing ${RUN}`

  // a second tab already watching the tenant's feed: whatever it shows next came over the stream
  const watcher = await context.newPage()
  let watcherFeedLoads = 0
  watcher.on('request', (r) => {
    if (r.method() === 'GET' && /\/v1\/feed\?/.test(r.url())) watcherFeedLoads += 1
  })
  await openFeed(watcher, TENANT)
  await expect(card(watcher, title)).toHaveCount(0)
  const loadsBeforePublish = watcherFeedLoads

  // the publisher's tab: the tenant chosen in the header flows into the form
  await openFeed(page, TENANT)
  await page.getByRole('tab', { name: 'Publish' }).click()
  await expect(page.getByLabel(/^Tenant\*$/)).toHaveValue(TENANT)
  await page.getByLabel(/^Title\*$/).fill(title)
  await page.getByLabel('Details').fill('Card payments fail for about a third of requests; retries succeed.')
  await page.getByLabel('Affected services').fill('checkout-web, payments-api')
  await page.getByLabel(/^Publisher\*$/).fill('e2e-oncall')
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')),
    page.getByRole('button', { name: 'Publish outage' }).click(),
  ])
  expect(response.status(), await response.text()).toBe(201)
  expect(response.request().headers()['x-client-id']).toBe('communication-frontend')
  const created = (await response.json()) as { id: string }
  await expect(page.getByRole('heading', { name: 'Outage published' })).toBeVisible()

  // the watcher shows it through the stream: the page was not reloaded and the list was not fetched again
  await expect(card(watcher, title)).toBeVisible({ timeout: 10_000 })
  await expectNotReloaded(watcher)
  expect(watcherFeedLoads, 'GET /v1/feed requests of the watcher since it settled').toBe(loadsBeforePublish)
  await expect(card(watcher, title).getByText('checkout-web')).toBeVisible()
  await expect(card(watcher, title).getByText('e2e-oncall')).toBeVisible()
  await test.info().attach('f90-watcher-sees-the-card', { body: await watcher.screenshot(), contentType: 'image/png' })

  // the app's own way to the feed: the confirmation's "View in feed"
  await page.getByRole('button', { name: 'View in feed' }).click()
  await expect(page).toHaveURL(/#\/feed$/)
  await expect(card(page, title)).toBeVisible()

  // resolve it from the UI, with a note; the inline confirmation replaces the first button with the second
  const mine = card(page, title)
  await mine.getByRole('button', { name: 'Resolve' }).click()
  await mine.getByPlaceholder('Resolution note (optional)').fill('fixed by the e2e suite')
  const [retired] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/v1/communications/${created.id}/retire`)),
    mine.getByRole('button', { name: 'Resolve' }).click(),
  ])
  expect(retired.status(), await retired.text()).toBe(200)
  expect(retired.request().postDataJSON()).toMatchObject({ note: 'fixed by the e2e suite' })
  await expect(card(page, title)).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: `Resolved “${title}”` })).toBeVisible()
  // the watcher learns of it over the stream as well
  await expect(card(watcher, title)).toHaveCount(0, { timeout: 10_000 })
  await expectNotReloaded(watcher)

  // and consumers reading the API no longer get it
  const feed = await request.get(`${BACKEND}/v1/feed?tenantId=${TENANT}`, { headers })
  expect(feed.status()).toBe(200)
  const { items } = (await feed.json()) as { items: { id: string }[] }
  expect(items.map((i) => i.id)).not.toContain(created.id)
  const permalink = await request.get(`${BACKEND}/v1/feed/${created.id}`, { headers })
  expect(await permalink.json()).toMatchObject({ status: 'RETIRED' })
})
