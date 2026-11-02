// F-56 publish submit (G-2-10 focus after 'Publish another'), F-01 publish contract via UI, F-02 draft, F-09 ticket, F-27 identity,
// F-57 server error surfacing (G-2-9 duplicate-externalRef banner, G-2-10 banner focus + viewport, G-2-12 5xx wording), F-07 server
// validation. Shared stack :3000 -> :8080; dead backend through my own dev server :3206 (-> 127.0.0.1:19299, nothing listening).
// Iteration 3: the duplicate-reference 409 is explained in the form's terms with the server sentence in a <details> (G-3-21, a
// deliberate change of the G-2-9 banner); the service's own 503 reads as a database outage, a proxy's 5xx without the service's
// {"error"} body as unreachable (G-3-20); focus returns to the confirm button after a failed resolve (G-3-22).
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant, field, alerts, banner, UI } = L
L.setFile('v2-publish-errors')
const RUN = Date.now().toString(36)
const T = (n) => `vf4-${n}-${RUN}`
const UNREACHABLE = 'The service is unreachable right now. Check that communication-service is running, then try again.'
const DB_503 = 'The service cannot reach its database right now (HTTP 503): database unavailable. It recovers on its own; try again in a moment.'
const visible = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim() // rendered text: a closed <details> shows only its summary
const DEAD_UI = 'http://127.0.0.1:3206'
const feedReqs = (page) => page.cap.requests.filter((r) => r.method === 'GET' && /\/v1\/feed\?/.test(r.url))
const streamReqs = (page) => page.cap.requests.filter((r) => r.url.includes('/v1/feed/stream'))

async function fillBasics(page, { title, publisher = 'vf4-oncall', type } = {}) {
  if (type) await field.type(page, type).click()
  await field.title(page).fill(title)
  await field.publisher(page).fill(publisher)
}

