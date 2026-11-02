// F-20 / F-61 replay paths seen from the browser against my own instance A (:19150) behind rp.js (:3129, the built UI + an
// SSE-aware reverse proxy with two test controls): (a) /__drop ends the open stream while the service stays up → the browser's own
// retry carries Last-Event-ID and the service replays the frame published meanwhile; (b) /__fail-next-stream answers that retry
// 502 (a proxy blip) → the client's own attempt with ?lastEventId= reaches the service and it replays. rp.js logs the
// Last-Event-ID header it really receives; CDP captures the frames, so snapshot vs replay is visible.
process.env.UI = 'http://127.0.0.1:3129'; process.env.API = 'http://127.0.0.1:19150'
const fs = require('fs')
const L = require('./lib'); const { record, api, publishBody, newPage } = L
L.setFile('t4b-replay-in-browser')
const tenant = `fe1-replay-${Date.now().toString(36)}`
const sseTitle = (d) => { const m = /"title":"([^"]*)"/.exec(d); return m ? m[1] : '' }
const control = (p) => fetch(`${process.env.UI}${p}`).then((r) => r.text())
;(async () => {
  const browser = await L.launch()
  const T0 = Date.now(); const tl = []; const log = (m) => tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`)
  const sse = []; const streamReqs = []; const indHist = []; const raw = []; let poll
  try {
    const { context, page } = await newPage(browser)
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable')
    cdp.on('Network.eventSourceMessageReceived', (e) => { sse.push({ at: Date.now(), name: e.eventName, id: e.eventId, title: sseTitle(e.data) }); log(`SSE frame ${e.eventName} id=${e.eventId} ${sseTitle(e.data)}`) })
    const pend = new Map()
    const noteRaw = (id) => { const p = pend.get(id); if (p && p.url && p.headers) { const lei = p.headers['Last-Event-ID'] || p.headers['last-event-id'] || null; raw.push({ at: Date.now(), url: p.url.replace(process.env.UI, ''), lastEventId: lei }); log(`CDP wire headers: stream request Last-Event-ID=${lei ?? '(none)'}`); pend.delete(id) } }
    cdp.on('Network.requestWillBeSent', (e) => { if (e.request.url.includes('/v1/feed/stream')) { pend.set(e.requestId, { ...(pend.get(e.requestId) || {}), url: e.request.url }); noteRaw(e.requestId) } })
    cdp.on('Network.requestWillBeSentExtraInfo', (e) => { pend.set(e.requestId, { ...(pend.get(e.requestId) || {}), headers: e.headers }); noteRaw(e.requestId) })
    const feedGets = []
    page.on('request', (r) => { if (r.url().includes('/v1/feed/stream')) { const u = new URL(r.url()); streamReqs.push({ at: Date.now(), q: u.searchParams.get('lastEventId') }); log(`stream REQUEST #${streamReqs.length} ?lastEventId=${u.searchParams.get('lastEventId') ?? '(none)'}`) } else if (/\/v1\/feed\?/.test(r.url())) { feedGets.push(Date.now()); log(`GET /v1/feed${new URL(r.url()).search.slice(0, 60)} (list load #${feedGets.length})`) } })
    page.on('response', (r) => { if (r.url().includes('/v1/feed/stream')) { streamReqs[streamReqs.length - 1].status = r.status(); log(`stream RESPONSE ${r.status()}`) } })
    page.on('requestfailed', (r) => { if (r.url().includes('/v1/feed/stream')) log(`stream REQUEST FAILED ${(r.failure() || {}).errorText}`) })
    let lastInd = ''; poll = setInterval(async () => { try { const s = await L.indicator(page, 300); if (s !== lastInd && s !== '?') { log(`badge → ${s}`); indHist.push({ at: Date.now(), s }); lastInd = s } } catch {} }, 150)
    const lastId = () => Math.max(...sse.map((f) => Number(f.id)).filter((n) => !isNaN(n)))

    await api('POST', '/v1/communications', publishBody(tenant, { title: 'seed a' }))
    await L.gotoFeed(page, tenant, { allTypes: true })
    await page.waitForSelector('article h3:has-text("seed a")')
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
    log('feed Live')

    // (a) drop → browser retry with Last-Event-ID → replay
    const before1 = lastId(); const t1 = Date.now()
    log(`/__drop → ${await control('/__drop')} stream(s) dropped`)
    await L.wait(800)
    const missed1 = await api('POST', '/v1/communications', publishBody(tenant, { title: 'missed during drop 1' }))
    log(`published 'missed during drop 1' → ${missed1.status}`)
    const shown1 = await page.waitForSelector('article h3:has-text("missed during drop 1")', { timeout: 20000 }).then(() => true).catch(() => false)
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 }).catch(() => {})
    await L.wait(1000)
    const reqs1 = streamReqs.filter((r) => r.at > t1); const frames1 = sse.filter((f) => f.at > t1); const raw1 = raw.filter((r) => r.at > t1)
    record('F-61', "(a) after the stream is cut the badge shows 'Reconnecting', the browser's own retry (≈3 s) carries Last-Event-ID=<last id seen> (seen on the wire by CDP and by the proxy), and the badge returns to Live", shown1 && raw1.some((r) => r.lastEventId === String(before1)) && reqs1.every((r) => r.q === null) && indHist.some((h) => h.at > t1 && h.s === 'Reconnecting') && indHist.filter((h) => h.at > t1).slice(-1)[0].s === 'Live', { lastIdBefore: before1, wireHeaders: raw1, requests: reqs1, badges: indHist.filter((h) => h.at > t1).map((h) => h.s) })
    record('F-20', "(a) the service replays the frame missed during the drop ('created', id > last id) with no snapshot frames, and the card appears", shown1 && frames1.some((f) => f.name === 'created' && f.title === 'missed during drop 1' && Number(f.id) > before1) && !frames1.some((f) => f.name === 'snapshot'), { lastIdBefore: before1, frames: frames1.map((f) => `${f.name}#${f.id} ${f.title}`) })

    // (b) drop + 502 to the browser retry → client ?lastEventId= → replay
    const before2 = lastId(); const t2 = Date.now()
    log(`/__fail-next-stream → ${await control('/__fail-next-stream')}`)
    log(`/__drop → ${await control('/__drop')} stream(s) dropped`)
    await L.wait(800)
    const missed2 = await api('POST', '/v1/communications', publishBody(tenant, { title: 'missed during drop 2' }))
    log(`published 'missed during drop 2' → ${missed2.status}`)
    const shown2 = await page.waitForSelector('article h3:has-text("missed during drop 2")', { timeout: 25000 }).then(() => true).catch(() => false)
    await page.waitForSelector('text=/^Live$/', { timeout: 20000 }).catch(() => {})
    await L.wait(1000)
    const reqs2 = streamReqs.filter((r) => r.at > t2); const frames2 = sse.filter((f) => f.at > t2); const raw2 = raw.filter((r) => r.at > t2)
    const resumeReq = reqs2.find((r) => r.q !== null)
    record('F-61', "(b) a 502 to the browser's retry closes the EventSource; the client reopens with ?lastEventId=<last id> after ~1 s (badge 'Reconnecting (1)'), then Live", shown2 && resumeReq && resumeReq.q === String(before2) && resumeReq.status === 200 && reqs2.some((r) => r.status === 502) && indHist.some((h) => h.at > t2 && h.s === 'Reconnecting (1)') && indHist.filter((h) => h.at > t2).slice(-1)[0].s === 'Live', { lastIdBefore: before2, requests: reqs2, wireHeaders: raw2, badges: indHist.filter((h) => h.at > t2).map((h) => h.s) })
    record('F-20', '(b) ?lastEventId= replays the missed frame (created, id > last id) with no snapshot frames', shown2 && frames2.some((f) => f.name === 'created' && f.title === 'missed during drop 2' && Number(f.id) > before2) && !frames2.some((f) => f.name === 'snapshot'), { lastIdBefore: before2, frames: frames2.map((f) => `${f.name}#${f.id} ${f.title}`) })
    await L.wait(4000)
    const openA = streamReqs.filter((r) => r.at > t1 && r.at < t2 && r.status === 200).slice(-1)[0]; const openB = streamReqs.filter((r) => r.at > t2 && r.status === 200).slice(-1)[0]
    const reloadsA = feedGets.filter((t) => openA && t >= openA.at - 200 && t < openA.at + 3000).length; const reloadsB = feedGets.filter((t) => openB && t >= openB.at - 200 && t < openB.at + 3000).length
    const idle = feedGets.filter((t) => openB && t > openB.at + 3000).length
    record('F-61', 'after each recovery the list is reloaded exactly once (useOutageFeed reloads when the stream comes back) and then stays quiet (no reload loop in the 4 s idle window)', reloadsA === 1 && reloadsB === 1 && idle === 0, { listLoadsTotal: feedGets.length, afterRecoveryA: reloadsA, afterRecoveryB: reloadsB, inIdleWindow: idle })
    record('F-61', 'no page errors', page.cap.errors.length === 0, { pageErrors: page.cap.errors })
    await context.close()
  } catch (e) { log('SCRIPT ERROR ' + e.message); console.error(e) } finally {
    clearInterval(poll)
    fs.mkdirSync(`${__dirname}/results`, { recursive: true })
    fs.writeFileSync(`${__dirname}/results/t4b-replay-timeline.txt`, tl.join('\n') + '\n')
    await browser.close(); L.flush()
  }
})()
