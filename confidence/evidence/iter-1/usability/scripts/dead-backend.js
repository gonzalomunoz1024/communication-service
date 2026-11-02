// UX-4 re-check: the UI with no service behind the dev proxy (own dev server on :3220 -> 127.0.0.1:1), plus proxy-style answers on the shared stack.
const { chromium } = require('playwright')
const fs = require('fs')
const EV = '/home/claude/communication-service/confidence/evidence/iter-1/usability'
const DEAD = 'http://127.0.0.1:3220', LIVE = 'http://127.0.0.1:3000'
const out = { steps: [] }
const log = (step, data) => { out.steps.push({ step, ...data }); console.log(step, JSON.stringify(data).slice(0, 700)) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BADGE = /^(Live|Connecting|Reconnecting( \(\d+\))?|Paused)$/
const badge = (page) => page.locator('main').getByText(BADGE).first().textContent({ timeout: 2000 }).catch(() => null)
async function step(name, fn) { try { await fn() } catch (e) { log(name + ':ERROR', { error: String(e).slice(0, 300) }) } }
const contrastFn = (arg) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const el = arg instanceof Element ? arg : document.querySelector(arg); if (!el) return { sel: String(arg), missing: true }
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
  return { text: (el.textContent || '').trim().slice(0, 50), color: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')', fontSize: size, weight, ratio: Math.round(ratio * 100) / 100, aa: ratio >= (large ? 3 : 4.5) }
}
async function focusInfo(page) {
  return page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return { tag: 'BODY' }; const r = a.getBoundingClientRect(); return { tag: a.tagName, role: a.getAttribute('role'), name: a.getAttribute('aria-label') || a.textContent.trim().slice(0, 40), inViewport: r.top >= 0 && r.bottom <= window.innerHeight } })
}
;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })
  const page = await ctx.newPage()
  const alerts = () => page.locator('main [role=alert]').allInnerTexts()
  const inView = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight })
  await step('feed-dead', async () => {
    await page.goto(DEAD + '/#/feed'); await page.waitForLoadState('networkidle')
    await page.getByLabel('Tenant', { exact: true }).fill('ux1-dead'); await sleep(3500)
    log('feed-dead', { text: (await page.locator('main').innerText()).slice(0, 500), alerts: await alerts(), badge: await badge(page), buttons: await page.locator('main button').allInnerTexts(), status: await page.locator('main [role=status]').allInnerTexts() })
    await page.screenshot({ path: `${EV}/23-unreachable-feed-light.png`, fullPage: true })
    log('contrast:unreachable-feed-light', { alert: await page.locator('main [role=alert]').first().evaluate(contrastFn).catch(() => null), tryAgain: await page.getByRole('button', { name: /Try again/ }).first().evaluate(contrastFn).catch(() => null), badge: await page.locator('main').getByText(BADGE).first().evaluate(contrastFn).catch(() => null) })
    const tryAgain = page.getByRole('button', { name: /Try again/ })
    if (await tryAgain.count()) { await tryAgain.first().click(); await sleep(2000); log('feed-dead-try-again', { alerts: await alerts(), badge: await badge(page), buttons: await page.locator('main button').allInnerTexts() }) }
  })
  await step('publish-dead', async () => {
    await page.getByRole('tab', { name: /Publish/ }).click(); await sleep(200)
    await page.getByLabel(/^Title/).fill('Draft while the service is down'); await page.getByLabel(/^Publisher/).fill('ux1-oncall')
    await page.getByRole('button', { name: /^Publish outage/ }).click()
    await page.locator('main [role=alert]').first().waitFor({ timeout: 10000 }); await sleep(300)
    log('publish-dead', { alerts: await alerts(), focus: await focusInfo(page), draftKept: await page.getByLabel(/^Title/).inputValue(), buttonEnabled: await page.getByRole('button', { name: /^Publish outage/ }).isEnabled(), alertInViewport: await inView(page.locator('main [role=alert]').first()) })
    await page.screenshot({ path: `${EV}/24-unreachable-publish-light.png`, fullPage: true })
    log('contrast:unreachable-publish-light', { alert: await page.locator('main [role=alert]').first().evaluate(contrastFn) })
    await page.getByRole('button', { name: /Switch to dark mode/ }).click(); await sleep(300)
    await page.screenshot({ path: `${EV}/25-unreachable-publish-dark.png`, fullPage: true })
    log('contrast:unreachable-publish-dark', { alert: await page.locator('main [role=alert]').first().evaluate(contrastFn) })
    await page.getByRole('tab', { name: /Feed/ }).click(); await sleep(3000)
    await page.screenshot({ path: `${EV}/26-unreachable-feed-dark.png`, fullPage: true })
    log('feed-dead-dark', { alerts: await alerts(), badge: await badge(page) })
    log('contrast:unreachable-feed-dark', { alert: await page.locator('main [role=alert]').first().evaluate(contrastFn).catch(() => null), tryAgain: await page.getByRole('button', { name: /Try again/ }).first().evaluate(contrastFn).catch(() => null), badge: await page.locator('main').getByText(BADGE).first().evaluate(contrastFn).catch(() => null) })
  })
  for (const v of [{ name: '502-html', status: 502, body: '<html><body><h1>502 Bad Gateway</h1></body></html>', ct: 'text/html' }, { name: '503-json', status: 503, body: '{"error":"upstream unavailable"}', ct: 'application/json' }, { name: 'abort', abort: true }, { name: '500-empty', status: 500, body: '', ct: 'text/plain' }]) {
    await step('variant-' + v.name, async () => {
      const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p2 = await c2.newPage()
      await p2.route('**/v1/**', (route) => v.abort ? route.abort('connectionrefused') : route.fulfill({ status: v.status, contentType: v.ct, body: v.body }))
      await p2.goto(LIVE + '/#/feed'); await p2.getByLabel('Tenant', { exact: true }).fill('ux1-dead'); await sleep(3000)
      const feedAlerts = await p2.locator('main [role=alert]').allInnerTexts(); const feedBadge = await badge(p2)
      await p2.getByRole('tab', { name: /Publish/ }).click(); await p2.getByLabel(/^Title/).fill('x'); await p2.getByLabel(/^Publisher/).fill('y'); await p2.getByRole('button', { name: /^Publish outage/ }).click(); await sleep(1500)
      log('variant-' + v.name, { feedAlerts, feedBadge, publishAlerts: await p2.locator('main [role=alert]').allInnerTexts() })
      await c2.close()
    })
  }
  await browser.close(); fs.writeFileSync(`${EV}/dead-backend-log.json`, JSON.stringify(out, null, 1))
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
