// ux4-third-notice.js — the third notice for one incident, and a date-shaped reference, following the banner's advice literally (shared, tenant ux4-third)
const { chromium } = require('playwright'); const C = require('./common'); const { rec, save } = C.recorder('ux4-third-notice');
const BASE = 'http://127.0.0.1:3000'; const T = 'ux4-third'; const INC = 'INC4100001'; const api = C.apiClient('http://localhost:8080');
(async () => {
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(BASE + '#/publish'); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux4-oncall'); }, T); await page.reload(); await page.waitForTimeout(1200);
  const fill = async (title, ref, inc = INC) => { await page.getByRole('textbox', { name: 'Title' }).fill(title); await page.getByRole('textbox', { name: 'ServiceNow incident' }).fill(inc); await page.getByRole('textbox', { name: 'External reference' }).fill(ref); };
  const submit = async () => { await page.locator('form button[type=submit]').click(); await page.waitForTimeout(1300); const b = page.locator('form [role=alert][tabindex="-1"]'); if (await b.count()) { const t = await b.innerText(); return { outcome: '409', banner: t.split('\n')[0], suggestion: (t.match(/such as (\S+?)\.?(\n|$)/) || [])[1] }; } const h = await page.locator('main h2').first().innerText().catch(() => ''); if (/published|scheduled/i.test(h)) { await page.getByRole('button', { name: 'Publish another' }).click(); await page.waitForTimeout(200); } return { outcome: h }; };
  await fill('Checkout errors (first notice)', ''); rec('n1', await submit());
  await fill('Checkout errors (follow-up)', ''); let r = await submit(); rec('n2-attempt1', r);
  await fill('Checkout errors (follow-up)', r.suggestion); rec('n2-attempt2-follows-advice', await submit());
  await fill('Checkout errors (all clear soon)', ''); r = await submit(); rec('n3-attempt1', r);
  await C.shot(page, '21-third-notice-suggests-free-value');
  await fill('Checkout errors (all clear soon)', r.suggestion); r = await submit(); rec('n3-attempt2-follows-advice', r);
  // a maintenance window named by its date: the same reference twice
  await page.getByRole('radio', { name: 'Maintenance' }).click(); await page.getByRole('button', { name: 'Schedule' }).click();
  await page.getByLabel('Starts').fill(C.localDT(26 * 3600e3)); await page.getByLabel(/^Ends/).fill(C.localDT(28 * 3600e3));
  await fill('Payments maintenance window', 'payments-2026-11-12', ''); rec('m1', await submit());
  await page.getByRole('radio', { name: 'Maintenance' }).click(); await page.getByRole('button', { name: 'Schedule' }).click().catch(() => {});
  await page.getByLabel('Starts').fill(C.localDT(26 * 3600e3)); await page.getByLabel(/^Ends/).fill(C.localDT(29 * 3600e3));
  await fill('Payments maintenance window (extended)', 'payments-2026-11-12', ''); r = await submit(); rec('m2-same-date-ref', r);
  await C.shot(page, '21c-date-reference-suggestion');
  await browser.close();
  const l = await api('GET', `/v1/communications?tenantId=${T}&size=100`);
  rec('refs', { refs: l.json.items.map((i) => `${i.externalRef} ${i.status}`) });
  for (const i of l.json.items) await api('POST', `/v1/communications/${i.id}/retire`, { actor: 'ux4-reviewer', note: 'review cleanup' });
  save();
})().catch((e) => { console.error(e); save(); process.exit(1); });
