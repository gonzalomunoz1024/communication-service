const { chromium } = require('playwright'); const path = require('path');
const BASE = 'http://127.0.0.1:3000'; const API = 'http://localhost:8080'; const T = 'ux3-focus';
async function api(m, p, b) { const r = await fetch(API + p, { method: m, headers: { 'X-Client-Id': 'ux3-reviewer', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); let j; try { j = await r.json(); } catch {} return { status: r.status, json: j }; }
const probe = (page) => page.evaluate(() => { const hb = document.querySelector('header').getBoundingClientRect().bottom; const a = document.activeElement; const r = a.getBoundingClientRect(); return `${a.tagName.toLowerCase()} "${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 20)}" top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} header=${Math.round(hb)} ${r.bottom <= hb ? 'HIDDEN' : r.top < hb ? 'PARTLY' : 'visible'} scrollY=${Math.round(scrollY)}`; });
(async () => {
  const ids = []; for (let i = 1; i <= 6; i++) { const r = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux3-oncall', type: 'OUTAGE', severity: 'MAJOR', title: `Reverse test ${i}`, body: 'Body text.', affectedServices: ['svc-' + i] }); ids.push(r.json.id); }
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(BASE); await page.evaluate((t) => localStorage.setItem('comm-tenant', t), T); await page.reload(); await page.waitForTimeout(2000);
  // a keyboard user: Tab forward to the last button of the page, then Shift+Tab back up, waiting for each scroll to settle
  await page.locator('header').getByLabel('Tenant').focus(); const fwd = [];
  for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); await page.waitForTimeout(500); const s = await probe(page); fwd.push(s); if (/body|Tenant/.test(s) && i > 5) break; }
  console.log('forward:\n ' + fwd.join('\n '));
  await page.getByRole('button', { name: 'Resolve' }).last().focus(); await page.waitForTimeout(500); const rev = [];
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(700); rev.push(await probe(page)); }
  console.log('reverse:\n ' + rev.join('\n '));
  await page.screenshot({ path: path.resolve(__dirname, '../shots/18-desktop-reverse-tab-settled.png') });
  await browser.close(); for (const id of ids) await api('POST', `/v1/communications/${id}/retire`, { actor: 'ux3-reviewer', note: 'review cleanup' });
})();
