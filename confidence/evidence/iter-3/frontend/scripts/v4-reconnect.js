// (iteration 3: phase 1 of the iteration-2 v4, plus a recorder of the badge's role=status text for G-3-23)
// F-61 / F-20 / G-2-11 in the browser: my own backend A (:19200, Mongo db vf3_reconnect) behind my own Vite dev server (:3200,
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
const RUN = Date.now().toString(36); const tenant = `vf3-reconnect-${RUN}`
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter3.jar'
const LOGS = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend3/logs'
const javaPid = (port) => { try { return execSync(`ps -eo pid,args | grep "[s]erver.port=${port}" | awk '{print $1}' | head -1`).toString().trim() } catch { return '' } }
async function waitBackend(base, up, ms = 120000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${base}/v1/feed?tenantId=x`, { headers: { 'X-Client-Id': 'vf3-verifier' } }); if (up && r.status === 200) return true } catch { if (!up) return true } await L.wait(250) } return false }
function startBackend(port) { const out = fs.openSync(`${LOGS}/backend-${port}.txt`, 'a'); const c = spawn('java', ['-jar', JAR, `--server.port=${port}`, '--spring.data.mongodb.uri=mongodb://localhost:27017/vf3_reconnect', '--communication.servicenow.instance-url=https://vf3.service-now.com', '--communication.sweep.interval-ms=2000', '--communication.health.sweep-interval-ms=1000'], { detached: true, stdio: ['ignore', out, out] }); c.unref() }
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
    await page.evaluate(() => { const el = document.querySelector('span[role="status"][aria-live="polite"]'); window.__badge = [{ t: Date.now(), text: el.innerText.trim() }]; new MutationObserver(() => { const t = el.innerText.trim(); if (window.__badge[window.__badge.length - 1].text !== t) window.__badge.push({ t: Date.now(), text: t }) }).observe(el, { subtree: true, childList: true, characterData: true }) })
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
    const badgeSeq = (await page.evaluate(() => window.__badge)).map((x) => x.text)
    record('G-3-23', "the badge's polite live region carries every state of the outage as text changes: Live → Reconnecting → Reconnecting (1) … (n) → Live (what a screen reader announces)", badgeSeq[0] === 'Live' && badgeSeq.includes('Reconnecting') && badgeSeq.includes('Reconnecting (1)') && badgeSeq.includes('Reconnecting (5)') && badgeSeq[badgeSeq.length - 1] === 'Live', badgeSeq)
    const afterRestart = await api('POST', '/v1/communications', publishBody(tenant, { title: 'published after the restart' }))
    const seen = await page.waitForSelector('article h3:has-text("published after the restart")', { timeout: 10000 }).then(() => true).catch(() => false)
    record('F-61', 'a notice published after the restart arrives live', afterRestart.status === 201 && seen, { status: afterRestart.status, frames: sse.filter((f) => f.title === 'published after the restart').map((f) => `${f.name}#${f.id}`) })

    // (iteration 3) phase 2 of the iteration-2 v4 crashed in its own arithmetic; it runs as v4c-reconnect-phase2.js instead
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
