// ux4-contrast-focus-card.js — (1) axe color-contrast "incomplete" nodes checked by hand (shared :3000, read-only);
// (2) focus hidden under the sticky header, Tab and Shift+Tab with a settle, desktop + phone (private A, Vite :3600);
// (3) the README cookbook's first body as a card (private A, tenant vmforge, published by the literal cookbook run)
const { chromium, devices } = require('playwright'); const { AxeBuilder } = require('@axe-core/playwright'); const C = require('./common'); const { rec, save } = C.recorder('ux4-contrast-focus-card');
const api = C.apiClient('http://127.0.0.1:19600'); const T = 'ux4-focus';
const probe = (page) => page.evaluate(() => { const hb = document.querySelector('header').getBoundingClientRect().bottom; const a = document.activeElement; const r = a.getBoundingClientRect(); const q = a.closest('[role=group]') && document.getElementById(a.closest('[role=group]').getAttribute('aria-labelledby')); const qr = q && q.getBoundingClientRect(); return { s: `${a.tagName.toLowerCase()} "${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 20)}" top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} header=${Math.round(hb)}`, hidden: r.bottom <= hb, partly: r.top < hb && r.bottom > hb, questionHidden: qr ? qr.bottom <= hb : null }; });
const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
(async () => {
  const b = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await p.goto('http://127.0.0.1:3000/'); await p.evaluate((t) => { localStorage.setItem('comm-tenant', 'ux4-sre'); localStorage.setItem('atlas-theme', t); }, theme); await p.reload(); await p.waitForTimeout(1200);
    await p.getByRole('tab', { name: 'Publish' }).click(); await p.waitForTimeout(400);
    const r = await new AxeBuilder({ page: p }).withRules(['color-contrast']).analyze(); const nodes = [];
    for (const v of r.incomplete) for (const n of v.nodes) { const sel = n.target.join(' '); const cs = await p.locator(sel).first().evaluate((e) => { const s = getComputedStyle(e); let bg = 'rgba(0, 0, 0, 0)', el = e; while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(el).backgroundColor; el = el.parentElement; } return { fg: s.color, bg, ph: getComputedStyle(e, '::placeholder').color }; }).catch(() => null); nodes.push({ sel, reason: ((n.any[0] || {}).data || {}).messageKey, text: cs && `text ${ratio(cs.fg, cs.bg)}:1 placeholder ${ratio(cs.ph, cs.bg)}:1` }); }
    rec(`contrast-${theme}`, { violations: r.violations.length, incompleteNodes: nodes });
  }
  // (2) focus vs sticky header
  const ids = []; for (let i = 1; i <= 6; i++) { const r = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'MAJOR', title: `Focus test notice ${i}`, body: 'Line one of the body. Line two of the body explains more.', affectedServices: ['svc-' + i] }); ids.push(r.json.id); }
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['iPhone 14'] }]]) {
    const page = await (await b.newContext({ ...opts, colorScheme: 'light' })).newPage();
    await page.goto('http://127.0.0.1:3600/'); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux4-oncall'); }, T); await page.reload(); await page.waitForTimeout(2000);
    await page.locator('header').getByLabel('Tenant').focus(); const fwd = [];
    for (let i = 0; i < 24; i++) { await page.keyboard.press('Tab'); await page.waitForTimeout(450); const s = await probe(page); fwd.push(s); if (/^body/.test(s.s)) break; }
    const rev = []; for (let i = 0; i < 10; i++) { await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(600); rev.push(await probe(page)); }
    // open the confirmation on a card reached by Shift+Tab: is its question visible?
    await page.keyboard.press('Enter'); await page.waitForTimeout(400); const conf = await probe(page);
    rec(`focus-${label}`, { forwardHidden: fwd.filter((s) => s.hidden || s.partly).map((s) => s.s), forwardStops: fwd.length, reverseHidden: rev.filter((s) => s.hidden || s.partly).map((s) => s.s), confirmAfterShiftTab: conf });
    await C.shot(page, `33-${label}-confirm-after-shift-tab`);
  }
  for (const id of ids) await api('POST', `/v1/communications/${id}/retire`, { actor: 'ux4-reviewer', note: 'review cleanup' });
  // (3) README example body as a card
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.goto('http://127.0.0.1:3600/'); await p.evaluate(() => localStorage.setItem('comm-tenant', 'vmforge')); await p.reload(); await p.waitForTimeout(2500);
  const card = p.locator('article', { hasText: 'API degradation in eu-west' }).first();
  rec('readme-body-card', { text: (await card.innerText().catch(() => '')).replace(/\s+/g, ' '), asterisks: /\*\*/.test(await card.innerText().catch(() => '')) });
  await card.screenshot({ path: require('path').join(C.SHOTS, '24-readme-example-body-card.png') }).catch(() => {});
  await b.close(); save();
})().catch((e) => { console.error(e); save(); process.exit(1); });
