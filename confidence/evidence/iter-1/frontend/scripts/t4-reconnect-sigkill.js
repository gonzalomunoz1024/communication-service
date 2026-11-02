// G-1-3 / F-61 / F-20 in the browser: my own backend instance A (:19150, Mongo db fe1-reconnect) behind my own Vite dev server
// (:3150, the iteration-1 proxy that ends the browser's response when the upstream dies). A is SIGKILLed while the feed is Live
// and restarted ~14 s later; then it is killed again while a second instance B (:19151, same db) publishes and retires, and
// restarted. SSE frames are captured through CDP (Network.eventSourceMessageReceived), stream requests through page.route.
const fs = require('fs'); const { execSync, spawn } = require('child_process')
const PORT = 19150, PORT_B = 19151
process.env.UI = 'http://127.0.0.1:3150'; process.env.API = `http://127.0.0.1:${PORT}`
const L = require('./lib'); const { record, api, publishBody, newPage } = L
L.setFile('t4-reconnect-sigkill')
const RUN = Date.now().toString(36); const tenant = `fe1-reconnect-${RUN}`
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter1.jar'
const javaPid = (port) => { try { return execSync(`ps -eo pid,args | grep "[s]erver.port=${port}" | awk '{print $1}' | head -1`).toString().trim() } catch { return '' } }
async function waitBackend(base, up, ms = 90000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${base}/v1/feed?tenantId=x`, { headers: { 'X-Client-Id': 'fe1-verifier' } }); if (up && r.status === 200) return true } catch { if (!up) return true } await L.wait(300) } return false }
function startBackend(port) { const out = fs.openSync(`${__dirname}/../backend-${port}-restart.txt`, 'a'); const c = spawn('java', ['-jar', JAR, `--server.port=${port}`, '--spring.data.mongodb.uri=mongodb://localhost:27017/fe1-reconnect'], { detached: true, stdio: ['ignore', out, out] }); c.unref() }
const apiB = (method, p, body) => fetch(`http://127.0.0.1:${PORT_B}${p}`, { method, headers: { 'X-Client-Id': 'fe1-verifier', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
const sseTitle = (d) => { const m = /"title":"([^"]*)"/.exec(d); return m ? m[1] : '' }

