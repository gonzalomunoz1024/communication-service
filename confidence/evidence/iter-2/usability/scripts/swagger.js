// swagger.js — the developer in Swagger UI: Authorize, the 409 on POST, externalRef and expectedVersion descriptions, try it out
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const out = {};
  await page.goto('http://localhost:8080/swagger-ui.html'); await page.waitForSelector('.opblock', { timeout: 20000 });
  out.url = page.url(); out.title = await page.title(); out.ops = await page.locator('.opblock').count();
  out.authorizeButton = await page.getByRole('button', { name: /Authorize/ }).count();
  out.lockOnOps = await page.locator('.opblock .authorization__btn').count();
  const post = page.locator('.opblock-post', { hasText: '/v1/communications' }).filter({ hasNotText: '{id}' }).first();
  await post.locator('.opblock-summary').click(); await page.waitForTimeout(600);
  const postText = await post.innerText();
  out.postSummary = (postText.match(/Publish[^\n]*/) || [''])[0];
  out.post409 = (postText.match(/409[\s\S]{0,500}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 480);
  out.post401 = (postText.match(/401[\s\S]{0,120}/) || [''])[0].replace(/\s+/g, ' ');
  await post.getByText('Schema', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(400);
  const postText2 = await post.innerText();
  out.externalRefInSchema = (postText2.match(/externalRef[\s\S]{0,360}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 360);
  await post.screenshot({ path: path.resolve(__dirname, '..', 'shots', '18-swagger-post-409.png') });
  const put = page.locator('.opblock-put', { hasText: '/v1/communications/{id}' }).first();
  await put.locator('.opblock-summary').click(); await page.waitForTimeout(600);
  await put.getByText('Schema', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(400);
  const putText = await put.innerText();
  out.expectedVersionInSchema = (putText.match(/expectedVersion\*?[\s\S]{0,360}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 360);
  out.put409 = (putText.match(/409[\s\S]{0,300}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 300);
  await put.screenshot({ path: path.resolve(__dirname, '..', 'shots', '19-swagger-put-expectedVersion.png') });
  // before Authorize: try it out on GET /v1/admin/tenants -> expect 401 rendered
  const get = page.locator('.opblock-get', { hasText: '/v1/admin/tenants' }).first(); await get.locator('.opblock-summary').click(); await page.waitForTimeout(300);
  await get.getByRole('button', { name: 'Try it out' }).click(); await get.getByRole('button', { name: 'Execute' }).click(); await page.waitForTimeout(1500);
  out.tryBeforeAuthorize = await get.locator('.responses-wrapper').innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 260));
  await page.getByRole('button', { name: /^Authorize/ }).click(); await page.waitForTimeout(300);
  fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'swagger.json'), JSON.stringify(out, null, 2)); out.authorizeDialog = await page.locator('.modal-ux').innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 320));
  await page.locator('.modal-ux input').first().fill('ux2-swagger'); await page.locator('.modal-ux button.authorize').click(); await page.waitForTimeout(200); await page.locator('.modal-ux button.btn-done').click();
  await get.getByRole('button', { name: 'Execute' }).click(); await page.waitForTimeout(1500);
  out.tryAfterAuthorize = await get.locator('.responses-wrapper').innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 260));
  console.log(JSON.stringify(out, null, 2)); fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'swagger.json'), JSON.stringify(out, null, 2)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
