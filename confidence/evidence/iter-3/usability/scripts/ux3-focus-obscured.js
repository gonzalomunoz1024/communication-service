// ux3-focus-obscured.js — is the focused control (and the confirmation's question) hidden under the sticky header?
const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path');
const BASE = process.env.UI_BASE || 'http://127.0.0.1:3000'; const API = process.env.API_BASE || 'http://localhost:8080';
const T = 'ux3-focus'; const SHOTS = path.resolve(__dirname, '../shots'); const out = [];
const rec = (k, v) => { out.push({ k, ...v }); console.log(`[${k}]`, JSON.stringify(v).slice(0, 700)); };
async function api(m, p, b) { const r = await fetch(API + p, { method: m, headers: { 'X-Client-Id': 'ux3-reviewer', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); let j; try { j = await r.json(); } catch {} return { status: r.status, json: j }; }
const probe = (page) => page.evaluate(() => {
  const h = document.querySelector('header'); const hb = h.getBoundingClientRect().bottom; const hs = getComputedStyle(h).position;
  const a = document.activeElement; const r = a.getBoundingClientRect();
  const q = a.closest('[role=group]') && document.getElementById(a.closest('[role=group]').getAttribute('aria-labelledby'));
  const qr = q && q.getBoundingClientRect(); const art = a.closest('article'); const title = art && art.querySelector('h3'); const tr = title && title.getBoundingClientRect();
  return { headerBottom: Math.round(hb), headerPos: hs, scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop, scrollY: Math.round(scrollY), focus: `${a.tagName.toLowerCase()} "${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30)}"`, top: Math.round(r.top), bottom: Math.round(r.bottom), hiddenUnderHeader: r.bottom <= hb, partlyUnderHeader: r.top < hb && r.bottom > hb, question: qr ? { top: Math.round(qr.top), bottom: Math.round(qr.bottom), hidden: qr.bottom <= hb } : null, cardTitle: tr ? { text: title.textContent.slice(0, 30), top: Math.round(tr.top), bottom: Math.round(tr.bottom), hidden: tr.bottom <= hb } : null };
});
(async () => {
  const ids = [];
  for (let i = 1; i <= 6; i++) { const r = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux3-oncall', type: 'OUTAGE', severity: 'MAJOR', title: `Focus test notice ${i}`, body: 'Line one of the body. Line two of the body explains more.', affectedServices: ['svc-' + i] }); ids.push(r.json.id); }
  const browser = await chromium.launch();
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['iPhone 14'] }]]) {
    const ctx = await browser.newContext({ ...opts, colorScheme: 'light' }); const page = await ctx.newPage();
    await page.goto(BASE); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux3-oncall'); }, T); await page.reload(); await page.waitForTimeout(2000);
    // reverse traversal: from the end of the page back up through the cards with Shift+Tab
    await page.keyboard.press('End'); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.getByRole('button', { name: 'Resolve' }).last().focus();
    const rev = []; for (let i = 0; i < 6; i++) { rev.push(await probe(page)); await page.keyboard.press('Shift+Tab'); }
    rec(`${label}-reverse`, { stops: rev.map((s) => `${s.focus} top=${s.top} bottom=${s.bottom} header=${s.headerBottom} hidden=${s.hiddenUnderHeader} partly=${s.partlyUnderHeader}`), headerPos: rev[0].headerPos, scrollPaddingTop: rev[0].scrollPadTop });
    await page.screenshot({ path: path.join(SHOTS, `18-${label}-reverse-tab.png`) });
    // forward traversal from the top: Tab into the first card's Resolve, open the confirmation with Enter
    await page.evaluate(() => window.scrollTo(0, 0)); await page.locator('header').getByLabel('Tenant').focus();
    let s; for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); s = await probe(page); if (/Resolve/.test(s.focus)) break; }
    rec(`${label}-first-resolve`, s);
    await page.keyboard.press('Enter'); await page.waitForTimeout(250); rec(`${label}-confirm-open-first`, await probe(page));
    await page.screenshot({ path: path.join(SHOTS, `19-${label}-confirm-first-card.png`) });
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    // the third card, reached by Shift+Tab from below (the usual way back up a list)
    await page.getByRole('button', { name: 'Resolve' }).nth(4).focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
    rec(`${label}-third-by-shift-tab`, await probe(page));
    await page.keyboard.press('Enter'); await page.waitForTimeout(250); rec(`${label}-confirm-open-shift-tab`, await probe(page));
    await page.screenshot({ path: path.join(SHOTS, `20-${label}-confirm-after-shift-tab.png`) });
    await ctx.close();
  }
  await browser.close();
  for (const id of ids) await api('POST', `/v1/communications/${id}/retire`, { actor: 'ux3-reviewer', note: 'review cleanup' });
  fs.writeFileSync(path.resolve(__dirname, '../logs/ux3-focus-obscured.json'), JSON.stringify(out, null, 2));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
