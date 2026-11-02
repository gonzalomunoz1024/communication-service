const { chromium } = require('playwright'); const path = require('path');
const T = 'ux3-kbd2';
const act = (p) => p.evaluate(() => { const a = document.activeElement; return `${a.tagName.toLowerCase()} "${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40)}"`; });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { window.__ann = []; const seen = new WeakMap(); new MutationObserver(() => { document.querySelectorAll('[role=status],[role=alert],[aria-live]').forEach((el) => { const t = (el.textContent || '').trim(); if (seen.get(el) !== t) { seen.set(el, t); if (t) window.__ann.push(t.slice(0, 100)); } }); }).observe(document, { subtree: true, childList: true, characterData: true }); });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/#/publish'); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux3-kbd-oncall'); }, T); await page.reload(); await page.waitForTimeout(800);
  for (const n of [1, 2]) {
    await page.getByRole('textbox', { name: 'Title' }).fill(`View-in-feed focus ${n}`); await page.getByRole('textbox', { name: 'Title' }).press('Enter'); await page.getByRole('heading', { name: /published/ }).waitFor();
    await page.getByRole('button', { name: 'View in feed' }).focus(); await page.evaluate(() => { window.__ann = []; }); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
    const after = await act(page); const ann = await page.evaluate(() => window.__ann); const tabs = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); tabs.push(await act(page)); }
    console.log(JSON.stringify({ run: n, focusAfterViewInFeed: after, announced: ann, nextTabs: tabs, title: await page.title() }));
    await page.getByRole('tab', { name: 'Publish' }).click(); await page.getByRole('button', { name: 'Publish another' }).click().catch(() => {}); await page.waitForTimeout(300);
  }
  await b.close();
  const l = await (await fetch(`http://localhost:8080/v1/communications?tenantId=${T}&status=ACTIVE&size=50`, { headers: { 'X-Client-Id': 'ux3-reviewer' } })).json();
  for (const c of l.items) await fetch(`http://localhost:8080/v1/communications/${c.id}/retire`, { method: 'POST', headers: { 'X-Client-Id': 'ux3-reviewer', 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'ux3-reviewer' }) });
})().catch((e) => { console.error(e); process.exit(1); });
