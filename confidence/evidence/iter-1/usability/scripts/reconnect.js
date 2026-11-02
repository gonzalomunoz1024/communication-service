// UX-6 re-check on a private stack (dev server :3221 -> backend :19700, db ux1): SIGKILL mid-stream, restart, page opened while down.
const { chromium } = require('playwright')
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const EV = '/home/claude/communication-service/confidence/evidence/iter-1/usability'
const BASE = 'http://127.0.0.1:3221', API = 'http://127.0.0.1:19700', T = 'ux1-priv'
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter1.jar'
const LOG = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/usability/iter1/backend-19700.txt'
const out = { steps: [] }
const log = (step, data) => { out.steps.push({ step, ...data }); console.log(step, JSON.stringify(data).slice(0, 900)) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BADGE = /^(Live|Connecting|Reconnecting( \(\d+\))?|Paused)$/
const badge = (page) => page.locator('main').getByText(BADGE).first().textContent({ timeout: 1500 }).catch(() => null)
const findPid = () => { try { return execSync("pgrep -f 'server.port=1970[0]' || true").toString().trim().split('\n').filter(Boolean)[0] || null } catch { return null } }
const killJar = () => { const pid = findPid(); if (pid) execSync(`kill -9 ${pid}`); return pid }
const startJar = () => { const fd = fs.openSync(LOG, 'a'); const p = spawn('java', ['-jar', JAR, '--server.port=19700', '--spring.data.mongodb.uri=mongodb://127.0.0.1:27017/ux1'], { detached: true, stdio: ['ignore', fd, fd] }); p.unref(); return p.pid }
const ready = async () => { try { const r = await fetch(API + '/actuator/health/readiness', { signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false } }
const waitReady = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ready()) return Date.now() - t0; await sleep(500) } return null }
async function api(method, path, body) {
  try { const res = await fetch(API + path, { method, headers: { 'X-Client-Id': 'ux1-reviewer', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await res.text(); return { status: res.status, body: text ? JSON.parse(text) : null } } catch (e) { return { status: 0, error: String(e).slice(0, 100) } }
}
const snapshot = async (page) => ({ badge: await badge(page), cards: await page.locator('article').count(), error: (await page.locator('main').innerText()).includes("Couldn't load the feed") })
const dedupe = (arr, key) => arr.filter((s, i) => i === 0 || key(s) !== key(arr[i - 1]))
const t = (from) => Math.round((Date.now() - from) / 100) / 10
;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' }); const page = await ctx.newPage()
  const seed = await api('POST', '/v1/communications', { tenantId: T, publisher: 'api', type: 'OUTAGE', severity: 'MAJOR', title: 'Private stack outage', affectedServices: ['priv-api'] })
  log('seed', { status: seed.status })
  await page.goto(BASE + '/#/feed'); await page.waitForLoadState('networkidle'); await page.getByLabel('Tenant', { exact: true }).fill(T)
  await page.locator('main').getByText('Live', { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => null)
  await page.locator('article').first().waitFor({ timeout: 10000 }).catch(() => null)
  log('before-kill', await snapshot(page))

  // (a) SIGKILL while the stream is open
  const pid = killJar(); const tKill = Date.now(); const samples = []; let shotTaken = false
  while (Date.now() - tKill < 25000) { const s = { t: t(tKill), ...(await snapshot(page)) }; samples.push(s); if (!shotTaken && /Reconnecting/.test(s.badge || '')) { await page.screenshot({ path: `${EV}/12-stream-reconnecting-light.png` }); shotTaken = true } await sleep(1000) }
  const firstRec = samples.find((s) => /Reconnecting/.test(s.badge || ''))
  log('a-outage', { killedPid: pid, firstReconnectingAtSec: firstRec ? firstRec.t : null, badgeSequence: dedupe(samples, (s) => s.badge).map((s) => `${s.t}s:${s.badge}`), minCards: Math.min(...samples.map((s) => s.cards)), errorBlockShown: samples.some((s) => s.error), mainTail: (await page.locator('main').innerText()).split('\n').filter(Boolean).slice(-8) })
  const newPid = startJar(); const readyMs = await waitReady(120000); const tReady = Date.now()
  const during = await api('POST', '/v1/communications', { tenantId: T, publisher: 'api', type: 'OUTAGE', severity: 'MAJOR', title: 'Published while the UI was reconnecting' })
  const s2 = []; let liveAt = null, newAt = null
  while (Date.now() - tReady < 75000) { const s = { t: t(tReady), ...(await snapshot(page)), hasNew: (await page.locator('article').filter({ hasText: 'while the UI was reconnecting' }).count()) > 0 }; s2.push(s); if (liveAt === null && s.badge === 'Live') liveAt = s.t; if (newAt === null && s.hasNew) newAt = s.t; if (liveAt !== null && newAt !== null) break; await sleep(1000) }
  log('a-recovery', { restartedPid: newPid, readyAfterMs: readyMs, publishedDuringStatus: during.status, liveAfterReadySec: liveAt, newItemAfterReadySec: newAt, badgeSequence: dedupe(s2, (s) => s.badge).map((s) => `${s.t}s:${s.badge}`) })
  const push = await api('POST', '/v1/communications', { tenantId: T, publisher: 'api', type: 'OUTAGE', severity: 'MINOR', title: 'After recovery push' }); const tp = Date.now()
  await page.locator('article').filter({ hasText: 'After recovery push' }).first().waitFor({ timeout: 10000 }).catch(() => null)
  log('a-live-after-recovery', { status: push.status, appearedMs: Date.now() - tp, appeared: (await page.locator('article').filter({ hasText: 'After recovery push' }).count()) > 0, badge: await badge(page) })

  // (b) the same in dark mode (screenshot + second recovery sample)
  await page.getByRole('button', { name: /Switch to dark mode/ }).click(); await sleep(400)
  killJar(); const tKill2 = Date.now(); let shot2 = false
  while (Date.now() - tKill2 < 15000) { const b = await badge(page); if (/Reconnecting/.test(b || '')) { await sleep(300); await page.screenshot({ path: `${EV}/12b-stream-reconnecting-dark.png` }); shot2 = true; break } await sleep(500) }
  log('b-dark-reconnecting', { badge: await badge(page), shot: shot2, afterSec: t(tKill2), mainTail: (await page.locator('main').innerText()).split('\n').filter(Boolean).slice(-6) })
  startJar(); const readyMs2 = await waitReady(120000); const tReady2 = Date.now(); let liveAt2 = null
  while (Date.now() - tReady2 < 75000) { const b = await badge(page); if (b === 'Live') { liveAt2 = t(tReady2); break } await sleep(1000) }
  log('b-recovery', { readyAfterMs: readyMs2, liveAfterReadySec: liveAt2 })
  await page.getByRole('button', { name: /Switch to light mode/ }).click()

  // (c) page opened while the service is down
  killJar(); await sleep(1000)
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p2 = await ctx2.newPage()
  await p2.goto(BASE + '/#/feed'); await p2.getByLabel('Tenant', { exact: true }).fill(T); await sleep(4000)
  log('c-opened-while-down', { ...(await snapshot(p2)), mainTail: (await p2.locator('main').innerText()).split('\n').filter(Boolean).slice(-6), buttons: await p2.locator('main button').allInnerTexts() })
  startJar(); const readyMs3 = await waitReady(120000); const tReady3 = Date.now(); const s3 = []; let recovered = null
  while (Date.now() - tReady3 < 75000) { const s = { t: t(tReady3), ...(await snapshot(p2)) }; s3.push(s); if (s.badge === 'Live' && s.cards > 0) { recovered = s.t; break } await sleep(1000) }
  log('c-recovery', { readyAfterMs: readyMs3, recoveredWithoutClickSec: recovered, sequence: dedupe(s3, (s) => s.badge + s.cards + s.error).map((s) => `${s.t}s:${s.badge}/${s.cards}cards/${s.error ? 'err' : 'ok'}`) })
  if (recovered === null) { await p2.getByRole('button', { name: /Try again/ }).first().click().catch(() => null); await sleep(3000); log('c-after-try-again', await snapshot(p2)) }
  await browser.close(); fs.writeFileSync(`${EV}/reconnect-log.json`, JSON.stringify(out, null, 1)); console.log('jar pid now', findPid())
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(`${EV}/reconnect-log.json`, JSON.stringify(out, null, 1)); process.exit(1) })
