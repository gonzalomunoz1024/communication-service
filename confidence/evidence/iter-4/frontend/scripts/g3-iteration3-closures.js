// Iteration-3 frontend changes in a real browser against a real backend (never mocked): my private backend A (:19200, iteration-3
// jar, Mongo db vf4_reconnect, ServiceNow instance-url set) behind my own Vite dev server (:3200); the empty-body proxy 502 through
// rp.js :3207 (EMPTY502=1, upstream port 19299 where nothing listens).
//   G-3-21 the duplicate-reference 409 in the form's terms, the suggested value actually accepted by the service, the server sentence
//          one click (or Tab + Enter) away; G-3-22 focus into the Resolve/Withdraw confirmation and back, keyboard only;
//   G-3-23 the badge's live region, 'Waiting for a tenant', the >= 24 px switch row; G-3-24 one feed GET and one stream per typed
//   tenant; G-3-25 a real automated notice: 'Automatic', no health: text, plain-words body, one actor name; G-3-20 empty-body 502.
process.env.UI = 'http://127.0.0.1:3200'; process.env.API = 'http://127.0.0.1:19200'
const L = require('./lib')
const { record, api, publishBody, newPage, field, UI, cardByTitle } = L
L.setFile('g3-iteration3')
const RUN = Date.now().toString(36)
const T = (n) => `vf4-${n}-${RUN}`
const visible = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()
const UNREACHABLE = 'The service is unreachable right now. Check that communication-service is running, then try again.'
const feedGets = (page, since = 0) => page.cap.requests.filter((r) => r.method === 'GET' && /\/v1\/feed\?/.test(r.url) && r.at >= since)
const streams = (page, since = 0) => page.cap.requests.filter((r) => r.url.includes('/v1/feed/stream') && r.at >= since)
const q = (r) => decodeURIComponent(new URL(r.url).search)
const tenantOf = (r) => new URL(r.url).searchParams.get('tenantId')

