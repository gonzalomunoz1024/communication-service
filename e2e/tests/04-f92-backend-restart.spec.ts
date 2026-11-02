import { expect, test, type Page } from '@playwright/test'
import { BACKEND, RUN, TENANT, card, expectNotReloaded, headers, openFeed, outage, publish, retire, stack, type Published } from './helpers'

/** The page's stream requests: EventSource opens /v1/feed/stream with the filter (and lastEventId when resuming). */
const STREAM = /\/v1\/feed\/stream\?/

/** One SSE message as the browser received it, and the stream request it came on. */
interface Frame {
  requestId: string
  url: string
  event: string
  seq: number
  communicationId?: string
}

/**
 * Every SSE message the page receives from now on. Playwright's own events stop at the request; the
 * DevTools protocol also reports each message with the request that carried it.
 */
async function recordFrames(page: Page): Promise<Frame[]> {
  const cdp = await page.context().newCDPSession(page)
  const urls = new Map<string, string>()
  const frames: Frame[] = []
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url))
  cdp.on('Network.eventSourceMessageReceived', (e) => {
    const data = JSON.parse(e.data) as { communication?: { id: string } }
    frames.push({ requestId: e.requestId, url: urls.get(e.requestId) ?? '', event: e.eventName, seq: Number(e.eventId), communicationId: data.communication?.id })
  })
  await cdp.send('Network.enable')
  return frames
}

/** One SSE frame as the test's own stream read it. */
interface Sse {
  event?: string
  data: string
}

/**
 * A stream of the test's own on a tenant's feed, read in Node. Its snapshot frames come after it has
 * subscribed to the backend's live fan-out, so from the first one on, its `created` frame for a notice
 * shows that the backend has fanned that notice out.
 */
async function ownStream(tenant: string) {
  const stop = new AbortController()
  const res = await fetch(`${BACKEND}/v1/feed/stream?tenantId=${tenant}`, { headers: { ...headers, Accept: 'text/event-stream' }, signal: stop.signal })
  expect(res.status, "the test's own stream").toBe(200)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const reading = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      text += decoder.decode(value, { stream: true })
    }
  })().catch(() => undefined) // close() aborts the read
  return {
    frames: (): Sse[] =>
      text.split(/\r?\n\r?\n/).map((block) => {
        const lines = block.split(/\r?\n/)
        const field = (name: string) => lines.filter((l) => l.startsWith(`${name}:`)).map((l) => l.slice(name.length + 1).replace(/^ /, ''))
        return { event: field('event')[0], data: field('data').join('\n') }
      }),
    close: async () => {
      stop.abort()
      await reading
    },
  }
}

test('F-92 F-61 F-20 the backend restarts mid-stream → Reconnecting → the page resumes by itself with lastEventId and is replayed what was published meanwhile', async ({ page, request }) => {
  await openFeed(page, TENANT)
  const frames = await recordFrames(page)
  // the page's list loads (test 02's count): after a reconnect the page reloads the list once by design
  let feedLoads = 0
  page.on('request', (r) => {
    if (r.method() === 'GET' && /\/v1\/feed\?/.test(r.url())) feedLoads += 1
  })

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
  const lastEventId = new URL(resumed.url()).searchParams.get('lastEventId')
  console.log(`F-92: a reopen carried lastEventId=${lastEventId}`)

  // The backend is still down (that reopen met the proxy). The page's next reopen is held here until the
  // notice below is stored and fanned out, so the page cannot be connected when it is published: the
  // notice can only reach the page as a replay of what it missed, or through the list reload that follows
  // a reconnect.
  let letIn = () => {}
  const lettingIn = new Promise<void>((resolve) => {
    letIn = resolve
  })
  let held = ''
  await page.route(
    STREAM,
    async (route) => {
      held = route.request().url()
      await lettingIn
      await route.continue()
    },
    { times: 1 },
  )

  // the restart itself succeeded: stack.sh saw the readiness probe UP again (its error otherwise)
  expect(await restart, 'stack.sh restart-backend').toBeNull()
  const backAt = Date.now()
  console.log(`F-92: the backend was ready again ${((backAt - dropped) / 1000).toFixed(1)} s after the restart began`)

  // The test's own stream, subscribed to the live fan-out before the publish, shows when the backend has
  // fanned the notice out. A stream that resumes after that gets the notice only from the event log: a
  // resume drops the live events up to the fan-out position it starts at, so had the page resumed before
  // the fan-out, the notice would have reached it live, replay or not.
  const own = await ownStream(TENANT)
  const published: Published[] = [before]
  try {
    await expect.poll(() => own.frames().some((f) => f.event === 'snapshot'), { message: "the test's own stream has its snapshot" }).toBe(true)
    // the backend is back: another system publishes while the page is still away
    const after = await publish(request, outage(`F-92 published while the page was away ${RUN}`))
    published.push(after)
    await expect.poll(() => own.frames().some((f) => f.event === 'created' && f.data.includes(after.id)), { message: 'the backend fanned the notice out' }).toBe(true)
    await own.close()
    const loadsBeforeResume = feedLoads
    letIn()
    await expect(card(page, after.title)).toBeVisible({ timeout: 30_000 })
    console.log(`F-92: the page showed it ${((Date.now() - backAt) / 1000).toFixed(1)} s after the backend was back`)
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await expectNotReloaded(page)
    await expect(card(page, before.title)).toBeVisible()
    await test.info().attach('f92-healed', { body: await page.screenshot(), contentType: 'image/png' })

    // Replay, not reload. The card alone cannot tell them apart: the page reloads the list once after
    // every reconnect, and that GET would show the notice even if the stream had replayed nothing. What
    // tells them apart is the frame: the notice must come as one `created` frame on the stream the page
    // resumed with ?lastEventId=, numbered after it, on a stream that sent no snapshot (a resume, not a
    // fresh start); and the page fetched the list at most that once. The list reload can show the card
    // before the replay arrives, so the frame is waited for (expect's 10 s).
    const carriedBy = () => frames.filter((f) => f.communicationId === after.id)
    await expect.poll(() => carriedBy().map((f) => f.event), { message: `SSE frames that carried "${after.title}"` }).toEqual(['created'])
    const [replayed] = carriedBy()
    expect(held, 'the reopen that waited for the fan-out').toContain(`lastEventId=${lastEventId}`)
    expect(replayed.url, 'the stream request it came on').toContain(`lastEventId=${lastEventId}`)
    expect(replayed.seq).toBeGreaterThan(Number(lastEventId))
    expect(frames.filter((f) => f.requestId === replayed.requestId && f.event === 'snapshot'), 'snapshot frames on the resumed stream').toEqual([])
    expect(feedLoads - loadsBeforeResume, 'GET /v1/feed since the page could reconnect').toBeLessThanOrEqual(1)
    console.log(`F-92: replayed as created#${replayed.seq} on the stream resumed after ${lastEventId}; ${feedLoads - loadsBeforeResume} list reload`)
  } finally {
    await own.close()
    for (const notice of published) await retire(request, notice.id, 'e2e cleanup')
  }
})
