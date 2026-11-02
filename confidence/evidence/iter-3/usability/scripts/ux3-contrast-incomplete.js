// ux3-contrast-incomplete.js — read-only: list axe color-contrast "incomplete" nodes on the Publish tab (shared :3000), light + dark
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
(async () => {
  const b = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto('http://127.0.0.1:3000/');
    await p.evaluate((t) => { localStorage.setItem('comm-tenant', 'ux3-sre'); localStorage.setItem('atlas-theme', t); }, theme);
    await p.reload(); await p.waitForTimeout(1200);
    await p.getByRole('tab', { name: 'Publish' }).click(); await p.waitForTimeout(400);
    const r = await new AxeBuilder({ page: p }).withRules(['color-contrast']).analyze();
    console.log(`== ${theme}: violations ${r.violations.length}, passes nodes ${r.passes.reduce((a, v) => a + v.nodes.length, 0)}, incomplete nodes ${r.incomplete.reduce((a, v) => a + v.nodes.length, 0)}`);
    for (const v of r.incomplete) for (const n of v.nodes) {
      const d = (n.any[0] || {}).data || {};
      console.log(`  ${n.target.join(' ')} | ${(n.any[0] || {}).message} | fg ${d.fgColor} bg ${d.bgColor} ratio ${d.contrastRatio} reason ${d.messageKey}`);
      const txt = await p.locator(n.target.join(' ')).first().innerText().catch(() => '?');
      console.log(`    text: ${JSON.stringify(txt.slice(0, 60))}`);
    }
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