;(async () => {
  const browser = await L.launch()
  const T0 = Date.now(); const tl = []; const log = (m) => { tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`) }
  const sse = []; const streamReqs = []; const indHist = []
  let poll
  try {
    if (!javaPid(PORT_B)) { startBackend(PORT_B); log(`started instance B on :${PORT_B} (boots while phase 1 runs)`) }
    if (!javaPid(PORT)) { startBackend(PORT); log('started instance A') }
    log('instance A up: ' + (await waitBackend(process.env.API, true)))
    const { context, page } = await newPage(browser)
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable')
    cdp.on('Network.eventSourceMessageReceived', (e) => { sse.push({ at: Date.now(), name: e.eventName, id: e.eventId, title: sseTitle(e.data) }); log(`SSE frame ${e.eventName} id=${e.eventId} ${sseTitle(e.data)}`) })
    // headers as sent on the wire (route.allHeaders() does not show the EventSource's own Last-Event-ID)
    const raw = []; const pend = new Map()
    const noteRaw = (id) => { const p = pend.get(id); if (p && p.url && p.headers) { const lei = p.headers['Last-Event-ID'] || p.headers['last-event-id'] || null; raw.push({ at: Date.now(), q: new URL(p.url).searchParams.get('lastEventId'), wireLastEventId: lei }); log(`CDP wire headers: stream request Last-Event-ID=${lei ?? '(none)'}`); pend.delete(id) } }
    cdp.on('Network.requestWillBeSent', (e) => { if (e.request.url.includes('/v1/feed/stream')) { pend.set(e.requestId, { ...(pend.get(e.requestId) || {}), url: e.request.url }); noteRaw(e.requestId) } })
    cdp.on('Network.requestWillBeSentExtraInfo', (e) => { pend.set(e.requestId, { ...(pend.get(e.requestId) || {}), headers: e.headers }); noteRaw(e.requestId) })
    await page.route('**/v1/feed/stream**', async (route) => { let h = {}; try { h = await route.request().allHeaders() } catch {} const u = new URL(route.request().url()); const rec = { at: Date.now(), q: u.searchParams.get('lastEventId'), h: h['last-event-id'] || null }; streamReqs.push(rec); log(`stream REQUEST #${streamReqs.length} ?lastEventId=${rec.q ?? '(none)'} Last-Event-ID=${rec.h ?? '(none)'}`); try { await route.continue() } catch {} })
    page.on('response', (r) => { if (r.url().includes('/v1/feed/stream')) log(`stream RESPONSE ${r.status()}`) })
    page.on('requestfailed', (r) => { if (r.url().includes('/v1/feed/stream')) log(`stream REQUEST FAILED ${(r.failure() || {}).errorText}`) })
    let lastInd = ''
    poll = setInterval(async () => { try { const s = await L.indicator(page, 300); if (s !== lastInd && s !== '?') { log(`badge → ${s}`); indHist.push({ at: Date.now(), s }); lastInd = s } } catch {} }, 150)

    // ---- phase 1: crash and restart ----
    const seed = await api('POST', '/v1/communications', publishBody(tenant, { title: 'before the drop' }))
    await L.gotoFeed(page, tenant, { allTypes: true })
    await page.waitForSelector('article h3:has-text("before the drop")')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    log('feed Live with one item')
    record('F-61', 'feed is Live before the crash; the first stream request carries neither ?lastEventId nor Last-Event-ID', streamReqs.length >= 1 && streamReqs[0].q === null && streamReqs[0].h === null, streamReqs)
    const pidA = javaPid(PORT); execSync(`kill -9 ${pidA}`); const tKill = Date.now(); log(`SIGKILL instance A (pid ${pidA})`)
    log('A down: ' + (await waitBackend(process.env.API, false, 20000)))
    await L.wait(14000)
    const badgesDuring = indHist.filter((h) => h.at > tKill).map((h) => h.s)
    const attemptsDuring = streamReqs.filter((r) => r.at > tKill)
    const gaps = attemptsDuring.slice(1).map((r, i) => +((r.at - attemptsDuring[i].at) / 1000).toFixed(1))
    record('F-61', "G-1-3: after the crash the badge shows 'Reconnecting', then 'Reconnecting (1)', '(2)', '(3)' for the client's own attempts", badgesDuring.includes('Reconnecting') && ['Reconnecting (1)', 'Reconnecting (2)', 'Reconnecting (3)'].every((b) => badgesDuring.includes(b)), badgesDuring)
    record('F-61', 'G-1-3: the reopen attempts are spaced with growing delays (≈1, 2, 4, 8 s)', gaps.length >= 3 && gaps.slice(1).every((g, i) => g > gaps[i]), { gapsSeconds: gaps, attempts: attemptsDuring })
    const rawDuring = raw.filter((r) => r.at > tKill)
    record('F-20', "the browser's own retry sends Last-Event-ID=<last id> (wire headers via CDP); the client's first attempt sends ?lastEventId=<last seq>; once that attempt fails without opening, later attempts start fresh (documented in api.ts)", rawDuring.some((r) => r.wireLastEventId !== null) && attemptsDuring.some((r) => r.q !== null) && attemptsDuring[attemptsDuring.length - 1].q === null, { wire: rawDuring, routeView: attemptsDuring.map((r) => ({ q: r.q, h: r.h })) })
    startBackend(PORT); log('restarting instance A')
    log('A up again: ' + (await waitBackend(process.env.API, true)))
    const tUp = Date.now()
    const live = await page.waitForSelector('text=/^Live$/', { timeout: 70000 }).then(() => true).catch(() => false)
    log(`badge Live again: ${live} (${((Date.now() - tUp) / 1000).toFixed(1)} s after A answered)`)
    record('F-61', 'G-1-3: after the restart the badge returns to Live by itself (the backoff is capped at 30 s)', live && Date.now() - tUp < 35000, { secondsAfterBackendUp: +((Date.now() - tUp) / 1000).toFixed(1), badges: indHist.map((h) => h.s) })
    const afterRestart = await api('POST', '/v1/communications', publishBody(tenant, { title: 'published after the restart' }))
    const seen = await page.waitForSelector('article h3:has-text("published after the restart")', { timeout: 10000 }).then(() => true).catch(() => false)
    record('F-61', 'G-1-3: a notice published after the restart arrives live', afterRestart.status === 201 && seen, { status: afterRestart.status, frames: sse.filter((f) => f.title === 'published after the restart').map((f) => `${f.name}#${f.id}`) })

    // ---- phase 2: crash again, publish and retire through instance B meanwhile, restart ----
    log('instance B up: ' + (await waitBackend(`http://127.0.0.1:${PORT_B}`, true)))
    const lastSeqBefore = Math.max(...sse.map((f) => Number(f.id)).filter((n) => !isNaN(n)))
    const pid2 = javaPid(PORT); execSync(`kill -9 ${pid2}`); const tKill2 = Date.now(); log(`SIGKILL instance A again (pid ${pid2}); last SSE id seen ${lastSeqBefore}`)
    await waitBackend(process.env.API, false, 20000)
    await L.wait(1500)
    const missed = await apiB('POST', '/v1/communications', publishBody(tenant, { title: 'missed while down' }))
    const retired = await apiB('POST', `/v1/communications/${seed.json.id}/retire`, { actor: 'fe1-verifier', note: 'retired while A was down' })
    log(`through instance B: publish 'missed while down' → ${missed.status}, retire 'before the drop' → ${retired.status}`)
    await L.wait(3000)
    startBackend(PORT); log('restarting instance A')
    log('A up again: ' + (await waitBackend(process.env.API, true)))
    const tUp2 = Date.now()
    const live2 = await page.waitForSelector('text=/^Live$/', { timeout: 70000 }).then(() => true).catch(() => false)
    log(`badge Live again: ${live2}`)
    const missedShown = await page.waitForSelector('article h3:has-text("missed while down")', { timeout: 15000 }).then(() => true).catch(() => false)
    const retiredGone = await page.waitForSelector('article h3:has-text("before the drop")', { state: 'detached', timeout: 15000 }).then(() => true).catch(() => false)
    const recovery = streamReqs.filter((r) => r.at > tKill2); const rawRecovery = raw.filter((r) => r.at > tKill2)
    const framesAfter = sse.filter((f) => f.at > tUp2)
    const feedReloads = page.cap.requests.filter((r) => r.method === 'GET' && /\/v1\/feed\?/.test(r.url) && r.at > tUp2).length
    const how = framesAfter.some((f) => f.name === 'snapshot') ? 'fresh stream (snapshot frames) + one GET /v1/feed reload' : framesAfter.some((f) => f.name === 'created' && f.title === 'missed while down') ? 'replayed created frame' : 'GET /v1/feed reload only'
    record('F-61', 'G-1-3: a notice published through another instance while A was down appears after the reconnect, and one retired meanwhile disappears, without a manual refresh', missed.status === 201 && retired.status === 200 && live2 && missedShown && retiredGone, { live2, missedShown, retiredGone, deliveredBy: how, feedReloadsAfterRecovery: feedReloads, framesAfterRecovery: framesAfter.slice(0, 8).map((f) => `${f.name}#${f.id} ${f.title}`), recoveryStreamRequests: recovery.map((r) => ({ q: r.q, h: r.h })), wireHeaders: rawRecovery })
    // F-20 at the HTTP level on the restarted instance: the events missed during the outage are replayed from the Mongo log
    const rawStream = await new Promise((resolve) => { const ctl = new AbortController(); const chunks = []; fetch(`${process.env.API}/v1/feed/stream?tenantId=${tenant}&lastEventId=${lastSeqBefore}`, { headers: { 'X-Client-Id': 'fe1-verifier' }, signal: ctl.signal }).then(async (r) => { const reader = r.body.getReader(); const dec = new TextDecoder(); const t = setTimeout(() => ctl.abort(), 3000); try { while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(dec.decode(value)) } } catch {} clearTimeout(t); resolve(chunks.join('')) }).catch(() => resolve(chunks.join(''))) })
    const names = [...rawStream.matchAll(/^event: ?(\w+)$/gm)].map((m) => m[1]); const ids = [...rawStream.matchAll(/^id: ?(\d+)$/gm)].map((m) => Number(m[1]))
    record('F-20', `GET /v1/feed/stream?lastEventId=${lastSeqBefore} on the restarted instance replays what was missed (created 'missed while down', retired 'before the drop'), no snapshot frames, ids ascending and > ${lastSeqBefore}`, names.length >= 2 && !names.includes('snapshot') && names.includes('created') && names.includes('retired') && ids.every((i) => i > lastSeqBefore) && ids.every((v, i) => i === 0 || v > ids[i - 1]), { names, ids, raw: rawStream.slice(0, 700) })
    record('F-61', 'no page errors during the crashes (the browser\'s own "Failed to load resource" console lines for the refused requests are expected)', page.cap.errors.length === 0, { pageErrors: page.cap.errors, consoleErrors: page.cap.console.filter((c) => c.type === 'error').length })
    await context.close()
  } catch (e) {
    log('SCRIPT ERROR ' + e.message); console.error(e)
  } finally {
    clearInterval(poll)
    const pidB = javaPid(PORT_B); if (pidB) { try { execSync(`kill ${pidB}`) } catch {} tl.push(`stopped instance B (pid ${pidB}, SIGTERM)`) }
    fs.mkdirSync(`${__dirname}/results`, { recursive: true })
    fs.writeFileSync(`${__dirname}/results/t4-reconnect-timeline.txt`, tl.join('\n') + '\n')
    fs.writeFileSync(`${__dirname}/results/t4-sse-frames.json`, JSON.stringify(sse, null, 1))
    await browser.close()
    L.flush()
  }
})()
