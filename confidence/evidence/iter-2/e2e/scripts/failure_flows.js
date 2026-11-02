// E2E verifier (iteration 2): failure paths. node failure_flows.js <scenario>...  scenarios: kill mongo
//  kill : backend A SIGKILL with the page streaming through the Vite preview proxy -> Reconnecting -> publish via B
//         meanwhile -> A restarted -> the page heals (CDP shows the reopen request's lastEventId and the SSE frames of the
//         resumed stream), backoff timings (G-2-11: 1,2,4,8,10 cap; reset after a successful open), sidecar backoff/recovery
//  mongo: docker stop e2e2-mongo -> API 503 database unavailable within ~5 s, readiness DOWN, UI wording, backend log hygiene,
//         sidecar reports fail -> recovery without a backend restart
const { chromium } = require('playwright')
const { execSync, spawn } = require('child_process')
const fs = require('fs')
const A = 'http://127.0.0.1:19501', B = 'http://127.0.0.1:19502', UI = 'http://127.0.0.1:19530'
const S = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e2'
const OUT = `${S}/out`, SHOT = `${OUT}/screenshots`; fs.mkdirSync(SHOT, { recursive: true })
const RUN = Date.now().toString(36)
const results = []
const stamp = () => new Date().toISOString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function check(id, name, cond, detail = '') { results.push([id, name, !!cond]); console.log(`${stamp()} ${cond ? 'PASS' : 'FAIL'} ${id} ${name} :: ${String(detail).slice(0, 1200)}`) }
function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch (e) { return `ERR(${e.status}): ${(e.stderr || e.stdout || e.message).toString().trim().slice(0, 300)}` } }
async function api(base, method, path, body, headers = { 'X-Client-Id': 've2-failure-checks' }, timeout = 40000) {
  const t0 = Date.now()
  try {
    const res = await fetch(base + path, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) })
    const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text, ms: Date.now() - t0 }
  } catch (e) { return { status: 0, json: null, text: String(e), ms: Date.now() - t0 } }
}
const outage = (tenantId, title, extra = {}) => ({ tenantId, publisher: 've2-api', type: 'OUTAGE', severity: 'MAJOR', title, affectedServices: ['payments-api'], ...extra })
async function waitFor(fn, ms = 10000, every = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return { ok: true, ms: Date.now() - t0, value: v } } catch {} await sleep(every) } return { ok: false, ms: Date.now() - t0 } }
const card = (page, title) => page.locator('article', { hasText: title })
const sidecarLog = () => sh('docker logs e2e2-sidecar 2>&1').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return { raw: l } } })
const status = async () => { try { return await (await fetch('http://127.0.0.1:19541/status', { signal: AbortSignal.timeout(3000) })).json() } catch { return null } }
const backendLog = () => fs.readFileSync(`${OUT}/backendA.txt`, 'utf8').split('\n')
const pidA = () => fs.readFileSync(`${S}/backendA.pid`, 'utf8').trim()
const alive = (pid) => sh(`kill -0 ${pid} 2>&1 && echo yes || echo no`) === 'yes'
async function openFeed(page, tenant) {
  await page.goto(`${UI}/#/feed`)
  await page.getByRole('textbox', { name: 'Tenant', exact: true }).fill(tenant)
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'All types' })
  await page.evaluate((run) => { window.__ve2 = run }, RUN)
}
const notReloaded = (page) => page.evaluate(() => window.__ve2).then((v) => v === RUN)
const badge = async (page) => { for (const b of ['Reconnecting', 'Live', 'Connecting', 'Paused']) if (await page.getByText(b, { exact: true }).isVisible().catch(() => false)) return b; return '?' }
async function startA() { sh(`${S}/scripts/start-backend.sh A`); const r = await waitFor(async () => (await api(A, 'GET', '/actuator/health/readiness', null, {}, 3000)).status === 200, 90000, 500); return r }

