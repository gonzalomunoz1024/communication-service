// E2E verifier (iteration 4; the iteration-3 script plus G-4-19, G-4-20, G-4-21 and the 6 s Live settle of G-4-17): browser flows against the production bundle (vite preview :19530 -> backend A :19501).
// node ui_flows.js  -> PASS/FAIL lines; screenshots next to the output. Tenants ve4-ui-<run>.
const { chromium } = require('playwright')
const fs = require('fs')
const UI = 'http://127.0.0.1:19530', A = 'http://127.0.0.1:19501'
const RUN = Date.now().toString(36)
const OUT = process.env.OUT || '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e4/out'
const SHOT = `${OUT}/screenshots`; fs.mkdirSync(SHOT, { recursive: true })
const results = []
const stamp = () => new Date().toISOString()
function check(id, name, cond, detail = '') { results.push([id, name, !!cond]); console.log(`${cond ? 'PASS' : 'FAIL'} ${id} ${name} :: ${String(detail).slice(0, 900)}`) }
async function api(method, path, body, headers = { 'X-Client-Id': 've4-ui-checks' }) {
  const res = await fetch(A + path, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text, headers: res.headers }
}
const outage = (tenantId, title, extra = {}) => ({ tenantId, publisher: 've4-api', type: 'OUTAGE', severity: 'MAJOR', title, affectedServices: ['payments-api'], ...extra })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const card = (page, title) => page.locator('article', { hasText: title })
async function waitFor(fn, ms = 10000, every = 100) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Date.now() - t0 } catch {} await sleep(every) } return -1 }
function track(page, label) {
  const log = { reqs: [], console: [], errors: [], label }
  page.on('request', (r) => log.reqs.push({ t: Date.now(), method: r.method(), url: r.url(), headers: r.headers() }))
  page.on('response', (r) => { const q = log.reqs.find((x) => x.url === r.url() && !x.status); if (q) q.status = r.status() })
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(`${m.type()}: ${m.text()}`) })
  page.on('pageerror', (e) => log.errors.push(String(e)))
  return log
}
const feedGets = (log) => log.reqs.filter((r) => r.method === 'GET' && /\/v1\/feed\?/.test(r.url)).length
async function openFeed(page, tenant) {
  await page.goto(`${UI}/#/feed`)
  await page.getByRole('textbox', { name: 'Tenant', exact: true }).fill(tenant)
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 15000 })
  await page.evaluate((run) => { window.__ve4 = run }, RUN)
}
const notReloaded = (page) => page.evaluate(() => window.__ve4).then((v) => v === RUN)
async function allTypes(page) { await page.getByLabel('Type', { exact: true }).selectOption({ label: 'All types' }) }
const activeEl = (page) => page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName.toLowerCase()}#${e.id || ''}.${(e.className || '').toString().split(' ')[0]} role=${e.getAttribute('role') || ''} text=${(e.textContent || '').trim().slice(0, 40)}` : 'none' })

