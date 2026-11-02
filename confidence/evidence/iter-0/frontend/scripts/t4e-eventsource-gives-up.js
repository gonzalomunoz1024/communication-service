// F-61 (frontend half, isolated from the proxy and from the backend's resume bug):
// the browser's EventSource reconnects after the stream closes (sending Last-Event-ID) but gives up for good after any non-200
// answer. Does the UI ever recover? The stream is served by Playwright's route handler, everything else hits the shared stack.
const fs = require('fs')
const L = require('./lib')
const { record, newPage } = L
L.setFile('t4e-eventsource-gives-up')
const tenant = `fe-gives-up-${Date.now().toString(36)}`
;(async () => {
  const browser = await L.launch()
  const T0 = Date.now(); const tl = []; const log = (m) => tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`)
  try {
    const { context, page } = await newPage(browser)
    await page.addInitScript(() => { window.__esLog = []; const Orig = window.EventSource; const stamp = () => new Date().toISOString().slice(11, 23); window.EventSource = function (url, init) { const es = new Orig(url, init); const n = (window.__esN = (window.__esN || 0) + 1); es.addEventListener('open', () => window.__esLog.push(`${stamp()} es#${n} open`)); es.addEventListener('error', () => window.__esLog.push(`${stamp()} es#${n} error readyState=${es.readyState}`)); return es }; window.EventSource.prototype = Orig.prototype })
    let n = 0; const seen = []
    await page.route('**/v1/feed/stream**', async (route) => {
      n++; let h = {}; try { h = await route.request().allHeaders() } catch {}
      const lei = h['last-event-id'] ?? '(none)'; seen.push({ n, lastEventId: lei }); log(`stream request #${n} Last-Event-ID=${lei}`)
      if (n === 1) { log('→ answered 200 text/event-stream with "retry: 300 / id: 41" and closed the stream (a normal drop)'); return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: 'retry: 300\nid: 41\n\n' }) }
      if (n === 2) { log('→ answered 500 (what the service does to a resumed stream today, or a proxy 502 during a restart)'); return route.fulfill({ status: 500, headers: { 'content-type': 'application/json' }, body: '{"error":"simulated: server/proxy error on reconnect"}' }) }
      log('→ passed through to the real backend'); return route.continue()
    })
    let lastInd = ''; const poll = setInterval(async () => { try { const s = await page.locator('text=/^(Paused|Connecting|Live|Reconnecting)$/').first().textContent({ timeout: 300 }); if (s !== lastInd) { log(`indicator → ${s}`); lastInd = s } } catch {} }, 200)
    await L.gotoFeed(page, tenant, { allTypes: true })
    await L.wait(8000)
    log(`after 8 s: ${n} stream requests, indicator=${lastInd}, es log=${JSON.stringify(await page.evaluate(() => window.__esLog))}`)
    await page.unroute('**/v1/feed/stream**')
    await L.wait(15000)
    const esLog = await page.evaluate(() => window.__esLog)
    log(`15 s later with the route removed (a real stream would now succeed): ${n} stream requests in total, indicator=${lastInd}`)
    const reconnected = seen.some((s) => s.lastEventId === '41')
    const gaveUp = esLog.some((l) => /readyState=2/.test(l))
    record('F-61', 'after a dropped stream the browser reconnects by itself and sends Last-Event-ID = last id seen (41)', reconnected, seen)
    record('F-61', 'after a non-200 answer to the reconnect the EventSource is CLOSED (readyState 2) and the UI shows Reconnecting', gaveUp && lastInd === 'Reconnecting', { esLog, indicator: lastInd })
    record('F-61', 'the UI recovers on its own once the stream would succeed again (a new EventSource within 15 s)', n > 2 && lastInd === 'Live', { totalStreamRequests: n, indicator: lastInd })
    await page.getByRole('switch', { name: 'Live updates' }).click(); await L.wait(400); await page.getByRole('switch', { name: 'Live updates' }).click()
    let healed = false; const t1 = Date.now(); while (Date.now() - t1 < 20000) { try { if ((await page.locator('text=/^(Paused|Connecting|Live|Reconnecting)$/').first().textContent({ timeout: 300 })) === 'Live') { healed = true; break } } catch {} await L.wait(300) }
    log(`diagnostic: Live updates off/on → indicator=${healed ? 'Live' : lastInd} (${n} stream requests in total)`)
    record('F-61', 'diagnostic: only a manual Live-updates off/on (or a reload) creates a new EventSource and restores Live', healed, { totalStreamRequests: n })
    clearInterval(poll)
    const text = tl.join('\n'); console.log(text); fs.writeFileSync(__dirname + '/t4e-timeline.txt', text)
    record('F-61', 'console/page errors during the scenario', page.cap.errors.length === 0, { pageErrors: page.cap.errors, console: page.cap.console.slice(0, 5) })
    await context.close()
  } finally { await browser.close(); L.flush() }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
