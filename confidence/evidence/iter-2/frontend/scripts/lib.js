// Shared helpers for the Frontend Verifier's Playwright checks, iteration 2 (tenant prefix vf2-, client id vf2-verifier).
// Written against the current UI (confidence-loop/2026-11-01 @ be19645): no default tenant, 'Scheduled' capsule, actor+tenant
// in the confirm line, 10 s reopen cap. Results: one JSON per script under ../results, screenshots under ../shots.
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const UI = process.env.UI || 'http://127.0.0.1:3000'
const API = process.env.API || 'http://127.0.0.1:8080'
const CLIENT = 'vf2-verifier'
const RESULTS_DIR = path.join(__dirname, '..', 'results')
const SHOTS = path.join(__dirname, '..', 'shots')

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

async function api(method, p, body, headers = {}, base = API) {
  const res = await fetch(`${base}${p}`, {
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
  return { tenantId, publisher: 'vf2-seed', type: 'OUTAGE', severity: 'MAJOR', title: `seed ${Date.now()}`, affectedServices: ['svc'], ...over }
}

async function launch() {
  return chromium.launch()
}

/** New context + page with console/pageerror/request/response capture. */
async function newPage(browser, ctxOpts = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, ...ctxOpts })
  const page = await context.newPage()
  const cap = { console: [], errors: [], requests: [], responses: [] }
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') cap.console.push({ type: m.type(), text: m.text() }) })
  page.on('pageerror', (e) => cap.errors.push(String(e)))
  page.on('request', (r) => { if (r.url().includes('/v1/')) cap.requests.push({ method: r.method(), url: r.url(), headers: r.headers(), postData: r.postData(), at: Date.now() }) })
  page.on('response', (r) => { if (r.url().includes('/v1/')) cap.responses.push({ status: r.status(), url: r.url(), method: r.request().method(), headers: r.headers(), at: Date.now() }) })
  page.cap = cap
  return { context, page }
}

async function setTenant(page, tenant) {
  await page.locator('input[aria-label="Tenant"]').fill(tenant)
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

/** datetime-local string for now + ms, in the page's local time zone. */
async function localPlus(page, ms) {
  return page.evaluate((ms) => {
    const d = new Date(Date.now() + ms)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }, ms)
}

const alerts = (page) => page.locator('[role="alert"]')
// inline field errors only (the error summary is a role=alert with one button per field)
const fieldAlerts = (page) => page.locator('[role="alert"]').filter({ hasNot: page.locator('button') })
// the server-error banner: role=alert, tabindex=-1 (G-2-10), no buttons
const banner = (page) => page.locator('[role="alert"][tabindex="-1"]')
const IND = 'text=/^(Paused|Connecting|Live|Reconnecting)( \\(\\d+\\))?$/'
const indicator = async (page, timeout = 1000) => page.locator(IND).first().textContent({ timeout }).catch(() => '?')
const cards = (page) => page.locator('article')
const cardByTitle = (page, title) => page.locator('article', { has: page.locator('h3', { hasText: title }) })

/** document.activeElement, described. */
const activeInfo = (page) => page.evaluate(() => {
  const e = document.activeElement
  if (!e) return null
  const r = e.getBoundingClientRect()
  const lab = e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`) && document.querySelector(`label[for="${CSS.escape(e.id)}"]`).textContent) || ''
  return { tag: e.tagName.toLowerCase(), id: e.id || null, role: e.getAttribute('role'), tabindex: e.getAttribute('tabindex'), label: lab.trim().slice(0, 40), text: (e.textContent || '').trim().slice(0, 80), inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0, top: Math.round(r.top), bottom: Math.round(r.bottom), innerHeight: window.innerHeight, scrollY: Math.round(window.scrollY) }
})

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true })
  const p = path.join(SHOTS, `${name}.png`)
  await page.screenshot({ path: p, fullPage: true })
  return p
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }

module.exports = { UI, API, CLIENT, setFile, record, flush, api, publishBody, launch, newPage, setTenant, gotoFeed, gotoPublish, form, field, localPlus, alerts, fieldAlerts, banner, IND, indicator, cards, cardByTitle, activeInfo, shot, wait }
