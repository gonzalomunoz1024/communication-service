// swagger4.js — the developer in Swagger UI on private backend A (:19600): docs, Authorize, every offered example executed as offered
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const C = require('./common');
const norm = (t) => (t || '').replace(/\s+/g, ' '); const BASE = 'http://localhost:19600'; const api = C.apiClient(BASE, 'ux4-swagger');
async function authorize(page, id) { await page.getByRole('button', { name: /^Authorize/ }).first().click(); await page.waitForTimeout(300); const dlg = norm(await page.locator('.modal-ux').innerText()).slice(0, 400); await page.locator('.modal-ux input').first().fill(id); await page.locator('.modal-ux button.authorize').click(); await page.waitForTimeout(200); await page.locator('.modal-ux button.btn-done').click(); return dlg; }
const opOf = (page, method, p) => page.locator(`.opblock-${method}:has(.opblock-summary-path[data-path="${p}"])`).first();
async function open(op) { const cls = (await op.getAttribute('class')) || ''; if (!cls.includes('is-open')) { await op.locator('.opblock-summary').click(); await op.page().waitForTimeout(600); } }
async function tryIt(page, method, p, { params = {}, example } = {}) {
  const op = opOf(page, method, p); await open(op);
  if (await op.getByRole('button', { name: 'Try it out' }).count()) { await op.getByRole('button', { name: 'Try it out' }).click(); await page.waitForTimeout(300); }
  if (await op.getByRole('tab', { name: 'Edit Value' }).count()) { await op.getByRole('tab', { name: 'Edit Value' }).first().click(); await page.waitForTimeout(200); }
  let examples = null;
  const sel = op.locator('select.examples-select-element').first();
  if (await sel.count()) { examples = await sel.locator('option').allInnerTexts(); if (example !== undefined) { await sel.selectOption({ index: example }); await page.waitForTimeout(300); } }
  for (const [name, value] of Object.entries(params)) { const inp = op.locator(`.parameters tr[data-param-name="${name}"] input`).first(); if (await inp.count()) await inp.fill(value); }
  const body = await op.locator('textarea.body-param__text').inputValue().catch(() => null);
  await op.getByRole('button', { name: 'Execute' }).click(); await page.waitForTimeout(2000);
  const code = norm(await op.locator('.live-responses-table tbody .response-col_status').first().innerText().catch(() => ''));
  const resp = norm(await op.locator('.live-responses-table tbody .response-col_description').first().innerText().catch(() => '')).slice(0, 500);
  return { op, examples, body: body && body.replace(/\s+/g, ' ').slice(0, 400), code, resp };
}
(async () => {
  const b = await chromium.launch(); const out = {};
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(BASE + '/swagger-ui.html'); await page.waitForSelector('.opblock', { timeout: 20000 });
  out.title = await page.title(); out.ops = await page.locator('.opblock').count(); out.lockOnOps = await page.locator('.opblock .authorization__btn').count();
  const post = opOf(page, 'post', '/v1/communications'); await open(post);
  const pt = norm(await post.innerText());
  out.postDescription = pt.slice(0, 700);
  out.postResponses = (await post.locator('.responses-table tr.response').allInnerTexts()).map((t) => norm(t).slice(0, 260));
  await post.getByText('Schema', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(400);
  const pt2 = norm(await post.innerText());
  out.externalRefInSchema = (pt2.match(/externalRef.{0,420}/) || [''])[0];
  await post.screenshot({ path: path.join(C.SHOTS, '22-swagger-post.png') });
  const put = opOf(page, 'put', '/v1/communications/{id}'); await open(put); await put.getByText('Schema', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(300);
  const ut = norm(await put.innerText()); out.expectedVersionInSchema = (ut.match(/expectedVersion\*?.{0,360}/) || [''])[0]; out.putResponses = (await put.locator('.responses-table tr.response').allInnerTexts()).map((t) => norm(t).slice(0, 200));
  const mon = opOf(page, 'post', '/v1/health/monitors'); await open(mon); const mt = norm(await mon.innerText()); out.monitorPostMentionsUnknown = /does not take|unknown/i.test(mt); out.monitorResponses = (await mon.locator('.responses-table tr.response').allInnerTexts()).map((t) => norm(t).slice(0, 200));
  const rep = opOf(page, 'post', '/v1/health/reports'); await open(rep); out.reportResponses = (await rep.locator('.responses-table tr.response').allInnerTexts()).map((t) => norm(t).slice(0, 200));
  const get = opOf(page, 'get', '/v1/admin/tenants'); await open(get);
  await get.getByRole('button', { name: 'Try it out' }).click(); await get.getByRole('button', { name: 'Execute' }).click(); await page.waitForTimeout(1500);
  out.tryBeforeAuthorize = norm(await get.locator('.live-responses-table').innerText()).slice(0, 300);
  out.authorizeDialog = await authorize(page, 'ux4-swagger');
  await get.getByRole('button', { name: 'Execute' }).click(); await page.waitForTimeout(1500);
  out.tryAfterAuthorize = norm(await get.locator('.live-responses-table').innerText()).slice(0, 200);
  // every offered example, executed as offered
  const p1 = await tryIt(page, 'post', '/v1/communications'); out.publishExample = { examples: p1.examples, body: p1.body, code: p1.code, resp: p1.resp.slice(0, 200) };
  await p1.op.screenshot({ path: path.join(C.SHOTS, '23-swagger-try-publish-example.png') });
  console.log('publishExample', JSON.stringify(out.publishExample));
  let id = (p1.resp.match(/"id": ?"([0-9a-f-]{36})"/) || [])[1];
  if (!id) { const made = await api('POST', '/v1/communications', { tenantId: 'acme', publisher: 'sre-team', type: 'INCIDENT', severity: 'MAJOR', title: 'made by the reviewer for the PUT and retire examples' }); id = made.json.id; out.idFromApi = true; }
  const p1b = await tryIt(page, 'post', '/v1/communications'); out.publishExampleAgain = { code: p1b.code, resp: p1b.resp.slice(0, 420) }; console.log('again', JSON.stringify(out.publishExampleAgain));
  const p2 = await tryIt(page, 'put', '/v1/communications/{id}', { params: { id } }); out.putExample = { body: p2.body, code: p2.code, resp: p2.resp.slice(0, 160) };
  const p3 = await tryIt(page, 'post', '/v1/communications/{id}/retire', { params: { id } }); out.retireExample = { body: p3.body, code: p3.code, resp: p3.resp.slice(0, 160) };
  const other = await api('POST', '/v1/communications', { tenantId: 'acme', publisher: 'sre-team', type: 'INCIDENT', severity: 'MAJOR', title: 'for the admin example' });
  const p4 = await tryIt(page, 'post', '/v1/admin/communications/{id}/retire', { params: { id: other.json.id } }); out.adminRetireExample = { body: p4.body, code: p4.code, resp: p4.resp.slice(0, 160) };
  const m0 = await tryIt(page, 'post', '/v1/health/monitors', { example: 0 }); out.monitorExample0 = { examples: m0.examples, body: m0.body, code: m0.code, resp: m0.resp.slice(0, 200) };
  const m1 = await tryIt(page, 'post', '/v1/health/monitors', { example: 1 }); out.monitorExample1 = { body: m1.body, code: m1.code, resp: m1.resp.slice(0, 200) };
  const r1 = await tryIt(page, 'post', '/v1/health/reports'); out.reportExample = { body: r1.body, code: r1.code, resp: r1.resp.slice(0, 260) };
  await r1.op.screenshot({ path: path.join(C.SHOTS, '23b-swagger-try-report-example.png') });
  // cleanup on A: the example monitors (the probed one would keep probing a host that does not exist)
  const mons = await api('GET', '/v1/health/monitors?tenantId=acme'); out.cleanup = [];
  for (const m of mons.json || []) out.cleanup.push(`${m.service} ${(await api('DELETE', `/v1/health/monitors/${m.id}`)).status}`);
  fs.writeFileSync(path.join(C.LOGS, 'swagger4.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 2)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
