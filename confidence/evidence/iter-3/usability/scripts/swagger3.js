// swagger3.js — the developer in Swagger UI (read-only checks on :8080; try-it-out writes only on private :19600)
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const SH = path.resolve(__dirname, '..', 'shots'); const norm = (t) => t.replace(/\s+/g, ' ');
async function authorize(page, id) { await page.getByRole('button', { name: /^Authorize/ }).first().click(); await page.waitForTimeout(300); const dlg = norm(await page.locator('.modal-ux').innerText()).slice(0, 360); await page.locator('.modal-ux input').first().fill(id); await page.locator('.modal-ux button.authorize').click(); await page.waitForTimeout(200); await page.locator('.modal-ux button.btn-done').click(); return dlg; }
const opOf = (page, method, p) => page.locator(`.opblock-${method}:has(.opblock-summary-path[data-path="${p}"])`).first();
async function tryDefault(page, method, p) {
  const op = opOf(page, method, p);
  await op.locator('.opblock-summary').click(); await page.waitForTimeout(500);
  await op.getByRole('button', { name: 'Try it out' }).click(); await page.waitForTimeout(300);
  const body = await op.locator('textarea.body-param__text').inputValue().catch(() => null);
  const params = await op.locator('.parameters input[type=text]').count();
  for (let i = 0; i < params; i++) { const inp = op.locator('.parameters input[type=text]').nth(i); if (!(await inp.inputValue())) await inp.fill('ux3-swagger'); }
  await op.getByRole('button', { name: 'Execute' }).click(); await page.waitForTimeout(1800);
  const live = norm(await op.locator('.live-responses-table').innerText().catch(() => '')).slice(0, 700);
  return { op, body, live };
}
(async () => {
  const b = await chromium.launch(); const out = {};
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto('http://localhost:8080/swagger-ui.html'); await page.waitForSelector('.opblock', { timeout: 20000 });
  out.title = await page.title(); out.ops = await page.locator('.opblock').count(); out.lockOnOps = await page.locator('.opblock .authorization__btn').count();
  const post = opOf(page, 'post', '/v1/communications');
  await post.locator('.opblock-summary').click(); await page.waitForTimeout(600);
  const pt = norm(await post.innerText());
  out.postDescription = pt.slice(0, 900);
  out.postMentionsUnknownFields = /unknown field/i.test(pt);
  out.post400 = (pt.match(/400 .{0,400}/) || [''])[0];
  out.post409 = (pt.match(/409 .{0,420}/) || [''])[0];
  await post.getByText('Schema', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(400);
  const pt2 = norm(await post.innerText());
  out.externalRefInSchema = (pt2.match(/externalRef.{0,360}/) || [''])[0];
  await post.screenshot({ path: path.join(SH, '22-swagger-post.png') });
  const put = opOf(page, 'put', '/v1/communications/{id}');
  await put.locator('.opblock-summary').click(); await page.waitForTimeout(500); await put.getByText('Schema', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(300);
  const ut = norm(await put.innerText()); out.expectedVersionInSchema = (ut.match(/expectedVersion\*?.{0,300}/) || [''])[0]; out.put400 = (ut.match(/400 .{0,300}/) || [''])[0];
  const mon = opOf(page, 'post', '/v1/health/monitors');
  await mon.locator('.opblock-summary').click(); await page.waitForTimeout(500); const mt = norm(await mon.innerText()); out.monitorPostMentionsUnknown = /unknown/i.test(mt); out.monitorPost = mt.slice(0, 500);
  const get = opOf(page, 'get', '/v1/admin/tenants'); await get.locator('.opblock-summary').click(); await page.waitForTimeout(300);
  await get.getByRole('button', { name: 'Try it out' }).click(); await get.getByRole('button', { name: 'Execute' }).click(); await page.waitForTimeout(1500);
  out.tryBeforeAuthorize = norm(await get.locator('.live-responses-table').innerText()).slice(0, 260);
  out.authorizeDialog = await authorize(page, 'ux3-swagger');
  await get.getByRole('button', { name: 'Execute' }).click(); await page.waitForTimeout(1500);
  out.tryAfterAuthorize = norm(await get.locator('.live-responses-table').innerText()).slice(0, 200);
  // private backend: Swagger's own example bodies, executed as they come
  const p2 = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await p2.goto('http://localhost:19600/swagger-ui.html'); await p2.waitForSelector('.opblock', { timeout: 20000 }); await authorize(p2, 'ux3-swagger');
  const r1 = await tryDefault(p2, 'post', '/v1/communications'); out.defaultPublish = { body: r1.body, response: r1.live };
  await r1.op.screenshot({ path: path.join(SH, '23-swagger-try-default-publish.png') });
  const r2 = await tryDefault(p2, 'post', '/v1/health/monitors'); out.defaultMonitor = { body: r2.body, response: r2.live };
  const r3 = await tryDefault(p2, 'post', '/v1/health/reports'); out.defaultReport = { body: r3.body, response: r3.live };
  fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'swagger3.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 2)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
