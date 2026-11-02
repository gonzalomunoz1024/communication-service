// ux4-none-free.js — when the next 50 follow-up values are all taken (private A :19600, Vite :3600, tenant ux4-none-free)
const { chromium } = require('playwright'); const C = require('./common'); const { rec, save } = C.recorder('ux4-none-free');
const T = 'ux4-none-free'; const INC = 'INC4900001'; const api = C.apiClient('http://127.0.0.1:19600');
(async () => {
  const seeded = []; for (const ref of [INC, ...Array.from({ length: 50 }, (_, i) => `${INC}-${i + 2}`)]) { const r = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'INCIDENT', severity: 'MINOR', title: `seed ${ref}`, externalRef: ref }); seeded.push(r.status); }
  rec('seeded', { n: seeded.length, statuses: [...new Set(seeded)] });
  const r = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'one more', ticket: { number: INC } });
  rec('api-409', { status: r.status, body: r.text });
  const r2 = await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux4-oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'one more', externalRef: `${INC}-51` });
  rec('api-409-from-51', { status: r2.status, body: r2.text });
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto('http://127.0.0.1:3600/#/publish'); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux4-oncall'); }, T); await page.reload(); await page.waitForTimeout(1200);
  await page.getByRole('textbox', { name: 'Title' }).fill('One more notice for the incident'); await page.getByRole('textbox', { name: 'ServiceNow incident' }).fill(INC);
  await page.locator('form button[type=submit]').click(); await page.waitForTimeout(1500);
  rec('ui-banner', { text: await page.locator('form [role=alert][tabindex="-1"]').innerText().catch(() => null) });
  await C.shot(page, '21d-none-free-banner');
  await browser.close(); save();
})().catch((e) => { console.error(e); save(); process.exit(1); });
