// light theme re-measured after the theme transition has settled (the earlier light numbers were taken 300 ms after a theme switch), plus the Save-as-draft switch target and the Publish-another focus.
const { chromium } = require('playwright'); const fs = require('fs')
const EV = '/home/claude/communication-service/confidence/evidence/iter-1/usability'
const BASE = 'http://127.0.0.1:3000', TENANT = 'ux1-sre'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {}
const contrastFn = (el) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const cs = getComputedStyle(el); let fg = parse(cs.color); const layers = []; let n = el
  while (n && n !== document.documentElement) { const b = parse(getComputedStyle(n).backgroundColor); if (b && b.a > 0) layers.push(b); n = n.parentElement }
  const htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor); const bodyBg = parse(getComputedStyle(document.body).backgroundColor)
  let bg = (htmlBg && htmlBg.a > 0) ? htmlBg : { r: 255, g: 255, b: 255, a: 1 }; if (bodyBg && bodyBg.a > 0) bg = blend(bodyBg, bg); for (const l of layers.reverse()) bg = blend(l, bg); if (fg.a < 1) fg = blend(fg, bg)
  const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight) || 400
  return { text: (el.textContent || '').trim().slice(0, 30), color: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')', fontSize: size, weight, ratio: Math.round(ratio * 100) / 100, aa: ratio >= ((size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5) }
}
;(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })
  await page.goto(BASE + '/#/feed'); await page.waitForLoadState('networkidle'); await page.getByLabel('Tenant', { exact: true }).fill(TENANT); await sleep(1500)
  const m = async (loc) => loc.evaluate(contrastFn).catch((e) => ({ error: String(e).slice(0, 80) }))
  out.feedLight = { typeSelectDefault: await m(page.getByLabel('Type')), severitySelectDefault: await m(page.getByLabel('Minimum severity')), refresh: await m(page.getByRole('button', { name: 'Refresh' })), tabPublishUnselected: await m(page.getByRole('tab', { name: /Publish/ })), tabFeedSelected: await m(page.getByRole('tab', { name: /Feed/ })), liveSwitchLabel: await m(page.getByText('Live updates')), badge: await m(page.locator('main').getByText(/^(Live|Paused|Reconnecting.*)$/).first()) }
  await page.getByLabel('Type').selectOption('OUTAGE'); await sleep(300)
  out.feedLight.typeSelectChosen = await m(page.getByLabel('Type'))
  await page.getByLabel('Type').selectOption(''); await sleep(300)
  // dark, settled
  await page.getByRole('button', { name: /Switch to dark mode/ }).click(); await sleep(1500)
  out.feedDark = { typeSelectDefault: await m(page.getByLabel('Type')), refresh: await m(page.getByRole('button', { name: 'Refresh' })), tabPublishUnselected: await m(page.getByRole('tab', { name: /Publish/ })), tabFeedSelected: await m(page.getByRole('tab', { name: /Feed/ })) }
  await page.getByRole('button', { name: /Switch to light mode/ }).click(); await sleep(1500)
  // switch target
  await page.getByRole('tab', { name: /Publish/ }).click(); await sleep(300)
  const sw = page.getByRole('switch', { name: /Save as draft/ })
  out.switch = await sw.evaluate((e) => { const r = e.getBoundingClientRect(); const lab = (e.labels && e.labels[0]) || (e.getAttribute('aria-labelledby') ? document.getElementById(e.getAttribute('aria-labelledby')) : null); const lr = lab ? lab.getBoundingClientRect() : null; const parent = e.parentElement; const pr = parent.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), ariaLabel: e.getAttribute('aria-label'), labelledBy: e.getAttribute('aria-labelledby'), labelTag: lab ? lab.tagName : null, labelText: lab ? lab.textContent.trim() : null, labelRect: lr ? { w: Math.round(lr.width), h: Math.round(lr.height) } : null, parentTag: parent.tagName, parentRect: { w: Math.round(pr.width), h: Math.round(pr.height) }, insideLabel: !!e.closest('label') } })
  const labelLoc = page.getByText(/Save as draft/).first()
  await labelLoc.click(); await sleep(150); out.switch.afterLabelClick = await sw.getAttribute('aria-checked')
  if (out.switch.afterLabelClick === 'true') { await labelLoc.click(); await sleep(100); out.switch.afterSecondLabelClick = await sw.getAttribute('aria-checked') }
  // Publish another: where does focus go?
  await page.getByLabel(/^Title/).fill('Focus check'); await page.getByLabel(/^Publisher/).fill('ux1-oncall')
  await page.getByRole('button', { name: /^Publish outage/ }).click(); await page.getByText(/Outage published/).waitFor({ timeout: 10000 })
  out.afterPublishFocus = await page.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent.trim().slice(0, 30) }))
  await page.getByRole('button', { name: /Publish another/ }).click(); await sleep(300)
  out.afterPublishAnotherFocus = await page.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.id, text: (document.activeElement.textContent || '').trim().slice(0, 30) }))
  // relative-time wording on the success card for a window exactly 1 h / 24 h away
  const pad = (n) => String(n).padStart(2, '0'); const dl = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  await page.getByRole('radio', { name: 'Maintenance' }).click(); await page.getByLabel(/^Title/).fill('Wording check'); 
  await page.getByLabel(/^Starts/).fill(dl(new Date(Date.now() + 24 * 3600 * 1000 + 60000))); await page.getByLabel(/^Ends/).fill(dl(new Date(Date.now() + 26 * 3600 * 1000)))
  await page.getByRole('button', { name: /^Publish maintenance/ }).click(); await page.getByText(/Maintenance scheduled/).waitFor({ timeout: 10000 })
  out.successWording24h = (await page.locator('main').innerText()).split('\n').filter(Boolean).slice(2, 5)
  await page.getByRole('button', { name: /View in feed/ }).click(); await sleep(1200)
  const card = page.locator('article').filter({ hasText: 'Wording check' }).first()
  out.cardWording24h = (await card.innerText()).split('\n').filter(Boolean)
  await card.getByRole('button', { name: 'Withdraw' }).click(); await card.getByRole('button', { name: 'Withdraw' }).last().click(); await sleep(500)
  await browser.close(); fs.writeFileSync(`${EV}/remeasure-log.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1))
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(`${EV}/remeasure-log.json`, JSON.stringify(out, null, 1)); process.exit(1) })