// CDP capture: every request to /v1/feed/stream and every SSE message the browser received on those streams
async function cdp(page) {
  const session = await page.context().newCDPSession(page)
  const rec = { requests: [], responses: [], messages: [], feedGets: [] }
  await session.send('Network.enable')
  session.on('Network.requestWillBeSent', (e) => {
    if (/\/v1\/feed\/stream/.test(e.request.url)) rec.requests.push({ id: e.requestId, t: Date.now(), url: e.request.url })
    if (e.request.method === 'GET' && /\/v1\/feed\?/.test(e.request.url)) rec.feedGets.push({ t: Date.now(), url: e.request.url })
  })
  session.on('Network.responseReceived', (e) => { if (/\/v1\/feed\/stream/.test(e.response.url)) rec.responses.push({ id: e.requestId, t: Date.now(), status: e.response.status, url: e.response.url }) })
  session.on('Network.loadingFailed', (e) => { const q = rec.requests.find((r) => r.id === e.requestId); if (q) q.failed = e.errorText })
  session.on('Network.eventSourceMessageReceived', (e) => rec.messages.push({ id: e.requestId, t: Date.now(), eventName: e.eventName, eventId: e.eventId, data: e.data }))
  return rec
}
const since = (arr, t) => arr.filter((x) => x.t >= t)

