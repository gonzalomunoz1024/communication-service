// ux4-dbdown.js — the database goes away under a running service (private backend B :19601 on my own Mongo ux4-mongo :19617, Vite :3601)
// phase 1: docker stop (refused connections); phase 2: docker pause (a hung database)
const { chromium } = require('playwright'); const { execSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const C = require('./common'); const { rec, save } = C.recorder('ux4-dbdown-log');
const API = 'http://127.0.0.1:19601', UI = 'http://127.0.0.1:3601', T = 'ux4-db', ST = 'http://127.0.0.1:19619/status';
const api = C.apiClient(API); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sc = async () => { try { const d = await (await fetch(ST)).json(); return { sendError: d.sendError || null, reportsSent: d.reportsSent, lastSendAt: d.lastSendAt, last: d.lastReport && d.lastReport.status }; } catch (e) { return { error: String(e).slice(0, 80) }; } };
const curlStream = () => { const t0 = Date.now(); let out = ''; try { out = execSync(`curl -s -N --max-time 40 -w ' HTTP=%{http_code} type=%{content_type}' -H 'X-Client-Id: ux4-reviewer' '${API}/v1/feed/stream?tenantId=${T}' | head -c 400`, { encoding: 'utf8' }); } catch (e) { out = String(e.stdout || e).slice(0, 300); } return { out: out.slice(0, 400), ms: Date.now() - t0 }; };
const state = (p) => p.evaluate(() => { const m = document.querySelector('main'); return { badge: (document.querySelector('main span[role=status][aria-live=polite]') || {}).textContent, error: /Couldn't load the feed/.test(m.textContent), skeleton: document.querySelectorAll('main [aria-busy=true]').length, cards: document.querySelectorAll('article').length }; }).catch(() => ({}));
const fmtS = (s) => `${s.badge}${s.error ? ' ERROR' : ''}${s.skeleton ? ' skeleton' : ''} cards=${s.cards}`;
async function watch(pages, seconds, label) { const out = {}; for (const k of Object.keys(pages)) out[k] = []; const last = {}; const t0 = Date.now(); for (let i = 0; i < seconds * 2; i++) { for (const [k, p] of Object.entries(pages)) { const s = fmtS(await state(p)); if (s !== last[k]) { out[k].push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`); last[k] = s; } } await sleep(500); } rec(label, out); return out; }
(async () => {
  rec('seed', await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'Seeded before the database outage', affectedServices: ['db-api'] }).then((r) => ({ status: r.status })));
  execSync('docker rm -f ux4-sc-b ux4-app-b >/dev/null 2>&1 || true');
  execSync('docker run -d --name ux4-sc-b -p 127.0.0.1:19619:9465 --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges -e CS_ENDPOINT=http://172.17.0.1:19601 -e CS_TENANT=ux4-db -e CS_SERVICE=db-api -e CS_CLIENT_ID=ux4-db-repo -e CS_INTERVAL=3s -e CS_HEARTBEAT=10s -e CS_STARTUP_GRACE=20s health-sidecar:ci');
  execSync('docker run -d --name ux4-app-b --network container:ux4-sc-b fakeapp:ci');
  await sleep(8); rec('sidecar-before', await sc());
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' }); await ctx.addInitScript(C.LIVE);
  await ctx.addInitScript((t) => { try { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux4-oncall'); localStorage.setItem('atlas-theme', 'light'); } catch {} }, T);
  const page1 = await ctx.newPage(); await page1.goto(UI + '#/feed'); await page1.waitForTimeout(2500);
  await C.L.typeFilter(page1).selectOption(''); await page1.waitForTimeout(2000);
  rec('page1-before', await state(page1)); await C.ann(page1);
  // ---------- phase 1: stopped database ----------
  execSync('docker stop ux4-mongo'); const tDown = Date.now(); rec('mongo-stopped', {});
  rec('api-feed-while-down', await api('GET', `/v1/feed?tenantId=${T}`).then((r) => ({ status: r.status, text: r.text && r.text.slice(0, 200), ms: r.ms })));
  rec('api-readiness', await (async () => { const t0 = Date.now(); const r = await fetch(API + '/actuator/health/readiness'); return { status: r.status, text: (await r.text()).slice(0, 100), ms: Date.now() - t0 }; })());
  rec('api-liveness', await (async () => { const r = await fetch(API + '/actuator/health/liveness'); return { status: r.status, text: (await r.text()).slice(0, 100) }; })());
  rec('api-publish-while-down', await api('POST', '/v1/communications', { tenantId: T, publisher: 'p', type: 'OUTAGE', severity: 'MAJOR', title: 'during outage' }).then((r) => ({ status: r.status, text: r.text && r.text.slice(0, 200), ms: r.ms })));
  rec('api-stream-while-down', curlStream());
  // page1 left alone for 8 s: does it notice anything?
  await watch({ page1 }, 8, 'page1-untouched-while-down');
  // the SRE presses Refresh on page1
  await page1.getByRole('button', { name: 'Refresh' }).click(); await page1.waitForTimeout(6500);
  rec('page1-after-refresh-while-down', { ...(await state(page1)), alert: await C.L.feedAlert(page1).innerText().catch(() => null), announced: (await C.ann(page1)).map((a) => `${a.t}ms ${a.role}:${a.text.slice(0, 120)}`) });
  await C.shot(page1, '26-feed-mongo-down-refreshed');
  // a colleague opens the page during the outage (page2), and someone tries to publish (page3)
  const page2 = await ctx.newPage(); const reqs = []; page2.on('request', (r) => { if (r.url().includes('/v1/feed')) reqs.push({ t: Date.now() - tDown, u: r.url().includes('/stream') ? 'stream' : 'GET' }); });
  const answers = []; page2.on('response', (r) => { if (r.url().includes('/v1/feed')) answers.push({ t: Date.now() - tDown, u: r.url().includes('/stream') ? 'stream' : 'GET', status: r.status() }); });
  const t2 = Date.now(); await page2.goto(UI + '#/feed');
  const samples = []; for (let i = 0; i < 45; i++) { samples.push(`${i}s ${fmtS(await state(page2))}`); await sleep(1000); }
  rec('page2-fresh-during-outage', { samples, feedGets: reqs.filter((r) => r.u === 'GET').length, streams: reqs.filter((r) => r.u === 'stream').length, answers: answers.map((a) => `${(a.t / 1000).toFixed(1)}s ${a.u} ${a.status}`), announced: (await C.ann(page2)).map((a) => `${a.t}ms ${a.role}:${a.text.slice(0, 100)}`) });
  await C.shot(page2, '27-fresh-page-mongo-down-45s');
  const page3 = await ctx.newPage(); await page3.goto(UI + '#/publish'); await page3.waitForTimeout(1200);
  await C.L.title(page3).fill('Publish while the database is down'); await page3.locator('form button[type=submit]').click(); await page3.waitForTimeout(7000);
  rec('page3-publish-while-down', { banner: await C.L.banner(page3).innerText().catch(() => null), title: await C.L.title(page3).inputValue() });
  await C.shot(page3, '28-publish-mongo-down');
  for (let i = 0; i < 12; i++) { const s = await sc(); if (s.sendError) { rec('sidecar-while-down', { ...s, afterDownMs: Date.now() - tDown }); break; } await sleep(2000); if (i === 11) rec('sidecar-while-down', { ...s, note: 'no sendError within 24 s' }); }
  execSync('docker start ux4-mongo'); const tStart = Date.now(); rec('mongo-started', { downForMs: tStart - tDown });
  let ready; for (let i = 0; i < 120; i++) { const r = await fetch(API + '/actuator/health/readiness').catch(() => null); if (r && r.status === 200) { ready = Date.now() - tStart; break; } await sleep(500); }
  rec('api-ready-again', { afterMs: ready }); rec('api-feed-after', await api('GET', `/v1/feed?tenantId=${T}`).then((r) => ({ status: r.status, ms: r.ms })));
  // recovery: nobody touches page1 or page2 for 60 s
  await watch({ page1, page2 }, 60, 'recovery-untouched-60s');
  rec('page1-after-60s', { ...(await state(page1)), announced: (await C.ann(page1)).map((a) => `${a.t}ms ${a.role}:${a.text.slice(0, 80)}`) });
  rec('page2-after-60s', { ...(await state(page2)), announced: (await C.ann(page2)).map((a) => `${a.t}ms ${a.role}:${a.text.slice(0, 80)}`) });
  await C.shot(page1, '29-page1-60s-after-recovery'); await C.shot(page2, '29b-page2-60s-after-recovery');
  await page3.locator('form button[type=submit]').click(); await page3.waitForTimeout(3000);
  rec('page3-publish-after', { heading: await page3.locator('main h2').first().innerText().catch(() => null), banner: await C.L.banner(page3).innerText().catch(() => null) });
  rec('sidecar-after', await sc());
  // ---------- phase 2: hung database (docker pause) ----------
  await page1.getByRole('button', { name: 'Refresh' }).click().catch(() => {}); await page1.waitForTimeout(1500); await C.ann(page1);
  execSync('docker pause ux4-mongo'); const tPause = Date.now(); rec('mongo-paused', {});
  const [feedP, pubP, streamP] = await Promise.all([api('GET', `/v1/feed?tenantId=${T}`), api('POST', '/v1/communications', { tenantId: T, publisher: 'p', type: 'OUTAGE', severity: 'MAJOR', title: 'during pause' }), Promise.resolve().then(curlStream)]);
  rec('api-while-paused', { feed: { status: feedP.status, ms: feedP.ms, text: feedP.text && feedP.text.slice(0, 80) }, publish: { status: pubP.status, ms: pubP.ms, text: pubP.text && pubP.text.slice(0, 80) }, stream: streamP });
  const page4 = await ctx.newPage(); const t4 = Date.now(); await page4.goto(UI + '#/feed'); const s4 = [];
  for (let i = 0; i < 30; i++) { s4.push(`${i}s ${fmtS(await state(page4))}`); await sleep(1000); }
  rec('page4-fresh-while-paused', { samples: s4 });
  await C.shot(page4, '27b-fresh-page-mongo-paused-30s');
  rec('sidecar-while-paused', await sc());
  execSync('docker unpause ux4-mongo'); const tUnpause = Date.now(); rec('mongo-unpaused', { pausedForMs: tUnpause - tPause });
  let ready2; for (let i = 0; i < 120; i++) { const r = await fetch(API + '/actuator/health/readiness').catch(() => null); if (r && r.status === 200) { ready2 = Date.now() - tUnpause; break; } await sleep(500); }
  rec('api-ready-after-unpause', { afterMs: ready2 });
  await watch({ page1, page4 }, 40, 'recovery-after-pause-40s');
  rec('sidecar-after-pause', await sc());
  await browser.close();
  fs.writeFileSync(path.join(C.LOGS, 'sidecar-b-container.txt'), execSync('docker logs ux4-sc-b 2>&1', { encoding: 'utf8' }));
  execSync('docker rm -f ux4-sc-b ux4-app-b >/dev/null 2>&1 || true');
  save();
})().catch((e) => { console.error(e); try { execSync('docker unpause ux4-mongo'); } catch {} try { execSync('docker start ux4-mongo'); } catch {} save(); process.exit(1); });
