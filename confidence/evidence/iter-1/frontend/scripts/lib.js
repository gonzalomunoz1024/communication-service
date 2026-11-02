// Shared helpers for the Frontend Verifier's Playwright checks (iteration 1; copied from iteration 0 and updated for the deliberate
// behaviour changes listed in confidence/iter-1/fixes.md: radiogroup named 'Type', 'Reconnecting (n)' badge, tenant prefix fe1-).
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const UI = process.env.UI || 'http://127.0.0.1:3000'
const API = process.env.API || 'http://127.0.0.1:8080'
const CLIENT = 'fe1-verifier'
const RESULTS_DIR = path.join(__dirname, 'results')
const SHOTS = path.join(__dirname, 'shots')

const results = []
let currentFile = 'unknown'
function setFile(name) { currentFile = name }
function record(feature, name, ok, evidence) {
  const r = { feature, name, ok: !!ok, evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence) }
  results.push(r)
  console.log(`${ok ? 'PASS' : 'FAIL'} [${feature}] ${name} :: ${r.evidence.slice(0, 400)}`)
  return ok
}
function flush() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  fs.writeFileSync(path.join(RESULTS_DIR, `${currentFile}.json`), JSON.stringify(results, null, 2))
  const fails = results.filter((r) => !r.ok)
  console.log(`\n== ${currentFile}: ${results.length} checks, ${fails.length} failed`)
  for (const f of fails) console.log(`   FAILED [${f.feature}] ${f.name}`)
}

async function api(method, p, body, headers = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'X-Client-Id': CLIENT, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, headers: res.headers, json, text }
}

function publishBody(tenantId, over = {}) {
  return { tenantId, publisher: 'fe-seed', type: 'OUTAGE', severity: 'MAJOR', title: `seed ${Date.now()}`, affectedServices: ['svc'], ...over }
}

async function launch(opts = {}) {
  const browser = await chromium.launch()
  return browser
}

/** New context + page with console/pageerror/request/response capture. */
async function newPage(browser, ctxOpts = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, ...ctxOpts })
  const page = await context.newPage()
  const cap = { console: [], errors: [], requests: [], responses: [] }
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') cap.console.push({ type: m.type(), text: m.text() }) })
  page.on('pageerror', (e) => cap.errors.push(String(e)))
  page.on('request', (r) => { if (r.url().includes('/v1/')) cap.requests.push({ method: r.method(), url: r.url(), headers: r.headers(), postData: r.postData(), at: Date.now() }) })
  page.on('response', (r) => { if (r.url().includes('/v1/')) cap.responses.push({ status: r.status(), url: r.url(), method: r.request().method(), headers: r.headers() }) })
  page.cap = cap
  return { context, page }
}

async function setTenant(page, tenant) {
  const input = page.locator('input[aria-label="Tenant"]')
  await input.fill(tenant)
}

async function gotoFeed(page, tenant, { allTypes = false } = {}) {
  await page.goto(`${UI}/#/feed`)
  await setTenant(page, tenant)
  if (allTypes) await page.getByRole('combobox', { name: 'Type' }).selectOption('')
}

async function gotoPublish(page, tenant) {
  await page.goto(`${UI}/#/publish`)
  await setTenant(page, tenant)
}

const form = (page) => page.locator('form')
const field = {
  title: (page) => form(page).locator('input[id$="-title"]'),
  body: (page) => form(page).locator('textarea[id$="-body"]'),
  services: (page) => form(page).locator('input[id$="-services"]'),
  ticket: (page) => form(page).locator('input[id$="-ticket"]'),
  tenant: (page) => form(page).locator('input[id$="-tenant"]'),
  publisher: (page) => form(page).locator('input[id$="-publisher"]'),
  audience: (page) => form(page).locator('select[id$="-audience"]'),
  ref: (page) => form(page).locator('input[id$="-ref"]'),
  starts: (page) => form(page).locator('input[id$="-starts"]'),
  ends: (page) => form(page).locator('input[id$="-ends"]'),
  expires: (page) => form(page).locator('input[id$="-expires"]'),
  draft: (page) => form(page).getByRole('switch', { name: 'Save as draft' }),
  submit: (page) => form(page).locator('button[type="submit"]'),
  clear: (page) => form(page).getByRole('button', { name: 'Clear' }),
  type: (page, label) => form(page).getByRole('radiogroup', { name: 'Type' }).getByRole('radio', { name: label, exact: true }),
  severity: (page, label) => form(page).getByRole('radiogroup', { name: 'Severity' }).getByRole('radio', { name: label, exact: true }),
  schedule: (page) => form(page).getByRole('button', { name: /^(Schedule|Hide)$/ }),
}

/** datetime-local string for now + ms, in the page's local time zone (evaluate in the page). */
async function localPlus(page, ms) {
  return page.evaluate((ms) => {
    const d = new Date(Date.now() + ms)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }, ms)
}

const alerts = (page) => page.locator('[role="alert"]')
// inline field errors only: the iteration-1 error summary (role=alert with one button per field) is excluded
const fieldAlerts = (page) => page.locator('[role="alert"]').filter({ hasNot: page.locator('button') })
// connection badge text: 'Live' | 'Connecting' | 'Paused' | 'Reconnecting' | 'Reconnecting (n)'
const IND = 'text=/^(Paused|Connecting|Live|Reconnecting)( \\(\\d+\\))?$/'
const indicator = async (page, timeout = 1000) => page.locator(IND).first().textContent({ timeout }).catch(() => '?')
const cards = (page) => page.locator('article')
const cardByTitle = (page, title) => page.locator('article', { has: page.locator('h3', { hasText: title }) })

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true })
  const p = path.join(SHOTS, `${name}.png`)
  await page.screenshot({ path: p, fullPage: true })
  return p
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }

module.exports = { UI, API, CLIENT, setFile, record, flush, api, publishBody, launch, newPage, setTenant, gotoFeed, gotoPublish, form, field, localPlus, alerts, fieldAlerts, IND, indicator, cards, cardByTitle, shot, wait }