async function main() {
  const browser = await chromium.launch()
  const T = `ve4-ui-${RUN}`
  console.log(`## ui flows run ${RUN} tenant ${T} at ${stamp()}`)
  // ---------------------------------------------------------------- U1: F-90 publish -> live in another context -> resolve
  const ctxW = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const W = await ctxW.newPage(); const logW = track(W, 'watcher')
  const ctxP = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const P = await ctxP.newPage(); const logP = track(P, 'publisher')
  const tOpen = Date.now(); await openFeed(W, T); const settle = Date.now() - tOpen
  check('F-60', 'G-4-17: on a tenant with nothing to show (no frame), the badge says Live only after the stream stayed open about 6 s', settle >= 5500 && settle < 12000, `Live ${settle} ms after the page was opened`)
  const loadsBefore = feedGets(logW)
  await openFeed(P, T)
  await P.getByRole('tab', { name: 'Publish' }).click()
  check('F-56', 'the tenant chosen in the header flows into the form', await P.getByLabel(/^Tenant\*$/).inputValue() === T, await P.getByLabel(/^Tenant\*$/).inputValue())
  const title = `F-90 card payments failing ${RUN}`
  await P.getByLabel(/^Title\*$/).fill(title)
  await P.getByLabel('Details').fill('Card payments fail for about a third of requests; retries succeed.')
  await P.getByLabel('Affected services').fill('checkout-web, payments-api')
  await P.getByLabel('ServiceNow incident').fill('INC0012345')
  await P.getByLabel(/^Publisher\*$/).fill('ve4-oncall')
  const tClick = Date.now()
  const [resp] = await Promise.all([
    P.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')),
    P.getByRole('button', { name: 'Publish outage' }).click(),
  ])
  const created = await resp.json().catch(() => ({}))
  check('F-56', 'UI publish -> 201 with X-Client-Id communication-frontend; request body carries ticket + services', resp.status() === 201 && resp.request().headers()['x-client-id'] === 'communication-frontend' && /INC0012345/.test(resp.request().postData() || ''), `${resp.status()} id=${created.id} ticket=${JSON.stringify(created.ticket)} externalRef=${created.externalRef}`)
  await P.getByRole('heading', { name: 'Outage published' }).waitFor({ timeout: 5000 })
  check('F-56', "confirmation card 'Outage published' with ticket chip, 'Publish another' and 'View in feed'", await P.getByText('INC0012345').first().isVisible() && await P.getByRole('button', { name: 'Publish another' }).isVisible() && await P.getByRole('button', { name: 'View in feed' }).isVisible(), await activeEl(P))
  await P.screenshot({ path: `${SHOT}/f90-publish-done.png` })
  const tW = await waitFor(() => card(W, title).isVisible(), 10000)
  check('F-90', 'second browser context shows the card live, without reload and without re-fetching /v1/feed', tW >= 0 && (await notReloaded(W)) && feedGets(logW) === loadsBefore, `card after ${tW} ms (from click ${Date.now() - tClick} ms total); feed GETs before=${loadsBefore} after=${feedGets(logW)}`)
  const wc = card(W, title)
  check('F-09', 'the live card carries the services, the publisher and the ticket chip (F-09 UI)', (await wc.getByText('checkout-web').count()) > 0 && (await wc.getByText('payments-api').count()) > 0 && (await wc.getByText('ve4-oncall').count()) > 0 && (await wc.getByText('INC0012345').count()) > 0, (await wc.innerText()).replace(/\s+/g, ' ').slice(0, 300))
  await W.screenshot({ path: `${SHOT}/f90-watcher-card.png` })
  const f1 = await api('GET', `/v1/feed?tenantId=${T}&service=payments-api`); const f2 = await api('GET', `/v1/feed?tenantId=${T}&service=other-svc`)
  check('F-90', 'consumer GET /v1/feed with the service filter lists it; another service does not', f1.json.items.some((i) => i.id === created.id) && !f2.json.items.some((i) => i.id === created.id), `payments-api=${f1.json.items.length} other=${f2.json.items.length}`)
  await P.getByRole('button', { name: 'View in feed' }).click()
  await card(P, title).waitFor({ timeout: 5000 })
  check('F-56', "'View in feed' switches to the feed tab showing the item under Active now", /#\/feed$/.test(P.url()) && (await P.getByRole('heading', { name: /Active now/ }).count()) > 0, P.url())
  const focusAfterView = await P.evaluate(() => { const e = document.activeElement; return { tag: e ? e.tagName.toLowerCase() : 'none', tabindex: e ? e.getAttribute('tabindex') : null, holdsCards: !!(e && e.querySelector && e.querySelector('article')) } })
  check('F-56', "G-4-19: after 'View in feed' focus is on the results list (not <body>)", focusAfterView.tag !== 'body' && focusAfterView.holdsCards, JSON.stringify(focusAfterView))
  const mine = card(P, title)
  await mine.getByRole('button', { name: 'Resolve' }).click()
  await sleep(150)
  const focusInConfirm = await P.evaluate(() => { const e = document.activeElement; const a = e && e.closest('article'); return { inCard: !!a, tag: e ? e.tagName.toLowerCase() : 'none', placeholder: e ? e.getAttribute('placeholder') : null, text: e ? (e.textContent || '').trim().slice(0, 30) : '' } })
  check('F-62', 'G-3-22: opening the inline confirmation moves focus into it (not to <body>)', focusInConfirm.inCard && focusInConfirm.tag !== 'body', JSON.stringify(focusInConfirm))
  const confirmText = (await mine.innerText()).replace(/\s+/g, ' ')
  check('F-62', "inline confirm names the actor and the tenant ('Resolve as ve4-oncall? … tenant …')", /Resolve as ve4-oncall\?/.test(confirmText) && confirmText.includes(`tenant ${T}`), confirmText.slice(0, 260))
  const postsBeforeEsc = logP.reqs.filter((r) => r.method === 'POST').length
  await P.keyboard.press('Escape'); await sleep(250)
  const escState = { noteFields: await mine.getByPlaceholder('Resolution note (optional)').count(), focus: await activeEl(P), posts: logP.reqs.filter((r) => r.method === 'POST').length - postsBeforeEsc }
  check('F-62', 'G-4-20: Escape inside the inline confirmation cancels it like Cancel (no POST) and returns focus to the Resolve button', escState.noteFields === 0 && /^button/.test(escState.focus) && /Resolve/.test(escState.focus) && escState.posts === 0, JSON.stringify(escState))
  await mine.getByRole('button', { name: 'Resolve' }).click(); await sleep(150)
  await mine.getByPlaceholder('Resolution note (optional)').fill('fixed by ve4')
  const [retired] = await Promise.all([
    P.waitForResponse((r) => r.url().endsWith(`/v1/communications/${created.id}/retire`)),
    mine.getByRole('button', { name: 'Resolve' }).click(),
  ])
  const postData = retired.request().postDataJSON()
  check('F-62', 'resolve posts {actor: publisher, note} -> 200', retired.status() === 200 && postData.actor === 've4-oncall' && postData.note === 'fixed by ve4', JSON.stringify(postData))
  const gone = await waitFor(async () => (await card(P, title).count()) === 0, 5000)
  const announced = await P.getByRole('status').filter({ hasText: `Resolved “${title}”` }).isVisible().catch(() => false)
  check('F-62', 'card removed at once, resolution announced in the live region, focus not lost to <body> (G-2-10)', gone >= 0 && announced && !/^body/.test(await activeEl(P)), `gone after ${gone} ms announced=${announced} focus=${await activeEl(P)}`)
  const goneW = await waitFor(async () => (await card(W, title).count()) === 0, 10000)
  check('F-90', 'the watcher loses the card through the retired frame (no reload, no re-fetch)', goneW >= 0 && (await notReloaded(W)) && feedGets(logW) === loadsBefore, `gone after ${goneW} ms feed GETs=${feedGets(logW)}`)
  const feedAfter = await api('GET', `/v1/feed?tenantId=${T}`); const perm = await api('GET', `/v1/feed/${created.id}`); const full = await api('GET', `/v1/communications/${created.id}`)
  const hist = (full.json && full.json.history) || []
  check('F-90', 'API: feed no longer lists it, permalink RETIRED, history holds the note and the actor', !feedAfter.json.items.some((i) => i.id === created.id) && perm.json.status === 'RETIRED' && hist.some((h) => h.actor === 've4-oncall' && /fixed by ve4/.test(h.action)), JSON.stringify(hist.slice(-1)))
  // ---------------------------------------------------------------- U2: F-57 duplicate externalRef through the UI (G-2-9 wording), focus (G-2-10)
  // G-4-11/G-4-21: another system already used the first follow-up value, so the service names the next free one (-3)
  const taken2 = await api('POST', '/v1/communications', outage(T, `follow-up taken over HTTP ${RUN}`, { externalRef: 'INC0012345-2' }))
  await P.getByRole('tab', { name: 'Publish' }).click()
  await P.getByRole('button', { name: 'Publish another' }).click().catch(() => {})
  const focusAfterAnother = await activeEl(P)
  await P.getByLabel(/^Title\*$/).fill(`dup ${RUN}`)
  await P.getByLabel('ServiceNow incident').fill('INC0012345')
  if (!(await P.getByLabel(/^Publisher\*$/).inputValue())) await P.getByLabel(/^Publisher\*$/).fill('ve4-oncall')
  const [dup] = await Promise.all([
    P.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')),
    P.getByRole('button', { name: 'Publish outage' }).click(),
  ])
  const banner = P.getByRole('alert').filter({ hasText: 'The service rejected this' })
  await banner.waitFor({ timeout: 5000 }).catch(() => {})
  const bannerText = (await banner.innerText().catch(() => '')).replace(/\s+/g, ' ')
  const saidText = ((await banner.locator('details').textContent().catch(() => '')) || '').replace(/\s+/g, ' ')
  const dupBody = await dup.json().catch(() => ({}))
  check('F-57', 'G-3-21: duplicate externalRef via the UI -> 409; the banner explains it in the form\'s terms (INC0012345 is already the reference in this tenant, permanent), the service\'s own sentence (naming the holder) kept under "What the service said"', dup.status() === 409 && /INC0012345 is already the reference of a notice in tenant/.test(bannerText) && bannerText.includes(T) && /permanent/i.test(bannerText) && /What the service said/.test(bannerText) && saidText.includes(created.id) && saidText.includes((dupBody.error || '').slice(0, 40)), `banner="${bannerText.slice(0, 420)}" said="${saidText.slice(0, 260)}"`)
  const offered = (/such as (INC0012345-\d+)/.exec(bannerText) || [])[1]
  check('F-57', 'G-4-11 + G-4-21: with INC0012345-2 taken over HTTP (201), the 409 carries suggestedExternalRef INC0012345-3 and the banner offers exactly that value (the service\'s, not the local -2)', taken2.status === 201 && dupBody.suggestedExternalRef === 'INC0012345-3' && offered === 'INC0012345-3' && !/INC0012345-2\b/.test(bannerText.replace(/What the service said.*/, '')), `HTTP -2 publish=${taken2.status}; 409 body keys=${Object.keys(dupBody).join(',')} suggestedExternalRef=${dupBody.suggestedExternalRef}; banner offers ${offered}`)
  check('F-57', 'the form stays editable and focus moves to the banner (G-2-10); (focus after "Publish another" is ui_focus.js: here the confirmation had already left with the tab switch)', (await P.getByLabel(/^Title\*$/).inputValue()) === `dup ${RUN}` && /role=alert|alert/.test(await activeEl(P)), `focus now=${await activeEl(P)}`)
  await P.screenshot({ path: `${SHOT}/f57-409-banner.png` })
  // the person accepts the offer: types it into External reference and publishes again
  await P.getByLabel('External reference').fill(offered || 'none')
  const [acc] = await Promise.all([
    P.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')),
    P.getByRole('button', { name: 'Publish outage' }).click(),
  ])
  const accBody = await acc.json().catch(() => ({}))
  const accHeading = await P.getByRole('heading', { name: 'Outage published' }).waitFor({ timeout: 5000 }).then(() => true, () => false)
  check('F-57', 'G-4-21: the offered value accepted through the form -> 201 with externalRef INC0012345-3 and the ticket INC0012345 kept; confirmation shown', acc.status() === 201 && accBody.externalRef === 'INC0012345-3' && (accBody.ticket || {}).number === 'INC0012345' && accHeading, `${acc.status()} externalRef=${accBody.externalRef} ticket=${JSON.stringify(accBody.ticket)} heading=${accHeading}`)
  await P.screenshot({ path: `${SHOT}/f57-suggestion-accepted.png` })
  await P.getByRole('button', { name: 'Publish another' }).click()
  await P.getByLabel(/^Title\*$/).fill(`bad incident ${RUN}`)
  if (!(await P.getByLabel(/^Publisher\*$/).inputValue())) await P.getByLabel(/^Publisher\*$/).fill('ve4-oncall')
  await api('POST', `/v1/communications/${accBody.id}/retire`, {}); if (taken2.json) await api('POST', `/v1/communications/${taken2.json.id}/retire`, {})
  // 400 path: a malformed incident number; the UI may block it inline (F-07 mirror) or the service answers 400 (F-57)
  await P.getByLabel('ServiceNow incident').fill('INC12')
  const postsBefore = logP.reqs.filter((r) => r.method === 'POST').length
  await P.getByRole('button', { name: 'Publish outage' }).click()
  await sleep(1500)
  const postsAfter = logP.reqs.filter((r) => r.method === 'POST').length
  const inline = (await P.locator('form').innerText()).replace(/\s+/g, ' ')
  check('F-07', 'malformed incident number: blocked inline before sending (UI mirrors the rule) or surfaced as the 400 text', (postsAfter === postsBefore && /INC\d{7}|incident|number/i.test(inline)) || (postsAfter > postsBefore && /rejected/i.test(inline)), `POSTs ${postsBefore}->${postsAfter}; form text: ${inline.match(/.{0,80}(INC\d\{7\}|incident number|ticket)[^.]{0,80}/i)?.[0] || inline.slice(0, 160)}`)
  // ---------------------------------------------------------------- U3: F-58 filters, F-16 upcoming, F-14 ordering in the UI
  const T3 = `${T}-feed`
  const alpha = (await api('POST', '/v1/communications', outage(T3, 'Alpha outage', { affectedServices: ['alpha'] }))).json
  const beta = (await api('POST', '/v1/communications', outage(T3, 'Beta outage', { severity: 'CRITICAL', affectedServices: ['beta'] }))).json
  const inc = (await api('POST', '/v1/communications', outage(T3, 'Beta incident', { type: 'INCIDENT', severity: 'MINOR', affectedServices: ['beta'] }))).json
  const maint = (await api('POST', '/v1/communications', outage(T3, 'Alpha maintenance', { type: 'MAINTENANCE', severity: 'INFO', affectedServices: ['alpha'], startsAt: new Date(Date.now() + 86400e3).toISOString(), endsAt: new Date(Date.now() + 90000e3).toISOString() }))).json
  const F = await ctxP.newPage(); const logF = track(F, 'filters')
  await openFeed(F, T3)
  const titles = async () => F.locator('article h3, article [data-title], article').evaluateAll((els) => els.filter((e) => e.tagName === 'ARTICLE').map((e) => e.querySelector('h3, h2, strong')?.textContent?.trim() || e.textContent.trim().slice(0, 40)))
  const lastQuery = (log) => { const r = [...log.reqs].reverse().find((x) => x.method === 'GET' && /\/v1\/feed\?/.test(x.url)); return r ? new URL(r.url).search : '' }
  check('F-58', "default type Outage: 'Active now 2' with the CRITICAL first, no Upcoming section", (await F.getByRole('heading', { name: /Active now/ }).innerText()).includes('2') && (await titles()).slice(0, 2).join('|').startsWith('Beta outage') && (await F.getByRole('heading', { name: /Upcoming/ }).count()) === 0 && /type=OUTAGE/.test(lastQuery(logF)), `${(await titles()).join(' | ')} query=${lastQuery(logF)}`)
  await allTypes(F)
  await F.getByRole('heading', { name: /Upcoming/ }).waitFor({ timeout: 5000 })
  const upText = (await card(F, 'Alpha maintenance').innerText()).replace(/\s+/g, ' ')
  check('F-16', "All types: 'Active now 3' + 'Upcoming 1' with the maintenance ('Scheduled', 'Starts in 1d'), query without type=", (await F.getByRole('heading', { name: /Active now/ }).innerText()).includes('3') && (await F.getByRole('heading', { name: /Upcoming/ }).innerText()).includes('1') && /Scheduled/.test(upText) && /Starts in (1d|24h|1 day)/.test(upText) && !/type=/.test(lastQuery(logF)), `${upText.slice(0, 200)} query=${lastQuery(logF)}`)
  await F.getByLabel('Service', { exact: true }).fill('beta')
  const svcOk = await waitFor(async () => (await F.locator('article').count()) === 2 && /service=beta/.test(lastQuery(logF)), 5000)
  check('F-58', 'Service filter -> only beta items, query carries service=beta', svcOk >= 0, `${(await titles()).join(' | ')} query=${lastQuery(logF)}`)
  await F.getByLabel('Minimum severity', { exact: true }).selectOption({ label: 'Major' })
  const sevOk = await waitFor(async () => (await F.locator('article').count()) === 1 && /severity=MAJOR/.test(lastQuery(logF)), 5000)
  check('F-58', 'Minimum severity Major -> only the CRITICAL outage, query carries severity=MAJOR', sevOk >= 0 && (await titles())[0].startsWith('Beta outage'), `${(await titles()).join(' | ')} query=${lastQuery(logF)}`)
  const getsBeforeRefresh = feedGets(logF)
  await F.getByRole('button', { name: 'Refresh' }).click(); await sleep(800)
  check('F-58', 'Refresh re-fetches the page', feedGets(logF) === getsBeforeRefresh + 1, `GETs ${getsBeforeRefresh} -> ${feedGets(logF)}`)
  await F.screenshot({ path: `${SHOT}/f58-filters.png` })
  // ---------------------------------------------------------------- U5: F-62/F-16 withdraw a scheduled notice
  await F.getByLabel('Service', { exact: true }).fill(''); await F.getByLabel('Minimum severity', { exact: true }).selectOption({ label: 'Any severity' })
  await card(F, 'Alpha maintenance').waitFor({ timeout: 5000 })
  const mc = card(F, 'Alpha maintenance')
  check('F-16', "a not-started notice offers 'Withdraw', not 'Resolve'", (await mc.getByRole('button', { name: 'Withdraw' }).count()) === 1 && (await mc.getByRole('button', { name: 'Resolve' }).count()) === 0, '')
  await mc.getByRole('button', { name: 'Withdraw' }).click()
  const wText = (await mc.innerText()).replace(/\s+/g, ' ')
  await mc.getByPlaceholder('Reason (optional)').fill('postponed')
  const [wres] = await Promise.all([F.waitForResponse((r) => r.url().endsWith(`/v1/communications/${maint.id}/retire`)), mc.getByRole('button', { name: 'Withdraw' }).click()])
  check('F-62', 'Withdraw explains itself and retires the scheduled notice (200, note recorded)', /Withdrawing retires it before it starts/.test(wText) && wres.status() === 200 && wres.request().postDataJSON().note === 'postponed', wText.slice(0, 200))
  // ---------------------------------------------------------------- U4: F-60 live updates and the Live switch
  const T4 = `${T}-live`
  const L = await ctxP.newPage(); const logL = track(L, 'live')
  await openFeed(L, T4); await allTypes(L)
  const t1 = Date.now(); const live1 = (await api('POST', '/v1/communications', outage(T4, `Live one ${RUN}`))).json
  const tCard = await waitFor(() => card(L, `Live one ${RUN}`).isVisible(), 8000)
  check('F-60', 'curl-publish -> card appears live', tCard >= 0, `after ${tCard} ms (publish took ${Date.now() - t1 - Math.max(tCard, 0)} ms)`)
  await api('PUT', `/v1/communications/${live1.id}`, { expectedVersion: live1.version, title: `Live one ${RUN} (edited)` })
  const tEdit = await waitFor(() => card(L, `Live one ${RUN} (edited)`).isVisible(), 8000)
  check('F-60', 'curl-update -> card text changes live (updated frame)', tEdit >= 0, `after ${tEdit} ms`)
  await api('POST', `/v1/communications/${live1.id}/retire`, {})
  const tGone = await waitFor(async () => (await card(L, `Live one ${RUN}`).count()) === 0, 8000)
  check('F-60', 'curl-retire -> card disappears live (retired frame)', tGone >= 0, `after ${tGone} ms`)
  await L.getByRole('switch', { name: 'Live updates' }).click().catch(async () => L.getByText('Live updates').click())
  const paused = await waitFor(() => L.getByText('Paused', { exact: true }).isVisible(), 3000)
  const streamsBefore = logL.reqs.filter((r) => /\/v1\/feed\/stream/.test(r.url)).length
  await api('POST', '/v1/communications', outage(T4, `While paused ${RUN}`))
  await sleep(3000)
  const seenWhilePaused = await card(L, `While paused ${RUN}`).count()
  await L.getByRole('switch', { name: 'Live updates' }).click().catch(async () => L.getByText('Live updates').click())
  const liveAgain = await waitFor(() => L.getByText('Live', { exact: true }).isVisible(), 8000)
  const tSnap = await waitFor(() => card(L, `While paused ${RUN}`).isVisible(), 8000)
  check('F-60', "Live switch off -> 'Paused', no updates arrive; on -> Live again and the missed item arrives through the fresh stream's snapshot", paused >= 0 && seenWhilePaused === 0 && liveAgain >= 0 && tSnap >= 0 && logL.reqs.filter((r) => /\/v1\/feed\/stream/.test(r.url)).length > streamsBefore, `paused=${paused}ms seenWhilePaused=${seenWhilePaused} liveAgain=${liveAgain}ms snapshotCard=${tSnap}ms`)
  // ---------------------------------------------------------------- U6: F-02 draft from the UI
  const D = await ctxP.newPage(); const logD = track(D, 'draft')
  await openFeed(D, T); await D.getByRole('tab', { name: 'Publish' }).click()
  await D.getByLabel(/^Title\*$/).fill(`Draft ${RUN}`); if (!(await D.getByLabel(/^Publisher\*$/).inputValue())) await D.getByLabel(/^Publisher\*$/).fill('ve4-oncall')
  await D.getByRole('switch', { name: 'Save as draft' }).click().catch(async () => D.getByText('Save as draft').click())
  const [dres] = await Promise.all([D.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), D.getByRole('button', { name: 'Save draft' }).click()])
  const draft = await dres.json()
  const dFeed = await api('GET', `/v1/feed?tenantId=${T}`); const dPerm = await api('GET', `/v1/feed/${draft.id}`)
  check('F-02', "UI 'Save draft' -> DRAFT, 'Draft saved' without 'View in feed'; invisible in feed and permalink 404", dres.status() === 201 && draft.status === 'DRAFT' && (await D.getByRole('heading', { name: 'Draft saved' }).isVisible()) && (await D.getByRole('button', { name: 'View in feed' }).count()) === 0 && !dFeed.json.items.some((i) => i.id === draft.id) && dPerm.status === 404, `status=${draft.status} permalink=${dPerm.status}`)
  const pub = await api('POST', `/v1/communications/${draft.id}/publish`)
  check('F-02', 'POST /publish makes the draft ACTIVE and it shows up in the feed', pub.status === 200 && pub.json.status === 'ACTIVE' && (await api('GET', `/v1/feed?tenantId=${T}`)).json.items.some((i) => i.id === draft.id), `${pub.status} ${pub.json && pub.json.status}`)
  await api('POST', `/v1/communications/${draft.id}/retire`, {})
  // ---------------------------------------------------------------- G-3-23 waiting state + live region, G-3-24 one load per typed tenant
  const ctxN = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const N = await ctxN.newPage(); const logN = track(N, 'typed')
  await N.goto(`${UI}/#/feed`)
  const waitingText = await N.getByText('Waiting for a tenant', { exact: true }).isVisible().catch(() => false)
  const pausedShown = await N.getByText('Paused', { exact: true }).isVisible().catch(() => false)
  const badgeRegion = await N.getByText('Waiting for a tenant', { exact: true }).evaluate((e) => { const r = e.closest('[role=status]'); return r ? `${r.getAttribute('role')}/${r.getAttribute('aria-live')}` : 'none' }).catch(() => 'none')
  check('F-60', "G-3-23: with no tenant the badge says 'Waiting for a tenant' (not 'Paused') inside a role=status aria-live=polite region", waitingText && !pausedShown && badgeRegion === 'status/polite', `waiting=${waitingText} paused=${pausedShown} region=${badgeRegion}`)
  const tenantBox = N.getByRole('textbox', { name: 'Tenant', exact: true })
  await tenantBox.click(); const tType = Date.now()
  await tenantBox.pressSequentially(T, { delay: 60 })
  await N.getByText('Live', { exact: true }).waitFor({ timeout: 15000 })
  await sleep(1200)
  const gets = logN.reqs.filter((r) => r.method === 'GET' && /\/v1\/feed\?/.test(r.url)); const streamsN = logN.reqs.filter((r) => /\/v1\/feed\/stream/.test(r.url))
  check('F-58', `G-3-24: typing the tenant key by key (${T.length} keys) -> one GET /v1/feed and one stream, for the whole name`, gets.length === 1 && streamsN.length === 1 && gets[0].url.includes(`tenantId=${encodeURIComponent(T)}`), `typing took ${Date.now() - tType - 1200} ms; GETs=${gets.map((r) => new URL(r.url).searchParams.get('tenantId')).join(',')} streams=${streamsN.map((r) => new URL(r.url).searchParams.get('tenantId')).join(',')}`)
  // ---------------------------------------------------------------- F-64 identity on every request, console hygiene
  const all = [logW, logP, logF, logL, logD, logN].flatMap((l) => l.reqs.map((r) => ({ ...r, label: l.label })))
  const apiReqs = all.filter((r) => /\/v1\//.test(r.url))
  const streams = apiReqs.filter((r) => /\/v1\/feed\/stream/.test(r.url))
  const nonStream = apiReqs.filter((r) => !/\/v1\/feed\/stream/.test(r.url))
  const badHeader = nonStream.filter((r) => r.headers['x-client-id'] !== 'communication-frontend')
  const badStream = streams.filter((r) => !/clientId=communication-frontend/.test(r.url))
  check('F-64', 'every /v1 fetch carried X-Client-Id communication-frontend; every stream carried ?clientId=; same origin (Vite preview proxy, no CORS)', badHeader.length === 0 && badStream.length === 0 && apiReqs.every((r) => r.url.startsWith(UI)), `fetches=${nonStream.length} streams=${streams.length} bad=${badHeader.length}/${badStream.length}`)
  const failed = nonStream.filter((r) => r.status && r.status >= 400 && !(r.status === 409 && r.method === 'POST')).map((r) => `${r.method} ${r.url.replace(UI, '')} ${r.status}`)
  check('F-64', 'no failed requests besides the deliberate 409', failed.length === 0, failed.join('; ').slice(0, 300))
  const consoleBad = [logW, logP, logF, logL, logD, logN].flatMap((l) => l.console.concat(l.errors)).filter((m) => !/409|ERR_ABORTED|Failed to load resource/.test(m))
  check('F-90', 'no console errors or page errors across the flows (Chromium\'s own 409/aborted-stream lines excluded)', consoleBad.length === 0, consoleBad.slice(0, 5).join(' || ').slice(0, 400))
  await browser.close()
  const fails = results.filter((r) => !r[2]).length
  console.log(`## summary: ${results.length - fails} pass, ${fails} fail at ${stamp()}`)
  process.exit(Math.min(99, fails))
}
main().catch((e) => { console.log('FAIL RUN script crashed :: ' + (e.stack || e)); process.exit(98) })
