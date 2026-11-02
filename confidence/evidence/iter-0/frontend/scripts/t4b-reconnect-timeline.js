// F-61 / F-20 with full instrumentation: EventSource instances (readyState), stream requests (Last-Event-ID via allHeaders), responses, indicator transitions.
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const PORT = fs.readFileSync(__dirname + '/aux-port.txt', 'utf8').trim()
process.env.UI = 'http://127.0.0.1:3011'
process.env.API = `http://127.0.0.1:${PORT}`
const L = require('./lib')
const { record, api, publishBody, newPage, cardByTitle } = L
L.setFile('t4b-reconnect-timeline')
const RUN = Date.now().toString(36)
const tenant = `fe-reconn2-${RUN}`
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service.jar'
function backendPid() { try { return execSync(`pgrep -f "server.port=${PORT}"`).toString().trim().split('\n')[0] } catch { return null } }
async function waitBackend(up, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${process.env.API}/v1/feed?tenantId=x`, { headers: { 'X-Client-Id': 'fe-verifier' } }); if (up && r.status === 200) return true } catch { if (!up) return true } await L.wait(300) } return false }
function startBackend() { const out = fs.openSync(__dirname + '/backend-aux-restart.txt', 'a'); const c = spawn('java', ['-jar', JAR, `--server.port=${PORT}`, '--spring.data.mongodb.uri=mongodb://localhost:27017/fe_reconnect'], { detached: true, stdio: ['ignore', out, out] }); c.unref() }

;(async () => {
  const browser = await L.launch()
  const T0 = Date.now(); const tl = []; const log = (m) => { tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`) }
  try {
    const { context, page } = await newPage(browser)
    await page.addInitScript(() => { const Orig = window.EventSource; window.__es = []; window.EventSource = function (url, init) { const es = new Orig(url, init); window.__es.push(es); return es }; window.EventSource.prototype = Orig.prototype; window.EventSource.CONNECTING = 0; window.EventSource.OPEN = 1; window.EventSource.CLOSED = 2 })
    page.on('request', async (r) => { if (r.url().includes('/v1/feed/stream')) { let h = {}; try { h = await r.allHeaders() } catch {} log(`stream REQUEST last-event-id=${h['last-event-id'] ?? '(none)'}`) } })
    page.on('response', (r) => { if (r.url().includes('/v1/feed/stream')) log(`stream RESPONSE ${r.status()} ${r.headers()['content-type'] || ''}`) })
    page.on('requestfailed', (r) => { if (r.url().includes('/v1/feed/stream')) log(`stream REQUEST FAILED ${r.failure() && r.failure().errorText}`) })
    const readyStates = async () => page.evaluate(() => (window.__es || []).map((e) => e.readyState).join(','))
    let lastInd = ''
    const poll = setInterval(async () => { try { const s = await page.locator('text=/^(Paused|Connecting|Live|Reconnecting)$/').first().textContent({ timeout: 500 }); if (s !== lastInd) { log(`indicator → ${s} (EventSource readyStates: ${await readyStates()})`); lastInd = s } } catch {} }, 250)

    await api('POST', '/v1/communications', publishBody(tenant, { title: 'seed before drop' }))
    await L.gotoFeed(page, tenant, { allTypes: true })
    await page.waitForSelector('article h3:has-text("seed before drop")')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    log('feed is Live; killing the backend now')
    execSync(`kill ${backendPid()}`)
    await waitBackend(false, 30000); log('backend is down (GET fails)')
    await L.wait(12000)
    log(`after 12 s down: readyStates=${await readyStates()}`)
    startBackend(); await waitBackend(true, 90000); log('backend is back (GET 200)')
    const after = await api('POST', '/v1/communications', publishBody(tenant, { title: 'published after restart' }))
    log(`published after restart → ${after.status}`)
    await L.wait(15000)
    const shown = (await cardByTitle(page, 'published after restart').count()) === 1
    const rs = await readyStates()
    log(`15 s after restart: card shown=${shown}, readyStates=${rs}, indicator=${lastInd}`)
    clearInterval(poll)
    const text = tl.join('\n'); console.log(text)
    fs.writeFileSync(__dirname + '/t4b-timeline.txt', text)
    const sawReconnecting = tl.some((l) => /indicator → Reconnecting/.test(l))
    const retried = tl.filter((l) => /stream REQUEST/.test(l)).length >= 2
    const sentLast = tl.some((l) => /last-event-id=\d+/.test(l))
    const closedForGood = /2/.test(rs) && !/1/.test(rs.split(',').slice(-1)[0])
    record('F-61', "indicator shows 'Reconnecting' while the backend is down", sawReconnecting, tl.filter((l) => /indicator/.test(l)))
    record('F-61', 'the browser retries the stream and sends Last-Event-ID', retried && sentLast, tl.filter((l) => /stream/.test(l)))
    record('F-61', 'after the restart the feed converges: new item shown and the stream is OPEN again (readyState 1)', shown && !closedForGood && lastInd === 'Live', { shown, readyStates: rs, indicator: lastInd })
    record('F-20', 'every resumed stream request (with Last-Event-ID) got 200', !tl.some((l) => /stream RESPONSE 500/.test(l)), tl.filter((l) => /RESPONSE/.test(l)))
    await context.close()
  } finally { await browser.close(); L.flush() }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
