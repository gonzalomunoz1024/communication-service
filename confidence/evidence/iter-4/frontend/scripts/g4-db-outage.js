// Iteration 4 in a real database outage (no mocks): my backend C (:19202, iteration-4 jar) on its own Mongo container vf4-mongo,
// behind my dev server :3201 and behind rp.js :3208 serving the production bundle (scratch dist/ built from d10369b = 1cd3f13).
//  P1 (dev, opened BEFORE the outage, light theme):
//    G-4-20  Resolve confirmation open with a note; `docker stop vf4-mongo`; Enter on Resolve → the retire call runs ~5 s: Escape
//            pressed inside the confirmation (focus put back in the note field) while it runs changes nothing; after the 503 the
//            error shows, focus is on the confirm button, and Escape then cancels and gives focus back to the Resolve button.
//    G-4-17  the open stream survives (no new stream request), badge stays 'Live' until a list load fails, then 'Service degraded'.
//    G-4-18  the load error is a role=alert; each failed Try again inserts a NEW alert and focus lands on its Try again.
//  P2 (dev) and P3 (prod, dark theme), opened DURING the outage: G-4-10 every stream attempt is answered 503 JSON before any byte;
//    G-4-17 the badge never says 'Live' (every change recorded from first paint by a MutationObserver), attempts back off, no list
//    reload per failed attempt; after `docker start` each page recovers by itself: Live, one reload, the card back, no alert.
//  P1 after the outage: stays 'Service degraded' until Try again (the documented behaviour), then Live with focus on the list.
//  axe + contrast on the alert / 'Service degraded' / 'Reconnecting (n)' states in light (P1, P2) and dark (P3).
const { execSync } = require('child_process'); const fs = require('fs')
const L = require('./lib')
const { record, api, publishBody, newPage } = L
const { axe, contrastSamples } = require('./a11y')
L.setFile('g4-db-outage')
const RUN = Date.now().toString(36)
const C_API = 'http://127.0.0.1:19202', DEV = 'http://127.0.0.1:3201', PROD = 'http://127.0.0.1:3208'
const LOG = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/frontend4/logs/backend-19202.txt'
const DB_503 = 'The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment.'
const tl = []; const T0 = Date.now(); const rel = (t) => ((t - T0) / 1000).toFixed(2); const log = (m) => { const l = `+${rel(Date.now())}s ${m}`; tl.push(l); console.log(l) }
const logLines = () => fs.readFileSync(LOG, 'utf8').split('\n')

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
async function openWatched(browser, origin, tenant, opts = {}) {
  const { context, page } = await newPage(browser, opts)
  await page.addInitScript(OBSERVE)
  const net = []
  page.on('request', (r) => { if (r.url().includes('/v1/')) net.push({ t: Date.now(), ev: 'req', kind: r.url().includes('/stream') ? 'stream' : r.method() === 'GET' ? 'GET' : r.method(), url: r.url() }) })
  page.on('response', async (r) => {
    if (!r.url().includes('/v1/')) return
    const e = { t: Date.now(), ev: 'res', kind: r.url().includes('/stream') ? 'stream' : r.request().method() === 'GET' ? 'GET' : r.request().method(), status: r.status(), ctype: r.headers()['content-type'] }
    net.push(e)
    if (r.status() !== 200) e.body = (await r.text().catch(() => '?')).slice(0, 120)
  })
  await page.goto(`${origin}/#/feed`)
  await page.waitForSelector('[role="tablist"]')
  await L.setTenant(page, tenant)
  return { context, page, net }
}
const badgeLog = (page) => page.evaluate(() => window.__badge)
const alertLog = (page) => page.evaluate(() => window.__alerts)
const fmtBadges = (b) => b.map((x) => `${x.text}@${rel(x.t)}`)
const fmtNet = (net, since = 0) => net.filter((n) => n.t >= since).map((n) => `${rel(n.t)} ${n.ev} ${n.kind}${n.status !== undefined ? ' ' + n.status : ''}${n.body ? ' ' + n.body : ''}`)

