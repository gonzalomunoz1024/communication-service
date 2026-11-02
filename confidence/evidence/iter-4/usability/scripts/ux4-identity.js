// ux4-identity.js — F-64: what the UI sends to identify itself (headers of the list GET, the stream URL), dev :3600 and production :3602
const { chromium } = require('playwright'); const C = require('./common'); const { rec, save } = C.recorder('ux4-identity');
(async () => {
  const b = await chromium.launch();
  for (const url of ['http://127.0.0.1:3600/', 'http://127.0.0.1:3602/']) {
    const page = await (await b.newContext()).newPage(); const seen = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/')) seen.push(`${r.method()} ${u.pathname}${u.search.replace(/tenantId=[^&]*/, 'tenantId=…')} X-Client-Id=${r.headers()['x-client-id'] ?? '(none)'}`); });
    await page.goto(url); await page.evaluate(() => localStorage.setItem('comm-tenant', 'ux4-identity')); await page.reload(); await page.waitForTimeout(1500);
    rec(url, { requests: [...new Set(seen)] });
  }
  await b.close(); save();
})().catch((e) => { console.error(e); save(); process.exit(1); });
