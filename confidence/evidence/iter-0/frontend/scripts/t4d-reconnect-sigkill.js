// F-61 / F-20 in the browser with a hard backend crash (SIGKILL) so the TCP connection really drops; route-level request logging; 12 s outage
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const PORT = fs.readFileSync(__dirname + '/aux-port.txt', 'utf8').trim()
process.env.UI = 'http://127.0.0.1:3011'
process.env.API = `http://127.0.0.1:${PORT}`
const L = require('./lib')
const { record, api, publishBody, newPage, cardByTitle } = L
L.setFile('t4d-reconnect-sigkill')
const RUN = Date.now().toString(36)
const tenant = `fe-reconn4-${RUN}`
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service.jar'
function javaPid() { try { return execSync(`ps -eo pid,args | grep java | grep "server.port=${PORT}" | grep -v grep | awk '{print $1}' | head -1`).toString().trim() } catch { return '' } }
async function waitBackend(up, ms = 90000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${process.env.API}/v1/feed?tenantId=x`, { headers: { 'X-Client-Id': 'fe-verifier' } }); if (up && r.status === 200) return true } catch { if (!up) return true } await L.wait(300) } return false }
function startBackend() { const out = fs.openSync(__dirname + '/backend-aux-restart.txt', 'a'); const c = spawn('java', ['-jar', JAR, `--server.port=${PORT}`, '--spring.data.mongodb.uri=mongodb://localhost:27017/fe_reconnect'], { detached: true, stdio: ['ignore', out, out] }); c.unref() }

;(async () => {
  const browser = await L.launch()
  const T0 = Date.now(); const tl = []; const log = (m) => { tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`) }
  try {
    if (!javaPid()) { startBackend(); log('started aux backend') }
    log('aux backend up: ' + (await waitBackend(true)))
    const { context, page } = await newPage(browser)
    await page.addInitScript(() => { window.__esLog = []; const Orig = window.EventSource; const stamp = () => new Date().toISOString().slice(11, 23); window.EventSource = function (url, init) { const es = new Orig(url, init); const n = (window.__esN = (window.__esN || 0) + 1); es.addEventListener('open', () => window.__esLog.push(`${stamp()} es#${n} open`)); es.addEventListener('error', () => window.__esLog.push(`${stamp()} es#${n} error readyState=${es.readyState}`)); return es }; window.EventSource.prototype = Orig.prototype })
    await page.route('**/v1/feed/stream**', async (route) => { let h = {}; try { h = await route.request().allHeaders() } catch {} log(`stream REQUEST last-event-id=${h['last-event-id'] ?? '(none)'}`); try { await route.continue() } catch {} })
    page.on('response', (r) => { if (r.url().includes('/v1/feed/stream')) log(`stream RESPONSE ${r.status()}`) })
    page.on('requestfailed', (r) => { if (r.url().includes('/v1/feed/stream')) log(`stream REQUEST FAILED ${(r.failure() || {}).errorText}`) })
    let lastInd = ''
    const poll = setInterval(async () => { try { const s = await page.locator('text=/^(Paused|Connecting|Live|Reconnecting)$/').first().textContent({ timeout: 400 }); if (s !== lastInd) { log(`indicator → ${s}`); lastInd = s } } catch {} }, 250)
    await api('POST', '/v1/communications', publishBody(tenant, { title: 'seed before drop' }))
    await L.gotoFeed(page, tenant, { allTypes: true })
    await page.waitForSelector('article h3:has-text("seed before drop")')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    const pid = javaPid(); log(`feed is Live; SIGKILL backend pid ${pid}`)
    execSync(`kill -9 ${pid}`)
    await waitBackend(false, 30000); log('backend is down (GET refused)')
    await L.wait(12000)
    log('after 12 s down; es log: ' + JSON.stringify(await page.evaluate(() => window.__esLog)))
    startBackend(); await waitBackend(true); log('backend is back (GET 200)')
    const after = await api('POST', '/v1/communications', publishBody(tenant, { title: 'published after restart' }))
    log(`published after restart → ${after.status}`)
    let shownAt = null
    for (let i = 0; i < 60; i++) { if ((await cardByTitle(page, 'published after restart').count()) === 1) { shownAt = i * 0.5; break } await L.wait(500) }
    log(`card 'published after restart' shown after ${shownAt === null ? '>30' : shownAt}s; indicator=${lastInd}`)
    const esLog = await page.evaluate(() => window.__esLog); log('final es log: ' + JSON.stringify(esLog))
    clearInterval(poll)
    const text = tl.join('\n'); console.log(text); fs.writeFileSync(__dirname + '/t4d-timeline.txt', text)
    const sawReconnecting = tl.some((l) => /indicator → Reconnecting/.test(l))
    const retries = tl.filter((l) => /stream REQUEST last-event-id=\d+/.test(l)).length
    const got500 = tl.some((l) => /stream RESPONSE 500/.test(l))
    const closed = esLog.some((l) => /readyState=2/.test(l))
    record('F-61', "indicator shows 'Reconnecting' while the backend is down", sawReconnecting, tl.filter((l) => /indicator/.test(l)))
    record('F-61', 'the browser retries the stream on its own and sends Last-Event-ID', retries >= 1, { retries, streamLines: tl.filter((l) => /stream/.test(l)) })
    record('F-20', 'resumed stream requests (Last-Event-ID) are answered 200, never 500', retries >= 1 && !got500, tl.filter((l) => /RESPONSE/.test(l)))
    record('F-61', 'after the restart the new item appears without a manual refresh and the indicator is Live again', shownAt !== null && lastInd === 'Live', { shownAt, indicator: lastInd, eventSourceClosedForGood: closed })
    if (shownAt === null || lastInd !== 'Live') {
      await L.shot(page, 'F-61-after-restart')
      await page.getByRole('switch', { name: 'Live updates' }).click(); await L.wait(400); await page.getByRole('switch', { name: 'Live updates' }).click()
      let healed = false; const t1 = Date.now(); while (Date.now() - t1 < 10000) { if ((await page.locator('text=/^(Paused|Connecting|Live|Reconnecting)$/').first().textContent()) === 'Live') { healed = true; break } await L.wait(300) }
      record('F-61', 'diagnostic: toggling Live updates off/on (fresh EventSource without Last-Event-ID) restores the stream', healed, { healed, nowShown: (await cardByTitle(page, 'published after restart').count()) === 1 })
    }
    await context.close()
  } finally { await browser.close(); L.flush() }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
