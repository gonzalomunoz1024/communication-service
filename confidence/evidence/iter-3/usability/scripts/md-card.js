const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const r = await fetch('http://localhost:19600/v1/communications', { method: 'POST', headers: { 'X-Client-Id': 'ux3-reviewer', 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: 'ux3-md', publisher: 'vmforge-sre', type: 'OUTAGE', severity: 'MAJOR', title: 'API degradation in eu-west', body: 'We are investigating **elevated errors**.', affectedServices: ['vm-api'] }) });
  const c = await r.json();
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await p.goto('http://127.0.0.1:3600/'); await p.evaluate(() => localStorage.setItem('comm-tenant', 'ux3-md')); await p.reload(); await p.waitForTimeout(2000);
  console.log('card:', (await p.locator('article').first().innerText()).replace(/\s+/g, ' '));
  await p.locator('article').first().screenshot({ path: path.resolve(__dirname, '../shots/24-readme-example-body-card.png') });
  await b.close();
  await fetch(`http://localhost:19600/v1/communications/${c.id}/retire`, { method: 'POST', headers: { 'X-Client-Id': 'ux3-reviewer', 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'ux3-reviewer' }) });
})();
