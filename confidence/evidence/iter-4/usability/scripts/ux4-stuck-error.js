// ux4-stuck-error.js — after a database outage: does a page whose Refresh failed come back by itself, and does it show a notice published after recovery?
// Also: when does a page opened during the outage first show the error, dev server (:3601, StrictMode) vs production bundle (:3602, vite preview)?
const { chromium } = require('playwright'); const { execSync } = require('child_process'); const C = require('./common'); const { rec, save } = C.recorder('ux4-stuck-error');
const API = 'http://127.0.0.1:19601', T = 'ux4-db2'; const api = C.apiClient(API); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (p) => p.evaluate(() => { const m = document.querySelector('main'); return { badge: (document.querySelector('main span[role=status][aria-live=polite]') || {}).textContent, error: /Couldn't load the feed/.test(m.textContent), skeleton: document.querySelectorAll('main [aria-busy=true]').length, titles: [...document.querySelectorAll('article h3, article [class*=font-semibold]')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 4), cards: document.querySelectorAll('article').length }; }).catch(() => ({}));
(async () => {
  await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'Open before the outage', affectedServices: ['db-api'] });
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(C.LIVE);
  await ctx.addInitScript((t) => { try { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux4-oncall'); } catch {} }, T);
  const page1 = await ctx.newPage(); await page1.goto('http://127.0.0.1:3601/#/feed'); await page1.waitForTimeout(2500); rec('page1-before', await state(page1));
  const prodCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await prodCtx.addInitScript((t) => { try { localStorage.setItem('comm-tenant', t); } catch {} }, T);
  execSync('docker stop ux4-mongo'); const tDown = Date.now(); rec('mongo-stopped', {});
  const opened = {}; const timeline = { dev: [], prod: [] }; const reqs = { dev: [], prod: [] };
  const pDev = await ctx.newPage(); const pProd = await prodCtx.newPage();
  for (const [k, p] of [['dev', pDev], ['prod', pProd]]) { p.on('request', (r) => { if (r.url().includes('/v1/feed')) reqs[k].push(`${((Date.now() - opened[k]) / 1000).toFixed(1)}s -> ${r.url().includes('/stream') ? 'stream' : 'GET'}`); }); p.on('response', (r) => { if (r.url().includes('/v1/feed')) reqs[k].push(`${((Date.now() - opened[k]) / 1000).toFixed(1)}s <- ${r.url().includes('/stream') ? 'stream' : 'GET'} ${r.status()}`); }); }
  opened.dev = Date.now(); await pDev.goto('http://127.0.0.1:3601/#/feed'); opened.prod = Date.now(); await pProd.goto('http://127.0.0.1:3602/#/feed');
  const last = {}; for (let i = 0; i < 30; i++) { for (const [k, p] of [['dev', pDev], ['prod', pProd]]) { const s = await state(p); const f = `${s.badge}${s.error ? ' ERROR' : ''}${s.skeleton ? ' skeleton' : ''}`; if (f !== last[k]) { timeline[k].push(`${((Date.now() - opened[k]) / 1000).toFixed(1)}s ${f}`); last[k] = f; } } await sleep(500); }
  rec('fresh-page-timelines', { timeline, requests: reqs });
  await page1.getByRole('button', { name: 'Refresh' }).click(); await page1.waitForTimeout(6500);
  rec('page1-refresh-during-outage', await state(page1));
  execSync('docker start ux4-mongo'); const tUp = Date.now();
  let ready; for (let i = 0; i < 120; i++) { const r = await fetch(API + '/actuator/health/readiness').catch(() => null); if (r && r.status === 200) { ready = Date.now() - tUp; break; } await sleep(500); }
  rec('ready-again', { afterMs: ready });
  const pub = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'CRITICAL', title: 'Published after recovery', affectedServices: ['db-api'] });
  rec('published-after-recovery', { status: pub.status });
  await sleep(20000);
  rec('page1-20s-after-the-new-notice', { ...(await state(page1)), announced: (await C.ann(page1)).map((a) => `${a.role}:${a.text.slice(0, 70)}`).slice(-6) });
  rec('fresh-pages-20s-after', { dev: await state(pDev), prod: await state(pProd) });
  await C.shot(page1, '29c-page1-after-recovery-new-notice-hidden');
  await page1.getByRole('button', { name: 'Try again' }).click(); await page1.waitForTimeout(1500);
  rec('page1-after-try-again', await state(page1));
  await browser.close();
  for (const s of ['ACTIVE']) { const l = await api('GET', `/v1/communications?tenantId=${T}&status=${s}&size=50`); for (const c of l.json.items) await api('POST', `/v1/communications/${c.id}/retire`, { actor: 'ux4-reviewer', note: 'cleanup' }); }
  save();
})().catch((e) => { console.error(e); try { execSync('docker start ux4-mongo'); } catch {} save(); process.exit(1); });
