// auto-notice4.js — the SRE's view of an automated notice (private Vite :3600 -> backend :19600), desktop and phone
const { chromium, devices } = require('playwright'); const path = require('path'); const C = require('./common');
(async () => {
  const tenant = process.argv[2] || 'ux4-sidecar'; const tag = process.argv[3] || 'a';
  const browser = await chromium.launch();
  for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', devices['iPhone 14']]]) {
    const page = await (await browser.newContext({ ...opts, colorScheme: 'light' })).newPage();
    await page.goto('http://127.0.0.1:3600/'); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('atlas-theme', 'light'); }, tenant);
    await page.reload(); await page.waitForTimeout(2000); await page.getByLabel('Type', { exact: true }).selectOption(''); await page.waitForTimeout(1500);
    const card = page.locator('article').first();
    const info = { label, cards: await page.locator('article').count(), text: (await card.innerText().catch(() => '')).replace(/\s+/g, ' '), automaticChip: await card.getByText('Automatic', { exact: true }).count(), healthRefShown: /health:/.test(await card.innerText().catch(() => '')), scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth) };
    console.log(JSON.stringify(info));
    await card.screenshot({ path: path.join(C.SHOTS, `25-auto-notice-${tag}-${label}.png`) }).catch(() => {});
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
