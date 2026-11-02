// UX-16 from the user's seat: publish with a ticket, Resolve it in the feed, publish again with the same ticket, follow the banner's advice.
const { chromium } = require('playwright'); const fs = require('fs')
const EV = '/home/claude/communication-service/confidence/evidence/iter-1/usability'
const BASE = 'http://127.0.0.1:3000', TENANT = 'ux1-sre'; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {}
;(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(BASE + '/#/publish'); await page.waitForLoadState('networkidle'); await page.getByLabel('Tenant', { exact: true }).fill(TENANT); await sleep(300)
  const ticket = 'INC' + String(Date.now()).slice(-7); out.ticket = ticket
  const publish = async (title) => { await page.getByRole('button', { name: 'Clear' }).click().catch(() => null); await page.getByLabel(/^Title/).fill(title); await page.getByLabel(/^Publisher/).fill('ux1-oncall'); await page.getByLabel(/ServiceNow incident/).fill(ticket); await page.getByRole('button', { name: /^Publish outage/ }).click(); await Promise.race([page.getByText(/Outage published/).waitFor({ timeout: 10000 }), page.locator('main div[role=alert]').first().waitFor({ timeout: 10000 })]); await sleep(300); return (await page.locator('main').innerText()).includes('Outage published') ? 'published' : (await page.locator('main div[role=alert]').first().innerText()) }
  out.first = await publish('Retire-then-republish')
  await page.getByRole('button', { name: /View in feed/ }).click(); await sleep(1000)
  const card = page.locator('article').filter({ hasText: 'Retire-then-republish' }).first()
  await card.getByRole('button', { name: 'Resolve' }).click(); await card.getByRole('button', { name: 'Resolve' }).last().click(); await sleep(1000)
  out.resolved = { gone: (await page.locator('article').filter({ hasText: 'Retire-then-republish' }).count()) === 0, status: await page.locator('main [role=status]').allInnerTexts() }
  await page.getByRole('tab', { name: /Publish/ }).click(); await sleep(300)
  out.second = await publish('Republished after retiring the first')
  const alert = page.locator('main div[role=alert]').first(); if (await alert.count()) { await alert.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${EV}/29-409-after-retire.png` }) }
  // the banner's second alternative: another external reference
  await page.getByLabel(/^External reference/).fill(ticket + '-2'); await page.getByRole('button', { name: /^Publish outage/ }).click(); await page.getByText(/Outage published/).waitFor({ timeout: 10000 }).catch(() => null)
  out.third = (await page.locator('main').innerText()).includes('Outage published') ? 'published with another external reference' : await page.locator('main div[role=alert]').first().innerText().catch(() => 'no alert')
  await browser.close(); fs.writeFileSync(`${EV}/409-after-retire-log.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1))
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(`${EV}/409-after-retire-log.json`, JSON.stringify(out, null, 1)); process.exit(1) })
