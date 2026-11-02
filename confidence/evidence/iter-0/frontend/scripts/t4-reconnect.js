// F-61 reconnect behaviour (own backend on the aux port + own Vite dev server on :3011), F-20 as seen from the browser
const fs = require('fs')
const { execSync } = require('child_process')
const PORT = fs.readFileSync(__dirname + '/aux-port.txt', 'utf8').trim()
process.env.UI = 'http://127.0.0.1:3011'
process.env.API = `http://127.0.0.1:${PORT}`
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant, UI, cards, cardByTitle } = L
L.setFile('t4-reconnect')
const RUN = Date.now().toString(36)
const tenant = `fe-reconnect-${RUN}`
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service.jar'

function backendPid() { try { return execSync(`pgrep -f "server.port=${PORT}"`).toString().trim().split('\n')[0] } catch { return null } }
async function waitBackend(up, ms = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`${process.env.API}/v1/feed?tenantId=x`, { headers: { 'X-Client-Id': 'fe-verifier' } }); if (up && r.status === 200) return true } catch (e) { if (!up) return true }
    await L.wait(500)
  }
  return false
}
function startBackend() {
  const { spawn } = require('child_process')
  const child = spawn('java', ['-jar', JAR, `--server.port=${PORT}`, '--spring.data.mongodb.uri=mongodb://localhost:27017/fe_reconnect'], { detached: true, stdio: ['ignore', fs.openSync(__dirname + '/backend-aux-restart.txt', 'a'), fs.openSync(__dirname + '/backend-aux-restart.txt', 'a')] })
  child.unref()
}
async function indicator(page) { return page.locator('text=/^(Paused|Connecting|Live|Reconnecting)$/').first().textContent() }

;(async () => {
  const browser = await L.launch()
  try {
    record('F-61', 'aux backend is up before the test', await waitBackend(true, 20000), `port ${PORT}`)
    const { context, page } = await newPage(browser)
    const streamRequests = []
    page.on('request', (r) => { if (r.url().includes('/v1/feed/stream')) streamRequests.push({ url: r.url(), lastEventId: r.headers()['last-event-id'] || null, at: Date.now() }) })
    const streamResponses = []
    page.on('response', (r) => { if (r.url().includes('/v1/feed/stream')) streamResponses.push({ status: r.status(), at: Date.now() }) })
    // seed first: on an empty tenant the SSE response is not committed until the first frame (15 s keepalive)
    const first = await api('POST', '/v1/communications', publishBody(tenant, { title: 'before the drop' }))
    await L.gotoFeed(page, tenant, { allTypes: true })
    await page.waitForSelector('article h3:has-text("before the drop")', { timeout: 10000 })
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    record('F-61', 'feed live with one item before the backend is stopped', first.status === 201, `status=${first.status}`)
    // stop the backend
    const pid = backendPid()
    execSync(`kill ${pid}`)
    record('F-61', 'aux backend stopped (SIGTERM)', await waitBackend(false, 30000), `pid=${pid}`)
    await page.waitForSelector('text=/^Reconnecting$/', { timeout: 15000 }).then(() => record('F-61', "indicator shows 'Reconnecting' when the stream drops", true, 'Reconnecting')).catch(async () => record('F-61', "indicator shows 'Reconnecting' when the stream drops", false, await indicator(page)))
    await L.wait(3000)
    startBackend()
    record('F-61', 'aux backend restarted', await waitBackend(true, 90000), 'GET /v1/feed → 200 again')
    const during = await api('POST', '/v1/communications', publishBody(tenant, { title: 'published after restart' }))
    record('F-61', 'published a second item right after the restart', during.status === 201, `status=${during.status}`)
    // what does the browser send on reconnect, and what does the server answer?
    await L.wait(8000)
    const reconnects = streamRequests.slice(1)
    const withLast = reconnects.filter((r) => r.lastEventId !== null)
    const statuses = streamResponses.map((r) => r.status)
    record('F-61', 'browser reconnects on its own and sends Last-Event-ID (the last id: seen)', reconnects.length >= 1 && withLast.length >= 1, { reconnectAttempts: reconnects.length, lastEventIds: [...new Set(withLast.map((r) => r.lastEventId))], responseStatuses: statuses })
    const t0 = Date.now()
    let live = false
    while (Date.now() - t0 < 30000) { if ((await indicator(page)) === 'Live') { live = true; break } await L.wait(500) }
    const shown = (await cardByTitle(page, 'published after restart').count()) === 1
    record('F-61', "after the backend is back the indicator returns to 'Live' within 30s", live, { indicator: await indicator(page), secondsWaited: Math.round((Date.now() - t0) / 1000), streamResponseStatuses: statuses })
    record('F-61', 'the item published after the restart appears without a manual refresh (replay or snapshot)', shown, { shown, cards: await cards(page).count() })
    record('F-20', 'server answers the resumed stream (Last-Event-ID) with 200', streamResponses.slice(1).some((r) => r.status === 200), { statusesAfterReconnect: streamResponses.slice(1).map((r) => r.status) })
    if (!live || !shown) {
      await L.shot(page, 'F-61-stuck-reconnecting')
      // does a manual Refresh heal the list? (the stream itself stays broken)
      await page.getByRole('button', { name: 'Refresh' }).click()
      await L.wait(1500)
      record('F-61', 'diagnostic: manual Refresh fetches the list again (GET works) while the stream is still broken', (await cardByTitle(page, 'published after restart').count()) === 1, { indicator: await indicator(page) })
      // does turning Live off/on heal it? (a fresh EventSource without Last-Event-ID)
      await page.getByRole('switch', { name: 'Live updates' }).click()
      await L.wait(500)
      await page.getByRole('switch', { name: 'Live updates' }).click()
      const t1 = Date.now(); let healed = false
      while (Date.now() - t1 < 10000) { if ((await indicator(page)) === 'Live') { healed = true; break } await L.wait(300) }
      record('F-61', 'diagnostic: toggling Live updates off/on (a new EventSource without Last-Event-ID) brings the stream back', healed, { indicator: await indicator(page) })
    }
    record('F-61', 'console/page errors during the reconnect scenario', page.cap.errors.length === 0, { pageErrors: page.cap.errors, console: page.cap.console.slice(0, 6) })
    await context.close()
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
