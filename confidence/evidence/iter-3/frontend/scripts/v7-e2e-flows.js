// F-90 human flow with two browser tabs on the shared stack (publish with ticket and services → appears live in the other tab →
// consumer GET with the service filter → resolve from the UI → gone from both → permalink RETIRED with the note).
// F-92 UI failure paths: Mongo down behind my private backend C (:19202 → container vf3-mongo :27117, UI :3201): 503 within ~5 s,
// what the UI says, whether the open stream survives, recovery without a backend restart; unknown/expired Last-Event-ID → snapshot.
const { execSync } = require('child_process')
const fs = require('fs')
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant, field, UI, cardByTitle } = L
L.setFile('v7-e2e-flows')
const RUN = Date.now().toString(36)
const C_API = 'http://127.0.0.1:19202', C_UI = 'http://127.0.0.1:3201'
const UNREACHABLE = 'The service is unreachable right now. Check that communication-service is running, then try again.'
const DB_503 = 'The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment.'
// iteration 3: G-3-20 (the service's own 503 reads as a database outage), G-3-22 (focus back to the confirm button after a real
// failed resolve during the outage), G-3-1 (a stream opened during the outage) and recovery measured without any click
const r1 = (n) => Math.round(n * 10) / 10

;(async () => {
  const browser = await L.launch()
  const tl = []; const T0 = Date.now(); const log = (m) => tl.push(`+${((Date.now() - T0) / 1000).toFixed(1)}s ${m}`)
  try {
    // ---------- F-90 ----------
    {
      const tenant = `vf3-e2e-${RUN}`
      const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
      const publisherTab = await context.newPage()
      const consumerTab = await context.newPage()
      const frames = []
      const cdp = await context.newCDPSession(consumerTab); await cdp.send('Network.enable')
      cdp.on('Network.eventSourceMessageReceived', (e) => { let title = ''; try { title = JSON.parse(e.data).communication.title } catch {} frames.push({ at: Date.now(), name: e.eventName, id: e.eventId, title }) })
      const consumerGets = []
      consumerTab.on('request', (r) => { if (/\/v1\/feed\?/.test(r.url())) consumerGets.push(Date.now()) })
      await consumerTab.goto(UI + '/#/feed')
      await setTenant(consumerTab, tenant)
      await consumerTab.waitForSelector('text=All clear')
      await consumerTab.waitForSelector('text=/^Live$/', { timeout: 20000 })
      await publisherTab.goto(UI + '/#/publish')
      await setTenant(publisherTab, tenant)
      await publisherTab.waitForSelector('form')
      await field.title(publisherTab).fill('Payments API returning 503s')
      await field.body(publisherTab).fill('Card payments fail for roughly 30% of requests.')
      await field.services(publisherTab).fill('payments-api, checkout-web')
      await field.ticket(publisherTab).fill('inc0090001')
      await field.publisher(publisherTab).fill('vf3-payments-oncall')
      const getsBefore = consumerGets.length
      const [res] = await Promise.all([publisherTab.waitForResponse((r) => r.request().method() === 'POST'), field.submit(publisherTab).click()])
      const created = await res.json()
      await publisherTab.waitForSelector('text=Outage published')
      const t0 = Date.now()
      const liveInB = await consumerTab.waitForSelector('article h3:has-text("Payments API returning 503s")', { timeout: 10000 }).then(() => Date.now() - t0).catch(() => null)
      const bCard = cardByTitle(consumerTab, 'Payments API returning 503s')
      const bText = await bCard.textContent()
      record('F-90', 'publishing in tab A (ticket + two services) → the card appears in tab B\'s feed without a refresh (created frame, no new GET), with the ticket chip and service chips', res.status() === 201 && liveInB !== null && consumerGets.length === getsBefore && frames.some((f) => f.name === 'created' && f.title === 'Payments API returning 503s') && /INC0090001/.test(bText) && /payments-api/.test(bText) && /checkout-web/.test(bText), { status: res.status(), msUntilVisibleInB: liveInB, newGets: consumerGets.length - getsBefore, frames: frames.map((f) => `${f.name}#${f.id} ${f.title}`) })
      await L.shot(consumerTab, 'e2e-consumer-live')
      const consumer = await api('GET', `/v1/feed?tenantId=${tenant}&service=payments-api`)
      const consumerOther = await api('GET', `/v1/feed?tenantId=${tenant}&service=search-api`)
      record('F-90', 'a consumer GET /v1/feed with the service filter lists it (and a different service does not)', consumer.status === 200 && consumer.json.items.some((i) => i.id === created.id && i.ticket && i.ticket.number === 'INC0090001') && consumerOther.json.items.length === 0, { withFilter: consumer.json.items.map((i) => i.title), otherService: consumerOther.json.items.length })
      await publisherTab.getByRole('button', { name: 'View in feed' }).click()
      const aCard = cardByTitle(publisherTab, 'Payments API returning 503s')
      await aCard.waitFor({ timeout: 10000 })
      await aCard.getByRole('button', { name: 'Resolve' }).click()
      await aCard.getByPlaceholder('Resolution note (optional)').fill('acquirer failover completed')
      const [rres] = await Promise.all([publisherTab.waitForResponse((r) => r.url().endsWith('/retire')), aCard.getByRole('button', { name: 'Resolve' }).click()])
      const t1 = Date.now()
      const goneA = await aCard.waitFor({ state: 'detached', timeout: 5000 }).then(() => true).catch(() => false)
      const goneB = await bCard.waitFor({ state: 'detached', timeout: 10000 }).then(() => Date.now() - t1).catch(() => null)
      const perma = await api('GET', `/v1/communications/${created.id}`)
      const last = (perma.json.history || []).slice(-1)[0] || {}
      const consumerAfter = await api('GET', `/v1/feed?tenantId=${tenant}&service=payments-api`)
      record('F-90', 'resolving from tab A with a note → 200; the card leaves tab A at once and tab B on the retired frame; the consumer feed is empty; the permalink is RETIRED with the actor and note in its history', rres.status() === 200 && goneA && goneB !== null && frames.some((f) => f.name === 'retired' && f.title === 'Payments API returning 503s') && perma.json.status === 'RETIRED' && last.actor === 'vf3-payments-oncall' && /acquirer failover completed/.test(last.action) && consumerAfter.json.items.length === 0, { retire: rres.status(), goneA, msUntilGoneInB: goneB, permalinkStatus: perma.json.status, last, consumerAfter: consumerAfter.json.items.length })
      await L.shot(consumerTab, 'e2e-consumer-after-resolve')
      await context.close()
    }

    // ---------- F-92: Mongo down behind my private backend C ----------
    {
      const tenant = `vf3-mongodown-${RUN}`
      const seed = await api('POST', '/v1/communications', publishBody(tenant, { title: 'before mongo went away' }), {}, C_API)
      const { context, page } = await newPage(browser)
      await page.goto(C_UI + '/#/feed')
      await setTenant(page, tenant)
      await page.waitForSelector('article h3:has-text("before mongo went away")')
      await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
      log('feed Live on backend C')
      record('F-92', 'setup: backend C (:19202, its own Mongo container) serves the feed and the stream is Live', seed.status === 201, { seed: seed.status })
      // open the Resolve confirmation from the keyboard while the database is still up
      const seedCard = cardByTitle(page, 'before mongo went away')
      await seedCard.getByRole('button', { name: 'Resolve' }).focus(); await page.keyboard.press('Enter')
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
      execSync('docker stop vf3-mongo'); const tStop = Date.now(); log('docker stop vf3-mongo')
      const tRes = Date.now()
      const [rres] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/retire'), { timeout: 30000 }), page.keyboard.press('Enter')])
      await seedCard.locator('[role="alert"]').waitFor({ timeout: 10000 })
      const resErr = (await seedCard.locator('[role="alert"]').innerText()).trim()
      const resFocus = await L.activeInfo(page)
      log(`resolve during the outage → ${rres.status()} after ${Date.now() - tRes} ms: ${resErr}`)
      record('F-92', "G-3-20/G-3-22: resolving while Mongo is down → the service's 503 shows the database wording under the confirm row, the card stays, and focus is back on the confirm button", rres.status() === 503 && resErr === DB_503 && (await seedCard.count()) === 1 && resFocus && /-confirm$/.test(resFocus.id || ''), { status: rres.status(), ms: Date.now() - tRes, resErr, focus: resFocus })
      await seedCard.getByRole('button', { name: 'Cancel' }).click()
      const tGet = Date.now()
      const down = await api('GET', `/v1/feed?tenantId=${tenant}`, undefined, {}, C_API)
      const getMs = Date.now() - tGet
      log(`GET /v1/feed → ${down.status} ${down.text.slice(0, 80)} after ${getMs} ms`)
      record('F-92', 'G-2-4 contract: with Mongo down the backend answers 503 {"error":"database unavailable"} within ~5 s (server-selection timeout), not 500 after 30 s', down.status === 503 && down.json && down.json.error === 'database unavailable' && getMs < 9000, { status: down.status, body: down.text.slice(0, 120), ms: getMs })
      const tClick = Date.now()
      await page.getByRole('button', { name: 'Refresh' }).click()
      const shown = await page.waitForSelector("text=Couldn't load the feed", { timeout: 20000 }).then(() => Date.now() - tClick).catch(() => null)
      const msg = shown !== null ? await page.getByText("Couldn't load the feed").locator('..').textContent() : '(not shown)'
      const badgeAt5 = await L.indicator(page)
      record('F-92', "G-3-20 (closes GAP-frontend2-1): with Mongo down a Refresh shows 'Couldn't load the feed' with the service's reason in the database wording (not 'unreachable') and Try again, while the badge keeps reporting the open stream (Live)", shown !== null && shown < 10000 && msg.includes(DB_503) && !msg.includes(UNREACHABLE) && (await page.getByRole('button', { name: 'Try again' }).count()) === 1 && badgeAt5 === 'Live', { msUntilErrorState: shown, msg: msg.slice(0, 260), badge: badgeAt5 })
      await L.shot(page, 'mongo-down-feed')
      // the open stream: does it survive, and what does the badge say?
      const streamStatuses = () => page.cap.responses.filter((r) => r.url.includes('/v1/feed/stream') && r.at > tStop).map((r) => r.status)
      await L.wait(16000)
      const badgeAt20 = await L.indicator(page)
      record('F-92', 'while Mongo is down the already-open SSE stream is not torn down by the UI (badge sampled at +5 s and +21 s; stream responses after the stop listed)', true, { badgeAt5, badgeAt21: badgeAt20, streamResponsesAfterStop: streamStatuses() })
      // publish from the UI while Mongo is down
      await page.goto(C_UI + '/#/publish')
      await page.waitForSelector('form')
      await field.title(page).fill('publish while mongo is down')
      await field.publisher(page).fill('vf3-oncall')
      const tPub = Date.now()
      const [pres] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 20000 }), field.submit(page).click()])
      await L.banner(page).waitFor({ timeout: 5000 })
      const pubBanner = (await L.banner(page).textContent()).trim()
      record('F-92', "G-3-20: publishing while Mongo is down: the POST is answered 503 within ~5 s, the banner gives the database wording (no 'rejected' prefix), the draft is kept and editable", pres.status() === 503 && Date.now() - tPub < 9000 && pubBanner === DB_503 && (await field.title(page).inputValue()) === 'publish while mongo is down' && (await field.title(page).isEditable()), { status: pres.status(), ms: Date.now() - tPub, banner: pubBanner })
      // a stream opened while the database is down (G-3-1: the service ends it with one WARN): what the feed shows meanwhile
      const tReopen = Date.now()
      await page.goto(C_UI + '/#/feed')
      await page.waitForSelector("text=Couldn't load the feed", { timeout: 20000 }).catch(() => {})
      const badges = []
      for (let i = 0; i < 24; i++) { const b = await L.indicator(page, 300); if (badges[badges.length - 1] !== b) badges.push(b); await L.wait(500) }
      const reopenMsg = await page.getByText("Couldn't load the feed").locator('..').innerText().catch(() => '(no error state)')
      const sr = page.cap.responses.filter((r) => r.url.includes('/v1/feed/stream') && r.at > tReopen).map((r) => r.status)
      log(`feed reopened during the outage: badges ${JSON.stringify(badges)} stream responses ${JSON.stringify(sr)}`)
      record('F-92', 'observation (G-3-1 + UI): the feed opened while Mongo is down shows the database wording; the badge states and stream answers over 12 s are recorded', reopenMsg.includes(DB_503), { msg: reopenMsg.replace(/\s+/g, ' ').slice(0, 220), badges, streamResponses: sr })
      execSync('docker start vf3-mongo'); const tStart = Date.now(); log('docker start vf3-mongo')
      let back = null
      for (let i = 0; i < 60; i++) { const r = await api('GET', `/v1/feed?tenantId=${tenant}`, undefined, {}, C_API); if (r.status === 200) { back = Date.now() - tStart; break } await L.wait(1000) }
      log(`backend C answers 200 again ${back} ms after mongo started`)
      record('F-92', 'after Mongo is back the backend recovers without a restart (GET /v1/feed → 200 again)', back !== null && back < 60000, { msUntilRecovered: back })
      // no click, no navigation: does the open page recover by itself?
      const selfBack = await page.waitForSelector('article h3:has-text("before mongo went away")', { timeout: 30000 }).then(() => Date.now() - tStart).catch(() => null)
      const liveBack = await page.waitForSelector('text=/^Live$/', { timeout: 30000 }).then(() => true).catch(() => false)
      let viaTryAgain = null
      if (selfBack === null) { const t = Date.now(); await page.getByRole('button', { name: 'Try again' }).click(); viaTryAgain = await page.waitForSelector('article h3:has-text("before mongo went away")', { timeout: 15000 }).then(() => Date.now() - t).catch(() => null) }
      log(`UI after mongo start: card back without a click after ${selfBack} ms, Live=${liveBack}, via Try again=${viaTryAgain}`)
      record('F-92', 'after Mongo is back the open feed recovers without a reload: the item is listed again (by itself, or with Try again as the message says) and the stream is Live', (selfBack !== null || viaTryAgain !== null) && liveBack, { msUntilCardBackWithoutClick: selfBack, msViaTryAgain: viaTryAgain, liveBack })
      await context.close()
    }

    // ---------- F-92 / F-20: unknown or expired Last-Event-ID → snapshot ----------
    {
      const tenant = `vf3-lei-${RUN}`
      await api('POST', '/v1/communications', publishBody(tenant, { title: 'snapshot fallback seed' }))
      const read = async (p, headers = {}) => new Promise((resolve) => { const ctl = new AbortController(); const chunks = []; fetch(`${L.API}${p}`, { headers: { 'X-Client-Id': 'vf3-verifier', ...headers }, signal: ctl.signal }).then(async (r) => { const reader = r.body.getReader(); const dec = new TextDecoder(); const t = setTimeout(() => ctl.abort(), 2500); try { while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(dec.decode(value)) } } catch {} clearTimeout(t); resolve({ status: r.status, body: chunks.join('') }) }).catch((e) => resolve({ status: 0, body: String(e) })) })
      const names = (b) => [...b.matchAll(/^event: ?(\w+)$/gm)].map((m) => m[1])
      const unknown = await read(`/v1/feed/stream?tenantId=${tenant}&lastEventId=999999999`)
      const expired = await read(`/v1/feed/stream?tenantId=${tenant}&lastEventId=1`)
      const header = await read(`/v1/feed/stream?tenantId=${tenant}`, { 'Last-Event-ID': '999999999' })
      record('F-92', 'an id never issued (999999999) or long expired from the log (1), as ?lastEventId= or as the Last-Event-ID header → 200 with a fresh snapshot (the fallback the client relies on)', unknown.status === 200 && names(unknown.body).includes('snapshot') && expired.status === 200 && names(expired.body)[0] === 'snapshot' && header.status === 200 && names(header.body).includes('snapshot'), { unknown: names(unknown.body).slice(0, 3), expired: names(expired.body).slice(0, 3), header: names(header.body).slice(0, 3) })
    }
  } catch (e) { log('SCRIPT ERROR ' + e.message); console.error(e) } finally {
    try { execSync('docker start vf3-mongo') } catch {}
    const R = `${__dirname}/../results`; fs.mkdirSync(R, { recursive: true })
    fs.writeFileSync(`${R}/v7-mongo-down-timeline.txt`, tl.join('\n') + '\n')
    await browser.close()
    L.flush()
  }
})()
