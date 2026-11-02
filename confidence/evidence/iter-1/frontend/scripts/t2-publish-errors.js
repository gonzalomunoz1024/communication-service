// F-56 publish submit, F-01 publish contract via UI, F-02 draft, F-09 ticket, F-57 server error surfacing, F-07 server validation surfacing
// Iteration-1 copy of the iteration-0 script. Expectations updated for the deliberate changes: 409 wording (G-1-16), unreachable
// wording + Try again reopening the stream (G-1-14); the dead-backend case runs on my own dev server (:3110 → dead port) and on
// the static build behind rp.js (:3128 → dead port, answers 502 like a production proxy).
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant, field, form, alerts, UI } = L
L.setFile('t2-publish-errors')
const RUN = Date.now().toString(36)
const T = (n) => `fe1-${n}-${RUN}`
const UNREACHABLE = 'The service is unreachable right now. Check that communication-service is running, then try again.'
const DEAD = [['dev proxy (vite → dead port, answers 502)', 'http://127.0.0.1:3110'], ['static build behind rp.js (→ dead port, 502)', 'http://127.0.0.1:3128']]
const feedReqs = (page) => page.cap.requests.filter((r) => r.method === 'GET' && /\/v1\/feed\?/.test(r.url))
const streamReqs = (page) => page.cap.requests.filter((r) => r.url.includes('/v1/feed/stream'))

async function fillBasics(page, { title, publisher = 'fe-oncall', type } = {}) {
  if (type) await field.type(page, type).click()
  await field.title(page).fill(title)
  await field.publisher(page).fill(publisher)
}

