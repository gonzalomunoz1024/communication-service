// E2E verifier (iteration 2): does the browser's own EventSource retry carry Last-Event-ID on the wire?
// Network.requestWillBeSent shows renderer headers only; Network.requestWillBeSentExtraInfo shows the headers as sent.
const { chromium } = require('playwright')
const { execSync } = require('child_process')
const fs = require('fs')
const S = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e2'
const UI = 'http://127.0.0.1:19530', A = 'http://127.0.0.1:19501'
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch (e) { return 'ERR ' + e.message.slice(0, 200) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const RUN = Date.now().toString(36); const T = `ve2-hdr-${RUN}`
  const browser = await chromium.launch(); const page = await browser.newPage()
  const session = await page.context().newCDPSession(page); await session.send('Network.enable')
  const reqs = {}
  session.on('Network.requestWillBeSent', (e) => { if (!/\/v1\/feed\/stream/.test(e.request.url)) return; const prev = reqs[e.requestId]; reqs[e.requestId] = { id: e.requestId, t: Date.now(), url: e.request.url, headers: e.request.headers, wireHeaders: prev && prev.pendingExtra } })
  session.on('Network.requestWillBeSentExtraInfo', (e) => { const r = reqs[e.requestId]; if (r) r.wireHeaders = e.headers; else reqs[e.requestId] = { id: e.requestId, t: Date.now(), pendingExtra: e.headers } })
  session.on('Network.responseReceived', (e) => { const r = reqs[e.requestId]; if (r) r.status = e.response.status })
  session.on('Network.loadingFailed', (e) => { const r = reqs[e.requestId]; if (r) r.failed = e.errorText })
  session.on('Network.eventSourceMessageReceived', (e) => { const r = reqs[e.requestId]; if (r) (r.frames = r.frames || []).push(`${e.eventName}#${e.eventId}`) })
  await page.goto(`${UI}/#/feed`); await page.getByRole('textbox', { name: 'Tenant', exact: true }).fill(T)
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'All types' })
  const res = await fetch(A + '/v1/communications', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Id': 've2-failure-checks' }, body: JSON.stringify({ tenantId: T, publisher: 've2-api', type: 'OUTAGE', severity: 'MAJOR', title: `hdr ${RUN}`, affectedServices: ['payments-api'] }) })
  console.log(`published: ${res.status}`)
  await page.locator('article', { hasText: `hdr ${RUN}` }).waitFor({ timeout: 8000 })
  await sleep(500)
  const pid = fs.readFileSync(`${S}/backendA.pid`, 'utf8').trim(); const tKill = Date.now(); console.log(`kill -9 A (pid ${pid}) at ${new Date(tKill).toISOString()}: ${sh(`kill -9 ${pid}`) || 'ok'}`)
  await sleep(7500)
  console.log(sh(`${S}/scripts/start-backend.sh A`))
  const list = Object.values(reqs).filter((r) => r.url).sort((a, b) => a.t - b.t)
  const find = (h) => { const k = Object.keys(h || {}).find((k) => k.toLowerCase() === 'last-event-id'); return k ? h[k] : '(absent)' }
  for (const r of list) console.log(`${((r.t - tKill) / 1000).toFixed(3).padStart(8)} s  status=${r.status || (r.failed ? r.failed : '-')}  query=${new URL(r.url).search}  requestWillBeSent.Last-Event-ID=${find(r.headers)}  wire(ExtraInfo).Last-Event-ID=${find(r.wireHeaders)}  frames=${(r.frames || []).join(',') || '-'}`)
  const t0 = Date.now(); while (Date.now() - t0 < 90000) { try { const r = await fetch(A + '/actuator/health/readiness', { signal: AbortSignal.timeout(2000) }); if (r.status === 200) break } catch {} await sleep(500) }
  console.log(`A ready again ${Date.now() - t0} ms after the restart command`)
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 25000 }).catch(() => {})
  console.log(`page Live again at +${((Date.now() - tKill) / 1000).toFixed(1)} s after the kill`)
  await sleep(1500)
  const list2 = Object.values(reqs).filter((r) => r.url && r.t > tKill + 7500).sort((a, b) => a.t - b.t)
  for (const r of list2) console.log(`${((r.t - tKill) / 1000).toFixed(3).padStart(8)} s  status=${r.status || (r.failed ? r.failed : '-')}  query=${new URL(r.url).search}  wire(ExtraInfo).Last-Event-ID=${find(r.wireHeaders)}  frames=${(r.frames || []).join(',') || '-'}`)
  await browser.close()
})().catch((e) => { console.error('ERR', e); process.exit(2) })
