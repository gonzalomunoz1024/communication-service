// F-61 / F-20 / G-2-11 in the browser: my own backend A (:19200, Mongo db vf2_reconnect) behind my own Vite dev server (:3200,
// whose proxy ends the browser's response when the upstream dies). Phase 1: SIGKILL A while the feed is Live and leave it down
// ~52 s, so the client's own reopen attempts show the 1, 2, 4, 8, 10, 10 s backoff (cap 10 s), each carrying ?lastEventId=;
// restart A → Live by itself. Phase 2: kill A again right away (backoff must start from 1 s again), publish through instance B
// (:19201, same db) meanwhile, restart A → the missed notice must arrive through a replayed `created` frame (no snapshot).
// SSE frames via CDP (Network.eventSourceMessageReceived), the wire headers via Network.requestWillBeSentExtraInfo, the
// reopen requests via page.waitForRequest / page.on('request').
const fs = require('fs'); const { execSync, spawn } = require('child_process')
const PORT = 19200, PORT_B = 19201
process.env.UI = 'http://127.0.0.1:3200'; process.env.API = `http://127.0.0.1:${PORT}`
const L = require('./lib'); const { record, api, publishBody, newPage } = L
L.setFile('v4-reconnect')
const RUN = Date.now().toString(36); const tenant = `vf2-reconnect-${RUN}`
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

    // ---- phase 1: crash, 52 s down, restart ----
    const seed = await api('POST', '/v1/communications', publishBody(tenant, { title: 'before the drop' }))
    await L.gotoFeed(page, tenant, { allTypes: true })
    await page.waitForSelector('article h3:has-text("before the drop")')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    log('feed Live with one item')
    record('F-61', 'feed is Live before the crash; the first stream request carries no ?lastEventId (fresh subscription)', streamReqs.length >= 1 && streamReqs[0].q === null, streamReqs)
    const lastSeq1 = Math.max(...sse.map((f) => Number(f.id)).filter((n) => !isNaN(n)))
    const pidA = javaPid(PORT); execSync(`kill -9 ${pidA}`); const tKill = Date.now(); log(`SIGKILL instance A (pid ${pidA}); last SSE id seen ${lastSeq1}`)
    log('A down: ' + (await waitBackend(process.env.API, false, 20000)))
    await L.wait(52000)
    const during = streamReqs.filter((r) => r.at > tKill)
    const gaps = during.slice(1).map((r, i) => r1((r.at - during[i].at) / 1000))
    const badgesDuring = indHist.filter((h) => h.at > tKill).map((h) => h.s)
    const clientAttempts = during.filter((r) => r.q !== null)
    const clientGaps = clientAttempts.slice(1).map((r, i) => r1((r.at - clientAttempts[i].at) / 1000))
    const expected = [2, 4, 8, 10, 10, 10]
    const gapsOk = clientGaps.length >= 6 && expected.every((e, i) => Math.abs(clientGaps[i] - e) <= 0.7)
    record('F-61', "G-2-11: while the service is down the client's reopen attempts are spaced 1, 2, 4, 8, 10, 10, 10 s (gaps between consecutive attempts ≈ 2, 4, 8, 10, 10, 10; cap 10 s, not 30 s)", gapsOk, { gapsBetweenClientAttempts: clientGaps, expectedGaps: expected, allStreamRequestGaps: gaps, attempts: during.map((r) => ({ t: r1((r.at - tKill) / 1000), q: r.q, status: r.status })) })
    record('F-61', "G-2-11: the badge shows 'Reconnecting' then 'Reconnecting (1)' … '(7)' for the client's own attempts", badgesDuring.includes('Reconnecting') && [1, 2, 3, 4, 5, 6, 7].every((n) => badgesDuring.includes(`Reconnecting (${n})`)), badgesDuring)
    record('F-20', `G-2-11: EVERY client reopen attempt, failed ones included, carries ?lastEventId=${lastSeq1} (the last id seen); the browser's own first retry carries the Last-Event-ID header instead`, clientAttempts.length >= 6 && clientAttempts.every((r) => r.q === String(lastSeq1)) && raw.some((r) => r.at > tKill && r.wireLastEventId === String(lastSeq1)), { clientAttemptQueries: clientAttempts.map((r) => r.q), wireHeaders: raw.filter((r) => r.at > tKill).slice(0, 3) })
    startBackend(PORT); log('restarting instance A')
    log('A up again: ' + (await waitBackend(process.env.API, true)))
    const tUp = Date.now()
    const live = await page.waitForSelector('text=/^Live$/', { timeout: 40000 }).then(() => true).catch(() => false)
    const liveAfter = r1((Date.now() - tUp) / 1000)
    log(`badge Live again: ${live} (${liveAfter} s after A answered)`)
    record('F-61', 'G-2-11: after the restart the badge returns to Live by itself within the 10 s cap (plus one attempt)', live && liveAfter <= 11, { secondsAfterBackendUp: liveAfter, badges: indHist.filter((h) => h.at > tKill).map((h) => h.s) })
    const recovery1 = streamReqs.filter((r) => r.at > tUp - 11000 && r.status === 200).slice(-1)[0]
    const framesAfterUp = sse.filter((f) => f.at > tUp)
    record('F-20', 'the attempt that reached the restarted service was a resume (?lastEventId=<last id>) and, nothing having happened meanwhile, it delivered no snapshot and no replayed frame (the list was reloaded once by the hook)', recovery1 && recovery1.q === String(lastSeq1) && !framesAfterUp.some((f) => f.name === 'snapshot'), { recoveryRequest: recovery1, framesAfterRecovery: framesAfterUp.map((f) => `${f.name}#${f.id} ${f.title}`) })
    const afterRestart = await api('POST', '/v1/communications', publishBody(tenant, { title: 'published after the restart' }))
    const seen = await page.waitForSelector('article h3:has-text("published after the restart")', { timeout: 10000 }).then(() => true).catch(() => false)
    record('F-61', 'a notice published after the restart arrives live', afterRestart.status === 201 && seen, { status: afterRestart.status, frames: sse.filter((f) => f.title === 'published after the restart').map((f) => `${f.name}#${f.id}`) })

    // ---- phase 2: crash again at once (backoff must restart from 1 s), publish + retire through B, restart → replay ----
    await L.wait(1500)
    const lastSeq2 = Math.max(...sse.map((f) => Number(f.id)).filter((n) => !isNaN(n)))
    const pid2 = javaPid(PORT); execSync(`kill -9 ${pid2}`); const tKill2 = Date.now(); log(`SIGKILL instance A again (pid ${pid2}); last SSE id seen ${lastSeq2}`)
    await waitBackend(process.env.API, false, 20000)
    await L.wait(1500)
    const missed = await apiB('POST', '/v1/communications', publishBody(tenant, { title: 'missed while down' }))
    const retired = await apiB('POST', `/v1/communications/${seed.json.id}/retire`, { actor: 'vf2-verifier', note: 'retired while A was down' })
    log(`through instance B: publish 'missed while down' → ${missed.status}, retire 'before the drop' → ${retired.status}`)
    await L.wait(6000)
    const during2 = streamReqs.filter((r) => r.at > tKill2)
    const client2 = during2.filter((r) => r.q !== null)
    const firstClientDelay = client2.length >= 1 && during2.length >= 2 ? r1((client2[0].at - during2[during2.indexOf(client2[0]) - 1].at) / 1000) : null
    const gaps2 = client2.slice(1).map((r, i) => r1((r.at - client2[i].at) / 1000))
    record('F-61', "G-2-11: after a successful open the backoff starts again from 1 s (second outage: the client's first attempt comes ~1 s after the browser's retry failed, then 2, 4 s), not from the 10 s cap", firstClientDelay !== null && Math.abs(firstClientDelay - 1) <= 0.7 && gaps2.length >= 2 && Math.abs(gaps2[0] - 2) <= 0.7 && Math.abs(gaps2[1] - 4) <= 0.7, { firstClientDelay, gaps2, attempts: during2.map((r) => ({ t: r1((r.at - tKill2) / 1000), q: r.q, status: r.status })) })
    startBackend(PORT); log('restarting instance A')
    const resumeReqP = page.waitForRequest((r) => r.url().includes('/v1/feed/stream') && new URL(r.url()).searchParams.get('lastEventId') === String(lastSeq2) && r.timing && false, { timeout: 1 }).catch(() => null)
    log('A up again: ' + (await waitBackend(process.env.API, true)))
    const tUp2 = Date.now()
    // the next reopen attempt is the one that reaches the restarted service: read it from the wire with page.waitForRequest
    const reached = await page.waitForRequest((r) => r.url().includes('/v1/feed/stream'), { timeout: 15000 }).then((r) => ({ q: new URL(r.url()).searchParams.get('lastEventId'), url: r.url() })).catch(() => null)
    void resumeReqP
    const live2 = await page.waitForSelector('text=/^Live$/', { timeout: 40000 }).then(() => true).catch(() => false)
    log(`badge Live again: ${live2}`)
    const missedShown = await page.waitForSelector('article h3:has-text("missed while down")', { timeout: 15000 }).then(() => true).catch(() => false)
    const retiredGone = await page.waitForSelector('article h3:has-text("before the drop")', { state: 'detached', timeout: 15000 }).then(() => true).catch(() => false)
    await L.wait(2500)
    const framesAfter = sse.filter((f) => f.at > tUp2)
    const replayedCreated = framesAfter.find((f) => f.name === 'created' && f.title === 'missed while down')
    const replayedRetired = framesAfter.find((f) => f.name === 'retired' && f.title === 'before the drop')
    const feedReloads = page.cap.requests.filter((r) => r.method === 'GET' && /\/v1\/feed\?/.test(r.url) && r.at > tUp2).length
    record('F-61', 'a notice published through another instance while A was down appears after the reconnect, and one retired meanwhile disappears, without a manual refresh', missed.status === 201 && retired.status === 200 && live2 && missedShown && retiredGone, { live2, missedShown, retiredGone, feedReloadsAfterRecovery: feedReloads })
    record('F-20', `G-2-11: the reopen that reached the restarted service carried ?lastEventId=${lastSeq2} (page.waitForRequest) and the missed events arrived as REPLAYED frames (created 'missed while down', retired 'before the drop', ids > ${lastSeq2}), with no snapshot frame`, reached && reached.q === String(lastSeq2) && replayedCreated && Number(replayedCreated.id) > lastSeq2 && replayedRetired && !framesAfter.some((f) => f.name === 'snapshot'), { reached, framesAfterRecovery: framesAfter.map((f) => `${f.name}#${f.id} ${f.title}`) })
    // F-20 at the HTTP level on the restarted instance
    const rawStream = await new Promise((resolve) => { const ctl = new AbortController(); const chunks = []; fetch(`${process.env.API}/v1/feed/stream?tenantId=${tenant}&lastEventId=${lastSeq2}`, { headers: { 'X-Client-Id': 'vf2-verifier' }, signal: ctl.signal }).then(async (r) => { const reader = r.body.getReader(); const dec = new TextDecoder(); const t = setTimeout(() => ctl.abort(), 3000); try { while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(dec.decode(value)) } } catch {} clearTimeout(t); resolve(chunks.join('')) }).catch(() => resolve(chunks.join(''))) })
    const names = [...rawStream.matchAll(/^event: ?(\w+)$/gm)].map((m) => m[1]); const ids = [...rawStream.matchAll(/^id: ?(\d+)$/gm)].map((m) => Number(m[1]))
    record('F-20', `GET /v1/feed/stream?lastEventId=${lastSeq2} on the restarted instance replays what was missed (created, retired), no snapshot frames, ids ascending and > ${lastSeq2}`, names.length >= 2 && !names.includes('snapshot') && names.includes('created') && names.includes('retired') && ids.every((i) => i > lastSeq2) && ids.every((v, i) => i === 0 || v > ids[i - 1]), { names, ids, raw: rawStream.slice(0, 600) })
    const hdr = await new Promise((resolve) => { const ctl = new AbortController(); const chunks = []; fetch(`${process.env.API}/v1/feed/stream?tenantId=${tenant}`, { headers: { 'X-Client-Id': 'vf2-verifier', 'Last-Event-ID': 'not-a-number' }, signal: ctl.signal }).then(async (r) => { const reader = r.body.getReader(); const dec = new TextDecoder(); const t = setTimeout(() => ctl.abort(), 2000); try { while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(dec.decode(value)) } } catch {} clearTimeout(t); resolve({ status: r.status, body: chunks.join('') }) }).catch((e) => resolve({ status: 0, body: String(e) })) })
    const hdrNames = [...hdr.body.matchAll(/^event: ?(\w+)$/gm)].map((m) => m[1])
    const badQ = await api('GET', `/v1/feed/stream?tenantId=${tenant}&lastEventId=abc`)
    record('F-20', 'a non-numeric Last-Event-ID header is ignored (200, fresh snapshot); a non-numeric ?lastEventId= is a 400 — the client only ever sends numbers', hdr.status === 200 && hdrNames.includes('snapshot') && badQ.status === 400, { headerCase: { status: hdr.status, names: hdrNames.slice(0, 3) }, queryCase: { status: badQ.status, error: badQ.json && badQ.json.error } })
    record('F-61', 'no page errors during the crashes (the browser\'s own "Failed to load resource" console lines for the refused requests are expected)', page.cap.errors.length === 0, { pageErrors: page.cap.errors, consoleErrors: page.cap.console.filter((c) => c.type === 'error').length })
    await context.close()
  } catch (e) {
    log('SCRIPT ERROR ' + e.message); console.error(e)
  } finally {
    clearInterval(poll)
    if (!javaPid(PORT)) { startBackend(PORT); tl.push('instance A restarted for the later scripts') }
    const R = `${__dirname}/../results`; fs.mkdirSync(R, { recursive: true })
    fs.writeFileSync(`${R}/v4-reconnect-timeline.txt`, tl.join('\n') + '\n')
    fs.writeFileSync(`${R}/v4-sse-frames.json`, JSON.stringify(sse, null, 1))
    await browser.close()
    L.flush()
  }
})()
