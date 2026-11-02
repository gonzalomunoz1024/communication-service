const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto('http://localhost:19600/swagger-ui.html'); await page.waitForSelector('.opblock', { timeout: 20000 });
  const op = page.locator('.opblock-post:has(.opblock-summary-path[data-path="/v1/communications"])').first();
  await op.locator('.opblock-summary').click(); await page.waitForTimeout(800);
  console.log('buttons before:', await op.locator('button').allInnerTexts());
  await op.getByRole('button', { name: 'Try it out' }).click(); await page.waitForTimeout(800);
  console.log('buttons after:', await op.locator('button').allInnerTexts());
  console.log('textareas:', await op.locator('textarea').count(), 'selects:', await op.locator('select').evaluateAll((s) => s.map((x) => `${x.className}|${x.getAttribute('aria-label')}|${[...x.options].map((o) => o.text).join(',')}`)));
  const rb = op.locator('.opblock-section-request-body');
  console.log('request body html:', (await rb.innerHTML()).replace(/\s+/g, ' ').slice(0, 1500));
  await b.close();
})();
