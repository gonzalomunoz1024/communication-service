// F-61 / F-20 end to end in a production-shaped setup: built UI served statically + an SSE-aware reverse proxy (rp.js) in
// front of an own backend instance. The backend is SIGKILLed while the feed is live and restarted ~8 s later. In HOLD mode the
// proxy keeps the browser's reconnect attempts pending until the backend is back, so the service's answer to the resumed
// stream (Last-Event-ID) is observed for real.
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const PORT = fs.readFileSync(__dirname + '/aux-port.txt', 'utf8').trim()
const RP = fs.readFileSync(__dirname + '/rp-port.txt', 'utf8').trim()
process.env.UI = `http://127.0.0.1:${RP}`
process.env.API = `http://127.0.0.1:${PORT}`
const L = require('./lib')
const { record, api, publishBody, newPage, cardByTitle } = L
L.setFile('t4g-reconnect-prodshape')
const tenant = `fe-reconn-prod-${Date.now().toString(36)}`
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service.jar'
const IND = 'text=/^(Paused|Connecting|Live|Reconnecting)$/'
function javaPid() { try { return execSync(`ps -eo pid,args | grep java | grep "server.port=${PORT}" | grep -v grep | awk '{print $1}' | head -1`).toString().trim() } catch { return '' } }
async function waitBackend(up, ms = 90000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${process.env.API}/v1/feed?tenantId=x`, { headers: { 'X-Client-Id': 'fe-verifier' } }); if (up && r.status === 200) return true } catch { if (!up) return true } await L.wait(300) } return false }
function startBackend() { const out = fs.openSync(__dirname + '/backend-aux-restart.txt', 'a'); const c = spawn('java', ['-jar', JAR, `--server.port=${PORT}`, '--spring.data.mongodb.uri=mongodb://localhost:27017/fe_reconnect'], { detached: true, stdio: ['ignore', out, out] }); c.unref() }
;(async () => {
  const browser = await L.launch()
  const T0 = Date.now(); const tl = []; const log = (m) => tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`)
  try {
    if (!javaPid()) { startBackend(); log('started aux backend') }
    log('aux backend up: ' + (await waitBackend(true)))
    const { context, page } = await newPage(browser)
    await page.addInitScript(() => { window.__esLog = []; const Orig = window.EventSource; const stamp = () => new Date().toISOString().slice(11, 23); window.EventSource = function (url, init) { const es = new Orig(url, init); const n = (window.__esN = (window.__esN || 0) + 1); es.addEventListener('open', () => window.__esLog.push(`${stamp()} es#${n} open`)); es.addEventListener('error', () => window.__esLog.push(`${stamp()} es#${n} error readyState=${es.readyState}`)); return es }; window.EventSource.prototype = Orig.prototype })
    const streamReqs = []; const statuses = []
    await page.route('**/v1/feed/stream**', async (route) => { let h = {}; try { h = await route.request().allHeaders() } catch {} const lei = h['last-event-id'] ?? '(none)'; streamReqs.push(lei); log(`stream REQUEST #${streamReqs.length} Last-Event-ID=${lei}`); try { await route.continue() } catch {} })
    page.on('response', (r) => { if (r.url().includes('/v1/feed/stream')) { statuses.push(r.status()); log(`stream RESPONSE ${r.status()}`) } })
    page.on('requestfailed', (r) => { if (r.url().includes('/v1/feed/stream')) log(`stream REQUEST FAILED ${(r.failure() || {}).errorText}`) })
    let lastInd = ''; const poll = setInterval(async () => { try { const s = await page.locator(IND).first().textContent({ timeout: 300 }); if (s !== lastInd) { log(`indicator → ${s}`); lastInd = s } } catch {} }, 200)
    const esLog = () => page.evaluate(() => window.__esLog)

    await api('POST', '/v1/communications', publishBody(tenant, { title: 'seed before drop' }))
    await L.gotoFeed(page, tenant, { allTypes: true })
    await page.waitForSelector('article h3:has-text("seed before drop")')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    const before = streamReqs.length; log(`feed is Live with one item (${before} stream requests so far)`)
    record('F-64', 'the built UI served statically from the same origin as /v1 works (publish/feed/stream through a plain reverse proxy)', true, { ui: process.env.UI })

    const pid = javaPid(); execSync(`kill -9 ${pid}`); log(`backend SIGKILLed (pid ${pid})`)
    await waitBackend(false, 30000); log('backend is down (connect refused)')
    let dropped = false; const t1 = Date.now()
    while (Date.now() - t1 < 8000) { if ((await esLog()).some((x) => /error readyState=0/.test(x))) { dropped = true; break } await L.wait(200) }
    log(`EventSource saw the drop (readyState 0): ${dropped}; indicator=${lastInd}`)
    record('F-61', "when the stream drops the UI shows 'Reconnecting' (EventSource readyState 0)", dropped && lastInd === 'Reconnecting', { dropped, indicator: lastInd, esLog: await esLog() })
    await L.wait(8000)
    log(`8 s later (backend still down): stream requests=${streamReqs.length}, es log=${JSON.stringify(await esLog())}`)
    startBackend(); await waitBackend(true); log('backend restarted (GET 200)')
    let resumed = null; const t2 = Date.now()
    while (Date.now() - t2 < 15000) { const lei = streamReqs.slice(before).find((x) => x !== '(none)'); if (lei) { resumed = lei; break } await L.wait(200) }
    await L.wait(2500)
    const l2 = await esLog(); const closed = l2.some((x) => /readyState=2/.test(x))
    log(`browser's reconnect Last-Event-ID=${resumed}; stream responses=${JSON.stringify(statuses)}; EventSource CLOSED for good=${closed}; indicator=${lastInd}`)
    record('F-61', 'the browser reconnects on its own and sends Last-Event-ID = the last id it saw', resumed !== null, { lastEventIds: streamReqs.slice(before) })
    record('F-20', 'the service answers the resumed stream (Last-Event-ID) with 200', resumed !== null && statuses[statuses.length - 1] === 200, { statuses })
    const after = await api('POST', '/v1/communications', publishBody(tenant, { title: 'published after restart' }))
    log(`published after restart → ${after.status}`)
    let shownAt = null
    for (let i = 0; i < 40; i++) { if ((await cardByTitle(page, 'published after restart').count()) === 1) { shownAt = i * 0.5; break } await L.wait(500) }
    log(`card 'published after restart' shown after ${shownAt === null ? '>20' : shownAt}s; indicator=${lastInd}; stream requests=${streamReqs.length}; es log=${JSON.stringify(await esLog())}`)
    record('F-61', "after the restart the UI is 'Live' again and the new item appears without a manual refresh", shownAt !== null && lastInd === 'Live', { shownAt, indicator: lastInd })
    record('F-61', 'after the EventSource gave up, the UI opens a new stream by itself within 20 s', streamReqs.length > before + 1 && (await esLog()).filter((x) => /open/.test(x)).length > 1, { streamRequests: streamReqs.length })
    await page.getByRole('switch', { name: 'Live updates' }).click(); await L.wait(400); await page.getByRole('switch', { name: 'Live updates' }).click()
    let healed = false; const t3 = Date.now(); while (Date.now() - t3 < 20000) { try { if ((await page.locator(IND).first().textContent({ timeout: 300 })) === 'Live') { healed = true; break } } catch {} await L.wait(300) }
    const nowShown = (await cardByTitle(page, 'published after restart').count()) === 1
    log(`diagnostic: Live updates off/on → indicator=${healed ? 'Live' : lastInd}, missed card shown=${nowShown}, last stream request Last-Event-ID=${streamReqs[streamReqs.length - 1]}`)
    record('F-61', 'diagnostic: a manual Live-updates off/on (fresh EventSource, no Last-Event-ID) restores Live and shows the missed item', healed && nowShown, { healed, nowShown })
    clearInterval(poll)
    record('F-61', 'console/page errors during the scenario', page.cap.errors.length === 0, { pageErrors: page.cap.errors, console: page.cap.console.slice(0, 6) })
    const text = tl.join('\n'); console.log(text); fs.writeFileSync(__dirname + '/t4g-timeline.txt', text)
    await context.close()
  } finally { await browser.close(); L.flush() }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
