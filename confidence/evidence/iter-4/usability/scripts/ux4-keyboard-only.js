// ux4-keyboard-only.js — publish, View in feed, Resolve and Refresh with the keyboard alone (shared stack, tenant ux4-kbd), 1280x800
const { chromium } = require('playwright'); const C = require('./common'); const { rec, save } = C.recorder('ux4-keyboard-only');
const T = 'ux4-kbd'; const api = C.apiClient('http://localhost:8080');
const act = (p) => p.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return 'body'; const cs = getComputedStyle(a); return `${a.tagName.toLowerCase()}${a.getAttribute('role') ? '[' + a.getAttribute('role') + ']' : ''} "${(a.getAttribute('aria-label') || (a.labels && a.labels[0] && a.labels[0].textContent) || a.textContent || '').trim().slice(0, 40)}" ring=${cs.outlineStyle !== 'none' || cs.boxShadow !== 'none'}`; });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(C.LIVE); const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/'); await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(800);
  const k = page.keyboard; const stops = [];
  await k.press('Tab'); stops.push(await act(page)); await k.type(T); await k.press('Enter'); await page.waitForTimeout(600);
  for (let i = 0; i < 6; i++) { await k.press('Tab'); const a = await act(page); stops.push(a); if (/\[tab\]/.test(a)) break; }
  await k.press('ArrowRight'); await page.waitForTimeout(300); stops.push(await act(page));
  const want = { 'Title': 'Keyboard-only notice', 'Details': 'Typed without a mouse.', 'Affected services': 'kbd-api', 'Publisher': 'ux4-kbd-oncall' };
  let n = 0; const ring = [];
  for (let i = 0; i < 40; i++) { await k.press('Tab'); n++; const a = await act(page); ring.push(a); const m = Object.keys(want).find((w) => a.includes(`"${w}`)); if (m) { await k.type(want[m]); delete want[m]; } if (/button "Publish outage/.test(a)) break; }
  rec('form-walk', { tabsToSubmit: n, stops: ring, noRing: ring.filter((r) => r.endsWith('ring=false')), unfilled: Object.keys(want) });
  await k.press('Enter'); await page.waitForTimeout(1500); rec('after-submit', { focus: await act(page), heading: await page.locator('main h2').first().innerText().catch(() => null) });
  for (let i = 0; i < 6; i++) { await k.press('Tab'); const a = await act(page); if (/View in feed/.test(a)) break; }
  await C.ann(page); await k.press('Enter'); await page.waitForTimeout(1500);
  rec('view-in-feed', { focus: await act(page), focusAx: await C.axFocus(page), cards: await page.locator('article').count(), announced: (await C.ann(page)).map((a) => `${a.role}:${a.text}`) });
  await C.shot(page, '18-keyboard-view-in-feed-focus');
  await page.route('**/retire', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected error' }) }));
  for (let i = 0; i < 12; i++) { await k.press('Tab'); const a = await act(page); if (/button "Resolve/.test(a)) break; }
  await k.press('Enter'); await page.waitForTimeout(200); await k.type('Fixed'); await k.press('Escape'); await page.waitForTimeout(200);
  rec('escape-in-note', { focus: await act(page), open: await page.getByRole('group').count() });
  await k.press('Enter'); await page.waitForTimeout(200); await k.press('Tab'); await k.press('Tab'); await k.press('Enter'); await page.waitForTimeout(1000);
  rec('resolve-fails', { focus: await act(page), cardError: await page.locator('article [role=alert]').first().innerText().catch(() => null) });
  await C.shot(page, '19-keyboard-resolve-fails');
  await page.unroute('**/retire'); await k.press('Enter'); await page.waitForTimeout(1500);
  rec('resolve-retry', { focus: await act(page), cards: await page.locator('article').count(), announced: await page.locator('main p[role=status]').innerText().catch(() => null) });
  // Refresh with the keyboard, on a feed that has a card
  await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-kbd-oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'Card for the refresh check', affectedServices: ['kbd-api'] });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Refresh' }).focus(); const before = await act(page); await C.ann(page);
  await k.press('Enter'); const at = []; for (let i = 0; i < 6; i++) { await page.waitForTimeout(150); at.push(await act(page)); }
  await page.waitForTimeout(600); const after = await act(page); const ax = await C.axFocus(page); const ann1 = await C.ann(page);
  await k.press('Tab'); const next1 = await act(page); await k.press('Tab'); const next2 = await act(page);
  rec('refresh-by-keyboard', { before, focusWhileLoading: at, after, afterAx: ax, announced: ann1.map((a) => `${a.role}:${a.text}`), nextTab: [next1, next2] });
  // Space on Refresh, then Shift+Tab: does the reverse walk start where the button was?
  await page.getByRole('button', { name: 'Refresh' }).focus(); await k.press('Space'); await page.waitForTimeout(900);
  const afterSpace = await act(page); await k.press('Shift+Tab'); const prev = await act(page);
  rec('refresh-space-then-shift-tab', { afterSpace, shiftTab: prev });
  // a failing Refresh: the alert replaces the list; where is focus, what is read out?
  await page.route(/\/v1\/feed\?/, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database unavailable' }) }));
  await page.getByRole('button', { name: 'Refresh' }).focus(); await C.ann(page); await k.press('Enter'); await page.waitForTimeout(1200);
  const afterFail = await act(page); const annF = await C.ann(page); await k.press('Tab'); const nextF = await act(page);
  rec('refresh-fails-by-keyboard', { after: afterFail, announced: annF.map((a) => `${a.role}:${a.text.slice(0, 90)}`), nextTab: nextF });
  await C.shot(page, '20-keyboard-refresh-fails');
  await page.unroute(/\/v1\/feed\?/);
  save(); await b.close();
  const l = await api('GET', `/v1/communications?tenantId=${T}&status=ACTIVE&size=50`);
  for (const c of l.json.items) await api('POST', `/v1/communications/${c.id}/retire`, { actor: 'ux4-reviewer', note: 'review cleanup' });
  console.log('first stops:', stops.join(' | '));
})().catch((e) => { console.error(e); save(); process.exit(1); });
