// F-61 / F-20 end to end in the browser against the SHARED stack (3000 → 8080), without touching the backend:
// the drop is produced by Chromium's offline emulation (context.setOffline), everything else is real — the browser's own
// reconnect with Last-Event-ID, the service's answer to it, and the UI's behaviour afterwards.
const fs = require('fs')
const L = require('./lib')
const { record, api, publishBody, newPage, cardByTitle } = L
L.setFile('t4f-offline-reconnect')
const tenant = `fe-offline-${Date.now().toString(36)}`
const IND = 'text=/^(Paused|Connecting|Live|Reconnecting)$/'
;(async () => {
  const browser = await L.launch()
  const T0 = Date.now(); const tl = []; const log = (m) => tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`)
  try {
    const { context, page } = await newPage(browser)
    await page.addInitScript(() => { window.__esLog = []; const Orig = window.EventSource; const stamp = () => new Date().toISOString().slice(11, 23); window.EventSource = function (url, init) { const es = new Orig(url, init); const n = (window.__esN = (window.__esN || 0) + 1); es.addEventListener('open', () => window.__esLog.push(`${stamp()} es#${n} open`)); es.addEventListener('error', () => window.__esLog.push(`${stamp()} es#${n} error readyState=${es.readyState}`)); return es }; window.EventSource.prototype = Orig.prototype })
    const streamReqs = []
    await page.route('**/v1/feed/stream**', async (route) => { let h = {}; try { h = await route.request().allHeaders() } catch {} const lei = h['last-event-id'] ?? '(none)'; streamReqs.push(lei); log(`stream REQUEST #${streamReqs.length} Last-Event-ID=${lei}`); try { await route.continue() } catch {} })
    const statuses = []
    page.on('response', (r) => { if (r.url().includes('/v1/feed/stream')) { statuses.push(r.status()); log(`stream RESPONSE ${r.status()}`) } })
    page.on('requestfailed', (r) => { if (r.url().includes('/v1/feed/stream')) log(`stream REQUEST FAILED ${(r.failure() || {}).errorText}`) })
    let lastInd = ''; const poll = setInterval(async () => { try { const s = await page.locator(IND).first().textContent({ timeout: 300 }); if (s !== lastInd) { log(`indicator → ${s}`); lastInd = s } } catch {} }, 200)
    const esLog = () => page.evaluate(() => window.__esLog)

    await api('POST', '/v1/communications', publishBody(tenant, { title: 'seed before drop' }))
    await L.gotoFeed(page, tenant, { allTypes: true })
    await page.waitForSelector('article h3:has-text("seed before drop")')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    const before = streamReqs.length; log(`feed is Live with one item (${before} stream requests so far, all without Last-Event-ID)`)

    // 1. drop the connection: go offline
    await context.setOffline(true); log('browser goes OFFLINE (in-flight stream should fail)')
    let dropped = false; const t1 = Date.now()
    while (Date.now() - t1 < 6000) { const l = await esLog(); if (l.some((x) => /error readyState=0/.test(x))) { dropped = true; break } await L.wait(200) }
    log(`drop seen by the EventSource: ${dropped}; indicator=${lastInd}; es log=${JSON.stringify(await esLog())}`)
    record('F-61', "a dropped stream puts the EventSource into CONNECTING (readyState 0) and the UI shows 'Reconnecting'", dropped && lastInd === 'Reconnecting', { dropped, indicator: lastInd })
    await L.wait(4000)
    const offlineRetries = streamReqs.length - before; log(`after 4 s offline: ${offlineRetries} reconnect attempts (all failed, network down)`)

    // 2. back online: the browser retries with Last-Event-ID and the real service answers
    await context.setOffline(false); log('browser back ONLINE')
    let resumed = null; const t2 = Date.now()
    while (Date.now() - t2 < 15000) { const lei = streamReqs.slice(before).find((x) => x !== '(none)'); if (lei) { resumed = lei; break } await L.wait(200) }
    await L.wait(1500)
    const l2 = await esLog(); const closed = l2.some((x) => /readyState=2/.test(x))
    log(`reconnect with Last-Event-ID=${resumed}; stream responses so far=${JSON.stringify(statuses)}; EventSource closed for good=${closed}; indicator=${lastInd}`)
    record('F-61', 'the browser reconnects on its own and sends Last-Event-ID = the last id it saw', resumed !== null, { lastEventIds: streamReqs })
    const resumedStatus = statuses[statuses.length - 1]
    record('F-20', 'the service answers the resumed stream (Last-Event-ID) with 200 and replays', resumed !== null && resumedStatus === 200, { statuses })

    // 3. does the feed converge?
    const after = await api('POST', '/v1/communications', publishBody(tenant, { title: 'published after reconnect' }))
    log(`published a second item → ${after.status}`)
    let shownAt = null
    for (let i = 0; i < 40; i++) { if ((await cardByTitle(page, 'published after reconnect').count()) === 1) { shownAt = i * 0.5; break } await L.wait(500) }
    log(`card 'published after reconnect' shown after ${shownAt === null ? '>20' : shownAt}s; indicator=${lastInd}; stream requests=${streamReqs.length}`)
    record('F-61', "after the reconnect the UI shows 'Live' again and the new item appears without a manual refresh", shownAt !== null && lastInd === 'Live', { shownAt, indicator: lastInd, esLog: await esLog() })
    record('F-61', 'the UI retries by itself after the EventSource gave up (new stream request within 20 s)', streamReqs.length > before + offlineRetries + 1, { streamRequests: streamReqs.length })

    // 4. diagnostic
    await page.getByRole('switch', { name: 'Live updates' }).click(); await L.wait(400); await page.getByRole('switch', { name: 'Live updates' }).click()
    let healed = false; const t3 = Date.now(); while (Date.now() - t3 < 20000) { try { if ((await page.locator(IND).first().textContent({ timeout: 300 })) === 'Live') { healed = true; break } } catch {} await L.wait(300) }
    const nowShown = (await cardByTitle(page, 'published after reconnect').count()) === 1
    log(`diagnostic: Live updates off/on (fresh EventSource, no Last-Event-ID) → indicator=${healed ? 'Live' : lastInd}, card shown=${nowShown}; last stream request Last-Event-ID=${streamReqs[streamReqs.length - 1]}`)
    record('F-61', 'diagnostic: a manual Live-updates off/on (fresh EventSource without Last-Event-ID) restores Live and shows the missed item', healed && nowShown, { healed, nowShown })
    clearInterval(poll)
    record('F-61', 'console/page errors during the scenario', page.cap.errors.length === 0, { pageErrors: page.cap.errors, console: page.cap.console.slice(0, 6) })
    const text = tl.join('\n'); console.log(text); fs.writeFileSync(__dirname + '/t4f-timeline.txt', text)
    await context.close()
  } finally { await browser.close(); L.flush() }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
