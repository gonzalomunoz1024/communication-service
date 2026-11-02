// Phase 2 of v4 as its own run (v4 crashed in its own arithmetic after the second kill: the browser's own retry reuses the current
// EventSource URL, which already carries ?lastEventId=, so "the first client attempt" cannot be told apart by the query alone;
// here the browser's retry is the request that carries the Last-Event-ID header on the wire, read through CDP).
// Backend A (:19200) behind my Vite dev server :3200; instance B (:19201, same Mongo db) publishes while A is down.
// Checks: backoff restarts from 1 s after a successful open (G-2-11); the reopen that reaches the restarted service carries
// ?lastEventId=<last seq> (page.waitForRequest) and the missed events arrive as replayed frames, no snapshot (F-20/F-61);
// exactly one list reload; HTTP-level replay; non-numeric ids.
const fs = require('fs'); const { execSync, spawn } = require('child_process')
const PORT = 19200, PORT_B = 19201
process.env.UI = 'http://127.0.0.1:3200'; process.env.API = `http://127.0.0.1:${PORT}`
const L = require('./lib'); const { record, api, publishBody, newPage } = L
L.setFile('v4c-reconnect-phase2')
const RUN = Date.now().toString(36); const tenant = `vf2-reconnect2-${RUN}`
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter2.jar'
const LOGS = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend2/logs'
const javaPid = (port) => { try { return execSync(`ps -eo pid,args | grep "[s]erver.port=${port}" | awk '{print $1}' | head -1`).toString().trim() } catch { return '' } }
async function waitBackend(base, up, ms = 120000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${base}/v1/feed?tenantId=x`, { headers: { 'X-Client-Id': 'vf2-verifier' } }); if (up && r.status === 200) return true } catch { if (!up) return true } await L.wait(250) } return false }
function startBackend(port) { const out = fs.openSync(`${LOGS}/backend-${port}.txt`, 'a'); const c = spawn('java', ['-jar', JAR, `--server.port=${port}`, '--spring.data.mongodb.uri=mongodb://localhost:27017/vf2_reconnect', '--communication.servicenow.instance-url=https://vf2.service-now.com', '--communication.sweep.interval-ms=2000', '--communication.health.sweep-interval-ms=1000'], { detached: true, stdio: ['ignore', out, out] }); c.unref() }
const apiB = (method, p, body) => api(method, p, body, {}, `http://127.0.0.1:${PORT_B}`)
const sseTitle = (d) => { const m = /"title":"([^"]*)"/.exec(d); return m ? m[1] : '' }
const r1 = (n) => Math.round(n * 10) / 10

