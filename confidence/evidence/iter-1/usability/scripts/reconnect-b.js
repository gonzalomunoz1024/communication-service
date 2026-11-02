// dark-mode screenshot of the reconnecting state (redo of step b), killing every java on :19700 and verifying it is really down first
const { chromium } = require('playwright'); const fs = require('fs'); const { execSync, spawn } = require('child_process')
const EV = '/home/claude/communication-service/confidence/evidence/iter-1/usability'
const BASE = 'http://127.0.0.1:3221', API = 'http://127.0.0.1:19700', T = 'ux1-priv'
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter1.jar'
const LOG = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/usability/iter1/backend-19700.txt'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const out = {}
const BADGE = /^(Live|Connecting|Reconnecting( \(\d+\))?|Paused)$/
const badge = (page) => page.locator('main').getByText(BADGE).first().textContent({ timeout: 1500 }).catch(() => null)
const pids = () => { try { return execSync("pgrep -f 'server.port=1970[0]' || true").toString().trim().split('\n').filter(Boolean) } catch { return [] } }
const ready = async () => { try { const r = await fetch(API + '/actuator/health/readiness', { signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false } }
;(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })
  await page.goto(BASE + '/#/feed'); await page.waitForLoadState('networkidle'); await page.getByLabel('Tenant', { exact: true }).fill(T)
  await page.locator('main').getByText('Live', { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => null)
  out.before = { badge: await badge(page), cards: await page.locator('article').count(), pids: pids() }
  for (const p of pids()) execSync(`kill -9 ${p}`)
  const t0 = Date.now(); while (await ready() && Date.now() - t0 < 10000) await sleep(200)
  out.downAfterMs = Date.now() - t0; out.pidsAfterKill = pids()
  const seq = []; let shot = false
  while (Date.now() - t0 < 20000) { const b = await badge(page); if (!seq.length || seq[seq.length - 1].b !== b) seq.push({ t: Math.round((Date.now() - t0) / 100) / 10, b }); if (!shot && /Reconnecting \(2\)/.test(b || '')) { await sleep(200); await page.screenshot({ path: `${EV}/12b-stream-reconnecting-dark.png` }); shot = true } await sleep(400) }
  out.badgeSeq = seq; out.shot = shot; out.cardsDuring = await page.locator('article').count()
  const fd = fs.openSync(LOG, 'a'); const p = spawn('java', ['-jar', JAR, '--server.port=19700', '--spring.data.mongodb.uri=mongodb://127.0.0.1:27017/ux1'], { detached: true, stdio: ['ignore', fd, fd] }); p.unref()
  const t1 = Date.now(); while (!(await ready()) && Date.now() - t1 < 120000) await sleep(500); out.readyAfterMs = Date.now() - t1
  const t2 = Date.now(); let live = null; while (Date.now() - t2 < 75000) { if ((await badge(page)) === 'Live') { live = Math.round((Date.now() - t2) / 100) / 10; break } await sleep(500) }
  out.liveAfterReadySec = live; out.pidsEnd = pids()
  await browser.close(); fs.writeFileSync(`${EV}/reconnect-b-log.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out))
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