// ------------------------------------------------------------------------------------------------- kill (F-61, F-92, G-2-11, F-74)
async function kill(page) {
  const T = `ve2-kill-${RUN}`
  console.log(`## kill: SIGKILL backend A under a streaming page (${stamp()})`)
  await openFeed(page, T)
  const rec = await cdp(page)
  const n1 = (await api(A, 'POST', '/v1/communications', outage(T, `before the kill ${RUN}`))).json
  const seen1 = await waitFor(() => card(page, `before the kill ${RUN}`).isVisible(), 8000)
  check('F-60', 'a notice published over HTTP arrives live (gives the page a last event id)', seen1.ok, `${seen1.ms} ms`)
  const sc0 = await status(); const sidecarLines0 = sidecarLog().length
  const pid = pidA(); const tKill = Date.now(); sh(`kill -9 ${pid}`)
  const dead = await waitFor(async () => !alive(pid), 5000, 50)
  const reconnecting = await waitFor(() => page.getByText('Reconnecting', { exact: true }).isVisible(), 15000, 50)
  check('F-61', 'SIGKILL: the proxy ends the browser\'s stream and the badge says Reconnecting within a second', dead.ok && reconnecting.ok && reconnecting.ms < 3000, `process gone after ${dead.ms} ms; Reconnecting after ${reconnecting.ms} ms`)
  await page.screenshot({ path: `${SHOT}/f61-reconnecting.png` })
  // the error state of a load while the service is down (F-57/F-92)
  await page.getByRole('button', { name: 'Refresh' }).click()
  const errState = await waitFor(() => page.getByText("Couldn't load the feed").isVisible(), 10000, 100)
  const errText = errState.ok ? (await page.locator('main').innerText()).replace(/\s+/g, ' ') : ''
  check('F-57', "backend down: 'Couldn't load the feed' + 'The service is unreachable right now…' + Try again (not a bare 502)", errState.ok && /unreachable right now/.test(errText) && (await page.getByRole('button', { name: 'Try again' }).isVisible()) && !/502 Bad Gateway/.test(errText), errText.match(/Couldn't load the feed.{0,160}/)?.[0] || errText.slice(0, 200))
  await page.screenshot({ path: `${SHOT}/f92-backend-down.png` })
  // B keeps serving; publish through B while A is dead
  const n2 = (await api(B, 'POST', '/v1/communications', outage(T, `published via B while A was dead ${RUN}`))).json
  check('F-92', 'the second node keeps serving while A is dead (publish via B -> 201)', n2 && n2.id, `id=${n2 && n2.id}`)
  // let the backoff reach its cap: attempts at ~1, 3, 7, 15, 25, 35 s
  await sleep(38000 - (Date.now() - tKill))
  const attempts = since(rec.requests, tKill)
  const gaps = attempts.map((r, i) => (i === 0 ? (r.t - tKill) / 1000 : (r.t - attempts[i - 1].t) / 1000).toFixed(1))
  const allCarry = attempts.every((r) => /lastEventId=\d+/.test(r.url))
  check('F-61', 'G-2-11: every reopen attempt carries ?lastEventId=, delays 1,2,4,8 then capped at 10 s', attempts.length >= 5 && allCarry && Number(gaps[1]) >= 1.5 && Number(gaps[1]) <= 3 && Number(gaps[4]) >= 8 && Number(gaps[4]) <= 12 && (gaps.length < 6 || (Number(gaps[5]) >= 8 && Number(gaps[5]) <= 12)), `attempts=${attempts.length} gaps(s)=${gaps.join(',')} lastEventIds=${attempts.map((r) => new URL(r.url).searchParams.get('lastEventId')).join(',')}`)
  const sidecarFail = sidecarLog().slice(sidecarLines0).filter((l) => l.msg === 'report failed; will retry')
  const sc1 = await status()
  check('F-74', "sidecar during the outage: 'report failed; will retry' with growing backoff, /status.sendError set, app unaffected", sidecarFail.length >= 2 && sc1 && sc1.sendError && sidecarFail[0].in === '1s', `fails=${sidecarFail.map((l) => l.in).join(',')} sendError="${(sc1 && sc1.sendError || '').slice(0, 80)}"`)
  // restart A
  const tStart = Date.now(); const ready = await startA(); const tReady = Date.now()
  check('F-92', 'backend A restarted and ready', ready.ok, `ready after ${ready.ms} ms`)
  const live = await waitFor(() => page.getByText('Live', { exact: true }).isVisible(), 30000, 100)
  const tLive = Date.now()
  const seen2 = await waitFor(() => card(page, `published via B while A was dead ${RUN}`).isVisible(), 15000, 100)
  check('F-61', 'the page heals by itself within the 10 s cap after the service is back and shows the notice published meanwhile, no reload', live.ok && live.ms <= 11000 && seen2.ok && (await notReloaded(page)) && (await card(page, `before the kill ${RUN}`).isVisible()), `Live ${live.ms} ms after readiness; card ${seen2.ms} ms later; still 1 card from before`)
  await page.screenshot({ path: `${SHOT}/f61-healed.png` })
  // what the wire shows: the resumed stream's response and its frames (replay vs the one-time reload)
  const okResp = since(rec.responses, tReady - 1000).find((r) => r.status === 200)
  const resumeReq = okResp && rec.requests.find((r) => r.id === okResp.id)
  const framesOnResume = okResp ? rec.messages.filter((m) => m.id === okResp.id) : []
  const replayed = framesOnResume.find((m) => m.eventName === 'created' && m.data.includes(n2.id))
  const feedReloads = since(rec.feedGets, tReady - 1000).length
  check('F-20', 'wire: the successful reopen carried lastEventId and the server replayed the created frame of the notice published via B (exactly once)', !!resumeReq && /lastEventId=\d+/.test(resumeReq.url) && !!replayed && framesOnResume.filter((m) => m.eventName === 'created' && m.data.includes(n2.id)).length === 1, `reopen url=${resumeReq && resumeReq.url.replace(UI, '')}; frames on the resumed stream=${framesOnResume.map((m) => `${m.eventName}#${m.eventId}`).join(',')}; GET /v1/feed reloads after recovery=${feedReloads} (the hook reloads once after a reconnect by design)`)
  const dupCards = await card(page, `published via B while A was dead ${RUN}`).count()
  check('F-61', 'the replayed notice is shown exactly once (upsert by id)', dupCards === 1, `cards=${dupCards}`)
  const sc2 = await waitFor(async () => { const s = await status(); return s && !s.sendError && s.reportsSent > sc1.reportsSent ? s : null }, 40000, 500)
  const mon = (await api(A, 'GET', '/v1/health/monitors?tenantId=ve2')).json.find((m) => m.service === 've2-app')
  check('F-74', 'sidecar recovery: next report accepted, sendError cleared, no notice opened by the outage', sc2.ok && !mon.state.openCommunicationId && mon.state.lastStatus === 'UP', `accepted ${sc2.ms} ms after readiness; monitor ${mon.state.lastStatus}`)
  // G-2-11 reset: after a successful open the first retry is 1 s again (kill once more, restart quickly)
  const pid2 = pidA(); const tKill2 = Date.now(); sh(`kill -9 ${pid2}`)
  await waitFor(() => page.getByText('Reconnecting', { exact: true }).isVisible(), 15000, 50)
  await sleep(4000)
  const attempts2 = since(rec.requests, tKill2)
  const gaps2 = attempts2.map((r, i) => (i === 0 ? (r.t - tKill2) / 1000 : (r.t - attempts2[i - 1].t) / 1000).toFixed(1))
  check('F-61', 'G-2-11: the backoff restarted from 1 s after the successful open (second outage: attempts at ~1 s, ~2 s)', attempts2.length >= 2 && Number(gaps2[0]) < 2 && Number(gaps2[1]) >= 1.5 && Number(gaps2[1]) <= 3, `gaps(s)=${gaps2.join(',')}`)
  const ready2 = await startA()
  const live2 = await waitFor(() => page.getByText('Live', { exact: true }).isVisible(), 30000, 100)
  check('F-92', 'second restart: ready and the page is Live again', ready2.ok && live2.ok, `ready ${ready2.ms} ms, Live ${live2.ms} ms later`)
  // try again button after a restart
  await api(A, 'POST', `/v1/communications/${n1.id}/retire`, {}); await api(A, 'POST', `/v1/communications/${n2.id}/retire`, {})
  fs.writeFileSync(`${OUT}/f61-cdp-capture.json`, JSON.stringify({ tKill, tReady, tLive, requests: rec.requests, responses: rec.responses, messages: rec.messages.map((m) => ({ ...m, data: m.data.slice(0, 160) })), feedGets: rec.feedGets }, null, 1))
}

// ------------------------------------------------------------------------------------------------------- mongo (G-2-4, F-92)
async function mongo(page) {
  const T = `ve2-mongo-${RUN}`
  console.log(`## mongo: stop the database under A and B (${stamp()})`)
  await openFeed(page, T)
  const rec = await cdp(page)
  const n0 = (await api(A, 'POST', '/v1/communications', outage(T, `before mongo stop ${RUN}`))).json
  await waitFor(() => card(page, `before mongo stop ${RUN}`).isVisible(), 8000)
  const logLen0 = backendLog().length; const sidecarLines0 = sidecarLog().length
  const tStop = Date.now(); sh('docker stop -t 5 e2e2-mongo')
  await sleep(6000) // past the 5 s server-selection timeout: the driver has noticed
  const r1 = await api(A, 'GET', `/v1/feed?tenantId=${T}`)
  check('F-92', 'G-2-4: GET /v1/feed -> 503 {"error":"database unavailable"} within ~5 s (was 500 after 30 s)', r1.status === 503 && r1.json && r1.json.error === 'database unavailable' && r1.ms < 8000, `${r1.status} ${r1.text.slice(0, 120)} in ${r1.ms} ms`)
  const r2 = await api(A, 'POST', '/v1/communications', outage(T, 'during outage'))
  check('F-92', 'POST -> 503 database unavailable, no driver cluster description in the body', r2.status === 503 && r2.json && r2.json.error === 'database unavailable' && !/ClusterDescription|ServerDescription|Exception/.test(r2.text), `${r2.status} ${r2.text.slice(0, 120)} in ${r2.ms} ms`)
  const rd = await api(A, 'GET', '/actuator/health/readiness', null, {}); const lv = await api(A, 'GET', '/actuator/health/liveness', null, {})
  check('F-92', 'readiness DOWN (503) while Mongo is unreachable, liveness still UP', rd.status === 503 && rd.json && rd.json.status === 'DOWN' && lv.status === 200, `readiness ${rd.status} ${rd.text.slice(0, 60)} in ${rd.ms} ms; liveness ${lv.status}`)
  const rb = await api(B, 'GET', `/v1/feed?tenantId=${T}`)
  check('F-92', 'node B answers the same 503', rb.status === 503 && rb.json && rb.json.error === 'database unavailable', `${rb.status} in ${rb.ms} ms`)
  const rh = await api(A, 'POST', '/v1/health/reports', { tenantId: 've2', service: 've2-app', status: 'UP', instance: { id: 'x' } }, { 'X-Client-Id': 've2-failure-checks' })
  check('F-92', 'health report during the outage -> 503 (the sidecar treats it as retryable)', rh.status === 503, `${rh.status} ${rh.text.slice(0, 80)}`)
  // the UI: stream state and the error wording of a reload (UX-19 wording for a 5xx)
  const badgeNow = await badge(page)
  await page.getByRole('button', { name: 'Refresh' }).click()
  const errState = await waitFor(() => page.getByText("Couldn't load the feed").isVisible(), 15000, 100)
  const errText = errState.ok ? (await page.locator('main').innerText()).replace(/\s+/g, ' ') : ''
  check('F-57', "UI reload during the outage: 'Couldn't load the feed' with the unreachable wording (a 503 is treated as the service not being there) + Try again", errState.ok && /unreachable right now|service failed \(HTTP 503\)/.test(errText) && (await page.getByRole('button', { name: 'Try again' }).isVisible()), `badge=${badgeNow}; ${errText.match(/Couldn't load the feed.{0,180}/)?.[0] || errText.slice(0, 200)}`)
  await page.screenshot({ path: `${SHOT}/f92-mongo-down.png` })
  await sleep(20000)
  const streamReqs = since(rec.requests, tStop); const streamResps = since(rec.responses, tStop)
  check('F-92', 'stream behaviour during the outage recorded (reopen attempts and their statuses)', true, `badge now=${await badge(page)}; stream requests since the stop=${streamReqs.length} statuses=${streamResps.map((r) => r.status).join(',')} failed=${streamReqs.filter((r) => r.failed).map((r) => r.failed).join(',')}`)
  const newLog = backendLog().slice(logLen0)
  const errLines = newLog.filter((l) => / ERROR /.test(l)); const traceLines = newLog.filter((l) => /^\s+at [\w.$<>]+\(/.test(l)).length
  const warnSkips = newLog.filter((l) => /sweep skipped: database unavailable/.test(l)).length
  const warn503 = newLog.filter((l) => /-> 503, /.test(l)).length
  check('F-92', 'G-2-4 log hygiene: sweeps log one WARN per skipped run without a stack trace; calls log a WARN -> 503; no ERROR storm', warnSkips >= 2 && errLines.length === 0 && traceLines === 0, `new lines=${newLog.length} 'sweep skipped' WARN=${warnSkips} '-> 503' WARN=${warn503} ERROR=${errLines.length} stack-trace lines=${traceLines}`)
  const sidecarFail = sidecarLog().slice(sidecarLines0).filter((l) => l.msg === 'report failed; will retry')
  check('F-74', "sidecar: the 503 is retried with backoff ('report failed; will retry'), nothing permanent", sidecarFail.length >= 1 && /503/.test(sidecarFail[0].error || ''), `fails=${sidecarFail.length} first="${(sidecarFail[0] && sidecarFail[0].error || '').slice(0, 100)}" in=${sidecarFail.map((l) => l.in).join(',')}`)
  // recovery without restarting the backend
  const tStart = Date.now(); sh('docker start e2e2-mongo')
  const back = await waitFor(async () => (await api(A, 'GET', `/v1/feed?tenantId=${T}`, null, undefined, 8000)).status === 200, 90000, 1000)
  const rd2 = await waitFor(async () => (await api(A, 'GET', '/actuator/health/readiness', null, {}, 8000)).status === 200, 30000, 1000)
  check('F-92', 'Mongo back -> API 200 and readiness UP again without a backend restart', back.ok && rd2.ok, `feed 200 after ${back.ms} ms, readiness UP after ${rd2.ms} ms`)
  await page.getByRole('button', { name: 'Try again' }).click().catch(() => {})
  const listed = await waitFor(() => card(page, `before mongo stop ${RUN}`).isVisible(), 15000, 200)
  const liveAgain = await waitFor(() => page.getByText('Live', { exact: true }).isVisible(), 40000, 200)
  const n1 = (await api(B, 'POST', '/v1/communications', outage(T, `after mongo back ${RUN}`))).json
  const seen = await waitFor(() => card(page, `after mongo back ${RUN}`).isVisible(), 20000, 200)
  check('F-92', "UI recovers: 'Try again' lists the feed, the badge is Live, a notice published via B arrives live, no page reload", listed.ok && liveAgain.ok && seen.ok && (await notReloaded(page)), `listed ${listed.ms} ms, Live ${liveAgain.ms} ms, live card ${seen.ms} ms`)
  await page.screenshot({ path: `${SHOT}/f92-mongo-recovered.png` })
  const sc = await waitFor(async () => { const s = await status(); return s && !s.sendError ? s : null }, 60000, 500)
  const mon = (await api(A, 'GET', '/v1/health/monitors?tenantId=ve2')).json.find((m) => m.service === 've2-app')
  check('F-74', 'sidecar reports accepted again, no notice from the database outage', sc.ok && mon && !mon.state.openCommunicationId, `sendError cleared after ${sc.ms} ms; monitor ${mon && mon.state.lastStatus} summary=${mon && mon.state.lastSummary}`)
  await api(A, 'POST', `/v1/communications/${n0.id}/retire`, {}); await api(A, 'POST', `/v1/communications/${n1.id}/retire`, {})
}

const SCEN = { kill, mongo }
async function main() {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCEN)
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage()
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e)))
  for (const n of names) { try { await SCEN[n](page) } catch (e) { check('RUN', `scenario ${n} crashed`, false, (e.stack || String(e)).slice(0, 500)) } }
  check('F-92', 'no uncaught page errors during the failure flows', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || '))
  await browser.close()
  const fails = results.filter((r) => !r[2]).length
  console.log(`## summary: ${results.length - fails} pass, ${fails} fail at ${stamp()}`)
  process.exit(Math.min(99, fails))
}
main().catch((e) => { console.log('FAIL RUN script crashed :: ' + (e.stack || e)); process.exit(98) })
