// Iteration-1 follow-up UI checks on the shared stack: dark theme (desktop + phone), 409 banner placement, cap notice, switch target, field associations, proxy 502 feed text.
const { chromium } = require('playwright')
const { AxeBuilder } = require('@axe-core/playwright')
const fs = require('fs')
const EV = '/home/claude/communication-service/confidence/evidence/iter-1/usability'
const BASE = 'http://127.0.0.1:3000', API = 'http://localhost:8080', TENANT = 'ux1-sre'
const out = { steps: [] }
const log = (step, data) => { out.steps.push({ step, ...data }); console.log(step, JSON.stringify(data).slice(0, 900)) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = (page, name, full = true) => page.screenshot({ path: `${EV}/${name}.png`, fullPage: full })
const BADGE = /^(Live|Connecting|Reconnecting( \(\d+\))?|Paused)$/
const badge = (page) => page.locator('main').getByText(BADGE).first().textContent({ timeout: 2000 }).catch(() => null)
async function step(name, fn) { try { await fn() } catch (e) { log(name + ':ERROR', { error: String(e).slice(0, 300) }) } }
async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { 'X-Client-Id': 'ux1-reviewer', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); return { status: res.status, body: text ? JSON.parse(text) : null }
}
const contrastFn = (arg) => {
  const { sel, pseudo } = typeof arg === 'string' || arg instanceof Element ? { sel: arg } : arg
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const el = sel instanceof Element ? sel : document.querySelector(sel); if (!el) return { sel: String(sel), missing: true }
  const cs = getComputedStyle(el, pseudo || null); let fg = parse(cs.color)
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
  return { sel: typeof sel === 'string' ? sel + (pseudo || '') : (el.tagName + ':' + (el.textContent || '').trim().slice(0, 20)), text: pseudo ? (el.placeholder || '') : (el.textContent || '').trim().slice(0, 40), color: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')', fontSize: size, weight, ratio: Math.round(ratio * 100) / 100, aa: ratio >= (large ? 3 : 4.5) }
}
async function contrast(page, label, selectors) { const rows = []; for (const s of selectors) rows.push(await page.evaluate(contrastFn, s)); log(`contrast:${label}`, { rows }); return rows }
async function axe(page, label) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  log(`axe:${label}`, { violations: r.violations.map((x) => ({ id: x.id, impact: x.impact, count: x.nodes.length, nodes: x.nodes.slice(0, 3).map((n) => n.target.join(' ')) })), passes: r.passes.length })
}
async function focusInfo(page) {
  return page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return { tag: 'BODY' }; const r = a.getBoundingClientRect(); return { tag: a.tagName, role: a.getAttribute('role'), name: a.getAttribute('aria-label') || a.textContent.trim().slice(0, 40), inViewport: r.top >= 0 && r.bottom <= window.innerHeight } })
}
;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })
  const page = await ctx.newPage()
  const hdrTenant = () => page.getByLabel('Tenant', { exact: true })
  await page.goto(BASE + '/#/feed'); await page.waitForLoadState('networkidle')
  await hdrTenant().fill(TENANT); await sleep(500)
  await step('feed-fields', async () => {
    const rows = await page.evaluate(() => [...document.querySelectorAll('main label')].map((lab) => { const forId = lab.getAttribute('for'); const c = forId ? document.getElementById(forId) : lab.querySelector('input,select,button'); return { label: lab.textContent.trim().slice(0, 30), associated: !!c, control: c ? c.tagName + (c.getAttribute('role') ? '[' + c.getAttribute('role') + ']' : '') : null } }))
    const sw = await page.getByRole('switch').evaluateAll((es) => es.map((e) => ({ name: e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent.trim()) || e.textContent.trim(), checked: e.getAttribute('aria-checked') })))
    log('feed-fields', { rows, switches: sw, hints: await page.locator('main p.text-caption').allInnerTexts() })
  })
  const DUP = 'INC0009991'
  const seed = await api('POST', '/v1/communications', { tenantId: TENANT, publisher: 'api-sre', type: 'OUTAGE', severity: 'MAJOR', title: 'Seed for the duplicate-ticket check', ticket: { number: DUP } })
  log('seed-dup', { status: seed.status, body: JSON.stringify(seed.body).slice(0, 160) })
  await step('409-placement-light', async () => {
    await page.getByRole('tab', { name: /Publish/ }).click(); await sleep(200)
    await page.getByLabel(/^Title/).fill('Duplicate ticket attempt'); await page.getByLabel(/^Publisher/).fill('ux1-oncall'); await page.getByLabel(/ServiceNow incident/).fill(DUP)
    const submit = page.getByRole('button', { name: /^Publish outage/ })
    await submit.scrollIntoViewIfNeeded()
    const before = await submit.evaluate((e) => { const r = e.getBoundingClientRect(); return { buttonTop: Math.round(r.top), scrollY: Math.round(window.scrollY), vh: window.innerHeight, docH: document.documentElement.scrollHeight } })
    await submit.click()
    const alert = page.locator('main [role=alert]').first(); await alert.waitFor({ timeout: 10000 }); await sleep(300)
    const geom = await alert.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), scrollY: Math.round(window.scrollY), vh: window.innerHeight, inViewport: r.top >= 0 && r.bottom <= window.innerHeight } })
    const rel = await page.evaluate(() => { const a = document.querySelector('main [role=alert]'); const b = [...document.querySelectorAll('main button')].find((x) => /^Publish outage/.test(x.textContent)); return a && b ? (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 'alert-before-button' : 'alert-after-button') : null })
    const btnAfter = await submit.evaluate((e) => { const r = e.getBoundingClientRect(); return { buttonTop: Math.round(r.top), inViewport: r.top >= 0 && r.bottom <= window.innerHeight } })
    log('409-placement-light', { before, alert: geom, rel, btnAfter, focus: await focusInfo(page), text: (await alert.innerText()).slice(0, 120) })
    await shot(page, '19-409-viewport-after-click', false)
    // if it is out of view: scroll to the top of the form and check whether there is anything near the button
    await page.evaluate(() => window.scrollTo(0, 0))
  })
  await step('dark-publish', async () => {
    await page.getByRole('button', { name: /Switch to dark mode/ }).click(); await sleep(400)
    await contrast(page, 'server-error-dark', ['main [role=alert]', 'main [role=alert] span.font-medium'])
    await page.getByRole('button', { name: 'Clear' }).click(); await sleep(150)
    await page.getByRole('radio', { name: 'Info' }).click()
    await page.getByRole('button', { name: /^Publish outage/ }).click(); await sleep(400)
    await shot(page, '15-publish-dark-desktop-errors')
    await contrast(page, 'publish-dark', ['main label.text-caption', 'main p.text-caption', { sel: 'main input[placeholder]', pseudo: '::placeholder' }, { sel: 'main textarea', pseudo: '::placeholder' }, 'main button[type=submit]', 'main [role=radiogroup] button[aria-checked=true]', 'main [role=radiogroup] button[aria-checked=false]', 'main h2', 'main p[role=alert]', 'main div[role=alert]', 'main div[role=alert] button', 'main select', 'main input[type=text]', 'main .text-tertiary'])
    log('contrast:dark-buttons', { clear: await page.getByRole('button', { name: 'Clear' }).evaluate(contrastFn), schedule: await page.getByRole('button', { name: 'Schedule' }).evaluate(contrastFn), tabUnselected: await page.getByRole('tab', { name: /Feed/ }).evaluate(contrastFn), tabSelected: await page.getByRole('tab', { name: /Publish/ }).evaluate(contrastFn), charCounter: await page.getByText(/\/200$/).first().evaluate(contrastFn).catch(() => null) })
    await axe(page, 'publish-dark')
    await page.getByRole('radio', { name: 'Major' }).click()
  })
  await step('dark-feed', async () => {
    await page.getByRole('tab', { name: /Feed/ }).click(); await page.getByLabel('Type').selectOption(''); await page.waitForLoadState('networkidle'); await sleep(900)
    await shot(page, '16-feed-dark-desktop')
    log('dark-feed', { cards: await page.locator('article').count(), badge: await badge(page), sections: await page.locator('main h2').allInnerTexts() })
    await contrast(page, 'card-dark', ['article h3', 'article p.text-sm', 'article .text-caption.text-tertiary', 'main h2', 'article span.rounded-full.font-medium', 'article span.border.rounded-full', 'article span.font-mono', 'article button', 'main span.text-caption.text-secondary', 'main .text-tertiary', 'main label.text-caption', { sel: 'main input[placeholder]', pseudo: '::placeholder' }, 'main select'])
    log('contrast:dark-feed-extra', { refresh: await page.getByRole('button', { name: 'Refresh' }).evaluate(contrastFn), countBadge: await page.locator('main h2 span').first().evaluate(contrastFn).catch(() => null) })
    await axe(page, 'feed-dark')
    await page.getByLabel('Service').fill('zzz-none'); await sleep(800)
    await contrast(page, 'feed-empty-dark', ['main p.text-sm.font-medium', 'main p.text-footnote'])
    await shot(page, '16b-feed-empty-dark-desktop')
    await page.getByLabel('Service').fill(''); await sleep(300)
    await page.getByRole('button', { name: /Switch to light mode/ }).click(); await sleep(300)
  })
  await step('light-extra', async () => {
    await contrast(page, 'feed-light-extra', [{ sel: 'main input[placeholder]', pseudo: '::placeholder' }, 'main select'])
    log('contrast:light-buttons-feed', { refresh: await page.getByRole('button', { name: 'Refresh' }).evaluate(contrastFn), tabUnselected: await page.getByRole('tab', { name: /Publish/ }).evaluate(contrastFn), tabSelected: await page.getByRole('tab', { name: /Feed/ }).evaluate(contrastFn), countBadge: await page.locator('main h2 span').first().evaluate(contrastFn).catch(() => null) })
    await page.getByRole('tab', { name: /Publish/ }).click(); await sleep(200)
    await contrast(page, 'publish-light-extra', [{ sel: 'main input[placeholder]', pseudo: '::placeholder' }, { sel: 'main textarea', pseudo: '::placeholder' }, 'main select', 'main .text-tertiary'])
    log('contrast:light-buttons-publish', { clear: await page.getByRole('button', { name: 'Clear' }).evaluate(contrastFn), schedule: await page.getByRole('button', { name: 'Schedule' }).evaluate(contrastFn), charCounter: await page.getByText(/\/200$/).first().evaluate(contrastFn).catch(() => null) })
    const hints = await page.locator('main p.text-caption').allInnerTexts()
    log('publish-hints', { hints })
  })
  await step('switch-target', async () => {
    const sw = page.getByRole('switch', { name: /Save as draft/ })
    const info = await sw.evaluate((e) => { const r = e.getBoundingClientRect(); const lab = e.labels && e.labels[0] ? e.labels[0] : (e.getAttribute('aria-labelledby') ? document.getElementById(e.getAttribute('aria-labelledby')) : null); const lr = lab ? lab.getBoundingClientRect() : null; return { w: Math.round(r.width), h: Math.round(r.height), checked: e.getAttribute('aria-checked'), labelTag: lab ? lab.tagName : null, labelRect: lr ? { w: Math.round(lr.width), h: Math.round(lr.height) } : null, insideLabel: !!e.closest('label') } })
    await page.getByText('Save as draft', { exact: true }).click(); await sleep(150)
    const afterLabelClick = await sw.getAttribute('aria-checked')
    log('switch-target', { ...info, afterLabelClick })
    if (afterLabelClick === 'true') await sw.click()
  })
  await step('cap-notice', async () => {
    const T = 'ux1-many'
    const existing = await api('GET', `/v1/feed?tenantId=${T}&size=1`)
    const total = existing.body ? (existing.body.totalElements ?? existing.body.total ?? null) : null
    if (!(total >= 101)) for (let i = 0; i < 103; i++) await api('POST', '/v1/communications', { tenantId: T, publisher: 'bulk', type: 'OUTAGE', severity: 'MINOR', title: `Bulk outage ${i}` })
    await page.getByRole('tab', { name: /Feed/ }).click()
    await hdrTenant().fill(T); await page.waitForLoadState('networkidle'); await sleep(2500)
    const txt = await page.locator('main').innerText()
    log('cap-notice', { totalBefore: total, cards: await page.locator('article').count(), notice: (txt.match(/Showing the first[^\n]*/) || [null])[0], tabBadge: (await page.getByRole('tab', { name: /Feed/ }).innerText()).replace(/\n/g, ' '), sections: await page.locator('main h2').allInnerTexts() })
    const noticeEl = page.getByText(/Showing the first/).first()
    if (await noticeEl.count()) { await noticeEl.scrollIntoViewIfNeeded(); log('contrast:cap-notice', { row: await noticeEl.evaluate(contrastFn) }); await shot(page, '20-cap-notice-light', false) }
    await hdrTenant().fill(TENANT); await sleep(500)
  })
  await step('proxy-502-feed-text', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p2 = await c2.newPage()
    await p2.route('**/v1/**', (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' }))
    await p2.goto(BASE + '/#/feed'); await p2.getByLabel('Tenant', { exact: true }).fill('ux1-dead'); await sleep(3000)
    log('proxy-502-feed-text', { text: (await p2.locator('main').innerText()).split('\n').filter(Boolean).slice(-6), badge: await badge(p2) })
    await c2.close()
  })
  await step('phone-dark', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const pp = await phone.newPage()
    await pp.goto(BASE + '/#/feed'); await pp.waitForLoadState('networkidle')
    await pp.getByLabel('Tenant', { exact: true }).fill(TENANT); await pp.getByLabel('Type').selectOption(''); await sleep(1000)
    await pp.screenshot({ path: `${EV}/21-feed-phone-dark.png`, fullPage: true })
    const v1 = await new AxeBuilder({ page: pp }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    log('phone-dark-feed', { overflowX: await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), cards: await pp.locator('article').count(), axe: v1.violations.map((x) => x.id + ':' + x.nodes.length) })
    await pp.getByRole('tab', { name: /Publish/ }).click(); await sleep(300)
    await pp.screenshot({ path: `${EV}/22-publish-phone-dark.png`, fullPage: true })
    await pp.getByRole('button', { name: /^Publish outage/ }).click(); await sleep(400)
    await pp.screenshot({ path: `${EV}/22b-publish-phone-dark-errors.png`, fullPage: true })
    const v2 = await new AxeBuilder({ page: pp }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    log('phone-dark-publish', { overflowX: await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), axe: v2.violations.map((x) => x.id + ':' + x.nodes.length), focusAfterSubmit: await pp.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { id: a.id, inViewport: r.top >= 0 && r.bottom <= window.innerHeight } }) })
    await phone.close()
  })
  await step('phone-light-publish-overview', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const pp = await phone.newPage(); await pp.goto(BASE + '/#/publish'); await pp.waitForLoadState('networkidle'); await sleep(300)
    await pp.screenshot({ path: `${EV}/18a-publish-phone-light.png`, fullPage: true }); await phone.close()
  })
  await browser.close()
  fs.writeFileSync(`${EV}/ux-ui2-log.json`, JSON.stringify(out, null, 1))
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(`${EV}/ux-ui2-log.json`, JSON.stringify(out, null, 1)); process.exit(1) })
