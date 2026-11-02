// Iteration-1 usability walk of the Outage Notifications UI as a first-time SRE (shared stack). Screenshots + JSON log.
const { chromium } = require('playwright')
const { AxeBuilder } = require('@axe-core/playwright')
const fs = require('fs')
const EV = '/home/claude/communication-service/confidence/evidence/iter-1/usability'
const BASE = process.env.UI_BASE || 'http://127.0.0.1:3000'
const API = 'http://localhost:8080'
const TENANT = process.env.UX_TENANT || 'ux1-sre'
const TICKET = 'INC' + String(Date.now()).slice(-7)
const out = { steps: [], console: [], failedRequests: [] }
const log = (step, data) => { out.steps.push({ step, ...data }); console.log(step, JSON.stringify(data).slice(0, 600)) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = (page, name) => page.screenshot({ path: `${EV}/${name}.png`, fullPage: true })
const BADGE = /^(Live|Connecting|Reconnecting( \(\d+\))?|Paused)$/
const badge = (page) => page.locator('main').getByText(BADGE).first().textContent().catch(() => null)
async function step(name, fn) { try { await fn() } catch (e) { log(name + ':ERROR', { error: String(e).slice(0, 300) }) } }

async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { 'X-Client-Id': 'ux1-reviewer', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const contrastScript = `(sel) => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const el = document.querySelector(sel); if (!el) return { sel, missing: true }
  const cs = getComputedStyle(el); let fg = parse(cs.color)
  const layers = []; let n = el
  while (n && n !== document.documentElement) { const b = parse(getComputedStyle(n).backgroundColor); if (b && b.a > 0) layers.push(b); n = n.parentElement }
  const htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor); const bodyBg = parse(getComputedStyle(document.body).backgroundColor)
  let bg = (htmlBg && htmlBg.a > 0) ? htmlBg : { r: 255, g: 255, b: 255, a: 1 }
  if (bodyBg && bodyBg.a > 0) bg = blend(bodyBg, bg)
  for (const l of layers.reverse()) bg = blend(l, bg)
  if (fg.a < 1) fg = blend(fg, bg)
  const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
  const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight) || 400
  const large = size >= 24 || (size >= 18.66 && weight >= 700)
  return { sel, text: (el.textContent || '').trim().slice(0, 40), color: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')', fontSize: size, weight, ratio: Math.round(ratio * 100) / 100, aa: ratio >= (large ? 3 : 4.5), aaLarge: ratio >= 3 }
}`
const contrastFn = eval(contrastScript)
async function contrast(page, label, selectors) { const rows = []; for (const sel of selectors) rows.push(await page.evaluate(contrastFn, sel)); log(`contrast:${label}`, { rows }); return rows }
async function axe(page, label) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, count: x.nodes.length, nodes: x.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary && n.failureSummary.split('\n').slice(0, 3).join(' | ').slice(0, 220) })) }))
  log(`axe:${label}`, { violations: v, passes: r.passes.length })
  return v
}
async function fieldInventory(page) {
  return page.evaluate(() => {
    const rows = []
    for (const lab of document.querySelectorAll('main label')) {
      const forId = lab.getAttribute('for'); const id = lab.id
      let control = forId ? document.getElementById(forId) : lab.querySelector('input,select,textarea,button')
      if (!control && id) control = document.querySelector(`[aria-labelledby~="${id}"]`)
      const wrap = lab.parentElement
      const hint = wrap && wrap.querySelector('p') ? wrap.querySelector('p').textContent.trim() : ''
      rows.push({ label: lab.textContent.trim().slice(0, 30), associated: !!control, control: control ? control.tagName + (control.getAttribute('role') ? '[' + control.getAttribute('role') + ']' : '') + (control.type ? ':' + control.type : '') : null, placeholder: control && control.placeholder ? control.placeholder : '', hint: hint.slice(0, 90) })
    }
    return rows
  })
}
const errorsNow = (page) => page.evaluate(() => [...document.querySelectorAll('[role=alert]')].map((e) => ({ text: e.textContent.trim().slice(0, 300) })))
async function focusInfo(page) {
  return page.evaluate(() => {
    const a = document.activeElement; if (!a || a === document.body) return { tag: 'BODY' }
    const cs = getComputedStyle(a); const r = a.getBoundingClientRect()
    const name = a.getAttribute('aria-label') || (a.labels && a.labels[0] && a.labels[0].textContent.trim()) || a.textContent.trim().slice(0, 30) || a.placeholder || a.id
    const ring = cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
    return { tag: a.tagName, type: a.type, role: a.getAttribute('role'), name, ring, inViewport: r.top >= 0 && r.bottom <= window.innerHeight, top: Math.round(r.top), invalid: a.getAttribute('aria-invalid'), describedBy: a.getAttribute('aria-describedby') }
  })
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') out.console.push({ type: m.type(), text: m.text().slice(0, 300) }) })
  page.on('requestfailed', (r) => out.failedRequests.push({ url: r.url().slice(0, 120), err: r.failure() && r.failure().errorText }))
  page.on('pageerror', (e) => out.console.push({ type: 'pageerror', text: String(e).slice(0, 300) }))

  await step('landing', async () => {
    await page.goto(BASE + '/'); await page.waitForLoadState('networkidle')
    log('landing', { title: await page.title(), tenantDefault: await page.getByLabel('Tenant').inputValue(), h1: await page.locator('h1').allInnerTexts(), h1Visible: await page.locator('h1').first().isVisible().catch(() => null), visibleText: (await page.locator('main').innerText()).slice(0, 400) })
    await shot(page, '01-feed-landing-light-desktop')
  })
  await step('tenant-set', async () => {
    await page.getByLabel('Tenant').fill(TENANT); await page.waitForLoadState('networkidle'); await sleep(800)
    log('tenant-set', { mainText: (await page.locator('main').innerText()).slice(0, 400), badge: await badge(page) })
    await contrast(page, 'feed-empty-light', ['main p.text-sm.font-medium', 'main p.text-footnote', 'main label.text-caption', 'main span.text-caption.text-secondary', 'main button.rounded-full', 'main .text-tertiary', 'main [role=status]'])
    await axe(page, 'feed-empty-light')
  })
  await step('publish-fields', async () => {
    await page.getByRole('tab', { name: /Publish/ }).click(); await sleep(300)
    await shot(page, '02-publish-empty-light-desktop')
    const groups = await page.locator('[role=radiogroup]').evaluateAll((gs) => gs.map((g) => ({ labelledBy: g.getAttribute('aria-labelledby'), name: g.getAttribute('aria-label'), labelText: g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')) ? document.getElementById(g.getAttribute('aria-labelledby')).textContent.trim() : null })))
    log('publish-fields', { fields: await fieldInventory(page), groups, buttons: await page.locator('main button').allInnerTexts(), headings: await page.locator('main h2, main h3').allInnerTexts() })
    await contrast(page, 'publish-light', ['main label.text-caption', 'main p.text-caption', 'main input::placeholder', 'main button[type=submit]', 'main [role=radiogroup] button[aria-checked=true]', 'main [role=radiogroup] button[aria-checked=false]', 'main p.text-footnote, main .text-footnote', 'main h2'])
    await axe(page, 'publish-empty-light')
  })
  await step('submit-empty', async () => {
    await page.getByRole('button', { name: /^Publish outage/ }).click(); await sleep(400)
    const alerts = await errorsNow(page)
    log('submit-empty', { errors: alerts, focus: await focusInfo(page), scrollY: await page.evaluate(() => window.scrollY), summaryLinks: await page.locator('[role=alert] button').allInnerTexts(), firstFieldErrorInViewport: await page.locator('[role=alert]').first().evaluate((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), visible: r.top >= 0 && r.bottom <= window.innerHeight } }) })
    await page.screenshot({ path: `${EV}/03-after-submit-viewport.png` })
    // the summary link: does it take me to the field?
    const links = page.locator('[role=alert] button')
    if (await links.count()) { await links.last().click(); await sleep(200); log('summary-link-click', { linkText: await links.last().innerText(), focus: await focusInfo(page) }) }
  })
  await step('severity-floor', async () => {
    await page.getByRole('radio', { name: 'Info' }).click()
    await page.getByRole('button', { name: /^Publish outage/ }).click(); await sleep(300)
    log('severity-info-outage', { errors: await errorsNow(page), focus: await focusInfo(page) })
    await page.getByRole('radio', { name: 'Major' }).click()
  })
  await step('bad-ticket', async () => {
    await page.getByLabel(/^Title/).fill('Payments API returning 503s')
    await page.getByLabel(/^Details/).fill('Card payments fail for ~30% of requests.')
    await page.getByLabel(/^Affected services/).fill('payments-api, checkout-web')
    await page.getByLabel(/^Publisher/).fill('ux1-oncall')
    await page.getByLabel(/ServiceNow incident/).fill('INC123')
    await page.getByRole('button', { name: /^Publish outage/ }).click(); await sleep(300)
    log('bad-ticket-client', { errors: await errorsNow(page), focus: await focusInfo(page), formStillFilled: await page.getByLabel(/^Title/).inputValue() })
    await shot(page, '04-publish-bad-ticket')
  })
  let publishedId = ''
  await step('publish-success', async () => {
    await page.getByLabel(/ServiceNow incident/).fill(TICKET.toLowerCase())
    await page.getByRole('button', { name: /^Publish outage/ }).click()
    await page.getByText(/published|scheduled|Draft saved/).first().waitFor({ timeout: 10000 }); await sleep(300)
    const successText = await page.locator('main').innerText()
    publishedId = (successText.match(/[0-9a-f-]{36}/) || [''])[0]
    log('publish-success', { text: successText.slice(0, 400), focus: await focusInfo(page), ticketIsLink: (await page.locator('main a').count()) > 0, links: await page.locator('main a').evaluateAll((as) => as.map((a) => a.href)), buttons: await page.locator('main button').allInnerTexts() })
    await shot(page, '05-publish-success')
  })
  await step('duplicate-409', async () => {
    await page.getByRole('button', { name: /Publish another/ }).click(); await sleep(200)
    log('after-publish-another', { title: await page.getByLabel(/^Title/).inputValue(), publisher: await page.getByLabel(/^Publisher/).inputValue(), tenant: await page.getByLabel(/^Tenant/).last().inputValue(), ticket: await page.getByLabel(/ServiceNow incident/).inputValue(), focus: await focusInfo(page) })
    await page.getByLabel(/^Title/).fill('Payments API returning 503s (again)')
    await page.getByLabel(/ServiceNow incident/).fill(TICKET)
    await page.getByRole('button', { name: /^Publish outage/ }).click()
    await page.locator('[role=alert]').first().waitFor({ timeout: 10000 }); await sleep(300)
    log('duplicate-409', { errors: await errorsNow(page), kept: { title: await page.getByLabel(/^Title/).inputValue(), ticket: await page.getByLabel(/ServiceNow incident/).inputValue() }, alertInViewport: await page.locator('[role=alert]').first().evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight }), focus: await focusInfo(page) })
    await shot(page, '06-publish-duplicate-409')
    await contrast(page, 'server-error-light', ['main [role=alert]', 'main [role=alert] span.font-medium'])
  })
  await step('maintenance', async () => {
    await page.getByRole('button', { name: 'Clear' }).click()
    await page.getByRole('radio', { name: 'Maintenance' }).click()
    await page.getByLabel(/^Title/).fill('Planned database upgrade')
    await page.getByLabel(/^Publisher/).fill('ux1-oncall')
    await page.getByRole('button', { name: /^Publish maintenance/ }).click(); await sleep(300)
    log('maintenance-no-end', { errors: await errorsNow(page), focus: await focusInfo(page), timingOpened: await page.getByLabel(/^Ends/).isVisible() })
    await shot(page, '07-maintenance-needs-end')
    const pad = (n) => String(n).padStart(2, '0')
    const dl = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    const start = new Date(Date.now() + 60 * 60 * 1000), end = new Date(Date.now() + 3 * 60 * 60 * 1000)
    await page.getByLabel(/^Starts/).fill(dl(start)); await page.getByLabel(/^Ends/).fill(dl(end))
    await page.getByRole('button', { name: /^Publish maintenance/ }).click()
    await page.getByText(/published|scheduled/).first().waitFor({ timeout: 10000 }); await sleep(200)
    log('maintenance-success', { text: (await page.locator('main').innerText()).slice(0, 300), focus: await focusInfo(page) })
    await shot(page, '08-maintenance-scheduled')
    await page.getByRole('button', { name: /View in feed/ }).click(); await page.waitForLoadState('networkidle'); await sleep(800)
    log('view-in-feed-after-maintenance', { headerTenant: await page.getByLabel('Tenant').inputValue(), typeFilter: await page.getByLabel('Type').inputValue(), maintenanceVisible: (await page.locator('article').filter({ hasText: 'Planned database upgrade' }).count()) > 0, sections: await page.locator('main h2').allInnerTexts(), cards: await page.locator('article').count() })
    await shot(page, '09-feed-after-view-in-feed')
  })
  await step('other-tenant', async () => {
    await page.getByRole('tab', { name: /Publish/ }).click(); await sleep(200)
    await page.getByRole('button', { name: 'Clear' }).click().catch(() => null)
    await page.getByLabel(/^Title/).fill('Published into another tenant from the form')
    await page.getByLabel(/^Publisher/).fill('ux1-oncall')
    await page.getByLabel(/^Tenant/).last().fill(TENANT + '-other')
    await page.getByRole('button', { name: /^Publish/ }).click()
    await page.getByText(/published|scheduled/).first().waitFor({ timeout: 10000 }); await sleep(200)
    const t = (await page.locator('main').innerText()).slice(0, 200)
    await page.getByRole('button', { name: /View in feed/ }).click(); await page.waitForLoadState('networkidle'); await sleep(800)
    log('view-in-feed-other-tenant', { successText: t, headerTenant: await page.getByLabel('Tenant').inputValue(), typeFilter: await page.getByLabel('Type').inputValue(), itemVisible: (await page.locator('article').filter({ hasText: 'another tenant' }).count()) > 0 })
    await shot(page, '10-feed-other-tenant')
    await page.getByLabel('Tenant').fill(TENANT); await page.waitForLoadState('networkidle'); await sleep(600)
  })
  let card
  await step('feed-all-types', async () => {
    await page.getByLabel('Type').selectOption(''); await page.waitForLoadState('networkidle'); await sleep(800)
    log('feed-all-types', { mainText: (await page.locator('main').innerText()).slice(0, 700), cards: await page.locator('article').count(), sections: await page.locator('main h2').allInnerTexts(), badge: await badge(page) })
    await shot(page, '11-feed-all-types')
    await axe(page, 'feed-cards-light')
    await contrast(page, 'card-light', ['article h3', 'article p.text-sm', 'article .text-caption.text-tertiary', 'article span.text-caption.text-tertiary', 'main h2', 'article span.rounded-full.font-medium', 'article span.border.rounded-full', 'article span.font-mono', 'article button', 'main p.text-footnote', 'main span.text-caption.text-secondary'])
    card = page.locator('article').filter({ hasText: 'Payments API returning 503s' }).first()
    const maint = page.locator('article').filter({ hasText: 'Planned database upgrade' }).first()
    log('card-anatomy', { text: (await card.innerText()).replace(/\n/g, ' | ').slice(0, 400), ticketChipIsLink: await card.locator('a').count(), buttons: await card.locator('button').allInnerTexts(), maintenanceText: (await maint.innerText()).replace(/\n/g, ' | ').slice(0, 300), maintenanceButtons: await maint.locator('button').allInnerTexts(), stateTagRendered: await maint.locator('span.rounded-full.font-medium').first().evaluate((e) => ({ text: e.textContent, transform: getComputedStyle(e).textTransform })) })
  })
  await step('live', async () => {
    const live = await api('POST', '/v1/communications', { tenantId: TENANT, publisher: 'api-sre', type: 'OUTAGE', severity: 'CRITICAL', title: 'Live-pushed outage', affectedServices: ['search-api'] })
    const t0 = Date.now()
    await page.locator('article').filter({ hasText: 'Live-pushed outage' }).first().waitFor({ timeout: 8000 }).catch(() => null)
    log('live-created-propagation', { status: live.status, appearedMs: Date.now() - t0, appeared: (await page.locator('article').filter({ hasText: 'Live-pushed outage' }).count()) > 0, badge: await badge(page) })
    await api('POST', `/v1/communications/${live.body.id}/retire`, { actor: 'api-sre', note: 'fixed' })
    const t1 = Date.now()
    await page.locator('article').filter({ hasText: 'Live-pushed outage' }).first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => null)
    log('live-retired-propagation', { goneMs: Date.now() - t1, gone: (await page.locator('article').filter({ hasText: 'Live-pushed outage' }).count()) === 0 })
  })
  await step('stream-drop', async () => {
    const streams = []
    const onReq = (rq) => { if (rq.url().includes('/v1/feed/stream')) streams.push(rq.url().replace(/^.*\/v1/, '/v1')) }
    page.on('request', onReq)
    await page.route('**/v1/feed/stream**', (route) => route.abort())
    await page.evaluate(() => { const es = window.__es; if (es) es.close() })
    const samples = []
    for (let i = 0; i < 6; i++) { await sleep(1500); samples.push(await badge(page)) }
    await page.unroute('**/v1/feed/stream**')
    await sleep(5000)
    page.off('request', onReq)
    log('stream-drop', { badgeWhileDropped: samples, badgeAfter: await badge(page), cardsStillShown: await page.locator('article').count(), streamRequests: streams.slice(0, 8) })
    await shot(page, '12-stream-reconnecting')
  })
  await step('resolve', async () => {
    await card.getByRole('button', { name: 'Resolve' }).click(); await sleep(200)
    log('resolve-confirm', { text: (await card.innerText()).replace(/\n/g, ' | ').slice(-400), buttons: await card.locator('button').allInnerTexts() })
    await shot(page, '13-resolve-confirm')
    await card.getByPlaceholder(/Resolution note/).fill('Rolled back the deploy')
    await card.getByRole('button', { name: 'Resolve' }).last().click(); await sleep(1200)
    log('after-resolve', { cardGone: (await page.locator('article').filter({ hasText: 'Payments API returning 503s' }).count()) === 0, statusRegion: await page.locator('main [role=status]').allInnerTexts(), focus: await focusInfo(page), undoOffered: /undo/i.test(await page.locator('main').innerText()) })
    await shot(page, '14-after-resolve')
    const resolved = await api('GET', `/v1/communications/${publishedId}`)
    log('resolve-audit', { status: resolved.body && resolved.body.status, lastHistory: resolved.body && resolved.body.history.slice(-1) })
    // the scheduled maintenance: Withdraw
    const maint = page.locator('article').filter({ hasText: 'Planned database upgrade' }).first()
    await maint.getByRole('button', { name: 'Withdraw' }).click(); await sleep(200)
    log('withdraw-confirm', { text: (await maint.innerText()).replace(/\n/g, ' | ').slice(-300), buttons: await maint.locator('button').allInnerTexts() })
    await maint.getByRole('button', { name: 'Withdraw' }).last().click(); await sleep(1000)
    log('after-withdraw', { gone: (await page.locator('article').filter({ hasText: 'Planned database upgrade' }).count()) === 0, statusRegion: await page.locator('main [role=status]').allInnerTexts() })
  })
  await step('empty-states', async () => {
    await page.getByLabel('Service').fill('no-such-service'); await page.waitForLoadState('networkidle'); await sleep(600)
    log('filter-no-match', { text: (await page.locator('main').innerText()).slice(0, 300) })
    await page.getByLabel('Service').fill('')
    await page.getByLabel('Type').selectOption('OUTAGE')
    await page.getByLabel('Tenant').fill('ux1-fresh-tenant'); await page.waitForLoadState('networkidle'); await sleep(600)
    log('empty-new-tenant', { text: (await page.locator('main').innerText()).slice(0, 300) })
    await page.getByLabel('Type').selectOption(''); await sleep(400)
    log('empty-new-tenant-all-types', { text: (await page.locator('main').innerText()).slice(0, 300) })
    await page.getByLabel('Tenant').fill(''); await sleep(300)
    log('empty-no-tenant', { text: (await page.locator('main').innerText()).slice(0, 300) })
    await page.getByLabel('Tenant').fill(TENANT); await sleep(500)
  })
  await step('loading', async () => {
    let slow = true
    const slowHandler = async (route) => { if (slow) await sleep(1500); await route.continue() }
    await page.route('**/v1/feed?**', slowHandler)
    await page.getByRole('button', { name: 'Refresh' }).click(); await sleep(500)
    log('loading-feedback', { skeletons: await page.locator('.skeleton').count(), refreshBusy: await page.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy'), spinner: await page.locator('[role=status][aria-label=Loading]').count() })
    slow = false; await sleep(2000); await page.unroute('**/v1/feed?**', slowHandler)
  })
  await step('keyboard', async () => {
    await page.goto(BASE + '/#/publish'); await page.waitForLoadState('networkidle'); await sleep(300)
    log('hash-landing', { tabSelected: await page.getByRole('tab', { selected: true }).innerText() })
    const order = []
    for (let i = 0; i < 24; i++) { await page.keyboard.press('Tab'); order.push(await focusInfo(page)) }
    log('tab-order', { order: order.map((o) => `${o.tag}${o.role ? '[' + o.role + ']' : ''}:${o.name}${o.ring ? '' : ' (NO RING)'}`) })
    await page.getByLabel(/^Title/).focus(); await page.keyboard.type('Keyboard-only outage')
    await page.getByLabel(/^Publisher/).focus(); await page.keyboard.type('ux1-keyboard')
    await page.getByLabel(/^Title/).focus(); await page.keyboard.press('Enter')
    await page.getByText(/Outage published/).first().waitFor({ timeout: 10000 }).catch(() => null); await sleep(200)
    log('keyboard-submit', { success: (await page.locator('main').innerText()).includes('Outage published'), focusAfter: await focusInfo(page) })
    await page.getByRole('button', { name: /Publish another/ }).click()
    await page.getByRole('radio', { name: 'Outage' }).focus(); await page.keyboard.press('ArrowRight')
    log('segmented-arrow', { selected: await page.locator('[role=radiogroup]').first().locator('[aria-checked=true]').innerText() })
    const aria = await page.locator('main').ariaSnapshot()
    fs.writeFileSync(`${EV}/aria-publish.txt`, aria)
    log('aria-publish', { lines: aria.split('\n').length })
  })
  await step('dark', async () => {
    await page.getByRole('button', { name: /Switch to dark mode/ }).click(); await sleep(400)
    await page.getByRole('button', { name: /^Publish outage/ }).click(); await sleep(300)
    await shot(page, '15-publish-dark-desktop-errors')
    await contrast(page, 'publish-dark', ['main label.text-caption', 'main p.text-caption', 'main input::placeholder', 'main button[type=submit]', 'main [role=radiogroup] button[aria-checked=true]', 'main [role=radiogroup] button[aria-checked=false]', 'main h3, main .text-subheadline', 'main h2', 'main [role=alert]', 'main p[role=alert], main .text-critical-fg'])
    await axe(page, 'publish-dark')
    await page.getByRole('tab', { name: /Feed/ }).click(); await page.getByLabel('Type').selectOption(''); await page.waitForLoadState('networkidle'); await sleep(800)
    await shot(page, '16-feed-dark-desktop')
    await contrast(page, 'card-dark', ['article h3', 'article p.text-sm', 'article .text-caption.text-tertiary', 'main h2', 'article span.rounded-full.font-medium', 'article span.border.rounded-full', 'article button', 'main p.text-footnote', 'main span.text-caption.text-secondary', 'main .text-tertiary'])
    await axe(page, 'feed-dark')
    await page.getByRole('button', { name: /Switch to light mode/ }).click()
  })
  await step('phone', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const pp = await phone.newPage()
    await pp.goto(BASE + '/#/feed'); await pp.evaluate((t) => localStorage.setItem('comm-tenant', t), TENANT); await pp.reload(); await pp.waitForLoadState('networkidle')
    await pp.getByLabel('Type').selectOption(''); await sleep(800)
    log('phone-feed', { overflowX: await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), headerText: await pp.locator('header').innerText().catch(() => ''), tenantVisible: await pp.getByLabel('Tenant').isVisible() })
    await pp.screenshot({ path: `${EV}/17-feed-phone.png`, fullPage: true })
    await pp.goto(BASE + '/#/publish'); await sleep(500)
    const tapTargets = await pp.evaluate(() => [...document.querySelectorAll('main button, main input, main select, header input, header button')].map((e) => { const r = e.getBoundingClientRect(); return { name: (e.getAttribute('aria-label') || e.textContent.trim() || e.placeholder || e.id).slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) } }).filter((t) => t.h < 24 || t.w < 24))
    await pp.getByRole('button', { name: /^Publish outage/ }).click(); await sleep(400)
    log('phone-publish', { overflowX: await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), smallTapTargets: tapTargets, focusAfterSubmit: await pp.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { id: a.id, tag: a.tagName, inViewport: r.top >= 0 && r.bottom <= window.innerHeight } }) })
    await pp.screenshot({ path: `${EV}/18-publish-phone-errors.png`, fullPage: true })
    await phone.close()
  })
  await step('cap-notice', async () => {
    const T = 'ux1-many'
    const existing = await api('GET', `/v1/feed?tenantId=${T}&size=1`)
    if (!existing.body || existing.body.totalElements < 101) {
      for (let i = 0; i < 103; i++) await api('POST', '/v1/communications', { tenantId: T, publisher: 'bulk', type: 'OUTAGE', severity: 'MINOR', title: `Bulk outage ${i}` })
    }
    await page.getByLabel('Tenant').fill(T); await page.waitForLoadState('networkidle'); await sleep(1500)
    const txt = await page.locator('main').innerText()
    log('cap-notice', { cards: await page.locator('article').count(), notice: (txt.match(/Showing the first[^\n]*/) || [null])[0], tabBadge: await page.getByRole('tab', { name: /Feed/ }).innerText() })
    await page.getByLabel('Tenant').fill(TENANT)
  })
  await browser.close()
  fs.writeFileSync(`${EV}/ux-ui-log.json`, JSON.stringify(out, null, 1))
  console.log('CONSOLE', JSON.stringify(out.console).slice(0, 1500)); console.log('FAILED', JSON.stringify(out.failedRequests).slice(0, 800))
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(`${EV}/ux-ui-log.json`, JSON.stringify(out, null, 1)); process.exit(1) })
