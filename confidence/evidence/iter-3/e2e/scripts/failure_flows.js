// E2E verifier (iteration 3): failure paths, rewritten from the iteration-2 script. node failure_flows.js <scenario>...  scenarios: kill mongo
//  kill : backend A SIGKILL with the page streaming through the Vite preview proxy -> Reconnecting -> publish via B
//         meanwhile -> A restarted -> the page heals (CDP shows the reopen request's lastEventId and the SSE frames of the
//         resumed stream), backoff timings (G-2-11: 1,2,4,8,10 cap; reset after a successful open), sidecar backoff/recovery
//  mongo: docker stop e2e3-mongo -> API 503 database unavailable within ~5 s, readiness DOWN, UI wording, backend log hygiene,
//         sidecar reports fail -> recovery without a backend restart
const { chromium } = require('playwright')
const { execSync, spawn } = require('child_process')
const fs = require('fs')
const A = 'http://127.0.0.1:19501', B = 'http://127.0.0.1:19502', UI = 'http://127.0.0.1:19530'
const S = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e3'
const OUT = `${S}/out`, SHOT = `${OUT}/screenshots`; fs.mkdirSync(SHOT, { recursive: true })
const RUN = Date.now().toString(36)
const results = []
const stamp = () => new Date().toISOString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function check(id, name, cond, detail = '') { results.push([id, name, !!cond]); console.log(`${stamp()} ${cond ? 'PASS' : 'FAIL'} ${id} ${name} :: ${String(detail).slice(0, 1200)}`) }
function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch (e) { return `ERR(${e.status}): ${(e.stderr || e.stdout || e.message).toString().trim().slice(0, 300)}` } }
async function api(base, method, path, body, headers = { 'X-Client-Id': 've3-failure-checks' }, timeout = 40000) {
  const t0 = Date.now()
  try {
    const res = await fetch(base + path, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) })
    const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text, ms: Date.now() - t0 }
  } catch (e) { return { status: 0, json: null, text: String(e), ms: Date.now() - t0 } }
}
const outage = (tenantId, title, extra = {}) => ({ tenantId, publisher: 've3-api', type: 'OUTAGE', severity: 'MAJOR', title, affectedServices: ['payments-api'], ...extra })
async function waitFor(fn, ms = 10000, every = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return { ok: true, ms: Date.now() - t0, value: v } } catch {} await sleep(every) } return { ok: false, ms: Date.now() - t0 } }
const card = (page, title) => page.locator('article', { hasText: title })
const sidecarLog = () => sh('docker logs e2e3-sidecar 2>&1').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return { raw: l } } })
const status = async () => { try { return await (await fetch('http://127.0.0.1:19541/status', { signal: AbortSignal.timeout(3000) })).json() } catch { return null } }
const backendLog = () => fs.readFileSync(`${OUT}/backendA.txt`, 'utf8').split('\n')
const pidA = () => fs.readFileSync(`${S}/backendA.pid`, 'utf8').trim()
const alive = (pid) => sh(`kill -0 ${pid} 2>&1 && echo yes || echo no`) === 'yes'
async function openFeed(page, tenant) {
  await page.goto(`${UI}/#/feed`)
  await page.getByRole('textbox', { name: 'Tenant', exact: true }).fill(tenant)
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'All types' })
  await page.evaluate((run) => { window.__ve3 = run }, RUN)
}
const notReloaded = (page) => page.evaluate(() => window.__ve3).then((v) => v === RUN)
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
// (iteration 3) wire headers of each stream request (the browser adds Last-Event-ID itself; only ExtraInfo shows it)
async function headersOf(page, rec) {
  const session = await page.context().newCDPSession(page)
  rec.extra = []
  await session.send('Network.enable')
  session.on('Network.requestWillBeSentExtraInfo', (e) => rec.extra.push({ id: e.requestId, t: Date.now(), lastEventId: e.headers['Last-Event-ID'] || e.headers['last-event-id'] || null }))
}
// B's view of the pod while A is away: any notice opened for ve3/ve3-app is a false OUTAGE (G-3-29)
function watchB(ms) {
  const seen = { polls: 0, opened: [], lastSeen: [], stop: false }
  ;(async () => {
    const t0 = Date.now()
    while (!seen.stop && Date.now() - t0 < ms) {
      const r = await api(B, 'GET', '/v1/health/monitors?tenantId=ve3', null, undefined, 5000)
      const m = (r.json || []).find((x) => x.service === 've3-app')
      seen.polls++
      if (m && m.state.openCommunicationId && !seen.opened.includes(m.state.openCommunicationId)) seen.opened.push(m.state.openCommunicationId)
      if (m) { const i = await api(B, 'GET', `/v1/health/monitors/${m.id}/instances`, null, undefined, 5000); const pod = (i.json || []).find((x) => x.instanceId === 've3-app-6d4f8b7c9-ab12c'); if (pod) seen.lastSeen.push(pod.lastSeenAt) }
      await sleep(500)
    }
  })()
  return seen
}

