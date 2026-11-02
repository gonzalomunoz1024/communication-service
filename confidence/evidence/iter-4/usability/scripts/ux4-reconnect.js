// ux4-reconnect.js — the service is killed (SIGKILL) and restarted under open pages (private backend B :19601; Vite dev :3601 and production bundle :3602)
const { chromium } = require('playwright'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const C = require('./common'); const { rec, save } = C.recorder('ux4-reconnect-log');
const API = 'http://127.0.0.1:19601', T = 'ux4-reconnect', TE = 'ux4-reconnect-empty';
const JAR = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/communication-service-iter4.jar';
const ARGS = ['-jar', JAR, '--server.port=19601', '--spring.mongodb.uri=mongodb://127.0.0.1:19617/ux4b'];
const LOGP = path.join(C.LOGS, 'backend-B-19601.txt'); const api = C.apiClient(API); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killB() { const killed = []; for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; let c = ''; try { c = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; } const parts = c.split('\0'); if (parts[0] && /(^|\/)java$/.test(parts[0]) && parts.includes('--server.port=19601')) { try { process.kill(+d, 'SIGKILL'); killed.push(+d); } catch {} } } return killed; }
(async () => {
  rec('seed', { status: (await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'Open before the restart', affectedServices: ['api'] })).status });
  const browser = await chromium.launch(); const pages = {};
  for (const [k, url, tenant] of [['dev', 'http://127.0.0.1:3601/#/feed', T], ['prod', 'http://127.0.0.1:3602/#/feed', T], ['prodEmpty', 'http://127.0.0.1:3602/#/feed', TE]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(C.LIVE); await ctx.addInitScript((t) => { try { localStorage.setItem('comm-tenant', t); } catch {} }, tenant);
    const p = await ctx.newPage(); const t0 = Date.now(); await p.goto(url); const tl = []; let last;
    for (let i = 0; i < 18; i++) { const b = await C.badgeText(p); if (b !== last) { tl.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${b}`); last = b; } await wait(500); }
    rec(`open-${k}`, { badgeTimeline: tl, cards: await C.L.cards(p).count() }); pages[k] = p;
  }
  for (const p of Object.values(pages)) await C.ann(p);
  const killed = killB(); const tKill = Date.now(); rec('killed', { pids: killed });
  const tls = {}; const lasts = {}; for (const k of Object.keys(pages)) tls[k] = [];
  for (let i = 0; i < 60; i++) { for (const [k, p] of Object.entries(pages)) { const b = await C.badgeText(p); if (b !== lasts[k]) { tls[k].push(`${((Date.now() - tKill) / 1000).toFixed(1)}s ${b}`); lasts[k] = b; } } await wait(500); }
  rec('down-timeline-30s', { timelines: tls, cards: { dev: await C.L.cards(pages.dev).count(), prod: await C.L.cards(pages.prod).count() }, errorShown: await pages.dev.locator('main').getByText("Couldn't load the feed").count() });
  await C.shot(pages.dev, '30-stream-reconnecting');
  const out = fs.openSync(LOGP, 'a'); const child = spawn('java', ARGS, { detached: true, stdio: ['ignore', out, out] }); child.unref(); const tStart = Date.now();
  let tReady; for (let i = 0; i < 240; i++) { const r = await fetch(API + '/actuator/health/readiness').catch(() => null); if (r && r.status === 200) { tReady = Date.now(); break; } await wait(250); }
  rec('restarted', { pid: child.pid, readyAfterMs: tReady - tStart });
  const pub = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'MINOR', title: 'Published right after the restart', affectedServices: ['api'] });
  rec('published-after-ready', { status: pub.status, msAfterReady: Date.now() - tReady });
  const res = {};
  await Promise.all(Object.entries(pages).map(async ([k, p]) => { let liveAt = null; for (let i = 0; i < 200; i++) { if ((await C.badgeText(p)) === 'Live') { liveAt = Date.now() - tReady; break; } await wait(250); } let cardAt = null; if (k !== 'prodEmpty') { try { await p.locator('article', { hasText: 'Published right after the restart' }).waitFor({ timeout: 45000 }); cardAt = Date.now() - tReady; } catch {} } res[k] = { liveAfterReadyMs: liveAt, newCardAfterReadyMs: cardAt }; }));
  rec('recovery', { res, timelines: Object.fromEntries(await Promise.all(Object.entries(pages).map(async ([k, p]) => [k, (await C.ann(p)).filter((a) => a.text).map((a) => `${a.t}ms ${a.text.slice(0, 40)}`).slice(-12)]))) });
  await C.shot(pages.dev, '31-stream-live-again');
  for (const c of (await api('GET', `/v1/communications?tenantId=${T}&status=ACTIVE&size=100`)).json?.items ?? []) await api('POST', `/v1/communications/${c.id}/retire`, { actor: 'ux4-reviewer', note: 'review cleanup' });
  save(); await browser.close(); process.exit(0);
})().catch((e) => { console.error(e); save(); process.exit(1); });