;(async () => {
  const browser = await L.launch()
  try {
    // ---------- F-56 / F-01: publish an outage from the UI ----------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('pub')
      await L.gotoPublish(page, tenant)
      await page.waitForSelector('form')
      await fillBasics(page, { title: 'UI outage one' })
      await field.services(page).fill('payments-api')
      await page.route('**/v1/communications', async (route) => { await L.wait(700); await route.continue() })
      const submit = field.submit(page)
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')),
        submit.click().then(async () => ({ busy: await submit.getAttribute('aria-busy'), disabled: await submit.isDisabled() })).then((b) => { page.__busy = b }),
      ])
      await page.unroute('**/v1/communications')
      const json = await res.json()
      record('F-01', 'UI publish → 201 with Location header, status ACTIVE, audience CUSTOMERS, CREATED visible via API', res.status() === 201 && /\/v1\/communications\//.test(res.headers()['location'] || '') && json.status === 'ACTIVE' && json.audience === 'CUSTOMERS' && json.tenantId === tenant, { status: res.status(), location: res.headers()['location'], status2: json.status, audience: json.audience })
      record('F-56', 'submit button shows a busy state while the POST is in flight', page.__busy && page.__busy.busy === 'true' && page.__busy.disabled === true, page.__busy)
      await page.waitForSelector('text=Outage published')
      const cardText = await page.locator('.animate-scale-in').textContent()
      const focused = await page.evaluate(() => ({ tag: document.activeElement && document.activeElement.tagName, text: document.activeElement && document.activeElement.textContent }))
      record('F-56', "confirmation card: 'Outage published', 'Live in the <tenant> feed now.', severity tag, id tag, Publish another + View in feed", /Outage published/.test(cardText) && cardText.includes(`Live in the ${tenant} feed now.`) && /Major/.test(cardText) && cardText.includes(json.id) && (await page.getByRole('button', { name: 'Publish another' }).count()) === 1 && (await page.getByRole('button', { name: 'View in feed' }).count()) === 1, cardText.slice(0, 300))
      record('F-56', 'the confirmation heading receives focus (read out, in view) — iteration-1 behaviour', focused.tag === 'H2' && /Outage published/.test(focused.text), focused)
      const remembered = await page.evaluate(() => localStorage.getItem('comm-publisher'))
      record('F-56', 'publisher remembered in localStorage comm-publisher', remembered === 'fe-oncall', remembered)
      await page.getByRole('button', { name: 'View in feed' }).click()
      await page.waitForSelector('article')
      const inActive = await page.locator('section', { has: page.locator('h2', { hasText: 'Active now' }) }).locator('article h3', { hasText: 'UI outage one' }).count()
      record('F-56', "'View in feed' switches to the Feed tab and the item is listed under Active now", page.url().endsWith('#/feed') && inActive === 1, `url=${page.url()} found=${inActive}`)
      await page.goto(UI + '/#/publish')
      await page.waitForSelector('form')
      record('F-56', 'after a reload the publisher field is prefilled from localStorage', (await field.publisher(page).inputValue()) === 'fe-oncall', await field.publisher(page).inputValue())
      await field.type(page, 'Incident').click()
      await field.title(page).fill('UI incident with ticket')
      await field.ticket(page).fill('inc0012345')
      const [res2] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), field.submit(page).click()])
      const j2 = await res2.json()
      record('F-09', 'ticket typed lower-case is sent upper-cased, stored as servicenow INC0012345, externalRef defaults to the number', res2.status() === 201 && j2.ticket && j2.ticket.number === 'INC0012345' && j2.ticket.system === 'servicenow' && j2.externalRef === 'INC0012345', { status: res2.status(), ticket: j2.ticket, externalRef: j2.externalRef })
      await page.waitForSelector('text=Incident published')
      const chip = page.locator('.animate-scale-in').getByText('INC0012345')
      record('F-56', 'confirmation card shows the ticket chip', (await chip.count()) === 1, 'chip present')
      await page.getByRole('button', { name: 'Publish another' }).click()
      await page.waitForSelector('form')
      const kept = { tenant: await field.tenant(page).inputValue(), publisher: await field.publisher(page).inputValue(), incident: await field.type(page, 'Incident').getAttribute('aria-checked'), title: await field.title(page).inputValue(), ticket: await field.ticket(page).inputValue() }
      record('F-56', "'Publish another' keeps tenant, publisher and type, clears the rest", kept.tenant === tenant && kept.publisher === 'fe-oncall' && kept.incident === 'true' && kept.title === '' && kept.ticket === '', kept)
      await field.type(page, 'Change').click()
      await field.severity(page, 'Info').click()
      await field.title(page).fill('UI change')
      const [res3] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), field.submit(page).click()])
      record('F-56', 'CHANGE at INFO publishes (201) and confirms', res3.status() === 201 && (await page.waitForSelector('text=Change published')) !== null, `status=${res3.status()}`)
      await page.getByRole('button', { name: 'Publish another' }).click()
      await field.type(page, 'Maintenance').click()
      await field.title(page).fill('UI maintenance tomorrow')
      await field.schedule(page).click()
      await field.starts(page).fill(await L.localPlus(page, 24 * 3600000))
      await field.ends(page).fill(await L.localPlus(page, 26 * 3600000))
      const [res4] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), field.submit(page).click()])
      const j4 = await res4.json()
      await page.waitForSelector('text=Maintenance scheduled')
      const sched = await page.locator('.animate-scale-in').textContent()
      record('F-56', "future maintenance → 201 SCHEDULED, card says 'Maintenance scheduled' / 'Goes live in 24h|1d.'", res4.status() === 201 && j4.status === 'SCHEDULED' && /Goes live in (1d|24h)\./.test(sched), { status: j4.status, text: sched.slice(0, 160) })
      // every type with and without a ticket (the four above cover outage∅, incident+ticket, change∅, maintenance∅)
      // one ticket number per combo: externalRef defaults to the number, and a reused number is a duplicate externalRef (409) within the tenant
      const combos = [['Outage', 'INC0045671'], ['Incident', null], ['Maintenance', 'INC0045673'], ['Change', 'INC0045674']]
      const outcomes = []
      for (const [type, ticket] of combos) {
        if (await page.getByRole('button', { name: 'Publish another' }).count()) await page.getByRole('button', { name: 'Publish another' }).click()
        else { await page.goto(UI + '/#/publish') }
        await page.waitForSelector('form')
        await field.type(page, type).click()
        if (type === 'Change') await field.severity(page, 'Minor').click(); else await field.severity(page, 'Major').click()
        await field.title(page).fill(`${type} ${ticket ? 'with' : 'without'} ticket`)
        await field.ticket(page).fill(ticket || '')
        if (type === 'Maintenance') { if ((await field.ends(page).count()) === 0) await field.schedule(page).click(); await field.starts(page).fill(await L.localPlus(page, -120000)); await field.ends(page).fill(await L.localPlus(page, 2 * 3600000)) }
        let r = null
        try { [r] = await Promise.all([page.waitForResponse((x) => x.request().method() === 'POST' && x.url().endsWith('/v1/communications'), { timeout: 8000 }), field.submit(page).click()]) } catch { /* nothing sent */ }
        const j = r ? await r.json().catch(() => ({})) : {}
        const shown = r ? await page.waitForSelector(`text=${type} ${j.status === 'SCHEDULED' ? 'scheduled' : 'published'}`, { timeout: 8000 }).then(() => true).catch(() => false) : false
        const alertsText = shown ? [] : await alerts(page).allTextContents()
        const chips = shown && ticket ? await page.locator('.animate-scale-in').getByText(ticket).count() : 0
        outcomes.push({ type, ticket, status: r ? r.status() : null, state: j.status || null, stored: j.ticket ? j.ticket.number : null, chip: chips, shown, alertsText: alertsText.slice(0, 3), serverError: j.error || null })
      }
      record('F-56', 'every type publishes with and without a ticket (outage+ticket, incident∅, maintenance+ticket, change+ticket; the earlier flows cover the other four); the chip appears exactly when a ticket was given', outcomes.every((o) => o.status === 201 && o.shown && (o.ticket ? o.stored === o.ticket && o.chip === 1 : o.stored === null && o.chip === 0)), outcomes)
      record('F-56', 'no console/page errors across the publish flows', page.cap.errors.length === 0 && page.cap.console.filter((c) => c.type === 'error').length === 0, { errors: page.cap.errors, console: page.cap.console.slice(0, 5) })
      await context.close()
    }

    // ---------- F-02 draft ----------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('draft')
      await L.gotoPublish(page, tenant)
      await page.waitForSelector('form')
      await fillBasics(page, { title: 'UI draft outage' })
      await field.draft(page).click()
      const [res] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), field.submit(page).click()])
      const j = await res.json()
      const req = page.cap.requests.find((r) => r.method === 'POST')
      await page.waitForSelector('text=Draft saved')
      const text = await page.locator('.animate-scale-in').textContent()
      record('F-02', 'Save as draft sends draft:true → 201 DRAFT; card says Draft saved / not visible until published; no View in feed button', JSON.parse(req.postData).draft === true && j.status === 'DRAFT' && /Consumers will not see it until it is published\./.test(text) && (await page.getByRole('button', { name: 'View in feed' }).count()) === 0, { status: j.status, text: text.slice(0, 120) })
      const feed = await api('GET', `/v1/feed?tenantId=${tenant}`)
      const perma = await api('GET', `/v1/feed/${j.id}`)
      record('F-02', 'draft is absent from the feed and the permalink answers 404', feed.status === 200 && !feed.json.items.some((i) => i.id === j.id) && perma.status === 404, { feedItems: feed.json.items.length, permalink: perma.status })
      await page.getByRole('tab', { name: /^Feed/ }).click()
      await page.waitForTimeout(800)
      record('F-02', 'UI feed shows All clear for a tenant whose only item is a draft', (await page.getByText('All clear').count()) === 1, 'All clear shown')
      const pub = await api('POST', `/v1/communications/${j.id}/publish`)
      const again = await api('POST', `/v1/communications/${j.id}/publish`)
      record('F-02', 'POST /publish moves the draft to ACTIVE (200); publishing again → 409', pub.status === 200 && pub.json.status === 'ACTIVE' && again.status === 409, { first: pub.status, status: pub.json && pub.json.status, second: again.status, err: again.json && again.json.error })
      await page.waitForSelector('article h3:has-text("UI draft outage")', { timeout: 10000 }).then(() => record('F-02', 'published draft appears live in the open feed (CREATED event)', true, 'card appeared without refresh')).catch(() => record('F-02', 'published draft appears live in the open feed (CREATED event)', false, 'card did not appear within 10s'))
      await context.close()
    }

    // ---------- F-57 / F-07: server error surfacing ----------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('err')
      await L.gotoPublish(page, tenant)
      await page.waitForSelector('form')
      const ref = 'fe1-dup-' + RUN
      await fillBasics(page, { title: 'dup one' })
      await field.ref(page).fill(ref)
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.getByRole('button', { name: 'Publish another' }).click()
      await field.title(page).fill('dup two')
      await field.ref(page).fill(ref)
      const [r409] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.waitForSelector('[role="alert"]')
      let banner = await alerts(page).first().textContent()
      const serverText = (await r409.json()).error
      record('F-57', "duplicate externalRef → 409 surfaces as 'The service rejected this.' + 'A notice with the reference <ref> already exists for tenant <tenant> …' (G-1-16 wording, raw 'duplicate externalRef' gone); form stays editable", r409.status() === 409 && /The service rejected this\./.test(banner) && banner.includes(`A notice with the reference ${ref} already exists for tenant ${tenant}`) && !/duplicate externalRef/.test(banner) && (await field.title(page).isEditable()) && (await field.title(page).inputValue()) === 'dup two', { status: r409.status(), banner, serverText })
      await page.route('**/v1/communications', async (route) => {
        const body = JSON.parse(route.request().postData()); body.severity = 'INFO'
        await route.continue({ postData: JSON.stringify(body) })
      })
      await field.ref(page).fill('')
      await field.title(page).fill('server 400 probe')
      const [r400] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      banner = await alerts(page).first().textContent()
      record('F-07', 'server-side invariant (OUTAGE at INFO, forced past the client) → 400 and its message is shown', r400.status() === 400 && /The service rejected this\./.test(banner) && banner.length > 30, { status: r400.status(), banner })
      await page.route('**/v1/communications', async (route) => {
        const body = JSON.parse(route.request().postData()); body.title = '   '; body.affectedServices = Array.from({ length: 25 }, (_, i) => 's' + i)
        await route.continue({ postData: JSON.stringify(body) })
      })
      const [r400b] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      banner = await alerts(page).first().textContent()
      record('F-07', 'bean validation (blank title, 25 services) → 400 naming the fields, shown in the banner', r400b.status() === 400 && /title/.test(banner) && /affectedServices/.test(banner), { status: r400b.status(), banner })
      await page.route('**/v1/communications', async (route) => { const h = { ...route.request().headers() }; delete h['x-client-id']; await route.continue({ headers: h }) })
      const [r401] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      banner = await alerts(page).first().textContent()
      record('F-57', 'missing X-Client-Id → 401 and the server text (missing X-Client-Id header …) is shown', r401.status() === 401 && /X-Client-Id/.test(banner), { status: r401.status(), banner })
      await page.route('**/v1/communications', async (route) => { await route.continue({ headers: { ...route.request().headers(), 'x-client-id': 'bad id!' } }) })
      const [r400c] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      banner = await alerts(page).first().textContent()
      record('F-57', "X-Client-Id 'bad id!' → 400 and the server text is shown (VITE_CLIENT_ID misconfiguration path)", r400c.status() === 400 && banner.length > 30, { status: r400c.status(), banner })
      const fulfil = async (status, contentType, body) => {
        await page.route('**/v1/communications', (route) => route.fulfill({ status, contentType, body }))
        await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
        await page.unroute('**/v1/communications')
        await page.waitForTimeout(200)
        return alerts(page).first().textContent()
      }
      const b500 = await fulfil(500, 'application/json', JSON.stringify({ error: 'boom from the service' }))
      const b503 = await fulfil(503, 'text/html', '<h1>gateway</h1>')
      const b502 = await fulfil(502, 'text/plain', 'bad gateway')
      const b504 = await fulfil(504, 'application/json', JSON.stringify({ error: 'upstream timed out' }))
      record('F-57', "5xx JSON error text shown with the 'rejected' prefix (500)", /The service rejected this\./.test(b500) && /boom from the service/.test(b500), { b500 })
      record('F-57', "502/503/504 (a proxy in front of a dead service) → the unreachable wording, no 'rejected' prefix, no status line (G-1-14)", [b502, b503, b504].every((b) => b.trim() === UNREACHABLE), { b502, b503, b504 })
      await page.route('**/v1/communications', (route) => route.abort('connectionrefused'))
      await field.submit(page).click()
      await page.waitForTimeout(400)
      await page.unroute('**/v1/communications')
      const bnet = await alerts(page).first().textContent()
      record('F-57', 'connection failure → the unreachable wording (not "Failed to fetch"), form still editable (G-1-14)', bnet.trim() === UNREACHABLE && (await field.title(page).isEditable()), bnet)
      record('F-57', 'console: the rejected calls produce only the browser\'s own fetch error lines, no app errors', page.cap.errors.length === 0, { pageErrors: page.cap.errors, console: page.cap.console.slice(0, 8) })
      await context.close()
    }

    // ---------- F-57 / F-59 / G-1-14: dead backend, two front shapes ----------
    for (const [label, deadUi] of DEAD) {
      const { context, page } = await newPage(browser)
      await page.goto(deadUi + '/#/feed')
      await setTenant(page, T('dead'))
      const shown = await page.waitForSelector("text=Couldn't load the feed", { timeout: 15000 }).then(() => true).catch(() => false)
      const msg = shown ? await page.locator("text=Couldn't load the feed").locator('..').textContent() : '(error state not shown)'
      const statuses = page.cap.responses.map((r) => r.status).slice(0, 4)
      record('F-57', `${label}: 'Couldn't load the feed' + the unreachable wording, not the status line (G-1-14)`, shown && msg.includes(UNREACHABLE) && !/502|Bad Gateway/.test(msg), { msg: msg.slice(0, 220), statuses })
      const ind0 = await L.indicator(page)
      await L.wait(2500)
      const ind1 = await L.indicator(page)
      record('F-59', `${label}: with the backend down the badge shows Reconnecting (n) / Connecting, never Live`, [ind0, ind1].every((i) => /^(Reconnecting|Connecting)/.test(i)) && /\(\d+\)/.test(ind1), { first: ind0, after2500ms: ind1 })
      const feedBefore = feedReqs(page).length
      const t0 = Date.now()
      await page.getByRole('button', { name: 'Try again' }).click()
      await page.waitForTimeout(1200)
      const newFeed = feedReqs(page).filter((r) => r.at >= t0).length
      const newStream = streamReqs(page).filter((r) => r.at >= t0 && r.at < t0 + 400).length
      record('F-57', `${label}: Try again re-requests the feed and reopens the stream at once (G-1-14)`, newFeed === 1 && newStream >= 1, { feedBefore, newFeed, streamRequestsWithin400ms: newStream })
      if (deadUi.endsWith('3110')) {
        await page.goto(deadUi + '/#/publish')
        await page.waitForSelector('form')
        await fillBasics(page, { title: 'unreachable publish probe' })
        await field.submit(page).click()
        await page.waitForSelector('[role="alert"]', { timeout: 10000 })
        const b = await alerts(page).first().textContent()
        record('F-57', "publish with the service unreachable → the unreachable wording without the 'rejected' prefix (G-1-14)", b.trim() === UNREACHABLE, b)
      }
      await context.close()
    }

    // ---------- F-57: resolve error shown under the confirm row ----------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('reserr')
      const a = await api('POST', '/v1/communications', publishBody(tenant, { title: 'resolve error probe' }))
      await L.gotoFeed(page, tenant)
      await page.waitForSelector('article')
      await page.route('**/retire', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'already expired (probe)' }) }))
      const card = L.cardByTitle(page, 'resolve error probe')
      await card.getByRole('button', { name: 'Resolve' }).click()
      await card.getByRole('button', { name: 'Resolve' }).click()
      await card.locator('[role="alert"]').waitFor({ timeout: 5000 })
      const err = await card.locator('[role="alert"]').textContent()
      record('F-57', 'resolve failure shows the server text under the confirm row and keeps the card', /already expired \(probe\)/.test(err) && (await card.count()) === 1 && (await card.getByRole('button', { name: 'Resolve' }).isEnabled()), err)
      await page.unroute('**/retire')
      await page.route('**/retire', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }))
      await card.getByRole('button', { name: 'Resolve' }).click()
      await page.waitForTimeout(400)
      const err2 = await card.locator('[role="alert"]').textContent()
      record('F-57', 'resolve while the service is unreachable (503) → the unreachable wording under the confirm row (G-1-14)', err2.trim() === UNREACHABLE, err2)
      await context.close()
      await api('POST', `/v1/communications/${a.json.id}/retire`, { actor: 'fe1-verifier' })
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
