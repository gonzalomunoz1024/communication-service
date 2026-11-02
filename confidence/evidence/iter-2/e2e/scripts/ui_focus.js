// G-2-10 follow-up: focus after "Publish another" (checked right after the publish, before any tab switch).
const { chromium } = require('playwright')
const UI = 'http://127.0.0.1:19530', A = 'http://127.0.0.1:19501'; const RUN = Date.now().toString(36); const T = `ve2-focus-${RUN}`
const activeEl = (p) => p.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName.toLowerCase()}#${e.id || ''} role=${e.getAttribute('role') || ''} label=${e.getAttribute('aria-label') || ''} text=${(e.textContent || '').trim().slice(0, 30)}` : 'none' })
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); let fails = 0
  const check = (id, n, c, d) => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'} ${id} ${n} :: ${d}`) }
  await p.goto(`${UI}/#/publish`); await p.getByRole('textbox', { name: 'Tenant', exact: true }).fill(T)
  await p.getByLabel(/^Title\*$/).fill(`focus ${RUN}`); await p.getByLabel(/^Publisher\*$/).fill('ve2-oncall')
  const [res] = await Promise.all([p.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/v1/communications')), p.getByRole('button', { name: 'Publish outage' }).click()])
  await p.getByRole('heading', { name: 'Outage published' }).waitFor()
  const afterPublish = await activeEl(p)
  await p.getByRole('button', { name: 'Publish another' }).click()
  const afterAnother = await activeEl(p)
  const titleId = await p.getByLabel(/^Title\*$/).getAttribute('id')
  check('F-56', 'after publishing, focus is on the confirmation heading; after "Publish another", focus is on the Title field (G-2-10)', /^h2/.test(afterPublish) && afterAnother.includes(`#${titleId} `), `publish=${res.status()} afterPublish=${afterPublish} afterAnother=${afterAnother} titleId=${titleId}`)
  check('F-56', '"Publish another" keeps tenant and publisher', (await p.getByLabel(/^Tenant\*$/).inputValue()) === T && (await p.getByLabel(/^Publisher\*$/).inputValue()) === 've2-oncall' && (await p.getByLabel(/^Title\*$/).inputValue()) === '', '')
  const c = await res.json(); await fetch(`${A}/v1/communications/${c.id}/retire`, { method: 'POST', headers: { 'X-Client-Id': 've2-focus', 'Content-Type': 'application/json' }, body: '{}' })
  await b.close(); console.log(`## summary: ${2 - fails} pass, ${fails} fail`); process.exit(fails)
})().catch((e) => { console.log('FAIL RUN ' + e); process.exit(98) })
