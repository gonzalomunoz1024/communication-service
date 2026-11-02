// ux4-focus-reverse-phone.js — re-check of the one phone Shift+Tab stop reported under the sticky header, with 700 ms and 1500 ms settles,
// checking what is actually painted at the control's centre (elementFromPoint) and whether the control sits inside the header (private A).
const { chromium, devices } = require('playwright'); const C = require('./common'); const { rec, save } = C.recorder('ux4-focus-reverse-phone');
const api = C.apiClient('http://127.0.0.1:19600'); const T = 'ux4-focus2';
const probe = (page) => page.evaluate(() => { const h = document.querySelector('header'); const hb = h.getBoundingClientRect().bottom; const a = document.activeElement; const r = a.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2); const top = cy >= 0 && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
  return { el: `${a.tagName.toLowerCase()} "${(a.getAttribute('aria-label') || a.labels?.[0]?.textContent || a.textContent || '').trim().slice(0, 24)}"`, top: Math.round(r.top), bottom: Math.round(r.bottom), headerBottom: Math.round(hb), insideHeader: h.contains(a),
    paintedAtCentre: top ? (h.contains(top) ? 'HEADER covers it' : (a === top || a.contains(top) ? 'the control itself' : top.tagName.toLowerCase())) : 'off-screen', scrollY: Math.round(scrollY) }; });
(async () => {
  const ids = []; for (let i = 1; i <= 6; i++) { const r = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'MAJOR', title: `Focus test notice ${i}`, body: 'Line one of the body. Line two of the body explains more.', affectedServices: ['svc-' + i] }); ids.push(r.json.id); }
  const b = await chromium.launch();
  for (const settle of [700, 1500]) {
    const page = await (await b.newContext({ ...devices['iPhone 14'], colorScheme: 'light' })).newPage();
    await page.goto('http://127.0.0.1:3600/'); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); }, T); await page.reload(); await page.waitForTimeout(2500);
    await page.locator('header').getByLabel('Tenant').focus(); for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); await page.waitForTimeout(150); if (await page.evaluate(() => document.activeElement === document.body)) break; }
    const steps = []; for (let i = 0; i < 14; i++) { await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(settle); const s = await probe(page); steps.push(s);
      if (s.paintedAtCentre === 'HEADER covers it' || (!s.insideHeader && s.bottom <= s.headerBottom)) await C.shot(page, `34-phone-shift-tab-${settle}ms-step${i + 1}`); }
    rec(`phone-shift-tab-${settle}ms`, { steps: steps.map((s) => `${s.el} ${s.top}..${s.bottom} hdr=${s.headerBottom} inHeader=${s.insideHeader} centre=${s.paintedAtCentre} y=${s.scrollY}`) });
  }
  for (const id of ids) await api('POST', `/v1/communications/${id}/retire`, { actor: 'ux4-reviewer', note: 'review cleanup' });
  await b.close(); save();
})().catch((e) => { console.error(e); save(); process.exit(1); });
