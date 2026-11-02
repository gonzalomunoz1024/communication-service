// G-4-17 (iteration 4) on a healthy real backend, no mocks: my private backend A (:19200, iteration-4 jar, db vf4_reconnect).
//  (1) a filter with no notice gets no frame: the badge stays 'Connecting' and turns 'Live' ~6 s (STREAM_SETTLE_MS) after the
//      stream's 200, never before; (2) a filter with a notice gets its snapshot frame at once and is 'Live' right after it;
//      both on the dev server (:3200) and on the production bundle behind rp.js (:3205);
//  (3) a stream that opens and is ended before it worked (rp.js /__drop cuts it 2 s after each 200, four times; no frame because
//      the tenant is empty) is a failed attempt: 'Reconnecting (n)', growing delays 1, 2, 4, 8 s, no list reload, never 'Live';
//      the fifth attempt is left alone, turns 'Live' after 6 s and the list is reloaded exactly once.
// Every badge change is recorded by a MutationObserver installed before the app runs (addInitScript), with Date.now() stamps.
process.env.UI = process.env.UI || 'http://127.0.0.1:3200'; process.env.API = 'http://127.0.0.1:19200'
const fs = require('fs')
const L = require('./lib')
const { record, api, publishBody, newPage } = L
L.setFile('g4-17-settle')
const RUN = Date.now().toString(36)
const DEV = 'http://127.0.0.1:3200', PROD = 'http://127.0.0.1:3205'
const tl = []; const T0 = Date.now(); const log = (m) => { const l = `+${((Date.now() - T0) / 1000).toFixed(2)}s ${m}`; tl.push(l); console.log(l) }

const OBSERVE = () => {
  window.__badge = []; window.__alerts = []
  const tick = () => {
    const el = document.querySelector('span[role="status"][aria-live="polite"]')
    if (!el) return
    const text = el.innerText.trim(); const last = window.__badge[window.__badge.length - 1]
    if (!last || last.text !== text) window.__badge.push({ t: Date.now(), text })
  }
  new MutationObserver((muts) => {
    tick()
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue
      const found = [...(n.matches('[role="alert"]') ? [n] : []), ...n.querySelectorAll('[role="alert"]')]
      for (const a of found) window.__alerts.push({ t: Date.now(), text: a.innerText.replace(/\s+/g, ' ').trim().slice(0, 240) })
    }
  }).observe(document, { subtree: true, childList: true, characterData: true })
}

async function openWatched(browser, origin, tenant) {
  const { context, page } = await newPage(browser)
  await page.addInitScript(OBSERVE)
  const net = []
  page.on('request', (r) => { if (r.url().includes('/v1/feed')) net.push({ t: Date.now(), ev: 'req', kind: r.url().includes('/stream') ? 'stream' : 'GET', url: r.url() }) })
  page.on('response', (r) => { if (r.url().includes('/v1/feed')) net.push({ t: Date.now(), ev: 'res', kind: r.url().includes('/stream') ? 'stream' : 'GET', status: r.status() }) })
  const frames = []
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable')
  cdp.on('Network.eventSourceMessageReceived', (e) => frames.push({ t: Date.now(), name: e.eventName, id: e.eventId }))
  await page.goto(`${origin}/#/feed`)
  await page.waitForSelector('[role="tablist"]')
  await L.setTenant(page, tenant)
  return { context, page, net, frames }
}
const badges = (page) => page.evaluate(() => window.__badge)