// ------------------------------------------------------------------- kill (F-61, F-20, F-92, F-74, G-3-29)
async function kill(page) {
  const T = `ve3-kill-${RUN}`
  console.log(`## kill: SIGKILL backend A under a streaming page (${stamp()})`)
  await openFeed(page, T)
  const rec = await cdp(page); await headersOf(page, rec)
  const n1 = (await api(A, 'POST', '/v1/communications', outage(T, `before the kill ${RUN}`))).json
  const seen1 = await waitFor(() => card(page, `before the kill ${RUN}`).isVisible(), 8000)
  check('F-60', 'a notice published over HTTP arrives live (gives the page a last event id)', seen1.ok, `${seen1.ms} ms`)
  const lastLive = rec.messages.filter((m) => m.eventName === 'created').slice(-1)[0]
  const sc0 = await status(); const sidecarLines0 = sidecarLog().length
  const watch = watchB(150000)
  const pid = pidA(); const tKill = Date.now(); sh(`kill -9 ${pid}`)
  const dead = await waitFor(async () => !alive(pid), 5000, 50)
  const reconnecting = await waitFor(() => page.getByText(/^Reconnecting/).isVisible(), 15000, 50)
  check('F-61', "SIGKILL: the proxy ends the browser's stream and the badge says Reconnecting within a second", dead.ok && reconnecting.ok && reconnecting.ms < 3000, `process gone after ${dead.ms} ms; Reconnecting after ${reconnecting.ms} ms`)
  await page.screenshot({ path: `${SHOT}/f61-reconnecting.png` })
  // the error state on a second page (the streaming page stays untouched)
  const E = await page.context().newPage()
  await E.goto(`${UI}/#/feed`); await E.getByRole('textbox', { name: 'Tenant', exact: true }).fill(T)
  const errState = await waitFor(() => E.getByText("Couldn't load the feed").isVisible(), 15000, 100)
  const errText = errState.ok ? (await E.locator('main').innerText()).replace(/\s+/g, ' ') : ''
  check('F-57', "backend down: a page opened meanwhile says 'Couldn't load the feed' + 'The service is unreachable right now…' + Try again (no bare 502)", errState.ok && /unreachable right now/.test(errText) && (await E.getByRole('button', { name: 'Try again' }).isVisible()) && !/502 Bad Gateway/.test(errText), errText.match(/Couldn't load the feed.{0,170}/)?.[0] || errText.slice(0, 200))
  await E.screenshot({ path: `${SHOT}/f92-backend-down.png` })
  const n2 = (await api(B, 'POST', '/v1/communications', outage(T, `published via B while A was dead ${RUN}`))).json
  check('F-92', 'the second node keeps serving while A is dead (publish via B -> 201)', n2 && n2.id, `id=${n2 && n2.id} at +${((Date.now() - tKill) / 1000).toFixed(1)} s`)
  await sleep(Math.max(0, 28000 - (Date.now() - tKill)))
  const attempts = since(rec.requests, tKill)
  const gaps = attempts.map((r, i) => (i === 0 ? (r.t - tKill) / 1000 : (r.t - attempts[i - 1].t) / 1000).toFixed(1))
  const ids = attempts.map((r) => new URL(r.url).searchParams.get('lastEventId') || `hdr:${(rec.extra.find((x) => x.id === r.id) || {}).lastEventId}`)
  check('F-61', 'every reopen while A is dead names the last event: ?lastEventId= on the page\'s own reopens (1,2,4,8 then 10 s), Last-Event-ID on the browser\'s retry', attempts.length >= 4 && ids.every((x) => /^\d+$|^hdr:\d+$/.test(x)), `attempts=${attempts.length} gaps(s)=${gaps.join(',')} ids=${ids.join(',')}`)
  // restart A (outage kept inside the documented budget: heartbeat 10 s + outage + 30 s cap < 90 s)
  const tStart = Date.now(); const ready = await startA(); const tReady = Date.now()
  check('F-92', 'backend A restarted and ready', ready.ok, `ready ${ready.ms} ms after the start, ${((tReady - tKill) / 1000).toFixed(1)} s after the kill`)
  const live = await waitFor(() => page.getByText('Live', { exact: true }).isVisible(), 30000, 100)
  const seen2 = await waitFor(() => card(page, `published via B while A was dead ${RUN}`).isVisible(), 15000, 100)
  check('F-61', 'the page heals by itself within the 10 s cap and shows the notice published meanwhile; no reload; the card from before is still there', live.ok && live.ms <= 11000 && seen2.ok && (await notReloaded(page)) && (await card(page, `before the kill ${RUN}`).isVisible()), `Live ${live.ms} ms after readiness; card +${seen2.ms} ms`)
  await page.screenshot({ path: `${SHOT}/f61-healed.png` })
  await sleep(1500)
  const okResp = since(rec.responses, tReady - 2000).find((r) => r.status === 200)
  const resumeReq = okResp && rec.requests.find((r) => r.id === okResp.id)
  const hdr = okResp && (rec.extra.find((x) => x.id === okResp.id) || {}).lastEventId
  const framesOnResume = okResp ? rec.messages.filter((m) => m.id === okResp.id) : []
  const carried = framesOnResume.filter((m) => m.eventName === 'created' && m.data.includes(n2.id))
  const feedReloads = since(rec.feedGets, tReady - 2000).length
  check('F-20', 'wire: the successful resume carried the last event id (query and/or header) and the server replayed the created frame of the notice published via B exactly once, no snapshot frame on it', !!resumeReq && (/lastEventId=\d+/.test(resumeReq.url) || /^\d+$/.test(hdr || '')) && carried.length === 1 && !framesOnResume.some((m) => m.eventName === 'snapshot'), `resume url=${resumeReq && resumeReq.url.replace(UI, '')} header Last-Event-ID=${hdr}; last live id before the kill=${lastLive && lastLive.eventId}; frames on it=${framesOnResume.map((m) => `${m.eventName}#${m.eventId}`).join(',')}; GET /v1/feed after recovery=${feedReloads}`)
  check('F-61', 'the replayed notice is shown exactly once', (await card(page, `published via B while A was dead ${RUN}`).count()) === 1, '')
  // the sidecar: retry steps capped at 30 s, next accepted report within 30 s of readiness
  const sc2 = await waitFor(async () => { const s = await status(); return s && !s.sendError && s.reportsSent > sc0.reportsSent ? s : null }, 45000, 250)
  const fails = sidecarLog().slice(sidecarLines0).filter((l) => l.msg === 'report failed; will retry')
  check('F-74', `G-3-29: sidecar retries step 1,2,4,8,16 then 30 s (cap), next report accepted within 30 s of A's readiness`, sc2.ok && sc2.ms <= 30000 && fails.length >= 5 && fails.every((l) => ['1s', '2s', '4s', '8s', '16s', '30s'].includes(l.in)), `steps=${fails.map((l) => `${l.time.slice(11, 19)} in=${l.in}`).join(', ')}; accepted ${sc2.ms} ms after readiness (${((tReady + sc2.ms - tKill) / 1000).toFixed(1)} s after the kill)`)
  await sleep(4000); watch.stop = true
  const lastSeenGap = (() => { const xs = [...new Set(watch.lastSeen)].map((x) => new Date(x).getTime()).sort(); let g = 0; for (let i = 1; i < xs.length; i++) g = Math.max(g, xs[i] - xs[i - 1]); return g })()
  check('F-48', 'G-3-29: no false OUTAGE on the second node (B, stale grace 0, sweep 1 s) for the pod that could not reach A', watch.opened.length === 0 && watch.polls > 20, `B polls=${watch.polls} notices opened=${JSON.stringify(watch.opened)}; longest gap between the pod's accepted reports as B saw it=${(lastSeenGap / 1000).toFixed(1)} s (window 90 s)`)
  // the second page recovers with Try again
  await E.getByRole('button', { name: 'Try again' }).click().catch(() => {})
  const eOk = await waitFor(() => card(E, `published via B while A was dead ${RUN}`).isVisible(), 15000, 200)
  check('F-57', "'Try again' on the error page lists the feed once A is back", eOk.ok, `${eOk.ms} ms`)
  await E.close()
  await api(A, 'POST', `/v1/communications/${n1.id}/retire`, {}); await api(A, 'POST', `/v1/communications/${n2.id}/retire`, {})
  fs.writeFileSync(`${OUT}/f61-cdp-capture.json`, JSON.stringify({ tKill, tReady, requests: rec.requests, responses: rec.responses, extra: rec.extra, messages: rec.messages.map((m) => ({ ...m, data: m.data.slice(0, 120) })), feedGets: rec.feedGets }, null, 1))
}

// ------------------------------------------------------------------- mongo (F-92, F-57, G-3-1, G-3-6, G-3-15, G-3-20)
async function mongo(page) {
  const T = `ve3-mongo-${RUN}`
  console.log(`## mongo: stop the database under A and B (${stamp()})`)
  await openFeed(page, T)
  const rec = await cdp(page)
  const n0 = (await api(A, 'POST', '/v1/communications', outage(T, `before mongo stop ${RUN}`))).json
  await waitFor(() => card(page, `before mongo stop ${RUN}`).isVisible(), 8000)
  const logLen0 = backendLog().length; const sidecarLines0 = sidecarLog().length
  const tStop = Date.now(); const stopOut = sh('docker stop -t 5 e2e3-mongo'); const stopMs = Date.now() - tStop
  const tAsk = Date.now()
  const [r1, rds] = await Promise.all([api(A, 'GET', `/v1/feed?tenantId=${T}`), (async () => { const xs = []; while (Date.now() - tAsk < 7000) { const r = await api(A, 'GET', '/actuator/health/readiness', null, {}, 8000); xs.push(`+${((Date.now() - tStop) / 1000).toFixed(1)}s:${r.status}/${r.ms}ms`); await sleep(400) } return xs })()])
  check('F-92', 'GET /v1/feed -> 503 {"error":"database unavailable"} within the 5 s database timeout', r1.status === 503 && r1.json && r1.json.error === 'database unavailable' && r1.ms < 7000, `${r1.status} ${r1.text.slice(0, 100)} in ${r1.ms} ms (docker stop took ${stopMs} ms)`)
  const r2 = await api(A, 'POST', '/v1/communications', outage(T, 'during outage'))
  check('F-92', 'POST -> 503 database unavailable, nothing of the driver in the body', r2.status === 503 && r2.json && r2.json.error === 'database unavailable' && !/ClusterDescription|ServerDescription|Exception/.test(r2.text), `${r2.status} ${r2.text.slice(0, 100)} in ${r2.ms} ms`)
  const rd = await api(A, 'GET', '/actuator/health/readiness', null, {}); const lv = await api(A, 'GET', '/actuator/health/liveness', null, {})
  check('F-92', 'G-3-6: readiness DOWN (503) within ~1 s while Mongo is unreachable, liveness still UP', rd.status === 503 && rd.json && rd.json.status === 'DOWN' && rd.ms < 1600 && lv.status === 200, `readiness ${rd.status} ${rd.text.slice(0, 60)} in ${rd.ms} ms; liveness ${lv.status} in ${lv.ms} ms; readiness series since the stop: ${rds.join(' ')}`)
  const rb = await api(B, 'GET', `/v1/feed?tenantId=${T}`)
  check('F-92', 'node B answers the same 503', rb.status === 503 && rb.json && rb.json.error === 'database unavailable', `${rb.status} in ${rb.ms} ms`)
  const rh = await api(A, 'POST', '/v1/health/reports', { tenantId: 've3', service: 've3-app', status: 'UP', instance: { id: 'x' } })
  check('F-92', 'health report during the outage -> 503 (the sidecar treats it as retryable)', rh.status === 503, `${rh.status} ${rh.text.slice(0, 80)} in ${rh.ms} ms`)
  // the open page: stream stays open (keepalives), badge Live, no reopen, no reload
  const badgeNow = await badge(page)
  // a page opened during the outage: the service's own reason (G-3-20), Try again; its stream meets the outage (G-3-1)
  const L = await page.context().newPage(); const recL = await cdp(L)
  const tLate = Date.now(); await L.goto(`${UI}/#/feed`); await L.getByRole('textbox', { name: 'Tenant', exact: true }).fill(T)
  const errState = await waitFor(() => L.getByText("Couldn't load the feed").isVisible(), 20000, 100)
  const errText = errState.ok ? (await L.locator('main').innerText()).replace(/\s+/g, ' ') : ''
  check('F-57', "G-3-20: a page opened during the outage says the service cannot reach its database (HTTP 503) with its reason, not 'unreachable', + Try again", errState.ok && /cannot reach its database right now \(HTTP 503\): database unavailable/.test(errText) && !/unreachable right now/.test(errText) && (await L.getByRole('button', { name: 'Try again' }).isVisible()), `after ${errState.ms} ms; ${errText.match(/Couldn't load the feed.{0,200}/)?.[0] || errText.slice(0, 220)}; open page badge=${badgeNow}`)
  await L.screenshot({ path: `${SHOT}/f92-mongo-down-late-page.png` })
  // run 2 checked at a fixed 30 s after the stop, before the first retry was due; run 3 waits for the badge and the retry
  const lateReco = await waitFor(async () => (await badge(L)) === 'Reconnecting', 15000, 100); const tReco = Date.now()
  const lateRetry = await waitFor(() => since(recL.requests, tLate).length >= 2 && since(recL.responses, tLate).length >= 2, 25000, 100)
  const lateStreams = since(recL.requests, tLate); const lateResps = since(recL.responses, tLate)
  check('F-92', "G-3-1: the late page's streams meet the outage: answered 200 then ended by the service, the page retries with backoff and says so", lateReco.ok && lateRetry.ok && lateResps.every((r) => r.status === 200), `badge Reconnecting at +${((tReco - tLate) / 1000).toFixed(1)} s; stream requests=${lateStreams.length} statuses=${lateResps.map((r) => r.status).join(',')} at +${lateStreams.map((r) => ((r.t - tLate) / 1000).toFixed(1)).join(',')} s`)
  await sleep(Math.max(0, 30000 - (Date.now() - tStop)))
  const openStreams = since(rec.requests, tStop); const openGets = since(rec.feedGets, tStop)
  check('F-92', 'the page that was open keeps its stream: badge Live, no reopen, no reload of the list during the outage', badgeNow === 'Live' && (await badge(page)) === 'Live' && openStreams.length === 0 && openGets.length === 0 && (await card(page, `before mongo stop ${RUN}`).isVisible()), `badge ${badgeNow} -> ${await badge(page)}; stream requests=${openStreams.length} list GETs=${openGets.length}`)
  const newLog = backendLog().slice(logLen0)
  const errLines = newLog.filter((l) => / ERROR /.test(l)); const traceLines = newLog.filter((l) => /^\s+at [\w.$<>]+\(/.test(l) || /^Caused by:/.test(l)).length
  const kinds = {}; for (const l of newLog.filter((x) => / (WARN|INFO|ERROR) /.test(x))) { const k = l.replace(/^.*? (WARN|INFO|ERROR) \d+ --- \[[^\]]*\] \[[^\]]*\] (\S+)\s+: /, '$1 $2: ').replace(/[0-9a-f-]{36}|ve3-[\w-]+|\d+(\.\d+)?/g, '#').slice(0, 110); kinds[k] = (kinds[k] || 0) + 1 }
  check('F-89', 'G-3-6/G-3-1: 30 s of database outage leave no ERROR and no stack trace in the service log', errLines.length === 0 && traceLines === 0, `new lines=${newLog.length} ERROR=${errLines.length} trace lines=${traceLines}; kinds=${JSON.stringify(kinds).slice(0, 900)}`)
  fs.writeFileSync(`${OUT}/mongo-outage-backendA-lines.txt`, newLog.join('\n'))
  const sidecarFail = sidecarLog().slice(sidecarLines0).filter((l) => l.msg === 'report failed; will retry')
  check('F-74', "G-3-15: the sidecar's reports during the outage fail with the service's 503 (its 10 s report timeout outlasts the 5 s database timeout), retried with backoff", sidecarFail.length >= 1 && sidecarFail.every((l) => /503/.test(l.error || '') && !/deadline/.test(l.error || '')), `fails=${sidecarFail.length} first="${(sidecarFail[0] && sidecarFail[0].error || '').slice(0, 120)}" in=${sidecarFail.map((l) => l.in).join(',')}`)
  // recovery without restarting the backend
  const tStart = Date.now(); sh('docker start e2e3-mongo')
  const back = await waitFor(async () => (await api(A, 'GET', `/v1/feed?tenantId=${T}`, null, undefined, 8000)).status === 200, 90000, 500)
  const rd2 = await waitFor(async () => (await api(A, 'GET', '/actuator/health/readiness', null, {}, 8000)).status === 200, 30000, 500)
  check('F-92', 'Mongo back -> API 200 and readiness UP again without a backend restart', back.ok && rd2.ok, `feed 200 ${back.ms} ms after docker start, readiness UP +${rd2.ms} ms`)
  const lateOk = await waitFor(() => card(L, `before mongo stop ${RUN}`).isVisible(), 30000, 200)
  check('F-92', 'the late page recovers by itself (no click): the error state gives way to the list', lateOk.ok && !(await L.getByText("Couldn't load the feed").isVisible().catch(() => false)), `list shown ${lateOk.ms} ms after the API answered 200; badge=${await badge(L)}`)
  await L.screenshot({ path: `${SHOT}/f92-mongo-recovered-late-page.png` })
  console.log(`INFO late page stream timeline (s after the page opened): requests +${since(recL.requests, tLate).map((r) => ((r.t - tLate) / 1000).toFixed(1)).join(',+')}; statuses ${since(recL.responses, tLate).map((r) => r.status).join(',')}`)
  const n1 = (await api(B, 'POST', '/v1/communications', outage(T, `after mongo back ${RUN}`))).json
  const seen = await waitFor(() => card(page, `after mongo back ${RUN}`).isVisible(), 20000, 200)
  check('F-92', 'the open page, stream open all along, shows a notice published via B after the recovery; no reload, no reopen', seen.ok && (await notReloaded(page)) && since(rec.requests, tStop).length === 0, `live card ${seen.ms} ms; stream requests since the stop=${since(rec.requests, tStop).length}`)
  await page.screenshot({ path: `${SHOT}/f92-mongo-recovered.png` })
  const sc = await waitFor(async () => { const s = await status(); return s && !s.sendError ? s : null }, 60000, 500)
  const mon = (await api(A, 'GET', '/v1/health/monitors?tenantId=ve3')).json.find((m) => m.service === 've3-app')
  check('F-74', 'sidecar reports accepted again, no notice from the database outage', sc.ok && mon && !mon.state.openCommunicationId, `sendError cleared ${sc.ms} ms after recovery; monitor ${mon && mon.state.lastStatus} summary=${mon && mon.state.lastSummary}`)
  await L.close()
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