;(async () => {
  const browser = await L.launch()
  const tenant = `vf4-g4db-${RUN}`
  let tStop = null, tStart = null
  const pages = []
  try {
    const seed = await api('POST', '/v1/communications', publishBody(tenant, { title: 'held through the outage' }), {}, C_API)
    // ---------------- P1: open before the outage ----------------
    const P1 = await openWatched(browser, DEV, tenant, { colorScheme: 'light' }); pages.push(P1)
    const p1 = P1.page
    await p1.waitForSelector('article h3:has-text("held through the outage")')
    await p1.waitForSelector('text=/^Live$/', { timeout: 20000 })
    log(`P1 ready: seed ${seed.status}, card listed, badge Live`)
    const card = L.cardByTitle(p1, 'held through the outage')
    await card.getByRole('button', { name: 'Resolve' }).focus(); await p1.keyboard.press('Enter')
    await p1.keyboard.type('escape probe')
    const l0 = logLines().length
    execSync('docker stop vf4-mongo'); tStop = Date.now(); log('docker stop vf4-mongo')
    const p1StreamsAtStop = P1.net.filter((n) => n.ev === 'req' && n.kind === 'stream').length

    // G-4-20 while the call runs
    await p1.keyboard.press('Tab'); await p1.keyboard.press('Tab')
    const onConfirm = await L.activeInfo(p1)
    const tRetire = Date.now()
    const retireResp = p1.waitForResponse((r) => r.url().endsWith('/retire'), { timeout: 40000 })
    await p1.keyboard.press('Enter')
    await L.wait(1200)
    const busyBefore = await card.locator('[role="group"] button[aria-busy="true"]').count()
    const focusWhileBusy0 = await L.activeInfo(p1)
    await card.locator('input[id$="-note"]').focus()
    await p1.keyboard.press('Escape')
    await L.wait(300)
    const afterEsc = { group: await card.locator('[role="group"]').count(), busy: await card.locator('[role="group"] button[aria-busy="true"]').count(), cancelDisabled: await card.getByRole('button', { name: 'Cancel' }).isDisabled().catch(() => null), note: await card.locator('input[id$="-note"]').inputValue().catch(() => null), focus: await L.activeInfo(p1) }
    const rr = await retireResp
    await card.locator('[role="group"] [role="alert"]').waitFor({ timeout: 15000 })
    const resErr = (await card.locator('[role="group"] [role="alert"]').innerText()).trim()
    const focusAfterFail = await L.activeInfo(p1)
    log(`P1 retire during the outage → ${rr.status()} after ${Date.now() - tRetire} ms; Escape while busy: ${JSON.stringify(afterEsc)}; error '${resErr}'`)
    record('G-4-20', 'Escape pressed inside the confirmation WHILE the retire call runs (focus in the note field, Cancel disabled, Resolve busy) changes nothing: the confirmation stays open, busy, with its note', onConfirm && /-confirm$/.test(onConfirm.id || '') && busyBefore === 1 && afterEsc.group === 1 && afterEsc.busy === 1 && afterEsc.cancelDisabled === true && afterEsc.note === 'escape probe' && /-note$/.test((afterEsc.focus && afterEsc.focus.id) || ''), { focusBeforeEnter: onConfirm && onConfirm.id, busyBefore, focusWhileBusyBeforeIClickedTheNote: focusWhileBusy0 && focusWhileBusy0.tag, afterEscape: afterEsc })
    record('F-92', "the call fails with the service's 503 (database unavailable): the database wording under the confirm row, the card stays, focus back on the confirm button", rr.status() === 503 && resErr === DB_503 && /-confirm$/.test((focusAfterFail && focusAfterFail.id) || ''), { status: rr.status(), ms: Date.now() - tRetire, resErr, focus: focusAfterFail && focusAfterFail.id })
    await p1.keyboard.press('Escape')
    await L.wait(300)
    const afterEsc2 = { group: await card.locator('[role="group"]').count(), focus: await L.activeInfo(p1), cards: await L.cardByTitle(p1, 'held through the outage').count(), retirePosts: P1.net.filter((n) => n.ev === 'req' && n.kind === 'POST').length }
    record('G-4-20', 'once the call has ended, Escape cancels the confirmation like Cancel: the group closes, focus returns to the Resolve button, the card stays and no second retire is sent', afterEsc2.group === 0 && afterEsc2.focus && /-action$/.test(afterEsc2.focus.id || '') && afterEsc2.focus.text === 'Resolve' && afterEsc2.cards === 1 && afterEsc2.retirePosts === 1, afterEsc2)

    // G-4-17: the stream opened before the outage
    const b1a = await badgeLog(p1)
    const p1StreamsNow = P1.net.filter((n) => n.ev === 'req' && n.kind === 'stream').length
    record('G-4-17', "P1 (stream opened before the outage) keeps its stream through the outage (no new stream request) and still reads 'Live' while no list load has failed", p1StreamsNow === p1StreamsAtStop && b1a[b1a.length - 1].text === 'Live', { streamRequestsAtStop: p1StreamsAtStop, now: p1StreamsNow, badges: fmtBadges(b1a) })
    const tRefresh = Date.now()
    await p1.getByRole('button', { name: 'Refresh' }).click()
    const alertShown = await p1.waitForSelector('[role="alert"]:has-text("Couldn\'t load the feed")', { timeout: 20000 }).then(() => Date.now() - tRefresh).catch(() => null)
    await L.wait(300)
    const b1b = await badgeLog(p1)
    const p1Alert = await p1.locator('[role="alert"]:has-text("Couldn\'t load the feed")').innerText().catch(() => '')
    log(`P1 Refresh → alert after ${alertShown} ms; badge ${b1b[b1b.length - 1].text}`)
    record('G-4-17', "P1: a list load that fails during the outage (Refresh → 503) puts the database wording on screen and the still-working stream's badge reads 'Service degraded', not 'Live'", alertShown !== null && p1Alert.includes(DB_503) && b1b[b1b.length - 1].text === 'Service degraded', { msRefreshToAlert: alertShown, alert: p1Alert.replace(/\s+/g, ' ').slice(0, 220), badges: fmtBadges(b1b).slice(-4) })
    const snap1 = await p1.locator('main').ariaSnapshot()
    record('G-4-18', "P1: the feed's load error is a role=alert in the accessibility tree (heading text, the service's sentence and its Try again button inside it)", /- alert:/.test(snap1) && /Couldn't load the feed/.test(snap1), snap1.split('\n').filter((l) => /alert|Couldn|database|Try again|status/.test(l)).slice(0, 8))
    L.shot && await L.shot(p1, 'g4-p1-service-degraded-light')
    await axe(p1, "P1 feed: database-outage alert + 'Service degraded' badge (light)")
    const c1 = await contrastSamples(p1)
    record('F-65', "contrast on the alert + 'Service degraded' state (light): no sampled text below AA", Object.values(c1).every((g) => g.belowAA === 0), Object.fromEntries(Object.entries(c1).map(([k, v]) => [k, { n: v.sampled, min: v.min && Math.round(v.min * 100) / 100, belowAA: v.belowAA }])))
    // G-4-18: Try again twice, each failing again
    const retries = []
    for (let i = 0; i < 2; i++) {
      const old = await p1.locator('[role="alert"]:has-text("Couldn\'t load the feed")').elementHandle()
      await p1.getByRole('button', { name: 'Try again' }).focus()
      const nAlerts = (await alertLog(p1)).length
      const t = Date.now()
      const resp = p1.waitForResponse((r) => /\/v1\/feed\?/.test(r.url()), { timeout: 30000 })
      await p1.keyboard.press('Enter')
      await L.wait(800)
      const duringLoad = { stillOld: await old.evaluate((e) => e.isConnected), focus: await L.activeInfo(p1) }
      const r = await resp
      await p1.waitForFunction((n) => window.__alerts.length > n, nAlerts, { timeout: 10000 }).catch(() => {})
      await L.wait(300)
      const after = { status: r.status(), ms: Date.now() - t, newAlerts: (await alertLog(p1)).length - nAlerts, oldDetached: !(await old.evaluate((e) => e.isConnected)), focus: await L.activeInfo(p1), badge: (await badgeLog(p1)).slice(-1)[0].text }
      retries.push({ duringLoad, after })
      log(`P1 Try again #${i + 1}: ${JSON.stringify(after)}`)
    }
    record('G-4-18', "P1: every Try again that fails again (503 after ~5 s) replaces the alert with a NEW role=alert element (one insertion per failure, the old node detached) and keyboard focus lands on the new Try again, never on <body>; the old alert stays on screen while the retry loads", retries.every((x) => x.after.status === 503 && x.after.newAlerts === 1 && x.after.oldDetached && x.after.focus && x.after.focus.tag === 'button' && /-retry$/.test(x.after.focus.id || '') && x.duringLoad.stillOld && x.after.badge === 'Service degraded'), retries)

    // ---------------- P2 (dev) and P3 (prod, dark): opened during the outage ----------------
    const tLate = Date.now()
    const curlish = (async () => { const t = Date.now(); const r = await fetch(`${C_API}/v1/feed/stream?tenantId=${tenant}&clientId=vf4-verifier`, { headers: { Accept: 'text/event-stream' } }); const body = await r.text(); return { status: r.status, ctype: r.headers.get('content-type'), body: body.slice(0, 200), ms: Date.now() - t } })()
    const [P2, P3] = await Promise.all([openWatched(browser, DEV, tenant, { colorScheme: 'light' }), openWatched(browser, PROD, tenant, { colorScheme: 'dark' })]); pages.push(P2, P3)
    log('P2 (dev) and P3 (prod, dark) opened during the outage')
    const direct = await curlish
    log(`direct stream request during the outage: ${JSON.stringify(direct)}`)
    record('G-4-10', 'a stream requested during the outage is answered 503 with JSON {"error":"database unavailable"} and no event-stream byte (after the ~5 s server-selection wait)', direct.status === 503 && /application\/json/.test(direct.ctype || '') && direct.body === '{"error":"database unavailable"}' && direct.ms >= 4000 && direct.ms < 9000, direct)
    await L.wait(45000)
    await P2.page.waitForSelector('[role="alert"]', { timeout: 5000 }).catch(() => {})
    for (const [name, P] of [['P2 dev', P2], ['P3 prod', P3]]) {
      const b = await badgeLog(P.page)
      const streamRes = P.net.filter((n) => n.ev === 'res' && n.kind === 'stream')
      const streamReq = P.net.filter((n) => n.ev === 'req' && n.kind === 'stream')
      const gets = P.net.filter((n) => n.ev === 'req' && n.kind === 'GET')
      const alertText = await P.page.locator('[role="alert"]:has-text("Couldn\'t load the feed")').innerText().catch(() => '')
      const gaps = streamReq.slice(1).map((r, i) => Math.round((r.t - streamReq[i].t) / 100) / 10)
      log(`${name} during the outage: badges ${JSON.stringify(fmtBadges(b))}`)
      log(`${name} during the outage: ${streamReq.length} stream requests (gaps s ${JSON.stringify(gaps)}), stream answers ${JSON.stringify(streamRes.map((r) => r.status))}, list GETs ${gets.length}`)
      const maxGets = name.startsWith('P2') ? 2 : 1 // dev: React StrictMode's development-only double mount issues the first GET twice
      record('G-4-17', `${name}: a page opened during the outage never reads 'Live' (every badge change recorded from first paint); it counts 'Reconnecting (n)' with the database wording on screen`, b.length > 0 && !b.some((x) => x.text === 'Live') && b.some((x) => /^Reconnecting \(\d+\)$/.test(x.text)) && alertText.includes(DB_503), { badges: fmtBadges(b), alert: alertText.replace(/\s+/g, ' ').slice(0, 200) })
      record('G-4-10', `${name}: every stream attempt during the outage is answered 503 with the JSON body (no 200, no event stream), and the attempts back off (gaps grow: ~5 s wait for the 503 plus 1, 2, 4, 8, 10 s)`, // run 1: Playwright could not read some 503 bodies ('?', the browser did not keep them); every status and content type is
      // checked, every body that could be read must be the JSON, and at least one must have been read
      streamRes.length >= 3 && streamRes.every((r) => r.status === 503 && /application\/json/.test(r.ctype || '') && (r.body === '{"error":"database unavailable"}' || r.body === '?')) && streamRes.some((r) => r.body === '{"error":"database unavailable"}') && gaps.length >= 2 && gaps[gaps.length - 1] > gaps[0], { answers: streamRes.map((r) => `${r.status} ${r.ctype} ${r.body}`), bodiesRead: streamRes.filter((r) => r.body !== '?').length, gapsS: gaps })
      record('G-4-17', `${name}: failed attempts reload nothing: the list was requested only when the page opened (${maxGets === 2 ? 'twice on the dev server: StrictMode' : 'once'})`, gets.length >= 1 && gets.length <= maxGets, { listGets: gets.length })
    }
    await axe(P2.page, "P2 feed opened during the outage: alert + 'Reconnecting (n)' badge (light)")
    await axe(P3.page, "P3 production bundle opened during the outage: alert + 'Reconnecting (n)' badge (dark)")
    const c3 = await contrastSamples(P3.page)
    record('F-65', "contrast on the alert + 'Reconnecting (n)' state (dark, production bundle): no sampled text below AA", Object.values(c3).every((g) => g.belowAA === 0), Object.fromEntries(Object.entries(c3).map(([k, v]) => [k, { n: v.sampled, min: v.min && Math.round(v.min * 100) / 100, belowAA: v.belowAA }])))
    await L.shot(P3.page, 'g4-p3-late-page-dark')

    // ---------------- the database comes back ----------------
    const outageLines = logLines().slice(l0 - 1)
    execSync('docker start vf4-mongo'); tStart = Date.now(); log('docker start vf4-mongo')
    const recov = {}
    await Promise.all([['P2 dev', P2], ['P3 prod', P3]].map(async ([name, P]) => {
      const card = await P.page.waitForSelector('article h3:has-text("held through the outage")', { timeout: 60000 }).then(() => Date.now() - tStart).catch(() => null)
      const live = await P.page.waitForSelector('text=/^Live$/', { timeout: 30000 }).then(() => Date.now() - tStart).catch(() => null)
      recov[name] = { cardMs: card, liveMs: live }
    }))
    await L.wait(2000)
    for (const [name, P] of [['P2 dev', P2], ['P3 prod', P3]]) {
      const b = await badgeLog(P.page)
      const getsAfter = P.net.filter((n) => n.ev === 'req' && n.kind === 'GET' && n.t >= tStart).length
      const firstOk = P.net.find((n) => n.ev === 'res' && n.kind === 'stream' && n.status === 200)
      const alerts = await P.page.locator('[role="alert"]').count()
      log(`${name} recovery: ${JSON.stringify(recov[name])}; badges after start ${JSON.stringify(fmtBadges(b.filter((x) => x.t >= tStart)))}; list GETs after start ${getsAfter}; first 200 stream at ${firstOk ? rel(firstOk.t) : null}`)
      record('G-4-17', `${name}: after 'docker start' the page recovers by itself (no click, no reload): the stream works, the badge reads 'Live', the list is reloaded exactly once and the card is back with no alert left`, recov[name].cardMs !== null && recov[name].liveMs !== null && getsAfter === 1 && alerts === 0 && b[b.length - 1].text === 'Live' && !b.some((x) => x.text === 'Live' && x.t < tStart), { ...recov[name], listGetsAfterStart: getsAfter, alertsLeft: alerts, badgesAfterStart: fmtBadges(b.filter((x) => x.t >= tStart)) })
    }
    // P1 after the outage: the documented behaviour is Try again
    await L.wait(3000)
    const b1c = await badgeLog(p1)
    const p1Streams = P1.net.filter((n) => n.ev === 'req' && n.kind === 'stream').length
    log(`P1 ${((Date.now() - tStart) / 1000).toFixed(1)} s after docker start, untouched: badge ${b1c[b1c.length - 1].text}; stream requests ${p1Streams} (at stop ${p1StreamsAtStop})`)
    await p1.getByRole('button', { name: 'Try again' }).focus()
    await p1.keyboard.press('Enter')
    const back1 = await p1.waitForSelector('article h3:has-text("held through the outage")', { timeout: 20000 }).then(() => true).catch(() => false)
    await L.wait(500)
    const focusBack = await L.activeInfo(p1)
    const b1d = await badgeLog(p1)
    record('G-4-17', "P1 after the outage: untouched it keeps saying 'Service degraded' with the error (its stream never dropped, so nothing reloads it, as frontend/README.md says); Try again loads the list and the badge returns to 'Live'", b1c[b1c.length - 1].text === 'Service degraded' && back1 && b1d[b1d.length - 1].text === 'Live' && p1Streams === p1StreamsAtStop, { untouchedBadge: b1c[b1c.length - 1].text, streamRequestsSinceStop: p1Streams - p1StreamsAtStop, badges: fmtBadges(b1d).slice(-3) })
    record('G-4-18', "P1: when Try again succeeds the alert leaves and focus moves to the results container (div tabindex=-1), not <body>", back1 && focusBack && focusBack.tag === 'div' && focusBack.tabindex === '-1', focusBack)
    // backend log over the outage window
    const warn = outageLines.filter((l) => / WARN /.test(l)).map((l) => l.replace(/^.*? WARN \d+ --- \[[^\]]*\] \[[^\]]*\] [^:]+: /, '').replace(/:.*$/, '').slice(0, 90))
    const counts = {}; for (const w of warn) counts[w] = (counts[w] || 0) + 1
    const errors = outageLines.filter((l) => / ERROR /.test(l)).length
    log(`backend C log during the outage: ${errors} ERROR, WARN by message ${JSON.stringify(counts)}`)
    record('F-92', 'backend C logged no ERROR line during the outage (WARN lines counted by message in the timeline)', errors === 0, { errors, warnByMessage: counts })
    for (const P of pages) record('F-92', 'no page errors', P.page.cap.errors.length === 0, P.page.cap.errors)
    // timeline of all requests
    for (const [name, P] of [['P1', P1], ['P2 dev', P2], ['P3 prod', P3]]) tl.push(`--- ${name} /v1 traffic (s since start)`, ...fmtNet(P.net))
    for (const [name, P] of [['P1', P1], ['P2 dev', P2], ['P3 prod', P3]]) tl.push(`--- ${name} badge changes`, JSON.stringify(fmtBadges(await badgeLog(P.page))), `--- ${name} role=alert insertions`, ...(await alertLog(P.page)).map((a) => `${rel(a.t)} ${a.text}`))
  } catch (e) { log('SCRIPT ERROR ' + (e.stack || e)); process.exitCode = 1 } finally {
    try { execSync('docker start vf4-mongo') } catch {}
    fs.writeFileSync(`${__dirname}/../results/g4-db-outage-timeline.txt`, `tStop=${tStop && rel(tStop)} tStart=${tStart && rel(tStart)}\n` + tl.join('\n') + '\n')
    await browser.close(); L.flush()
  }
})()
