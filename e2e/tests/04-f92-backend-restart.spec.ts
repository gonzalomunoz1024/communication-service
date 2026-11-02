import { expect, test } from '@playwright/test'
import { RUN, TENANT, card, expectNotReloaded, openFeed, outage, publish, retire, stack } from './helpers'

test('F-92 the backend restarts mid-stream → Reconnecting → the page resumes by itself with lastEventId and shows what was published meanwhile', async ({ page, request }) => {
  await openFeed(page, TENANT)
  // a notice that arrives live gives the page a last event id to resume from
  const before = await publish(request, outage(`F-92 published before the restart ${RUN}`))
  await expect(card(page, before.title)).toBeVisible({ timeout: 10_000 })

  // listen for the resume before anything drops; the restart runs while the assertions below watch the page
  const resume = page.waitForRequest(/\/v1\/feed\/stream\?.*lastEventId=\d+/, { timeout: 90_000 })
  const dropped = Date.now()
  const restart = stack('restart-backend').then(
    () => null,
    (e: Error) => e,
  )
  await expect(page.getByText(/^Reconnecting/)).toBeVisible({ timeout: 30_000 })
  console.log(`F-92: the badge showed Reconnecting ${((Date.now() - dropped) / 1000).toFixed(1)} s into the restart`)
  const resumed = await resume
  console.log(`F-92: a reopen carried lastEventId=${new URL(resumed.url()).searchParams.get('lastEventId')}`)
  const restartError = await restart
  if (restartError) throw restartError
  const backAt = Date.now()
  console.log(`F-92: the backend was ready again ${((backAt - dropped) / 1000).toFixed(1)} s after the restart began`)

  // the backend is back: another system publishes while the page is still on its own reopen schedule
  const after = await publish(request, outage(`F-92 published after the restart ${RUN}`))
  try {
    await expect(card(page, after.title)).toBeVisible({ timeout: 90_000 })
    console.log(`F-92: the page showed it ${((Date.now() - backAt) / 1000).toFixed(1)} s after the backend was back`)
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await expectNotReloaded(page)
    await expect(card(page, before.title)).toBeVisible()
    await test.info().attach('f92-healed', { body: await page.screenshot(), contentType: 'image/png' })
  } finally {
    await retire(request, before.id, 'e2e cleanup')
    await retire(request, after.id, 'e2e cleanup')
  }
})
