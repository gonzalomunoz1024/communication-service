// ux3-keyboard-only.js — publish and resolve with the keyboard alone (shared stack, tenant ux3-kbd), 1280x800
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const T = 'ux3-kbd'; const out = []; const rec = (k, v) => { out.push({ k, ...v }); console.log(`[${k}]`, JSON.stringify(v).slice(0, 700)); };
const act = (p) => p.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return `${a.tagName.toLowerCase()}${a.getAttribute('role') ? '[' + a.getAttribute('role') + ']' : ''} "${(a.getAttribute('aria-label') || (a.labels && a.labels[0] && a.labels[0].textContent) || a.textContent || '').trim().slice(0, 30)}" ring=${cs.outlineStyle !== 'none' || cs.boxShadow !== 'none'}`; });
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('http://127.0.0.1:3000/'); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(800);
  const k = page.keyboard; const stops = [];
  await k.press('Tab'); stops.push(await act(page)); await k.type(T); await k.press('Enter'); await page.waitForTimeout(600);
  // to the Publish tab: Tab to the tab list, ArrowRight, Enter
  for (let i = 0; i < 6; i++) { await k.press('Tab'); const a = await act(page); stops.push(a); if (/\[tab\]/.test(a)) break; }
  await k.press('ArrowRight'); await page.waitForTimeout(300); stops.push(await act(page));
  // walk the form with Tab, typing where a field takes text
  const want = { 'Title': 'Keyboard-only notice', 'Details': 'Typed without a mouse.', 'Affected services': 'kbd-api', 'Publisher': 'ux3-kbd-oncall' };
  let n = 0; const ring = [];
  for (let i = 0; i < 40; i++) { await k.press('Tab'); n++; const a = await act(page); ring.push(a); const m = Object.keys(want).find((w) => a.includes(`"${w}`)); if (m) { await k.type(want[m]); delete want[m]; } if (/button "Publish outage/.test(a)) break; }
  rec('form-walk', { tabsToSubmit: n, stops: ring, noRing: ring.filter((r) => r.endsWith('ring=false')), unfilled: Object.keys(want) });
  await k.press('Enter'); await page.waitForTimeout(1500); rec('after-submit', { focus: await act(page), heading: await page.locator('main h2').first().innerText().catch(() => null) });
  for (let i = 0; i < 6; i++) { await k.press('Tab'); const a = await act(page); if (/View in feed/.test(a)) break; }
  await k.press('Enter'); await page.waitForTimeout(1500); rec('view-in-feed', { focus: await act(page), cards: await page.locator('article').count() });
  // resolve: Tab to the card's Resolve, Enter, type a note, Tab Tab Enter; the service answers 500 first
  await page.route('**/retire', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected error' }) }));
  for (let i = 0; i < 12; i++) { await k.press('Tab'); const a = await act(page); if (/button "Resolve/.test(a)) break; }
  await k.press('Enter'); await page.waitForTimeout(200); await k.type('Fixed'); await k.press('Tab'); await k.press('Tab'); await k.press('Enter'); await page.waitForTimeout(1000);
  rec('resolve-fails', { focus: await act(page), cardError: await page.locator('article [role=alert], article .text-critical-fg').first().innerText().catch(() => null) });
  await page.screenshot({ path: path.resolve(__dirname, '../shots/32-keyboard-resolve-fails.png') });
  await page.unroute('**/retire'); await k.press('Enter'); await page.waitForTimeout(1500);
  rec('resolve-retry', { focus: await act(page), cards: await page.locator('article').count(), announced: await page.locator('main p[role=status]').innerText().catch(() => null) });
  fs.writeFileSync(path.resolve(__dirname, '../logs/ux3-keyboard-only.json'), JSON.stringify({ stops, out }, null, 2)); await b.close();
  const l = await (await fetch(`http://localhost:8080/v1/communications?tenantId=${T}&status=ACTIVE&size=50`, { headers: { 'X-Client-Id': 'ux3-reviewer' } })).json();
  for (const c of l.items) await fetch(`http://localhost:8080/v1/communications/${c.id}/retire`, { method: 'POST', headers: { 'X-Client-Id': 'ux3-reviewer', 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'ux3-reviewer' }) });
  console.log('first stops:', stops.join(' | '));
})().catch((e) => { console.error(e); process.exit(1); });
