// F-56 publish submit, F-01 publish contract via UI, F-02 draft, F-09 ticket, F-57 server error surfacing, F-07 server validation surfacing
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant, field, form, alerts, UI } = L
L.setFile('t2-publish-errors')
const RUN = Date.now().toString(36)
const T = (n) => `fe-${n}-${RUN}`

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
      // slow the POST down so the busy state is observable
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
      record('F-56', "confirmation card: 'Outage published', 'Live in the <tenant> feed now.', severity tag, id tag, Publish another + View in feed", /Outage published/.test(cardText) && cardText.includes(`Live in the ${tenant} feed now.`) && /Major/.test(cardText) && cardText.includes(json.id) && (await page.getByRole('button', { name: 'Publish another' }).count()) === 1 && (await page.getByRole('button', { name: 'View in feed' }).count()) === 1, cardText.slice(0, 300))
      const remembered = await page.evaluate(() => localStorage.getItem('comm-publisher'))
      record('F-56', 'publisher remembered in localStorage comm-publisher', remembered === 'fe-oncall', remembered)
      await page.getByRole('button', { name: 'View in feed' }).click()
      await page.waitForSelector('article')
      const inActive = await page.locator('section', { has: page.locator('h2', { hasText: 'Active now' }) }).locator('article h3', { hasText: 'UI outage one' }).count()
      record('F-56', "'View in feed' switches to the Feed tab and the item is listed under Active now", page.url().endsWith('#/feed') && inActive === 1, `url=${page.url()} found=${inActive}`)
      // reload → publisher prefilled on the form
      await page.goto(UI + '/#/publish')
      await page.waitForSelector('form')
      record('F-56', 'after a reload the publisher field is prefilled from localStorage', (await field.publisher(page).inputValue()) === 'fe-oncall', await field.publisher(page).inputValue())
      // Publish another keeps tenant/publisher/type
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
      // CHANGE without ticket
      await field.type(page, 'Change').click()
      await field.severity(page, 'Info').click()
      await field.title(page).fill('UI change')
      const [res3] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), field.submit(page).click()])
      record('F-56', 'CHANGE at INFO publishes (201) and confirms', res3.status() === 201 && (await page.waitForSelector('text=Change published')) !== null, `status=${res3.status()}`)
      // future MAINTENANCE → scheduled wording
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
      record('F-56', "future maintenance → 201 SCHEDULED, card says 'Maintenance scheduled' / 'Goes live in 24h.' (relativeTime: 24h just under a day)", res4.status() === 201 && j4.status === 'SCHEDULED' && /Goes live in (1d|24h)\./.test(sched), { status: j4.status, text: sched.slice(0, 160) })
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
      // draft invisible in the UI feed too
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
      // 409 duplicate externalRef (real server answer)
      const ref = 'fe-dup-' + RUN
      await fillBasics(page, { title: 'dup one' })
      await field.ref(page).fill(ref)
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.getByRole('button', { name: 'Publish another' }).click()
      await field.title(page).fill('dup two')
      await field.ref(page).fill(ref)
      const [r409] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.waitForSelector('[role="alert"]')
      let banner = await alerts(page).first().textContent()
      record('F-57', "duplicate externalRef → 409 surfaces as 'The service rejected this.' + server text; form stays editable", r409.status() === 409 && /The service rejected this\./.test(banner) && /duplicate/i.test(banner) && (await field.title(page).isEditable()) && (await field.title(page).inputValue()) === 'dup two', { status: r409.status(), banner })
      // 400 from the server (bypass the client validator by rewriting the body in flight: OUTAGE at INFO)
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
      // 400 bean validation: empty title forced past the client
      await page.route('**/v1/communications', async (route) => {
        const body = JSON.parse(route.request().postData()); body.title = '   '; body.affectedServices = Array.from({ length: 25 }, (_, i) => 's' + i)
        await route.continue({ postData: JSON.stringify(body) })
      })
      const [r400b] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      banner = await alerts(page).first().textContent()
      record('F-07', 'bean validation (blank title, 25 services) → 400 naming the fields, shown in the banner', r400b.status() === 400 && /title/.test(banner) && /affectedServices/.test(banner), { status: r400b.status(), banner })
      // 401 missing X-Client-Id (header stripped in flight) and 400 bad id
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
      // 5xx with JSON error, and non-JSON error → 'status statusText'
      await page.route('**/v1/communications', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom from the service' }) }))
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      const b500 = await alerts(page).first().textContent()
      await page.route('**/v1/communications', (route) => route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>gateway</h1>' }))
      await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      await page.unroute('**/v1/communications')
      await page.waitForTimeout(200)
      const b503 = await alerts(page).first().textContent()
      record('F-57', "5xx JSON error text shown; non-JSON answer falls back to 'status statusText'", /boom from the service/.test(b500) && /503 Service Unavailable/.test(b503), { b500, b503 })
      // network failure (connection refused via abort)
      await page.route('**/v1/communications', (route) => route.abort('connectionrefused'))
      await field.submit(page).click()
      await page.waitForTimeout(400)
      await page.unroute('**/v1/communications')
      const bnet = await alerts(page).first().textContent()
      record('F-57', 'network failure → banner with the browser error (Failed to fetch), form still editable', /Failed to fetch|NetworkError|network/i.test(bnet) && (await field.title(page).isEditable()), bnet)
      record('F-57', 'console: the rejected calls produce only the browser\'s own fetch error lines, no app errors', page.cap.errors.length === 0, { pageErrors: page.cap.errors, console: page.cap.console.slice(0, 8) })
      await context.close()
    }

    // ---------- F-57: feed load error with a dead backend (second dev server on :3010) ----------
    {
      const { context, page } = await newPage(browser)
      await page.goto('http://127.0.0.1:3010/#/feed')
      await setTenant(page, T('dead'))
      await page.waitForSelector("text=Couldn't load the feed", { timeout: 15000 })
      const msg = await page.locator('text=Couldn\'t load the feed').locator('..').textContent()
      const before = page.cap.requests.filter((r) => r.url.includes('/v1/feed?')).length
      await page.getByRole('button', { name: 'Try again' }).click()
      await page.waitForTimeout(1500)
      const after = page.cap.requests.filter((r) => r.url.includes('/v1/feed?')).length
      record('F-57', "backend unreachable → 'Couldn't load the feed' with the error text and a Try again that re-requests", /Couldn't load the feed/.test(msg) && after === before + 1, { msg: msg.slice(0, 200), requestsBefore: before, requestsAfter: after, statuses: page.cap.responses.map((r) => r.status).slice(0, 4) })
      const conn = await page.locator('text=/^(Reconnecting|Connecting|Live|Paused)$/').first().textContent()
      record('F-59', 'with the backend down the live indicator shows Reconnecting/Connecting, not Live', conn !== 'Live', conn)
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
      await context.close()
      await api('POST', `/v1/communications/${a.json.id}/retire`, { actor: 'fe-verifier' })
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