;(async () => {
  const browser = await L.launch()
  try {
    // ---------------- G-3-23: badge region, waiting state, row size ----------------
    {
      const { context, page } = await newPage(browser)
      await page.goto(UI + '/#/feed')
      await page.waitForSelector('[role="tablist"]')
      const region = L.badgeRegion(page)
      const regionText = (await region.innerText()).trim()
      const sw = page.getByRole('switch', { name: 'Live updates' })
      const swOn = await sw.getAttribute('aria-checked')
      const attrs = await region.evaluate((e) => ({ role: e.getAttribute('role'), live: e.getAttribute('aria-live'), tag: e.tagName.toLowerCase() }))
      record('G-3-23', "first visit, no tenant, Live updates ON: the badge says 'Waiting for a tenant' (not 'Paused') inside its own role=status aria-live=polite region", regionText === 'Waiting for a tenant' && swOn === 'true' && attrs.role === 'status' && attrs.live === 'polite', { regionText, switch: swOn, attrs })
      const snap = await page.locator('main').ariaSnapshot()
      record('G-3-23', 'the accessibility tree exposes the badge as a status node with its text (Playwright ariaSnapshot)', /- status: Waiting for a tenant/.test(snap), snap.split('\n').filter((l) => /status|switch/.test(l)).slice(0, 6))
      const row = page.locator('label', { has: sw })
      const rowBox = await row.boundingBox(); const swBox = await sw.boundingBox()
      await sw.click()
      const offText = (await region.innerText()).trim(); const swOff = await sw.getAttribute('aria-checked')
      record('G-3-23', "switching Live updates OFF (no tenant) reads 'Paused'; the switch row (label) is >= 24 px tall around the 30x18 switch", offText === 'Paused' && swOff === 'false' && rowBox.height >= 24, { offText, swOff, row: { w: Math.round(rowBox.width), h: Math.round(rowBox.height) }, switch: { w: Math.round(swBox.width), h: Math.round(swBox.height) } })
      // the row text (badge) is part of the label: clicking it toggles the switch back on
      await region.click()
      const viaRow = await sw.getAttribute('aria-checked')
      record('G-3-23', "clicking the row's text (the badge inside the label) toggles the switch: the labelled row is the click target", viaRow === 'true' && (await region.innerText()).trim() === 'Waiting for a tenant', { afterRowClick: viaRow, text: (await region.innerText()).trim() })
      // announcements: record every text the region takes while a tenant is entered and the stream opens
      await page.evaluate(() => { const el = document.querySelector('span[role="status"][aria-live="polite"]'); window.__badge = [{ t: Date.now(), text: el.innerText.trim() }]; new MutationObserver(() => { const t = el.innerText.trim(); if (window.__badge[window.__badge.length - 1].text !== t) window.__badge.push({ t: Date.now(), text: t }) }).observe(el, { subtree: true, childList: true, characterData: true }) })
      await L.setTenant(page, T('badge'))
      await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
      const seq = (await page.evaluate(() => window.__badge)).map((x) => x.text)
      record('G-3-23', "the live region's text goes 'Waiting for a tenant' → 'Connecting' → 'Live' once a tenant is entered (each change is a DOM text change inside the polite region, i.e. announced)", JSON.stringify(seq) === JSON.stringify(['Waiting for a tenant', 'Connecting', 'Live']), seq)
      const two = await page.locator('[role="status"][aria-live="polite"]').evaluateAll((els) => els.map((e) => ({ tag: e.tagName.toLowerCase(), text: e.innerText.trim() })))
      record('G-3-23', 'two separate polite regions on the feed: the badge (span) and the resolve announcement (p, empty until a resolve)', two.length === 2 && two[0].tag === 'span' && two[0].text === 'Live' && two[1].tag === 'p' && two[1].text === '', two)
      await context.close()
    }

    // ---------------- G-3-24: one load per typed tenant ----------------
    {
      const { context, page } = await newPage(browser)
      await page.goto(UI + '/#/feed')
      await page.waitForSelector('[role="tablist"]')
      const input = page.locator('input[aria-label="Tenant"]')
      const tenant = T('typed')
      await api('POST', '/v1/communications', publishBody(tenant, { title: 'typed tenant item' }))
      const t0 = Date.now()
      await input.click()
      await input.pressSequentially(tenant, { delay: 60 })
      const tLastKey = Date.now()
      const promptGone = await page.locator('main p', { hasText: 'Enter the tenant your consumers read' }).count()
      await page.waitForSelector('article h3:has-text("typed tenant item")', { timeout: 10000 })
      await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
      await L.wait(1500)
      const gets = feedGets(page, t0), sts = streams(page, t0)
      const delay = gets.length ? gets[0].at - tLastKey : null
      record('G-3-24', `typing "${tenant}" (${tenant.length} keys, 60 ms apart) into the header = exactly one GET /v1/feed and one stream, both for the full tenant, ~400 ms after the last key`, gets.length === 1 && sts.length === 1 && tenantOf(gets[0]) === tenant && tenantOf(sts[0]) === tenant && delay >= 300 && delay <= 900, { feedGets: gets.map(q), streams: sts.map(q), msFromLastKeyToGet: delay, typingMs: tLastKey - t0 })
      record('G-3-24', 'the tenant prompt goes as soon as the field has text (it follows the field, not the committed tenant)', promptGone === 0, { promptCountRightAfterTyping: promptGone })
      // Enter commits at once
      const t1 = Date.now()
      await input.fill(tenant + 'x')
      await input.press('Enter')
      const tEnter = Date.now()
      await L.wait(1200)
      const g1 = feedGets(page, t1)
      record('G-3-24', 'Enter commits the tenant at once: one GET for the new tenant well before the 400 ms pause', g1.length === 1 && tenantOf(g1[0]) === tenant + 'x' && g1[0].at - tEnter < 250, { feedGets: g1.map(q), msFromEnter: g1.length ? g1[0].at - tEnter : null })
      // blur commits at once
      const t2 = Date.now()
      await input.fill(tenant)
      await page.keyboard.press('Tab')
      const tBlur = Date.now()
      await L.wait(1200)
      const g2 = feedGets(page, t2)
      record('G-3-24', 'leaving the field (Tab) commits it at once: one GET', g2.length === 1 && tenantOf(g2[0]) === tenant && g2[0].at - tBlur < 250, { feedGets: g2.map(q), msFromBlur: g2.length ? g2[0].at - tBlur : null })
      // the stored tenant and a reload: one load in the production bundle (run 1 measured this on the dev server, where React
      // StrictMode mounts twice in development and the first GET is cancelled: 2 GETs, dev only; see probe-reload.js)
      const stored = await page.evaluate(() => localStorage.getItem('comm-tenant'))
      const t3 = Date.now()
      await page.reload(); await page.waitForSelector('article h3:has-text("typed tenant item")', { timeout: 10000 }); await L.wait(1200)
      const devGets = feedGets(page, t3).length
      const prod = await newPage(browser)
      await prod.page.goto('http://127.0.0.1:3205/#/feed')
      await prod.page.evaluate((t) => localStorage.setItem('comm-tenant', t), tenant)
      const t3b = Date.now()
      await prod.page.reload(); await prod.page.waitForSelector('article h3:has-text("typed tenant item")', { timeout: 10000 }); await L.wait(1200)
      record('G-3-24', 'after a reload the remembered tenant loads once in the production bundle (one GET, one stream); the dev server shows 2 GETs from React StrictMode\'s development-only double mount', stored === tenant && feedGets(prod.page, t3b).length === 1 && streams(prod.page, t3b).length === 1, { stored, prodGets: feedGets(prod.page, t3b).map(q), prodStreams: streams(prod.page, t3b).length, devServerGetsAfterReload: devGets })
      await prod.context.close()
      // observation: slow typing (a pause longer than 400 ms between keys) commits each pause, by design
      const t4 = Date.now()
      await input.fill('')
      await input.press('Enter')
      await input.pressSequentially('vf4', { delay: 650 })
      await L.wait(1200)
      const g4 = feedGets(page, t4)
      record('G-3-24', 'observation: typing with pauses longer than 400 ms commits after each pause (a GET per pause), as designed', true, { feedGets: g4.map(q) })
      record('G-3-24', 'no page errors while typing tenants', page.cap.errors.length === 0, { errors: page.cap.errors })
      await context.close()
    }

    // ---------------- G-3-21: real 409s through the form, the suggested values accepted ----------------
    {
      const { context, page } = await newPage(browser, { viewport: { width: 1280, height: 800 } })
      const tenant = T('dupref')
      const n = String(Date.now() % 10000000).padStart(7, '0')
      const ticket = `INC${n}`
      await L.gotoPublish(page, tenant)
      await page.waitForSelector('form')
      const publish = async (title, { ticketText = ticket.toLowerCase(), ref = '' } = {}) => {
        if (await page.getByRole('button', { name: 'Publish another' }).count()) await page.getByRole('button', { name: 'Publish another' }).click()
        await field.title(page).fill(title)
        await field.publisher(page).fill('vf4-oncall')
        await field.ticket(page).fill(ticketText)
        await field.ref(page).fill(ref)
        const [r] = await Promise.all([page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/v1/communications')), field.submit(page).click()])
        return { status: r.status(), json: await r.json() }
      }
      const first = await publish('original incident notice')
      record('G-3-21', `setup: a notice published with ticket ${ticket.toLowerCase()} → 201, externalRef defaults to ${ticket}`, first.status === 201 && first.json.externalRef === ticket, { status: first.status, externalRef: first.json.externalRef })
      const second = await publish('follow-up notice, same incident')
      await L.banner(page).waitFor({ timeout: 5000 })
      const text2 = await visible(L.banner(page))
      const focus2 = await L.activeInfo(page)
      record('G-3-21', "a real 409 for the reused incident number reads in the form's terms: the incident number doubles as the reference, it is permanent, suggested value <INC>-2; no uuid; the server sentence collapsed under 'What the service said'", second.status === 409 && text2 === `The service rejected this. ${ticket} is already the reference of a notice in tenant ${tenant} (the ServiceNow incident number doubles as the reference). References are permanent, even after a notice is retired, so a follow-up for the same incident needs another External reference, such as ${ticket}-2. What the service said` && !text2.includes(first.json.id) && second.json.error.includes(first.json.id), { status: second.status, text2, server: second.json.error })
      // keyboard: the banner has focus (G-2-10); Tab reaches the summary, Enter opens it
      await page.keyboard.press('Tab')
      const onSummary = await page.evaluate(() => document.activeElement && document.activeElement.tagName.toLowerCase())
      await page.keyboard.press('Enter')
      const openNow = await L.banner(page).locator('details').evaluate((d) => d.open)
      const said = await visible(L.banner(page).locator('details p'))
      record('G-3-21', "keyboard: focus is on the banner after the 409; Tab lands on the 'What the service said' summary and Enter opens it, showing the service's sentence verbatim", focus2.role === 'alert' && onSummary === 'summary' && openNow === true && said === second.json.error, { focusAfter409: focus2.role, onSummary, openNow, said })
      await L.shot(page, 'g3-409-details-open')
      // the suggestion is usable: the service accepts <INC>-2 as the follow-up's External reference, the ticket stays the incident
      await field.ref(page).fill(`${ticket}-2`)
      const [r3] = await Promise.all([page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/v1/communications')), field.submit(page).click()])
      const j3 = await r3.json()
      record('G-3-21', `the suggested value works: the follow-up published with External reference ${ticket}-2 and the same ticket → 201`, r3.status() === 201 && j3.externalRef === `${ticket}-2` && j3.ticket && j3.ticket.number === ticket, { status: r3.status(), externalRef: j3.externalRef, ticket: j3.ticket && j3.ticket.number })
      const fourth = await publish('a second follow-up', { ref: `${ticket}-2` })
      await L.banner(page).waitFor({ timeout: 5000 })
      const text4 = await visible(L.banner(page))
      record('G-3-21', `a typed External reference that is taken is named as such and the next number is suggested (${ticket}-3)`, fourth.status === 409 && text4 === `The service rejected this. ${ticket}-2 is already the External reference of a notice in tenant ${tenant}. References are permanent, even after a notice is retired, so a follow-up needs another External reference, such as ${ticket}-3. What the service said`, { status: fourth.status, text4 })
      await field.ref(page).fill(`${ticket}-3`)
      const [r5] = await Promise.all([page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/v1/communications')), field.submit(page).click()])
      record('G-3-21', `and ${ticket}-3 is accepted (201)`, r5.status() === 201, { status: r5.status() })
      await context.close()
    }

    // ---------------- G-3-22: keyboard-only resolve / withdraw, focus at every step ----------------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('kbd')
      await api('POST', '/v1/communications', publishBody(tenant, { title: 'kbd first', severity: 'CRITICAL' }))
      await api('POST', '/v1/communications', publishBody(tenant, { title: 'kbd second' }))
      const sched = await api('POST', '/v1/communications', publishBody(tenant, { title: 'kbd window', type: 'MAINTENANCE', severity: 'INFO', startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString() }))
      await page.goto(UI + '/#/feed')
      await page.evaluate(() => localStorage.setItem('comm-publisher', 'vf4-kbd-oncall'))
      await page.reload()
      await L.setTenant(page, tenant)
      await page.getByRole('combobox', { name: 'Type' }).selectOption('')
      await page.waitForSelector('article h3:has-text("kbd window")')
      await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
      // from the Refresh button, Tab forward until the first card's Resolve button
      await page.getByRole('button', { name: 'Refresh' }).focus()
      let tabs = 0, a = null
      for (; tabs < 15; tabs++) { await page.keyboard.press('Tab'); a = await L.activeInfo(page); if (a && a.tag === 'button' && a.text === 'Resolve') break }
      const card = cardByTitle(page, 'kbd first')
      record('G-3-22', `keyboard: Tab from Refresh reaches the first card's Resolve button (${tabs + 1} Tab presses)`, a && a.text === 'Resolve' && /-action$/.test(a.id || ''), a)
      await page.keyboard.press('Enter')
      const s1 = await page.evaluate(() => { const e = document.activeElement; const g = e.closest('[role="group"]'); const lab = g && document.getElementById(g.getAttribute('aria-labelledby')); return { tag: e.tagName.toLowerCase(), aria: e.getAttribute('aria-label'), placeholder: e.getAttribute('placeholder'), inGroup: !!g, groupName: lab && lab.textContent } })
      const groupSnap = await card.ariaSnapshot()
      record('G-3-22', "Enter on Resolve: focus moves into the confirmation, onto the note field (aria-label 'Resolution note (optional)'), inside a role=group named by the question", s1.tag === 'input' && s1.aria === 'Resolution note (optional)' && s1.inGroup && s1.groupName === `Resolve as vf4-kbd-oncall? It leaves tenant ${tenant}'s feed at once and cannot be reopened.`, { ...s1, aria_snapshot_group: groupSnap.split('\n').filter((l) => /group|textbox|button "(Cancel|Resolve)"/.test(l)) })
      await page.keyboard.press('Tab')
      const onCancel = await L.activeInfo(page)
      await page.keyboard.press('Enter')
      const back = await L.activeInfo(page)
      record('G-3-22', "Tab → Cancel, Enter: the confirmation closes and focus returns to the card's Resolve button (not <body>)", onCancel.text === 'Cancel' && back.tag === 'button' && back.text === 'Resolve' && /-action$/.test(back.id || '') && (await card.getByRole('group').count()) === 0, { onCancel: onCancel.text, back })
      await page.keyboard.press('Enter')
      await page.keyboard.type('fixed from the keyboard')
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
      const onConfirm = await L.activeInfo(page)
      const [rr] = await Promise.all([page.waitForResponse((x) => x.url().endsWith('/retire')), page.keyboard.press('Enter')])
      await card.waitFor({ state: 'detached', timeout: 5000 })
      await L.wait(200)
      const afterResolve = await L.activeInfo(page)
      const announced = (await L.announcement(page).innerText()).trim()
      const body = JSON.parse(page.cap.requests.find((r) => r.url.endsWith('/retire')).postData)
      record('G-3-22', 'Enter again, type a note, Tab Tab to the confirm button, Enter: POST /retire {actor, note} → 200, the card leaves, focus is on the results wrapper (div tabindex=-1), the resolve is announced', onConfirm.text === 'Resolve' && /-confirm$/.test(onConfirm.id || '') && rr.status() === 200 && body.note === 'fixed from the keyboard' && body.actor === 'vf4-kbd-oncall' && afterResolve.tag === 'div' && afterResolve.tabindex === '-1' && announced === 'Resolved “kbd first”. It has left every consumer\'s feed.', { onConfirm, status: rr.status(), body, afterResolve, announced })
      // Withdraw on the scheduled window, keyboard only, starting from the results wrapper that holds focus now
      let w = null
      for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); w = await L.activeInfo(page); if (w && w.tag === 'button' && w.text === 'Withdraw') break }
      await page.keyboard.press('Enter')
      const s2 = await page.evaluate(() => { const e = document.activeElement; const g = e.closest('[role="group"]'); const lab = g && document.getElementById(g.getAttribute('aria-labelledby')); return { tag: e.tagName.toLowerCase(), aria: e.getAttribute('aria-label'), groupName: lab && lab.textContent } })
      record('G-3-22', "Withdraw (a notice that has not started): Enter moves focus to 'Reason (optional)' inside the group named by the Withdraw question", w && w.text === 'Withdraw' && s2.tag === 'input' && s2.aria === 'Reason (optional)' && s2.groupName === `Withdraw as vf4-kbd-oncall? Withdrawing retires it before it starts: tenant ${tenant}'s consumers never see it and it cannot be reopened.`, { from: w, ...s2 })
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter')
      const wback = await L.activeInfo(page)
      record('G-3-22', "Cancel on the Withdraw confirmation gives focus back to the card's Withdraw button", wback.tag === 'button' && wback.text === 'Withdraw' && /-action$/.test(wback.id || ''), wback)
      await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
      const [wr] = await Promise.all([page.waitForResponse((x) => x.url().endsWith('/retire')), page.keyboard.press('Enter')])
      await cardByTitle(page, 'kbd window').waitFor({ state: 'detached', timeout: 5000 })
      await L.wait(200)
      const afterW = await L.activeInfo(page)
      const server = await api('GET', `/v1/communications/${sched.json.id}`)
      record('G-3-22', 'withdrawing from the keyboard: 200, server RETIRED, focus on the results wrapper, never <body>', wr.status() === 200 && server.json.status === 'RETIRED' && afterW.tag === 'div' && afterW.tabindex === '-1', { status: wr.status(), server: server.json.status, afterW })
      record('G-3-22', 'no page errors during the keyboard flows', page.cap.errors.length === 0, { errors: page.cap.errors })
      await context.close()
    }

    // ---------------- G-3-25: a real automated notice ----------------
    {
      const tenant = T('auto')
      const service = `vf4-auto-svc-${RUN}`
      const report = (status, extra = {}) => api('POST', '/v1/health/reports', { tenantId: tenant, service, status, ...extra })
      const { context, page } = await newPage(browser)
      await L.gotoFeed(page, tenant)
      await page.waitForSelector('text=All clear')
      await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
      const d1 = await report('DOWN', { components: { db: { status: 'DOWN', details: { error: 'connection refused' } } }, message: 'database unreachable' })
      const d2 = await report('DOWN', { components: { db: { status: 'DOWN', details: { error: 'connection refused' } } }, message: 'database unreachable' })
      const card = cardByTitle(page, `${service} is down`)
      const shown = await card.waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
      const feed = await api('GET', `/v1/feed?tenantId=${tenant}`)
      const item = feed.json.items.find((i) => i.title === `${service} is down`) || {}
      const cardText = shown ? await visible(card) : ''
      const tags = shown ? await card.locator('span[title="Raised by an automated health check"]').allInnerTexts() : []
      const anyHealthText = shown ? await card.evaluate((el) => el.innerText.includes('health:') || [...el.querySelectorAll('[title]')].some((e) => e.getAttribute('title').includes('health:'))) : null
      record('G-3-25', "two DOWN reports open a real automated notice; its card shows an 'Automatic' tag (title 'Raised by an automated health check') and nowhere the internal health:<monitor>:<n> reference the API carries", d1.status === 202 && d2.status === 202 && shown && /^health:[0-9a-f-]+:\d+$/.test(item.externalRef || '') && tags.length === 1 && tags[0].trim() === 'Automatic' && anyHealthText === false, { reports: [d1.status, d2.status], apiExternalRef: item.externalRef, tags, anyHealthText })
      const bodyText = item.body || ''
      record('G-3-25', 'the notice body reads as plain words (backend half): no Markdown ** markers, timestamps to the second (no fractional seconds), the component named', !/\*\*/.test(bodyText) && !/\d{2}:\d{2}:\d{2}\.\d+/.test(bodyText) && /db/.test(bodyText) && !/\*\*/.test(cardText), { body: bodyText, cardText: cardText.slice(0, 400) })
      await L.shot(page, 'g3-automatic-notice')
      const u1 = await report('UP'); const u2 = await report('UP')
      const gone = await card.waitFor({ state: 'detached', timeout: 15000 }).then(() => true).catch(() => false)
      const perma = await api('GET', `/v1/communications/${item.id}`)
      const hist = (perma.json && perma.json.history) || []
      const actors = [...new Set(hist.map((h) => h.actor))]
      record('G-3-25', 'two UP reports retire it: the card leaves live; the history is signed by one actor, the name the notice was published under (backend half)', u1.status === 202 && u2.status === 202 && gone && perma.json.status === 'RETIRED' && actors.length === 1 && actors[0] === item.publisher, { gone, status: perma.json.status, publisher: item.publisher, actors, last: hist.slice(-1)[0] })
      await context.close()
    }

    // ---------------- G-3-20: a proxy 502 with an EMPTY body is still 'unreachable' (production bundle behind rp.js :3207) ----------------
    {
      const { context, page } = await newPage(browser)
      await page.goto('http://127.0.0.1:3207/#/feed')
      await L.setTenant(page, T('empty502'))
      const shown = await page.waitForSelector("text=Couldn't load the feed", { timeout: 15000 }).then(() => true).catch(() => false)
      const msg = shown ? await visible(page.getByText("Couldn't load the feed").locator('..')) : ''
      const res = page.cap.responses.find((r) => /\/v1\/feed\?/.test(r.url))
      const tryAgain = await page.getByRole('button', { name: 'Try again' }).count()
      record('G-3-20', "production bundle behind a proxy whose upstream is dead (502, EMPTY body, no content-type): the feed says 'Couldn't load the feed' + the unreachable wording, with Try again", shown && res && res.status === 502 && msg === `Couldn't load the feed ${UNREACHABLE}` && tryAgain === 1, { status: res && res.status, contentType: res && res.headers['content-type'], msg, tryAgain })
      await page.goto('http://127.0.0.1:3207/#/publish')
      await page.waitForSelector('form')
      await field.title(page).fill('publish to a dead upstream')
      await field.publisher(page).fill('vf4-oncall')
      await field.submit(page).click()
      await L.banner(page).waitFor({ timeout: 10000 })
      const b = await visible(L.banner(page))
      record('G-3-20', 'the same empty-body 502 on publish → the unreachable banner (no "rejected" prefix, no details), the form stays editable', b === UNREACHABLE && (await field.title(page).inputValue()) === 'publish to a dead upstream', { banner: b })
      await context.close()
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
