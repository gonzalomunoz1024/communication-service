// ux3-fresh-during-outage.js — an SRE opens the feed while the database is down (backend :19601, Vite :3601, own Mongo ux3-mongo)
const { chromium } = require('playwright'); const { execSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('comm-tenant', 'ux3-db'); } catch {} });
  execSync('docker stop ux3-mongo'); const t0 = Date.now(); console.log('mongo stopped');
  const page = await ctx.newPage(); const reqs = []; page.on('request', (r) => { if (r.url().includes('/v1/feed')) reqs.push({ t: Date.now() - t0, u: r.url().includes('/stream') ? 'stream' : 'GET' }); });
  const done = []; page.on('requestfinished', async (r) => { if (r.url().includes('/v1/feed?')) { const resp = await r.response(); done.push({ t: Date.now() - t0, status: resp && resp.status() }); } });
  await page.goto('http://127.0.0.1:3601/#/feed');
  const samples = [];
  for (let i = 0; i < 45; i++) {
    const s = await page.evaluate(() => ({ badge: (document.querySelector('main span[role=status][aria-live=polite]') || {}).textContent, error: /Couldn't load the feed/.test(document.querySelector('main').textContent), skeleton: document.querySelectorAll('main .animate-pulse, main [aria-busy=true]').length, cards: document.querySelectorAll('article').length }));
    samples.push(`${i}s ${s.badge}${s.error ? ' ERROR-SHOWN' : ''}${s.skeleton ? ' skeleton' : ''}`); await sleep(1000);
  }
  await page.screenshot({ path: path.resolve(__dirname, '..', 'shots', '29-fresh-page-mongo-down-45s.png') });
  execSync('docker start ux3-mongo'); console.log('mongo started');
  const out = { samples, feedGets: reqs.filter((r) => r.u === 'GET').length, streams: reqs.filter((r) => r.u === 'stream').length, getAnswers: done };
  console.log(JSON.stringify(out, null, 1)); fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'ux3-fresh-during-outage.json'), JSON.stringify(out, null, 2));
  await sleep(4000); await browser.close();
})().catch((e) => { try { execSync('docker start ux3-mongo'); } catch {} console.error(e); process.exit(1); });
