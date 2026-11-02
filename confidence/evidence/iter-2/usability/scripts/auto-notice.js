// auto-notice.js — what the SRE sees in the UI when the sidecar's report opens an OUTAGE (private Vite :3600 -> backend :19600)
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const tenant = process.argv[2] || 'ux2-sidecar';
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })).newPage();
  await page.goto('http://127.0.0.1:3600/');
  await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('atlas-theme', 'light'); }, tenant);
  await page.reload(); await page.waitForTimeout(2000);
  const cards = page.locator('article');
  console.log(JSON.stringify({ cards: await cards.count(), text: await page.locator('main').innerText().then((t) => t.replace(/\s+/g, ' ').trim()).catch(() => null), links: await page.locator('article a').count() }));
  await page.screenshot({ path: path.resolve(__dirname, '..', 'shots', '20-auto-notice-feed.png') });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
