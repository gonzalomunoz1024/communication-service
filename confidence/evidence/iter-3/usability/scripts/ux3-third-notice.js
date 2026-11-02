// ux3-third-notice.js — the third notice for one incident, following the banner's advice literally
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const BASE = 'http://127.0.0.1:3000'; const API = 'http://localhost:8080'; const T = 'ux3-third'; const INC = 'INC3100001';
const out = []; const rec = (k, v) => { out.push({ k, ...v }); console.log(`[${k}]`, JSON.stringify(v).slice(0, 600)); };
(async () => {
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(BASE + '#/publish'); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux3-oncall'); }, T); await page.reload(); await page.waitForTimeout(1200);
  const fill = async (title, ref) => { await page.getByRole('textbox', { name: 'Title' }).fill(title); await page.getByRole('textbox', { name: 'ServiceNow incident' }).fill(INC); await page.getByRole('textbox', { name: 'External reference' }).fill(ref); };
  const submit = async () => { await page.locator('form button[type=submit]').click(); await page.waitForTimeout(1300); const b = page.locator('form [role=alert][tabindex="-1"]'); if (await b.count()) { const t = await b.innerText(); return { outcome: '409', banner: t.split('\n')[0], suggestion: (t.match(/such as (\S+?)\.?(\n|$)/) || [])[1] }; } const h = await page.locator('main h2').first().innerText().catch(() => ''); if (/published/.test(h)) { await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200); } return { outcome: h }; };
  await fill('Checkout errors (first notice)', ''); rec('n1', await submit());
  await fill('Checkout errors (follow-up)', ''); let r = await submit(); rec('n2-attempt1', r);
  await fill('Checkout errors (follow-up)', r.suggestion); rec('n2-attempt2-follows-advice', await submit());
  // hours later, a third notice for the same incident: the person leaves External reference empty, as the first time
  await fill('Checkout errors (all clear soon)', ''); r = await submit(); rec('n3-attempt1', r);
  await page.screenshot({ path: path.resolve(__dirname, '../shots/21-third-notice-suggests-taken-value.png') });
  await fill('Checkout errors (all clear soon)', r.suggestion); r = await submit(); rec('n3-attempt2-follows-advice', r);
  await page.screenshot({ path: path.resolve(__dirname, '../shots/21b-third-notice-advice-rejected.png') });
  await fill('Checkout errors (all clear soon)', r.suggestion); rec('n3-attempt3-follows-advice', await submit());
  await browser.close();
  const l = await (await fetch(`${API}/v1/communications?tenantId=${T}&size=100`, { headers: { 'X-Client-Id': 'ux3-reviewer' } })).json();
  rec('refs', { refs: l.items.map((i) => i.externalRef) });
  for (const i of l.items) await fetch(`${API}/v1/communications/${i.id}/retire`, { method: 'POST', headers: { 'X-Client-Id': 'ux3-reviewer', 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'ux3-reviewer', note: 'review cleanup' }) });
  fs.writeFileSync(path.resolve(__dirname, '../logs/ux3-third-notice.json'), JSON.stringify(out, null, 2));
})();