;(async () => {
  const browser = await L.launch()
  try {
    // ---------- F-56 / F-01 / F-09 / F-27 ----------
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
      const postReq = page.cap.requests.find((r) => r.method === 'POST')
      record('F-01', 'UI publish → 201 with Location header, status ACTIVE, audience CUSTOMERS', res.status() === 201 && /\/v1\/communications\//.test(res.headers()['location'] || '') && json.status === 'ACTIVE' && json.audience === 'CUSTOMERS' && json.tenantId === tenant, { status: res.status(), location: res.headers()['location'], status2: json.status, audience: json.audience })
      record('F-27', 'the publish request carries X-Client-Id: communication-frontend and Content-Type application/json', postReq.headers['x-client-id'] === 'communication-frontend' && /application\/json/.test(postReq.headers['content-type']), { clientId: postReq.headers['x-client-id'], contentType: postReq.headers['content-type'] })
      record('F-56', 'submit button shows a busy state while the POST is in flight', page.__busy && page.__busy.busy === 'true' && page.__busy.disabled === true, page.__busy)
      await page.waitForSelector('text=Outage published')
      const cardText = await page.locator('.animate-scale-in').textContent()
      const focused = await L.activeInfo(page)
      record('F-56', "confirmation card: 'Outage published', 'Live in the <tenant> feed now.', severity tag, id tag, Publish another + View in feed", /Outage published/.test(cardText) && cardText.includes(`Live in the ${tenant} feed now.`) && /Major/.test(cardText) && cardText.includes(json.id) && (await page.getByRole('button', { name: 'Publish another' }).count()) === 1 && (await page.getByRole('button', { name: 'View in feed' }).count()) === 1, cardText.slice(0, 300))
      record('F-56', 'the confirmation heading receives focus', focused.tag === 'h2' && /Outage published/.test(focused.text), focused)
      const remembered = await page.evaluate(() => localStorage.getItem('comm-publisher'))
      record('F-56', 'publisher remembered in localStorage comm-publisher', remembered === 'vf4-oncall', remembered)
      await page.getByRole('button', { name: 'View in feed' }).click()
      await page.waitForSelector('article')
      const inActive = await page.locator('section', { has: page.locator('h2', { hasText: 'Active now' }) }).locator('article h3', { hasText: 'UI outage one' }).count()
      record('F-56', "'View in feed' switches to the Feed tab and the item is listed under Active now", page.url().endsWith('#/feed') && inActive === 1, `url=${page.url()} found=${inActive}`)
      await page.goto(UI + '/#/publish')
      await page.waitForSelector('form')
      record('F-56', 'after a reload the publisher field is prefilled from localStorage', (await field.publisher(page).inputValue()) === 'vf4-oncall', await field.publisher(page).inputValue())
      await field.type(page, 'Incident').click()
      await field.title(page).fill('UI incident with ticket')
      await field.ticket(page).fill('inc0012345')
      const [res2] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), field.submit(page).click()])
      const j2 = await res2.json()
      record('F-09', 'ticket typed lower-case is sent upper-cased, stored as servicenow INC0012345, externalRef defaults to the number', res2.status() === 201 && j2.ticket && j2.ticket.number === 'INC0012345' && j2.ticket.system === 'servicenow' && j2.externalRef === 'INC0012345', { status: res2.status(), ticket: j2.ticket, externalRef: j2.externalRef })
      await page.waitForSelector('text=Incident published')
      const chip = page.locator('.animate-scale-in').getByText('INC0012345')
      record('F-56', 'confirmation card shows the ticket chip', (await chip.count()) === 1, 'chip present')
      // G-2-10: focus after 'Publish another'
      await page.getByRole('button', { name: 'Publish another' }).focus()
      await page.keyboard.press('Enter')
      await page.waitForSelector('form')
      const focusAnother = await L.activeInfo(page)
      record('F-56', "G-2-10/UX-17: after 'Publish another' (keyboard) focus is on the Title field, not on <body>", focusAnother && focusAnother.tag === 'input' && /-title$/.test(focusAnother.id || ''), focusAnother)
      const kept = { tenant: await field.tenant(page).inputValue(), publisher: await field.publisher(page).inputValue(), incident: await field.type(page, 'Incident').getAttribute('aria-checked'), title: await field.title(page).inputValue(), ticket: await field.ticket(page).inputValue() }
      record('F-56', "'Publish another' keeps tenant, publisher and type, clears the rest", kept.tenant === tenant && kept.publisher === 'vf4-oncall' && kept.incident === 'true' && kept.title === '' && kept.ticket === '', kept)
      await field.type(page, 'Change').click()
      await field.severity(page, 'Info').click()
      await field.title(page).fill('UI change')
      const [res3] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), field.submit(page).click()])
      record('F-56', 'CHANGE at INFO publishes (201) and confirms', res3.status() === 201 && (await page.waitForSelector('text=Change published')) !== null, `status=${res3.status()}`)
      await page.getByRole('button', { name: 'Publish another' }).click()
      const focusAnother2 = await L.activeInfo(page)
      record('F-56', "G-2-10: after 'Publish another' (mouse) focus is on the Title field as well", focusAnother2 && /-title$/.test(focusAnother2.id || ''), focusAnother2)
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
      const combos = [['Outage', 'INC0045671'], ['Incident', null], ['Maintenance', 'INC0045673'], ['Change', 'INC0045674']]
      const outcomes = []
      for (const [type, ticket] of combos) {
        if (await page.getByRole('button', { name: 'Publish another' }).count()) await page.getByRole('button', { name: 'Publish another' }).click()
        else await page.goto(UI + '/#/publish')
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
      record('F-56', 'every type publishes with and without a ticket; the chip appears exactly when a ticket was given', outcomes.every((o) => o.status === 201 && o.shown && (o.ticket ? o.stored === o.ticket && o.chip === 1 : o.stored === null && o.chip === 0)), outcomes)
      record('F-56', 'no console/page errors across the publish flows', page.cap.errors.length === 0 && page.cap.console.filter((x) => x.type === 'error').length === 0, { errors: page.cap.errors, console: page.cap.console.slice(0, 5) })
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
      await page.waitForSelector('text=/^Live$/', { timeout: 15000 }).catch(() => {})
      const pub = await api('POST', `/v1/communications/${j.id}/publish`)
      const again = await api('POST', `/v1/communications/${j.id}/publish`)
      record('F-02', 'POST /publish moves the draft to ACTIVE (200); publishing again → 409', pub.status === 200 && pub.json.status === 'ACTIVE' && again.status === 409, { first: pub.status, status: pub.json && pub.json.status, second: again.status, err: again.json && again.json.error })
      const appeared = await page.waitForSelector('article h3:has-text("UI draft outage")', { timeout: 10000 }).then(() => true).catch(() => false)
      record('F-02', 'the published draft appears live in the open feed (CREATED event)', appeared, appeared ? 'card appeared without refresh' : 'card did not appear within 10s')
      await context.close()
    }

    // ---------- F-57 / F-07 / G-2-9 / G-2-10 / G-2-12: server errors ----------
    {
      const { context, page } = await newPage(browser, { viewport: { width: 1280, height: 800 } })
      const tenant = T('err')
      await L.gotoPublish(page, tenant)
      await page.waitForSelector('form')
      const ref = 'vf4-dup-' + RUN
      await fillBasics(page, { title: 'dup one' })
      await field.ref(page).fill(ref)
      const [first] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      const firstJson = await first.json()
      await page.getByRole('button', { name: 'Publish another' }).click()
      // a long form, so the banner sits below the fold at 1280x800 unless it is brought into view (UX-18)
      await field.title(page).fill('dup two')
      await field.body(page).fill('Card payments fail for roughly 30% of requests.\nRetries succeed.\nNext update in 30 minutes.')
      await field.services(page).fill('payments-api, checkout-web')
      await field.ticket(page).fill('INC0077001')
      await field.ref(page).fill(ref)
      await field.schedule(page).click()
      await page.evaluate(() => window.scrollTo(0, 0))
      const [r409] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await banner(page).waitFor({ timeout: 5000 })
      await page.waitForTimeout(300)
      const bannerText = await visible(banner(page))
      const serverText = (await r409.json()).error
      const details = banner(page).locator('details')
      const detailsOpen0 = await details.evaluate((d) => d.open).catch(() => null)
      const summary = await details.locator('summary').innerText().catch(() => null)
      const focus409 = await L.activeInfo(page)
      const box = await banner(page).boundingBox()
      await L.shot(page, 'publish-409-banner')
      const expected409 = `The service rejected this. ${ref} is already the External reference of a notice in tenant ${tenant}. References are permanent, even after a notice is retired, so a follow-up needs another External reference, such as ${ref}-2. What the service said`
      record('F-57', "G-3-21 (replaces the G-2-9 verbatim banner by design): a real duplicate externalRef 409 is explained in the form's terms (the typed External reference, permanent, suggested next value <ref>-2), no notice uuid on screen, no instruction to retire anything; the service's sentence sits in a closed <details> 'What the service said'; the form stays editable", r409.status() === 409 && bannerText === expected409 && !bannerText.includes(firstJson.id) && !/Retire (that|the) notice|retire it first/i.test(bannerText) && detailsOpen0 === false && summary === 'What the service said' && serverText.includes(firstJson.id) && (await field.title(page).isEditable()) && (await field.title(page).inputValue()) === 'dup two', { status: r409.status(), bannerText, serverText, holderId: firstJson.id, detailsOpen0, summary })
      await details.locator('summary').click()
      const opened = await visible(banner(page))
      record('F-57', "G-3-21: opening 'What the service said' shows the service's own sentence (with the holder's id) below the explanation", (await details.evaluate((d) => d.open)) && opened.includes(serverText) && opened.includes(firstJson.id), { opened })
      record('F-57', 'G-2-10/UX-18: the server-error banner receives focus (document.activeElement is the role=alert div) and is fully inside the 1280×800 viewport', focus409 && focus409.role === 'alert' && focus409.tabindex === '-1' && box && box.y >= 0 && box.y + box.height <= 800, { focus: focus409, bannerBox: box && { top: Math.round(box.y), bottom: Math.round(box.y + box.height), viewport: 800 } })
      // the bare 409 (a service that only names the key): explained in the form's terms
      await page.route('**/v1/communications', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: `duplicate externalRef '${ref}' for tenant '${tenant}'` }) }))
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      const bare = await visible(banner(page))
      record('F-57', "G-2-9/G-3-21: an older bare 'duplicate externalRef' 409 (route-fulfilled) is explained the same way: the typed External reference is permanent, even after a retire, suggests '<ref>-2'; no 'Retire' instruction; the bare sentence is in the details", bare === `The service rejected this. ${ref} is already the External reference of a notice in tenant ${tenant}. References are permanent, even after a notice is retired, so a follow-up needs another External reference, such as ${ref}-2. What the service said` && !/Retire that notice/.test(bare) && !/^.*\bretire\b.*first/i.test(bare), bare)
      await page.route('**/v1/communications', async (route) => {
        const body = JSON.parse(route.request().postData()); body.severity = 'INFO'
        await route.continue({ postData: JSON.stringify(body) })
      })
      await field.ref(page).fill('')
      await field.ticket(page).fill('')
      await field.title(page).fill('server 400 probe')
      const [r400] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      let b = (await banner(page).textContent()).trim()
      record('F-07', 'server-side invariant (OUTAGE at INFO, forced past the client) → 400 and its message is shown with the rejected prefix', r400.status() === 400 && /^The service rejected this\./.test(b) && b.length > 30, { status: r400.status(), banner: b })
      await page.route('**/v1/communications', async (route) => {
        const body = JSON.parse(route.request().postData()); body.title = '   '; body.affectedServices = Array.from({ length: 25 }, (_, i) => 's' + i)
        await route.continue({ postData: JSON.stringify(body) })
      })
      const [r400b] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      b = (await banner(page).textContent()).trim()
      record('F-07', 'bean validation (blank title, 25 services) → 400 naming the fields, shown in the banner', r400b.status() === 400 && /title/.test(b) && /affectedServices/.test(b), { status: r400b.status(), banner: b })
      await page.route('**/v1/communications', async (route) => { const h = { ...route.request().headers() }; delete h['x-client-id']; await route.continue({ headers: h }) })
      const [r401] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      b = (await banner(page).textContent()).trim()
      record('F-27', 'missing X-Client-Id → 401 and the server text (X-Client-Id …) is shown', r401.status() === 401 && /X-Client-Id/.test(b), { status: r401.status(), banner: b })
      await page.route('**/v1/communications', async (route) => { await route.continue({ headers: { ...route.request().headers(), 'x-client-id': 'bad id!' } }) })
      const [r400c] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      b = (await banner(page).textContent()).trim()
      record('F-27', "X-Client-Id 'bad id!' → 400 and the server text is shown", r400c.status() === 400 && b.length > 30 && /^The service rejected this\./.test(b), { status: r400c.status(), banner: b })
      const fulfil = async (status, contentType, body) => {
        await page.route('**/v1/communications', (route) => route.fulfill({ status, contentType, body }))
        await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
        await page.unroute('**/v1/communications')
        await page.waitForTimeout(200)
        return (await banner(page).textContent()).trim()
      }
      const b500 = await fulfil(500, 'application/json', JSON.stringify({ error: 'boom from the service' }))
      const b500empty = await fulfil(500, 'text/plain', '')
      const b503 = await fulfil(503, 'text/html', '<h1>gateway</h1>')
      const b502 = await fulfil(502, 'text/plain', 'bad gateway')
      const b502empty = await fulfil(502, 'text/plain', '')
      const b504 = await fulfil(504, 'text/plain', 'upstream request timeout')
      const b504json = await fulfil(504, 'application/json', JSON.stringify({ error: 'upstream timed out' }))
      const b503db = await fulfil(503, 'application/json', JSON.stringify({ error: 'database unavailable' }))
      record('F-57', "G-2-12/UX-19: a 500 with an empty body reads 'The service failed (HTTP 500). Try again; if it keeps happening, tell the service owners.' with no 'rejected' prefix", b500empty === 'The service failed (HTTP 500). Try again; if it keeps happening, tell the service owners.', b500empty)
      record('F-57', "a 500 with a JSON error reads 'The service failed (HTTP 500): <reason>. Try again; …' (no 'rejected')", b500 === 'The service failed (HTTP 500): boom from the service. Try again; if it keeps happening, tell the service owners.', b500)
      record('F-57', "G-3-20: 502/503/504 without the service's {\"error\"} body (a proxy in front of a dead service: html, text or EMPTY body) → the unreachable wording, no 'rejected' prefix, no status line", [b502, b502empty, b503, b504].every((x) => x === UNREACHABLE), { b502, b502empty, b503, b504 })
      record('F-57', "G-3-20: the service's own 503 {\"error\":\"database unavailable\"} → the database wording with its reason, not 'unreachable' (route-fulfilled here; the real outage is in v7)", b503db === DB_503, { shownAs: b503db })
      record('F-57', "G-3-20 (rule as specified: a 5xx carrying an {\"error\"} body counts as the service's own): a 504 with a JSON {error} body reads 'The service failed (HTTP 504): <reason>. …'", b504json === 'The service failed (HTTP 504): upstream timed out. Try again; if it keeps happening, tell the service owners.', { shownAs: b504json })
      await page.route('**/v1/communications', (route) => route.abort('connectionrefused'))
      await field.submit(page).click()
      await page.waitForTimeout(400)
      await page.unroute('**/v1/communications')
      const bnet = (await banner(page).textContent()).trim()
      record('F-57', 'connection failure → the unreachable wording (not "Failed to fetch"), form still editable', bnet === UNREACHABLE && (await field.title(page).isEditable()), bnet)
      record('F-57', 'console: the rejected calls produce only the browser\'s own fetch error lines, no page errors', page.cap.errors.length === 0, { pageErrors: page.cap.errors, console: page.cap.console.slice(0, 8) })
      await context.close()
    }

    // ---------- F-57 / F-59 / F-92: dead backend through my own dev server ----------
    {
      const { context, page } = await newPage(browser)
      await page.goto(DEAD_UI + '/#/feed')
      await setTenant(page, T('dead'))
      const shown = await page.waitForSelector("text=Couldn't load the feed", { timeout: 15000 }).then(() => true).catch(() => false)
      const msg = shown ? await page.locator("text=Couldn't load the feed").locator('..').textContent() : '(error state not shown)'
      const statuses = page.cap.responses.map((r) => r.status).slice(0, 4)
      record('F-57', "G-3-20: dead backend (the dev proxy answers 502 with an EMPTY text/plain body): 'Couldn't load the feed' + the unreachable wording, not the status line", shown && msg.includes(UNREACHABLE) && !/502|Bad Gateway/.test(msg) && statuses.length > 0 && statuses.every((x) => x === 502), { msg: msg.slice(0, 220), statuses })
      const ind0 = await L.indicator(page)
      await L.wait(2500)
      const ind1 = await L.indicator(page)
      record('F-59', 'with the backend down the badge shows Reconnecting (n) / Connecting, never Live', [ind0, ind1].every((i) => /^(Reconnecting|Connecting)/.test(i)) && /\(\d+\)/.test(ind1), { first: ind0, after2500ms: ind1 })
      const t0 = Date.now()
      await page.getByRole('button', { name: 'Try again' }).click()
      await page.waitForTimeout(1200)
      const newFeed = feedReqs(page).filter((r) => r.at >= t0).length
      const newStream = streamReqs(page).filter((r) => r.at >= t0 && r.at < t0 + 400).length
      record('F-57', 'Try again re-requests the feed and reopens the stream at once', newFeed === 1 && newStream >= 1, { newFeed, streamRequestsWithin400ms: newStream })
      await page.goto(DEAD_UI + '/#/publish')
      await page.waitForSelector('form')
      await fillBasics(page, { title: 'unreachable publish probe' })
      await field.submit(page).click()
      await banner(page).waitFor({ timeout: 10000 })
      const bt = (await banner(page).textContent()).trim()
      const focusDead = await L.activeInfo(page)
      record('F-57', "publish with the service unreachable → the unreachable wording without the 'rejected' prefix; the banner has focus", bt === UNREACHABLE && focusDead && focusDead.role === 'alert', { bt, focusDead })
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
      const focusAfterFail = await L.activeInfo(page)
      record('F-57', 'resolve failure shows the server text under the confirm row and keeps the card', /already expired \(probe\)/.test(err) && (await card.count()) === 1 && (await card.getByRole('button', { name: 'Resolve' }).isEnabled()), err)
      record('F-62', "G-3-22: after a failed resolve focus is given back to the confirm button (Enter tries again), not dropped on <body>", focusAfterFail && focusAfterFail.tag === 'button' && /-confirm$/.test(focusAfterFail.id || '') && focusAfterFail.text === 'Resolve', focusAfterFail)
      await page.unroute('**/retire')
      await page.route('**/retire', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }))
      await card.getByRole('button', { name: 'Resolve' }).click()
      await page.waitForTimeout(400)
      const err2 = await card.locator('[role="alert"]').textContent()
      record('F-57', 'resolve while the service is unreachable (503) → the unreachable wording under the confirm row', err2.trim() === UNREACHABLE, err2)
      await page.unroute('**/retire')
      await page.route('**/retire', (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: '' }))
      await card.getByRole('button', { name: 'Resolve' }).click()
      await page.waitForTimeout(400)
      const err3 = await card.locator('[role="alert"]').textContent()
      record('F-57', "resolve answered 500 (empty body) → 'The service failed (HTTP 500). …' under the confirm row", err3.trim() === 'The service failed (HTTP 500). Try again; if it keeps happening, tell the service owners.', err3)
      await page.unroute('**/retire')
      await page.route('**/retire', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }))
      await card.getByRole('button', { name: 'Resolve' }).click()
      await page.waitForTimeout(400)
      const err4 = await card.locator('[role="alert"]').textContent()
      record('F-57', "G-3-20: resolve answered with the service's own 503 {error: database unavailable} → the database wording under the confirm row", err4.trim() === DB_503, err4)
      await context.close()
      await api('POST', `/v1/communications/${a.json.id}/retire`, { actor: 'vf4-verifier' })
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