;(async () => {
  const browser = await L.launch()
  const out = {}
  try {
    for (const [name, origin] of [['dev', DEV], ['prod', PROD]]) {
      // ---- (1) empty filter: no frame, Live only after the settle time ----
      {
        const tenant = `vf4-g417-empty-${name}-${RUN}`
        const { context, page, net, frames } = await openWatched(browser, origin, tenant)
        await page.waitForSelector('text=/^Live$/', { timeout: 15000 }).catch(() => {})
        await L.wait(500)
        const b = await badges(page)
        const okStreams = net.filter((n) => n.ev === 'res' && n.kind === 'stream' && n.status === 200)
        const lastOpen = okStreams[okStreams.length - 1]
        const live = b.find((x) => x.text === 'Live')
        // run 1 counted the initial 'Waiting for a tenant' (before the tenant is entered) against the rule; only the states after it count
        const beforeLive = b.filter((x) => x.text !== 'Waiting for a tenant' && (!live || x.t < live.t)).map((x) => x.text)
        const delay = live && lastOpen ? live.t - lastOpen.t : null
        log(`(${name}) empty tenant: badges ${JSON.stringify(b.map((x) => x.text))}; stream 200s ${okStreams.length}; Live ${delay} ms after the last 200; frames ${frames.length}`)
        record('G-4-17', `(${name}) a filter with no notice gets no frame: the badge reads 'Connecting' until the stream has stayed open ~6 s (STREAM_SETTLE_MS), then 'Live'; never 'Live' before`, live && frames.length === 0 && delay >= 5800 && delay <= 7500 && beforeLive.every((x) => x === 'Connecting'), { badgeTexts: b.map((x) => x.text), msFromStream200ToLive: delay, stream200s: okStreams.length, frames: frames.length })
        out[`empty-${name}`] = { badges: b.map((x) => ({ ...x, t: x.t - (lastOpen ? lastOpen.t : 0) })), net: net.map((n) => ({ ...n, t: n.t - (lastOpen ? lastOpen.t : 0), url: undefined })) }
        await context.close()
      }
      // ---- (2) a notice: the snapshot frame proves the stream at once ----
      {
        const tenant = `vf4-g417-frame-${name}-${RUN}`
        const seed = await api('POST', '/v1/communications', publishBody(tenant, { title: 'settle seed' }))
        const { context, page, net, frames } = await openWatched(browser, origin, tenant)
        await page.waitForSelector('text=/^Live$/', { timeout: 15000 }).catch(() => {})
        await L.wait(300)
        const b = await badges(page)
        const okStreams = net.filter((n) => n.ev === 'res' && n.kind === 'stream' && n.status === 200)
        const lastOpen = okStreams[okStreams.length - 1]
        const live = b.find((x) => x.text === 'Live')
        const firstFrame = frames.find((f) => lastOpen && f.t >= lastOpen.t)
        const delay = live && lastOpen ? live.t - lastOpen.t : null
        log(`(${name}) one notice: seed ${seed.status}; badges ${JSON.stringify(b.map((x) => x.text))}; first frame ${firstFrame && firstFrame.name} ${firstFrame ? firstFrame.t - lastOpen.t : null} ms, Live ${delay} ms after the 200`)
        // run 1 required the first frame to be 'snapshot'; the service merges the live bus with the snapshot (FeedUseCase.java:93-108), so a
        // fresh notice's 'created' may come first: any frame proves the stream works, which is G-4-17's rule
        record('G-4-17', `(${name}) a filter with a notice: its first frame (snapshot, or the merged live 'created' of a notice published just before) arrives right after the 200 and the badge reads 'Live' at once (well under the 6 s settle time)`, seed.status === 201 && live && firstFrame && delay !== null && delay < 2000 && live.t >= firstFrame.t - 50, { badgeTexts: b.map((x) => x.text), firstFrame: firstFrame && firstFrame.name, frames: frames.map((f) => f.name), msFrom200ToFirstFrame: firstFrame ? firstFrame.t - lastOpen.t : null, msFrom200ToLive: delay })
        await context.close()
      }
    }

    // ---- (3) open, then ended before it worked, four times (production bundle behind rp.js :3205 → A) ----
    {
      const tenant = `vf4-g417-drop-${RUN}`
      const { context, page, net } = await openWatched(browser, PROD, tenant)
      let drops = 0; const dropAt = []
      page.on('response', (r) => {
        if (!r.url().includes('/v1/feed/stream') || r.status() !== 200 || drops >= 4) return
        drops++
        setTimeout(async () => { const n = await fetch('http://127.0.0.1:3205/__drop').then((x) => x.text()).catch((e) => 'ERR ' + e.message); dropAt.push({ t: Date.now(), dropped: n }); log(`/__drop → ${n} stream(s) cut`) }, 2000)
      })
      await L.wait(36000)
      const b = await badges(page)
      const streamReqs = net.filter((n) => n.ev === 'req' && n.kind === 'stream')
      const gets = net.filter((n) => n.ev === 'req' && n.kind === 'GET')
      const gaps = dropAt.map((d) => { const next = streamReqs.find((s) => s.t > d.t); return next ? next.t - d.t : null })
      const live = b.find((x) => x.text === 'Live')
      const lastDrop = dropAt[dropAt.length - 1]
      const getsBeforeLive = gets.filter((g) => !live || g.t < live.t).length
      const getsAfterLive = live ? gets.filter((g) => g.t >= live.t).length : null
      const lastReq = streamReqs[streamReqs.length - 1]
      log(`(drop) badges ${JSON.stringify(b.map((x) => `${x.text}@${((x.t - T0) / 1000).toFixed(1)}`))}`)
      log(`(drop) ${streamReqs.length} stream requests; reopen gaps after each cut (ms) ${JSON.stringify(gaps)}; list GETs before Live ${getsBeforeLive}, after ${getsAfterLive}`)
      const texts = b.map((x) => x.text)
      record('G-4-17', "a stream that opens and is ended before it delivered a frame or stayed 6 s is a failed attempt: the client reopens with its growing backoff (≈1, 2, 4, 8 s after the cuts), the badge counts 'Reconnecting (1)'…'(4)', never 'Live' in between, and no list reload happens per failed attempt", dropAt.length === 4 && gaps.every((g) => g !== null) && gaps[0] >= 800 && gaps[0] < 1800 && gaps[1] >= 1800 && gaps[1] < 2900 && gaps[2] >= 3800 && gaps[2] < 4900 && gaps[3] >= 7800 && gaps[3] < 8900 && ['Reconnecting (1)', 'Reconnecting (2)', 'Reconnecting (3)', 'Reconnecting (4)'].every((x) => texts.includes(x)) && !b.some((x) => x.text === 'Live' && x.t < (lastDrop ? lastDrop.t : 0)) && getsBeforeLive === 1, { badgeTexts: texts, reopenGapsMs: gaps, streamRequests: streamReqs.length, listGetsBeforeLive: getsBeforeLive })
      record('G-4-17', "the fifth attempt, left alone, turns 'Live' about 6 s after it opened, and the list is reloaded exactly once then (events may have been missed while the stream was down)", live && lastReq && live.t - lastReq.t >= 5800 && live.t - lastReq.t < 8000 && getsAfterLive === 1, { msFromLastStreamRequestToLive: live && lastReq ? live.t - lastReq.t : null, listGetsAfterLive: getsAfterLive })
      out.drop = { badges: b.map((x) => ({ text: x.text, t: x.t - T0 })), drops: dropAt.map((d) => ({ ...d, t: d.t - T0 })), net: net.map((n) => ({ ev: n.ev, kind: n.kind, status: n.status, t: n.t - T0 })) }
      record('G-4-17', 'no page errors on the drop page', page.cap.errors.length === 0, page.cap.errors)
      await context.close()
    }
  } catch (e) { log('SCRIPT ERROR ' + (e.stack || e)); process.exitCode = 1 } finally {
    fs.writeFileSync(`${__dirname}/../results/g4-17-settle-timeline.txt`, tl.join('\n') + '\n' + JSON.stringify(out, null, 1).split('\n').slice(0, 400).join('\n') + '\n')
    await browser.close(); L.flush()
  }
})()
