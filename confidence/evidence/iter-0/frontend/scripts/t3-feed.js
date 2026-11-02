// F-58 feed tab + filters, F-14 feed contract via UI, F-59 states, F-16 upcoming, F-63 card content, F-62/F-06 resolve, F-60 live updates, F-15 effective status
const L = require('./lib')
const { record, api, publishBody, newPage, setTenant, field, alerts, UI, cards, cardByTitle } = L
L.setFile('t3-feed')
const RUN = Date.now().toString(36)
const T = (n) => `fe-${n}-${RUN}`
const feedReqs = (page) => page.cap.requests.filter((r) => r.method === 'GET' && /\/v1\/feed\?/.test(r.url))
const lastFeedQuery = (page) => { const r = feedReqs(page); return r.length ? new URL(r[r.length - 1].url).search : null }

;(async () => {
  const browser = await L.launch()
  try {
    // ---------- F-58 / F-14 / F-16 / F-63: seeded feed ----------
    {
      const tenant = T('feed')
      const now = Date.now()
      const seeds = [
        publishBody(tenant, { title: 'outage major payments', severity: 'MAJOR', affectedServices: ['payments-api'], startsAt: new Date(now - 3600000).toISOString() }),
        publishBody(tenant, { title: 'outage critical checkout', severity: 'CRITICAL', affectedServices: ['checkout-web'], ticket: { number: 'INC0012345' }, externalRef: 'ref-' + RUN, audience: 'INTERNAL', endsAt: new Date(now + 7200000).toISOString(), body: 'line one\nline two' }),
        publishBody(tenant, { title: 'incident minor payments', type: 'INCIDENT', severity: 'MINOR', affectedServices: ['payments-api'] }),
        publishBody(tenant, { title: 'change info other', type: 'CHANGE', severity: 'INFO', affectedServices: ['other'] }),
        publishBody(tenant, { title: 'maintenance tomorrow', type: 'MAINTENANCE', severity: 'INFO', affectedServices: ['payments-api'], startsAt: new Date(now + 86400000).toISOString(), endsAt: new Date(now + 90000000).toISOString() }),
        publishBody(tenant, { title: 'outage starting tomorrow (hidden)', severity: 'MAJOR', startsAt: new Date(now + 86400000).toISOString() }),
        publishBody(tenant, { title: 'maintenance in 10 days (outside window)', type: 'MAINTENANCE', severity: 'INFO', startsAt: new Date(now + 10 * 86400000).toISOString(), endsAt: new Date(now + 10 * 86400000 + 3600000).toISOString() }),
      ]
      const created = []
      for (const s of seeds) { const r = await api('POST', '/v1/communications', s); created.push(r); }
      record('F-14', 'seeded 7 items via API (5 visible now/upcoming, 2 hidden future)', created.every((r) => r.status === 201), created.map((r) => r.status))
      const { context, page } = await newPage(browser)
      await page.goto(UI + '/#/feed')
      await setTenant(page, tenant)
      await page.waitForSelector('article')
      await page.waitForTimeout(300)
      let q = lastFeedQuery(page)
      let titles = await page.locator('article h3').allTextContents()
      record('F-58', 'default filter Type=Outage: GET /v1/feed?tenantId&type=OUTAGE&page=0&size=100, two outages, CRITICAL before MAJOR', q === `?tenantId=${tenant}&type=OUTAGE&page=0&size=100` && JSON.stringify(titles) === JSON.stringify(['outage critical checkout', 'outage major payments']), { q, titles })
      await page.getByRole('combobox', { name: 'Type' }).selectOption('')
      await page.waitForTimeout(600)
      q = lastFeedQuery(page)
      titles = await page.locator('article h3').allTextContents()
      const activeCount = (await page.locator('h2', { hasText: 'Active now' }).textContent()).replace(/\D/g, '')
      const upcomingCount = (await page.locator('h2', { hasText: 'Upcoming' }).textContent()).replace(/\D/g, '')
      record('F-58', "'All types' drops the type param; Active now 4 + Upcoming 1; sorted active first, severity desc, then latest start", q === `?tenantId=${tenant}&page=0&size=100` && activeCount === '4' && upcomingCount === '1' && JSON.stringify(titles) === JSON.stringify(['outage critical checkout', 'outage major payments', 'incident minor payments', 'change info other', 'maintenance tomorrow']), { q, activeCount, upcomingCount, titles })
      record('F-16', 'future OUTAGE and maintenance outside the 7-day window are hidden; maintenance tomorrow is under Upcoming', !titles.includes('outage starting tomorrow (hidden)') && !titles.includes('maintenance in 10 days (outside window)') && titles.includes('maintenance tomorrow'), titles)
      const upCard = cardByTitle(page, 'maintenance tomorrow')
      const upTag = await upCard.locator('span', { hasText: /^Starts in (1d|24h)$/ }).count()
      record('F-63', "upcoming card shows the 'Starts in …' state tag and timing (24h just under a day, 1d from a day on)", upTag >= 1 && /Starts in (1d|24h)/.test(await upCard.textContent()), await upCard.textContent())
      await page.getByPlaceholder('Any service').fill('payments-api')
      await page.waitForTimeout(600)
      q = lastFeedQuery(page)
      titles = await page.locator('article h3').allTextContents()
      record('F-58', "Service filter 'payments-api' → service param, exact match on affectedServices", q === `?tenantId=${tenant}&service=payments-api&page=0&size=100` && JSON.stringify(titles) === JSON.stringify(['outage major payments', 'incident minor payments', 'maintenance tomorrow']), { q, titles })
      await page.getByPlaceholder('Any service').fill('')
      await page.getByRole('combobox', { name: 'Minimum severity' }).selectOption('MAJOR')
      await page.waitForTimeout(600)
      q = lastFeedQuery(page)
      titles = await page.locator('article h3').allTextContents()
      record('F-58', 'Minimum severity MAJOR → severity param, only MAJOR and CRITICAL', q === `?tenantId=${tenant}&severity=MAJOR&page=0&size=100` && JSON.stringify(titles) === JSON.stringify(['outage critical checkout', 'outage major payments']), { q, titles })
      await page.getByRole('combobox', { name: 'Minimum severity' }).selectOption('')
      await page.waitForTimeout(400)
      const before = feedReqs(page).length
      await page.getByRole('button', { name: 'Refresh' }).click()
      await page.waitForTimeout(600)
      record('F-58', 'Refresh issues a new GET /v1/feed', feedReqs(page).length === before + 1, `before=${before} after=${feedReqs(page).length}`)
      // card content for the rich item
      const rich = cardByTitle(page, 'outage critical checkout')
      const richText = await rich.textContent()
      const rail = await rich.locator('span[aria-hidden="true"]').first().getAttribute('class')
      const chipLink = await rich.locator('a[href]').count()
      const chipTitle = await rich.locator('span[title]', { hasText: 'INC0012345' }).getAttribute('title')
      const bodyWs = await rich.locator('p.whitespace-pre-line').evaluate((el) => getComputedStyle(el).whiteSpace)
      const hoverTitles = await rich.locator('[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title')))
      record('F-63', 'card: Active tag, Critical, Outage, Internal audience, ticket chip (plain: no url from this backend), externalRef tag, title, pre-wrapped body, service chip, Started/Expected end/publisher/Updated', /Active/.test(richText) && /Critical/.test(richText) && /Outage/.test(richText) && /Internal/.test(richText) && /INC0012345/.test(richText) && richText.includes('ref-' + RUN) && /line one/.test(richText) && bodyWs === 'pre-line' && /checkout-web/.test(richText) && /Started (just now|1m ago)/.test(richText) && /Expected end in 2h/.test(richText) && /fe-seed/.test(richText) && /Updated (just now|1m ago)/.test(richText) && /bg-critical/.test(rail) && chipLink === 0 && chipTitle === 'ServiceNow INC0012345', { richText: richText.slice(0, 400), rail, chipLink, chipTitle, hoverTitles })
      const plain = cardByTitle(page, 'outage major payments')
      const plainText = await plain.textContent()
      record('F-63', 'audience CUSTOMERS not tagged; no ticket → no chip; externalRef absent → no tag; rail colour by severity (MAJOR → warning)', !/Customers/.test(plainText) && !/INC/.test(plainText) && /bg-warning/.test(await plain.locator('span[aria-hidden="true"]').first().getAttribute('class')), plainText.slice(0, 200))
      // ticket chip with url links out (publish via API with an explicit url)
      const withUrl = await api('POST', '/v1/communications', publishBody(tenant, { title: 'outage with ticket url', ticket: { number: 'INC0099999', url: 'https://acme.service-now.com/nav_to.do?uri=incident.do?sysparm_query=number=INC0099999' } }))
      await page.waitForSelector('article h3:has-text("outage with ticket url")')
      const linkCard = cardByTitle(page, 'outage with ticket url')
      const a = linkCard.locator('a[href]')
      record('F-09', 'ticket with url → chip is a link opening in a new tab (target=_blank rel=noreferrer) with the external icon', withUrl.status === 201 && (await a.count()) === 1 && (await a.getAttribute('target')) === '_blank' && /noreferrer/.test(await a.getAttribute('rel')) && (await a.getAttribute('href')).startsWith('https://acme.service-now.com/'), { href: await a.getAttribute('href'), target: await a.getAttribute('target') })
      record('F-58', 'no console/page errors on the feed', page.cap.errors.length === 0 && page.cap.console.filter((c) => c.type === 'error').length === 0, { errors: page.cap.errors, console: page.cap.console.slice(0, 5) })
      // stale responses ignored: delay the all-types response, then switch to OUTAGE quickly; final list must be the OUTAGE one
      await page.route(/\/v1\/feed\?/, async (route) => { if (!/type=/.test(route.request().url())) await L.wait(1500); try { await route.continue() } catch { /* unrouted meanwhile */ } })
      await page.getByRole('button', { name: 'Refresh' }).click()
      await page.waitForTimeout(100)
      await page.getByRole('combobox', { name: 'Type' }).selectOption('OUTAGE')
      await page.waitForTimeout(2500)
      await page.unroute(/\/v1\/feed\?/)
      titles = await page.locator('article h3').allTextContents()
      record('F-58', 'a slow stale response (all types) arriving after a newer request (Outage) is ignored', titles.every((t) => /^outage/.test(t)) && titles.length === 3, titles)
      await context.close()
    }

    // ---------- F-14: feed contract probes through HTTP (paging caps, 400s) ----------
    {
      const tenant = T('page')
      for (let i = 0; i < 3; i++) await api('POST', '/v1/communications', publishBody(tenant, { title: 'p' + i }))
      const big = await api('GET', `/v1/feed?tenantId=${tenant}&size=500`)
      const neg = await api('GET', `/v1/feed?tenantId=${tenant}&page=-1`)
      const zero = await api('GET', `/v1/feed?tenantId=${tenant}&size=0`)
      const blank = await api('GET', `/v1/feed?tenantId=`)
      const one = await api('GET', `/v1/feed?tenantId=${tenant}&size=2&page=0`)
      const two = await api('GET', `/v1/feed?tenantId=${tenant}&size=2&page=1`)
      record('F-14', 'size=500 is capped to 100; page=-1 → 400; size=0 → 400; blank tenantId → 400; paging math (size 2: hasNext then last page)', big.status === 200 && big.json.size === 100 && neg.status === 400 && zero.status === 400 && blank.status === 400 && one.json.items.length === 2 && one.json.hasNext === true && two.json.items.length === 1 && two.json.hasNext === false && one.json.totalElements === 3, { bigSize: big.json && big.json.size, neg: neg.status, zero: zero.status, blank: blank.status, one: [one.json.items.length, one.json.hasNext], two: [two.json.items.length, two.json.hasNext] })
    }

    // ---------- F-59 states ----------
    {
      const { context, page } = await newPage(browser)
      await page.goto(UI + '/#/feed')
      await setTenant(page, '')
      await page.waitForTimeout(300)
      record('F-59', "empty tenant → 'Choose a tenant'", (await page.getByText('Choose a tenant').count()) === 1, 'shown')
      // loading skeleton
      await page.route(/\/v1\/feed\?/, async (route) => { await L.wait(1500); try { await route.continue() } catch { /* unrouted meanwhile */ } })
      await setTenant(page, T('empty'))
      await page.waitForTimeout(400)
      const busy = await page.locator('[aria-busy="true"] .skeleton').count()
      await page.unroute(/\/v1\/feed\?/)
      await page.waitForSelector('text=All clear', { timeout: 5000 })
      record('F-59', 'loading with no items → three skeleton cards in an aria-busy container', busy === 3, `skeletons=${busy}`)
      let msg = await page.getByText('All clear').locator('..').textContent()
      record('F-59', "no items → 'All clear' naming the type filter and tenant", msg.includes(`Nothing outage is active or upcoming for ${T('empty')}.`), msg)
      await page.getByPlaceholder('Any service').fill('nothing-here')
      await page.waitForTimeout(600)
      msg = await page.getByText('All clear').locator('..').textContent()
      record('F-59', "'All clear' message names the service filter", msg.includes(`for ${T('empty')} on nothing-here.`), msg)
      await page.getByPlaceholder('Any service').fill('')
      await page.getByRole('combobox', { name: 'Type' }).selectOption('')
      await page.waitForTimeout(600)
      msg = await page.getByText('All clear').locator('..').textContent()
      record('F-59', "'All clear' with All types reads 'Nothing is active or upcoming for <tenant>.'", msg.includes(`Nothing is active or upcoming for ${T('empty')}.`), msg)
      // error state on the shared stack via an aborted request
      await page.route(/\/v1\/feed\?/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'feed exploded (probe)' }) }))
      await page.getByRole('button', { name: 'Refresh' }).click()
      await page.waitForSelector("text=Couldn't load the feed", { timeout: 5000 })
      const err = await page.getByText("Couldn't load the feed").locator('..').textContent()
      record('F-59', "error → 'Couldn't load the feed' + the service text + Try again", /feed exploded \(probe\)/.test(err) && (await page.getByRole('button', { name: 'Try again' }).count()) === 1, err)
      await page.unroute(/\/v1\/feed\?/)
      await page.getByRole('button', { name: 'Try again' }).click()
      await page.waitForSelector('text=All clear', { timeout: 5000 })
      record('F-59', 'Try again recovers to the normal state', true, 'All clear after retry')
      await context.close()
    }

    // ---------- F-60 live updates / F-15 / F-16 live ----------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('live')
      await L.gotoFeed(page, tenant, { allTypes: true })
      await page.waitForSelector('text=All clear')
      await page.waitForSelector('text=/^Live$/', { timeout: 20000 })
      const streamReqs = page.cap.requests.filter((r) => r.url.includes('/v1/feed/stream')); const streamReq = streamReqs[streamReqs.length - 1]
      record('F-60', 'EventSource URL carries tenantId and clientId=communication-frontend (type omitted for All types)', streamReq && new URL(streamReq.url).search === `?tenantId=${tenant}&clientId=communication-frontend`, streamReq && streamReq.url)
      const feedsBefore = feedReqs(page).length
      const c1 = await api('POST', '/v1/communications', publishBody(tenant, { title: 'live created' }))
      await page.waitForSelector('article h3:has-text("live created")', { timeout: 10000 })
      record('F-60', 'created event → card appears without a new GET /v1/feed', feedReqs(page).length === feedsBefore, `feedRequests before=${feedsBefore} after=${feedReqs(page).length}`)
      const upd = await api('PUT', `/v1/communications/${c1.json.id}`, { title: 'live updated title', expectedVersion: c1.json.version })
      await page.waitForSelector('article h3:has-text("live updated title")', { timeout: 10000 })
      record('F-60', 'updated event → card text changes in place', upd.status === 200 && (await cards(page).count()) === 1, `PUT=${upd.status} cards=${await cards(page).count()}`)
      await api('POST', `/v1/communications/${c1.json.id}/retire`, { actor: 'fe-verifier', note: 'done' })
      await page.waitForSelector('article h3:has-text("live updated title")', { state: 'detached', timeout: 10000 })
      record('F-60', 'retired event → card removed', (await cards(page).count()) === 0, 'card gone')
      // SCHEDULED outage via live event: server feed hides future outages, the live frame shows it
      const futureOutage = await api('POST', '/v1/communications', publishBody(tenant, { title: 'future outage live', startsAt: new Date(Date.now() + 86400000).toISOString() }))
      let appeared = true
      await page.waitForSelector('article h3:has-text("future outage live")', { timeout: 6000 }).catch(() => { appeared = false })
      const serverFeed = await api('GET', `/v1/feed?tenantId=${tenant}`)
      const inServerFeed = serverFeed.json.items.some((i) => i.id === futureOutage.json.id)
      record('F-16', 'CONTRACT CHECK: a future-dated OUTAGE published while the feed is open — live frame vs GET /v1/feed visibility must agree', appeared === inServerFeed, { shownLiveUnderUpcoming: appeared, visibleInServerFeed: inServerFeed, note: appeared && !inServerFeed ? 'live view shows it under Upcoming, a reload hides it (server feed excludes future non-maintenance)' : '' })
      await api('POST', `/v1/communications/${futureOutage.json.id}/retire`, { actor: 'fe-verifier' })
      await page.waitForTimeout(800)
      // expiry: effective status
      const exp = await api('POST', '/v1/communications', publishBody(tenant, { title: 'expires soon', expiresAt: new Date(Date.now() + 4000).toISOString() }))
      await page.waitForSelector('article h3:has-text("expires soon")', { timeout: 10000 })
      await L.wait(5500)
      const stillShown = (await cardByTitle(page, 'expires soon').count()) === 1
      const feedAfter = await api('GET', `/v1/feed?tenantId=${tenant}`)
      const perma = await api('GET', `/v1/feed/${exp.json.id}`)
      record('F-15', 'after expiresAt the server feed excludes the item at once and the permalink says EXPIRED (sweeper not yet run)', !feedAfter.json.items.some((i) => i.id === exp.json.id) && perma.status === 200 && perma.json.status === 'EXPIRED', { inFeed: feedAfter.json.items.some((i) => i.id === exp.json.id), permalink: perma.json && perma.json.status })
      const t0 = Date.now()
      await page.waitForSelector('article h3:has-text("expires soon")', { state: 'detached', timeout: 45000 }).then(() => record('F-15', `UI drops the expired card when the sweeper's expired event arrives (took ${Math.round((Date.now() - t0) / 1000)}s after expiry; the card is kept until then)`, true, { stillShownRightAfterExpiry: stillShown })).catch(() => record('F-15', 'UI drops the expired card when the sweeper expired event arrives (≤30s)', false, 'still shown after 45s'))
      // scheduled → activated via sweeper
      const soon = await api('POST', '/v1/communications', publishBody(tenant, { title: 'starts in a few seconds', startsAt: new Date(Date.now() + 3000).toISOString(), type: 'MAINTENANCE', severity: 'INFO', endsAt: new Date(Date.now() + 3600000).toISOString() }))
      await page.waitForSelector('article h3:has-text("starts in a few seconds")', { timeout: 10000 })
      const underUpcoming = (await page.locator('section', { has: page.locator('h2', { hasText: 'Upcoming' }) }).locator('h3:has-text("starts in a few seconds")').count()) === 1
      const t1 = Date.now()
      await page.waitForSelector('section:has(h2:has-text("Active now")) h3:has-text("starts in a few seconds")', { timeout: 45000 }).then(() => record('F-60', `scheduled item first listed under Upcoming, moved to Active now by the activated event (${Math.round((Date.now() - t1) / 1000)}s)`, underUpcoming, { underUpcoming })).catch(() => record('F-60', 'scheduled item moves to Active now on the activated event', false, 'not moved within 45s'))
      await api('POST', `/v1/communications/${soon.json.id}/retire`, { actor: 'fe-verifier' })
      // Live switch off / on
      await page.getByRole('switch', { name: 'Live updates' }).click()
      await page.waitForSelector('text=/^Paused$/')
      const paused = await api('POST', '/v1/communications', publishBody(tenant, { title: 'while paused' }))
      await L.wait(2500)
      const notShown = (await cardByTitle(page, 'while paused').count()) === 0
      await page.getByRole('switch', { name: 'Live updates' }).click()
      const states = []
      for (let i = 0; i < 20; i++) { const s = await page.locator('text=/^(Paused|Connecting|Live|Reconnecting)$/').first().textContent(); if (!states.includes(s)) states.push(s); if (s === 'Live') break; await L.wait(100) }
      await page.waitForSelector('article h3:has-text("while paused")', { timeout: 10000 })
      record('F-60', "'Live updates' off → Paused and no updates arrive; on → Connecting then Live and the snapshot brings the missed item", notShown && states.includes('Live'), { notShownWhilePaused: notShown, states })
      await api('POST', `/v1/communications/${paused.json.id}/retire`, { actor: 'fe-verifier' })
      record('F-60', 'no console/page errors during live updates', page.cap.errors.length === 0 && page.cap.console.filter((c) => c.type === 'error').length === 0, { errors: page.cap.errors, console: page.cap.console.slice(0, 5) })
      await context.close()
    }

    // ---------- F-62 / F-06 resolve ----------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('resolve')
      await page.goto(UI + '/#/publish')
      await setTenant(page, tenant)
      await page.waitForSelector('form')
      await field.title(page).fill('to be resolved')
      await field.publisher(page).fill('fe-resolver')
      const [res] = await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), field.submit(page).click()])
      const created = await res.json()
      await page.getByRole('button', { name: 'View in feed' }).click()
      const card = cardByTitle(page, 'to be resolved')
      await card.waitFor()
      await card.getByRole('button', { name: 'Resolve' }).click()
      const confirm = await card.textContent()
      record('F-62', "Resolve opens the inline confirm ('Resolving retires it…') with a note input and Cancel", /Resolving retires it: it leaves every consumer's feed and cannot be reopened\./.test(confirm) && (await card.getByPlaceholder('Resolution note (optional)').count()) === 1 && (await card.getByRole('button', { name: 'Cancel' }).count()) === 1, confirm.slice(-200))
      await card.getByRole('button', { name: 'Cancel' }).click()
      record('F-62', 'Cancel closes the confirm row', (await card.getByPlaceholder('Resolution note (optional)').count()) === 0, 'closed')
      await card.getByRole('button', { name: 'Resolve' }).click()
      await card.getByPlaceholder('Resolution note (optional)').fill('fixed by failover')
      const [rres] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/retire')), card.getByRole('button', { name: 'Resolve' }).click()])
      const rreq = page.cap.requests.find((r) => r.url.endsWith('/retire'))
      const rbody = JSON.parse(rreq.postData)
      await card.waitFor({ state: 'detached', timeout: 5000 })
      const after = await api('GET', `/v1/communications/${created.id}`)
      const hist = after.json.history || []
      const last = hist[hist.length - 1] || {}
      record('F-62', 'Resolve → POST /retire {actor: publisher, note}; 200; card removed at once', rres.status() === 200 && rbody.actor === 'fe-resolver' && rbody.note === 'fixed by failover' && (await cardByTitle(page, 'to be resolved').count()) === 0, { status: rres.status(), body: rbody })
      record('F-06', 'server: status RETIRED and the audit history carries the actor and note', after.json.status === 'RETIRED' && last.actor === 'fe-resolver' && /fixed by failover/.test(last.action), { status: after.json.status, last })
      // idempotent retire of an item retired elsewhere
      const other = await api('POST', '/v1/communications', publishBody(tenant, { title: 'retired elsewhere' }))
      await cardByTitle(page, 'retired elsewhere').waitFor()
      await page.route('**/retire', async (route) => { await api('POST', `/v1/communications/${other.json.id}/retire`, { actor: 'someone-else' }); await route.continue() })
      const c2 = cardByTitle(page, 'retired elsewhere')
      await c2.getByRole('button', { name: 'Resolve' }).click()
      const [r2] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/retire')), c2.getByRole('button', { name: 'Resolve' }).click()])
      await page.unroute('**/retire')
      await c2.waitFor({ state: 'detached', timeout: 5000 })
      record('F-06', 'resolving an item already retired elsewhere → 200 (idempotent) and the card is gone', r2.status() === 200 && (await cardByTitle(page, 'retired elsewhere').count()) === 0, `status=${r2.status()}`)
      // 409 on EXPIRED (API)
      const ex = await api('POST', '/v1/communications', publishBody(tenant, { title: 'expired then retired', expiresAt: new Date(Date.now() + 1500).toISOString() }))
      await L.wait(2000)
      const r409 = await api('POST', `/v1/communications/${ex.json.id}/retire`, { actor: 'fe-verifier' })
      record('F-06', 'retiring an EXPIRED item → 409', r409.status === 409, { status: r409.status, error: r409.json && r409.json.error })
      await context.close()
    }

    // ---------- Q11: resolve before any publish (no publisher known) ----------
    {
      const { context, page } = await newPage(browser)
      const tenant = T('q11')
      const c = await api('POST', '/v1/communications', publishBody(tenant, { title: 'resolve without identity', publisher: 'original-publisher' }))
      await L.gotoFeed(page, tenant)
      const card = cardByTitle(page, 'resolve without identity')
      await card.waitFor()
      await card.getByRole('button', { name: 'Resolve' }).click()
      await Promise.all([page.waitForResponse((r) => r.url().endsWith('/retire')), card.getByRole('button', { name: 'Resolve' }).click()])
      const rreq = page.cap.requests.find((r) => r.url.endsWith('/retire'))
      const after = await api('GET', `/v1/communications/${c.json.id}`)
      const last = (after.json.history || []).slice(-1)[0] || {}
      record('F-62', 'Q11: a fresh browser (no publisher yet) resolves with no actor; the server records the item\'s publisher as the actor', rreq.postData === '{}' && last.actor === 'original-publisher', { body: rreq.postData, lastActor: last.actor, action: last.action })
      await context.close()
    }

    // ---------- Q10: more than 100 visible items ----------
    {
      const tenant = T('many')
      const posts = []
      for (let i = 0; i < 103; i++) posts.push(api('POST', '/v1/communications', publishBody(tenant, { title: `many ${String(i).padStart(3, '0')}` })))
      const rs = await Promise.all(posts)
      const ok = rs.filter((r) => r.status === 201).length
      const page1 = await api('GET', `/v1/feed?tenantId=${tenant}&size=100`)
      const { context, page } = await newPage(browser)
      await L.gotoFeed(page, tenant)
      await page.waitForSelector('article')
      await page.waitForTimeout(1500)
      const shown = await cards(page).count()
      const heading = (await page.locator('h2', { hasText: 'Active now' }).textContent()).replace(/\D/g, '')
      const hint = await page.getByText(/more|next|page|showing/i).count()
      record('F-58', `Q10: ${ok} active items exist (server hasNext=${page1.json.hasNext}, total=${page1.json.totalElements}); UI shows ${shown}, heading says ${heading}, no paging/truncation hint`, shown === 100 && page1.json.hasNext === true, { created: ok, shown, heading, totalElements: page1.json.totalElements, hasNext: page1.json.hasNext, truncationHints: hint })
      await context.close()
    }
  } finally {
    await browser.close()
    L.flush()
  }
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
