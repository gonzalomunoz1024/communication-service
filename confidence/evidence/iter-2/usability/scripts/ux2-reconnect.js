// ux2-reconnect.js — the service is killed and restarted under an open page (private backend A :19600, Vite :3600)
const { chromium } = require('playwright'); const { execSync, spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const API = 'http://127.0.0.1:19600', UI = 'http://127.0.0.1:3600', T = 'ux2-reconnect';
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter2.jar';
const ARGS = ['-jar', JAR, '--server.port=19600', '--spring.data.mongodb.uri=mongodb://127.0.0.1:27017/ux2', '--communication.health.sweep-interval-ms=1000', '--communication.sweep.interval-ms=2000', '--communication.health.stale-grace-after-start-ms=0'];
const LOGP = path.resolve(__dirname, '..', 'logs', 'backend-19600.txt');
const log = []; const rec = (s, d) => { log.push({ step: s, at: new Date().toISOString(), ...d }); console.log(`[${s}]`, JSON.stringify(d).slice(0, 500)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, p, body) { try { const r = await fetch(API + p, { method, headers: { 'X-Client-Id': 'ux2-reviewer', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch {} return { status: r.status, json }; } catch (e) { return { error: String(e).slice(0, 100) }; } }
function killA() { const killed = []; for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; let c = ''; try { c = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; } const parts = c.split('\0'); if (parts[0] && /(^|\/)java$/.test(parts[0]) && parts.includes('--server.port=19600')) { try { process.kill(+d, 'SIGKILL'); killed.push(+d); } catch {} } } return killed; }
async function ensureUp() { const r = await fetch(API + '/actuator/health/readiness').catch(() => null); if (r && r.status === 200) return 'was up'; const out = fs.openSync(LOGP, 'a'); const c = spawn('java', ARGS, { detached: true, stdio: ['ignore', out, out] }); c.unref(); for (let i = 0; i < 240; i++) { const r2 = await fetch(API + '/actuator/health/readiness').catch(() => null); if (r2 && r2.status === 200) return 'started'; await wait(250); } throw new Error('A did not come up'); }
(async () => {
  rec('ensure-A', { state: await ensureUp() });
  rec('seed', { status: (await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux2-oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'Open before the restart', affectedServices: ['api'] })).status });
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })).newPage();
  await page.goto(UI); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('atlas-theme', 'light'); }, T); await page.reload(); await page.waitForTimeout(2500);
  const badge = () => page.locator('main').getByText(/^(Live|Reconnecting|Connecting|Paused)/).first().innerText().catch(() => null);
  rec('before', { cards: await page.locator('article').count(), badge: await badge() });
  const killed = killA(); const tKill = Date.now(); rec('killed', { pids: killed });
  const timeline = []; let last;
  for (let i = 0; i < 56; i++) { const b = await badge(); if (b !== last) { timeline.push({ t: +((Date.now() - tKill) / 1000).toFixed(1), badge: b }); last = b; } await wait(500); }
  rec('outage-timeline', { timeline, cards: await page.locator('article').count(), errorState: await page.locator('main').getByText("Couldn't load the feed").count() });
  await page.screenshot({ path: path.resolve(__dirname, '..', 'shots', '23-stream-reconnecting.png') });
  const out = fs.openSync(LOGP, 'a'); const child = spawn('java', ARGS, { detached: true, stdio: ['ignore', out, out] }); child.unref(); const tStart = Date.now();
  let tReady; for (let i = 0; i < 240; i++) { const r = await fetch(API + '/actuator/health/readiness').catch(() => null); if (r && r.status === 200) { tReady = Date.now(); break; } await wait(250); }
  rec('restarted', { readyAfterMs: tReady - tStart });
  const pub = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux2-oncall', type: 'OUTAGE', severity: 'MINOR', title: 'Published right after the restart', affectedServices: ['api'] });
  rec('published-after-ready', { status: pub.status, msAfterReady: Date.now() - tReady });
  let liveAt; for (let i = 0; i < 160; i++) { if ((await badge()) === 'Live') { liveAt = Date.now() - tReady; break; } await wait(250); }
  let cardAt; try { await page.locator('article', { hasText: 'Published right after the restart' }).waitFor({ timeout: 40000 }); cardAt = Date.now() - tReady; } catch { cardAt = null; }
  rec('recovery', { liveAfterReadyMs: liveAt, newCardAfterReadyMs: cardAt, badge: await badge(), cards: await page.locator('article').count(), reconnectAttemptsSeen: timeline.map((x) => x.badge).filter((b) => b && b.startsWith('Reconnecting')).length });
  await page.screenshot({ path: path.resolve(__dirname, '..', 'shots', '24-stream-live-again.png') });
  for (const c of (await api('GET', `/v1/communications?tenantId=${T}&status=ACTIVE&size=100`)).json?.items ?? []) await api('POST', `/v1/communications/${c.id}/retire`, { actor: 'ux2-reviewer', note: 'review cleanup' });
  fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'ux2-reconnect-log.json'), JSON.stringify(log, null, 2)); await browser.close(); process.exit(0);
})().catch((e) => { console.error(e); fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'ux2-reconnect-log.json'), JSON.stringify(log, null, 2)); process.exit(1); });
