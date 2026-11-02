// F-18 follow-up to v3: one stream subscription only (tenant set once, default Type=Outage, no filter change) → exactly one
// `snapshot` frame per visible item, numeric id, lower-cased names; then the duplicate-delivery observation from the curl capture
// (snapshot#N followed by created#N for a notice published just before the open) and that the UI shows the card once.
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant, UI } = L
L.setFile('v3b-snapshot-per-open')
const RUN = Date.now().toString(36)
;(async () => {
  const browser = await L.launch()
  try {
    const tenant = `vf2-snap-${RUN}`
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'snap one' }))
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'snap two', severity: 'CRITICAL' }))
    await L.wait(1500) // let the fan-out cursor pass both created events
    const { context, page } = await newPage(browser)
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable')
    const frames = []
    cdp.on('Network.eventSourceMessageReceived', (e) => { let title = ''; try { title = JSON.parse(e.data).communication.title } catch {} frames.push({ name: e.eventName, id: e.eventId, title }) })
    await page.goto(UI + '/#/feed')
    await setTenant(page, tenant)
    await page.waitForSelector('article h3:has-text("snap two")')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    await L.wait(1500)
    const streamOpens = page.cap.requests.filter((r) => r.url.includes('/v1/feed/stream')).length
    const snaps = frames.filter((f) => f.name === 'snapshot')
    record('F-18', 'one subscription (tenant set once, default filter): exactly one lower-cased `snapshot` frame per visible item, numeric ids, no live frame for items already in the log', streamOpens === 1 && snaps.length === 2 && new Set(snaps.map((s) => s.title)).size === 2 && snaps.every((s) => /^\d+$/.test(s.id)) && frames.length === 2, { streamOpens, frames })
    // a notice published right before a (re)open: the snapshot carries it and the live tail may deliver its `created` once more
    const t = Date.now()
    const third = await api('POST', '/v1/communications', publishBody(tenant, { title: 'snap three' }))
    await page.waitForSelector('article h3:has-text("snap three")', { timeout: 10000 })
    const third2 = frames.filter((f) => f.title === 'snap three')
    const cardsThree = await page.locator('article h3', { hasText: 'snap three' }).count()
    record('F-18', 'a notice published while the stream is open arrives exactly once as `created`; the UI shows one card', third.status === 201 && third2.length === 1 && third2[0].name === 'created' && cardsThree === 1, { frames: third2, cardsThree, ms: Date.now() - t })
    // reopen right after a publish: the snapshot (stamped with the log head, G-2-8) may be followed by the same seq as a live `created`
    await page.getByRole('switch', { name: 'Live updates' }).click()
    await page.waitForSelector('text=/^Paused$/')
    const fourth = await api('POST', '/v1/communications', publishBody(tenant, { title: 'snap four' }))
    const n0 = frames.length
    await page.getByRole('switch', { name: 'Live updates' }).click()
    await page.waitForSelector('article h3:has-text("snap four")', { timeout: 10000 })
    await L.wait(2500)
    const after = frames.slice(n0)
    const four = after.filter((f) => f.title === 'snap four')
    const snapFour = four.find((f) => f.name === 'snapshot'); const createdFour = four.find((f) => f.name === 'created')
    const cardsFour = await page.locator('article h3', { hasText: 'snap four' }).count()
    const ids = after.filter((f) => f.name === 'snapshot').map((f) => f.id)
    record('F-18', 'observation (G-2-8): a stream opened right after a publish gets snapshot frames stamped with the log head (= the seq of that publish); the live tail may then deliver the same `created` seq once more (at-least-once, documented); the UI dedupes by id and shows one card', fourth.status === 201 && !!snapFour && cardsFour === 1 && new Set(ids).size === 1 && (!createdFour || createdFour.id === snapFour.id), { framesAfterReopen: after, snapshotIdEqualsCreatedSeq: snapFour && createdFour ? snapFour.id === createdFour.id : 'no duplicate this time', cardsFour })
    await context.close()
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