;(async () => {
  const browser = await L.launch()
  const T0 = Date.now(); const tl = []; const log = (m) => { tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`) }
  const sse = []; const streamReqs = []; const indHist = []; const raw = []
  let poll
  try {
    if (!javaPid(PORT_B)) { startBackend(PORT_B); log(`started instance B on :${PORT_B}`) }
    if (!javaPid(PORT)) { startBackend(PORT); log('started instance A') }
    log('instance A up: ' + (await waitBackend(process.env.API, true)))
    log('instance B up: ' + (await waitBackend(`http://127.0.0.1:${PORT_B}`, true)))
    const { context, page } = await newPage(browser)
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable')
    cdp.on('Network.eventSourceMessageReceived', (e) => { sse.push({ at: Date.now(), name: e.eventName, id: e.eventId, title: sseTitle(e.data) }); log(`SSE frame ${e.eventName} id=${e.eventId} ${sseTitle(e.data)}`) })
    const pend = new Map()
    const noteRaw = (id) => { const p = pend.get(id); if (p && p.url && p.headers) { const lei = p.headers['Last-Event-ID'] || p.headers['last-event-id'] || null; raw.push({ at: Date.now(), q: new URL(p.url).searchParams.get('lastEventId'), wireLastEventId: lei }); log(`CDP wire: stream request ?lastEventId=${new URL(p.url).searchParams.get('lastEventId') ?? '(none)'} Last-Event-ID header=${lei ?? '(none)'}`); pend.delete(id) } }
    cdp.on('Network.requestWillBeSent', (e) => { if (e.request.url.includes('/v1/feed/stream')) { pend.set(e.requestId, { ...(pend.get(e.requestId) || {}), url: e.request.url }); noteRaw(e.requestId) } })
    cdp.on('Network.requestWillBeSentExtraInfo', (e) => { pend.set(e.requestId, { ...(pend.get(e.requestId) || {}), headers: e.headers }); noteRaw(e.requestId) })
    page.on('request', (r) => { if (r.url().includes('/v1/feed/stream')) { const u = new URL(r.url()); const rec = { at: Date.now(), q: u.searchParams.get('lastEventId'), status: null }; streamReqs.push(rec); log(`stream REQUEST #${streamReqs.length} ?lastEventId=${rec.q ?? '(none)'}`) } })
    page.on('response', (r) => { if (r.url().includes('/v1/feed/stream')) { const rec = streamReqs[streamReqs.length - 1]; if (rec) rec.status = r.status(); log(`stream RESPONSE ${r.status()}`) } })
    page.on('requestfailed', (r) => { if (r.url().includes('/v1/feed/stream')) { const rec = streamReqs[streamReqs.length - 1]; if (rec && rec.status === null) rec.status = 'failed:' + ((r.failure() || {}).errorText); log(`stream REQUEST FAILED ${(r.failure() || {}).errorText}`) } })
    let lastInd = ''
    poll = setInterval(async () => { try { const s = await L.indicator(page, 300); if (s !== lastInd && s !== '?') { log(`badge → ${s}`); indHist.push({ at: Date.now(), s }); lastInd = s } } catch {} }, 150)

    const seed = await api('POST', '/v1/communications', publishBody(tenant, { title: 'before the drop' }))
    await L.gotoFeed(page, tenant, { allTypes: true })
    await page.waitForSelector('article h3:has-text("before the drop")')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    await L.wait(1000)
    const lastSeq = Math.max(...sse.map((f) => Number(f.id)).filter((n) => !isNaN(n)))
    const pid = javaPid(PORT); execSync(`kill -9 ${pid}`); const tKill = Date.now(); log(`SIGKILL instance A (pid ${pid}); last SSE id seen ${lastSeq}`)
    await waitBackend(process.env.API, false, 20000)
    await L.wait(1200)
    const missed = await apiB('POST', '/v1/communications', publishBody(tenant, { title: 'missed while down' }))
    const retired = await apiB('POST', `/v1/communications/${seed.json.id}/retire`, { actor: 'vf2-verifier', note: 'retired while A was down' })
    log(`through instance B: publish 'missed while down' → ${missed.status}, retire 'before the drop' → ${retired.status}`)
    await L.wait(11000) // run 1 sampled at kill+8.8 s, before the third client attempt (kill+10.1 s); the window now covers it
    const during = streamReqs.filter((r) => r.at > tKill)
    const browserRetry = raw.find((r) => r.at > tKill && r.wireLastEventId !== null)
    const first = during[0]; const client = during.slice(1)
    const firstClientDelay = first && client[0] ? r1((client[0].at - first.at) / 1000) : null
    const gaps = client.slice(1).map((r, i) => r1((r.at - client[i].at) / 1000))
    record('F-61', "G-2-11: after a successful open the backoff starts again from 1 s: the browser's own retry (~3 s, Last-Event-ID header on the wire) fails with 502, then the client's attempts come 1, 2, 4 s apart, not from the 10 s cap", browserRetry && browserRetry.wireLastEventId === String(lastSeq) && firstClientDelay !== null && Math.abs(firstClientDelay - 1) <= 0.7 && gaps.length >= 2 && Math.abs(gaps[0] - 2) <= 0.7 && Math.abs(gaps[1] - 4) <= 0.7, { browserRetryHeader: browserRetry && browserRetry.wireLastEventId, firstClientDelay, gapsBetweenClientAttempts: gaps, attempts: during.map((r) => ({ t: r1((r.at - tKill) / 1000), q: r.q, status: r.status })) })
    record('F-20', `G-2-11: every client attempt during the outage carries ?lastEventId=${lastSeq}`, client.length >= 3 && client.every((r) => r.q === String(lastSeq)), client.map((r) => r.q))
    startBackend(PORT); log('restarting instance A')
    const reachedP = page.waitForRequest((r) => r.url().includes('/v1/feed/stream') && r.timing !== undefined && false, { timeout: 1 }).catch(() => null)
    log('A up again: ' + (await waitBackend(process.env.API, true)))
    const tUp = Date.now()
    const reached = await page.waitForRequest((r) => r.url().includes('/v1/feed/stream'), { timeout: 15000 }).then((r) => ({ q: new URL(r.url()).searchParams.get('lastEventId'), url: r.url().replace(process.env.UI, '') })).catch(() => null)
    void reachedP
    const live = await page.waitForSelector('text=/^Live$/', { timeout: 40000 }).then(() => true).catch(() => false)
    log(`badge Live again: ${live}`)
    const missedShown = await page.waitForSelector('article h3:has-text("missed while down")', { timeout: 15000 }).then(() => true).catch(() => false)
    const retiredGone = await page.waitForSelector('article h3:has-text("before the drop")', { state: 'detached', timeout: 15000 }).then(() => true).catch(() => false)
    await L.wait(3000)
    const framesAfter = sse.filter((f) => f.at > tUp)
    const replayedCreated = framesAfter.find((f) => f.name === 'created' && f.title === 'missed while down')
    const replayedRetired = framesAfter.find((f) => f.name === 'retired' && f.title === 'before the drop')
    const open = streamReqs.filter((r) => r.at > tKill && r.status === 200).slice(-1)[0]
    const feedReloads = page.cap.requests.filter((r) => r.method === 'GET' && /\/v1\/feed\?/.test(r.url) && open && r.at >= open.at - 200).length
    record('F-61', 'a notice published through another instance while A was down appears after the reconnect, and one retired meanwhile disappears, without a manual refresh; the list is reloaded exactly once', missed.status === 201 && retired.status === 200 && live && missedShown && retiredGone && feedReloads === 1, { live, missedShown, retiredGone, feedReloadsAfterRecovery: feedReloads })
    record('F-20', `G-2-11/GAP-frontend1-2 closed: the reopen that reached the restarted service carried ?lastEventId=${lastSeq} (page.waitForRequest) and the missed events arrived as REPLAYED frames (created 'missed while down', retired 'before the drop', ids > ${lastSeq}), with no snapshot frame`, reached && reached.q === String(lastSeq) && replayedCreated && Number(replayedCreated.id) > lastSeq && replayedRetired && Number(replayedRetired.id) > Number(replayedCreated.id) && !framesAfter.some((f) => f.name === 'snapshot'), { reached, framesAfterRecovery: framesAfter.map((f) => `${f.name}#${f.id} ${f.title}`) })
    const rawStream = await new Promise((resolve) => { const ctl = new AbortController(); const chunks = []; fetch(`${process.env.API}/v1/feed/stream?tenantId=${tenant}&lastEventId=${lastSeq}`, { headers: { 'X-Client-Id': 'vf2-verifier' }, signal: ctl.signal }).then(async (r) => { const reader = r.body.getReader(); const dec = new TextDecoder(); const t = setTimeout(() => ctl.abort(), 3000); try { while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(dec.decode(value)) } } catch {} clearTimeout(t); resolve(chunks.join('')) }).catch(() => resolve(chunks.join(''))) })
    const names = [...rawStream.matchAll(/^event: ?(\w+)$/gm)].map((m) => m[1]); const ids = [...rawStream.matchAll(/^id: ?(\d+)$/gm)].map((m) => Number(m[1]))
    record('F-20', `GET /v1/feed/stream?lastEventId=${lastSeq} on the restarted instance replays what was missed (created, retired), no snapshot frames, ids ascending and > ${lastSeq}`, names.length >= 2 && !names.includes('snapshot') && names.includes('created') && names.includes('retired') && ids.every((i) => i > lastSeq) && ids.every((v, i) => i === 0 || v > ids[i - 1]), { names, ids, raw: rawStream.slice(0, 600) })
    const hdr = await new Promise((resolve) => { const ctl = new AbortController(); const chunks = []; fetch(`${process.env.API}/v1/feed/stream?tenantId=${tenant}`, { headers: { 'X-Client-Id': 'vf2-verifier', 'Last-Event-ID': 'not-a-number' }, signal: ctl.signal }).then(async (r) => { const reader = r.body.getReader(); const dec = new TextDecoder(); const t = setTimeout(() => ctl.abort(), 2000); try { while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(dec.decode(value)) } } catch {} clearTimeout(t); resolve({ status: r.status, body: chunks.join('') }) }).catch((e) => resolve({ status: 0, body: String(e) })) })
    const hdrNames = [...hdr.body.matchAll(/^event: ?(\w+)$/gm)].map((m) => m[1])
    const badQ = await api('GET', `/v1/feed/stream?tenantId=${tenant}&lastEventId=abc`)
    record('F-20', 'a non-numeric Last-Event-ID header is ignored (200, fresh snapshot); a non-numeric ?lastEventId= is a 400 — the client only ever sends numbers', hdr.status === 200 && hdrNames.includes('snapshot') && badQ.status === 400, { headerCase: { status: hdr.status, names: hdrNames.slice(0, 3) }, queryCase: { status: badQ.status, error: badQ.json && badQ.json.error } })
    record('F-61', 'no page errors during the crash (the browser\'s own "Failed to load resource" console lines for the refused requests are expected)', page.cap.errors.length === 0, { pageErrors: page.cap.errors, consoleErrors: page.cap.console.filter((c) => c.type === 'error').length })
    await context.close()
  } catch (e) {
    log('SCRIPT ERROR ' + e.message); console.error(e)
  } finally {
    clearInterval(poll)
    if (!javaPid(PORT)) { startBackend(PORT); tl.push('instance A restarted for the later scripts') }
    const R = `${__dirname}/../results`; fs.mkdirSync(R, { recursive: true })
    fs.writeFileSync(`${R}/v4c-reconnect-phase2-timeline.txt`, tl.join('\n') + '\n')
    fs.writeFileSync(`${R}/v4c-sse-frames.json`, JSON.stringify(sse, null, 1))
    await browser.close()
    L.flush()
  }
})()
