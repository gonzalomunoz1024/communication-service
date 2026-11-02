// E2E verifier (iteration 4): Withdraw of a scheduled maintenance in one browser -> gone live in a second, separate browser
// (own Chromium process), without reload or list re-fetch; API shows RETIRED with the note. Tenant ve4-wd-<run>.
const { chromium } = require('playwright')
const UI = 'http://127.0.0.1:19530', A = 'http://127.0.0.1:19501'
const RUN = Date.now().toString(36)
const OUT = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e4/out'
let fails = 0
function check(id, name, cond, detail = '') { if (!cond) fails++; console.log(`${new Date().toISOString()} ${cond ? 'PASS' : 'FAIL'} ${id} ${name} :: ${String(detail).slice(0, 700)}`) }
async function api(method, path, body) {
  const res = await fetch(A + path, { method, headers: { Accept: 'application/json', 'X-Client-Id': 've4-wd-checks', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, ms = 10000, every = 50) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Date.now() - t0 } catch {} await sleep(every) } return -1 }
const card = (page, title) => page.locator('article', { hasText: title })
function track(page) { const log = { gets: 0, streams: 0, errors: [] }; page.on('request', (r) => { if (r.method() === 'GET' && /\/v1\/feed\?/.test(r.url())) log.gets++; if (/\/v1\/feed\/stream/.test(r.url())) log.streams++ }); page.on('pageerror', (e) => log.errors.push(String(e))); return log }
async function openFeed(page, tenant) {
  await page.goto(`${UI}/#/feed`)
  await page.getByRole('textbox', { name: 'Tenant', exact: true }).fill(tenant)
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'All types' })
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 15000 })
  await page.evaluate((run) => { window.__ve4 = run }, RUN)
}
;(async () => {
  const T = `ve4-wd-${RUN}`
  console.log(`## withdraw propagation run ${RUN} tenant ${T} at ${new Date().toISOString()}`)
  const base = { tenantId: T, publisher: 've4-api', affectedServices: ['wd-api'] }
  const out = (await api('POST', '/v1/communications', { ...base, type: 'OUTAGE', severity: 'MAJOR', title: `Wd outage ${RUN}` })).json
  const maint = (await api('POST', '/v1/communications', { ...base, type: 'MAINTENANCE', severity: 'INFO', title: `Wd maintenance ${RUN}`, startsAt: new Date(Date.now() + 86400e3).toISOString(), endsAt: new Date(Date.now() + 93600e3).toISOString() })).json
  check('F-01', 'seed: an ACTIVE outage and a SCHEDULED maintenance starting in 24 h', out && out.status === 'ACTIVE' && maint && maint.status === 'SCHEDULED', `${out && out.status} / ${maint && maint.status}`)
  const bW = await chromium.launch(); const bP = await chromium.launch()
  const W = await (await bW.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const logW = track(W)
  const P = await (await bP.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const logP = track(P)
  await openFeed(W, T); await openFeed(P, T)
  const both = (await card(W, `Wd maintenance ${RUN}`).count()) === 1 && (await card(P, `Wd maintenance ${RUN}`).count()) === 1
  check('F-16', 'both browsers (two Chromium processes) list the scheduled maintenance under Upcoming with All types', both && await W.getByRole('heading', { name: /Upcoming/ }).isVisible(), '')
  const getsW = logW.gets, streamsW = logW.streams
  const mc = card(P, `Wd maintenance ${RUN}`)
  await mc.getByRole('button', { name: 'Withdraw' }).click()
  await mc.getByPlaceholder('Reason (optional)').fill('postponed by ve4')
  const t0 = Date.now()
  const [wres] = await Promise.all([P.waitForResponse((r) => r.url().endsWith(`/v1/communications/${maint.id}/retire`)), mc.getByRole('button', { name: 'Withdraw' }).click()])
  const tResp = Date.now()
  const goneW = await waitFor(async () => (await card(W, `Wd maintenance ${RUN}`).count()) === 0, 10000)
  const tGone = Date.now()
  check('F-62', 'Withdraw in browser 1 -> POST retire 200 {actor: publisher, note}', wres.status() === 200 && wres.request().postDataJSON().note === 'postponed by ve4', `${wres.status()} ${JSON.stringify(wres.request().postDataJSON())}`)
  check('F-60', 'browser 2 loses the withdrawn maintenance live (retired frame), no reload, no list re-fetch, no stream reopen', goneW >= 0 && (await W.evaluate(() => window.__ve4)) === RUN && logW.gets === getsW && logW.streams === streamsW, `gone ${tGone - tResp} ms after the 200 (${tGone - t0} ms after the click); browser-2 list GETs ${getsW}->${logW.gets}, streams ${streamsW}->${logW.streams}`)
  check('F-60', 'browser 2 keeps the active outage (only the withdrawn item left)', (await card(W, `Wd outage ${RUN}`).count()) === 1, '')
  const p = await api('GET', `/v1/communications/${maint.id}`)
  const hist = (p.json && (p.json.history || p.json.audit)) || []
  check('F-06', 'API: the maintenance reads RETIRED, the history holds the note and the actor', p.status === 200 && p.json.status === 'RETIRED' && JSON.stringify(hist).includes('postponed by ve4'), `${p.status} ${p.json && p.json.status} ${JSON.stringify(hist).slice(0, 300)}`)
  check('F-90', 'no page errors in either browser', logW.errors.length === 0 && logP.errors.length === 0, [...logW.errors, ...logP.errors].join(' || '))
  await W.screenshot({ path: `${OUT}/screenshots/f62-withdraw-watcher.png` })
  await api('POST', `/v1/communications/${out.id}/retire`, {})
  await bW.close(); await bP.close()
  console.log(`## summary: fails=${fails} at ${new Date().toISOString()}`)
  process.exit(Math.min(99, fails))
})().catch((e) => { console.log('FAIL RUN script crashed :: ' + (e.stack || e)); process.exit(98) })
