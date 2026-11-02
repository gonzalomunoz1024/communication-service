// ux2-dbdown.js — the database goes away under a running service (private backend :19601 on my own Mongo :27018, Vite :3601): API seat and SRE seat
const { chromium } = require('playwright'); const { execSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const API = 'http://127.0.0.1:19601', UI = 'http://127.0.0.1:3601', T = 'ux2-db';
const log = []; const rec = (s, d) => { log.push({ step: s, at: new Date().toISOString(), ...d }); console.log(`[${s}]`, JSON.stringify(d).slice(0, 420)); };
async function api(method, p, body) { const t0 = Date.now(); try { const r = await fetch(API + p, { method, headers: { 'X-Client-Id': 'ux2-reviewer', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(40000) }); const text = await r.text(); return { status: r.status, text: text.slice(0, 220), ms: Date.now() - t0 }; } catch (e) { return { error: String(e).slice(0, 120), ms: Date.now() - t0 }; } }
(async () => {
  rec('seed', await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux2-oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'Seeded before the database outage', affectedServices: ['db-api'] }));
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })).newPage();
  await page.goto(UI); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux2-oncall'); localStorage.setItem('atlas-theme', 'light'); }, T); await page.reload(); await page.waitForTimeout(2000);
  const badge = () => page.locator('main').getByText(/^(Live|Reconnecting|Connecting|Paused)/).first().innerText().catch(() => null);
  const main = () => page.locator('main').innerText().then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 420));
  rec('before', { cards: await page.locator('article').count(), badge: await badge() });
  execSync('docker stop ux2-mongo'); rec('mongo-stopped', {});
  rec('api-feed-while-down', await api('GET', `/v1/feed?tenantId=${T}`));
  rec('api-readiness', await (async () => { const t0 = Date.now(); const r = await fetch(API + '/actuator/health/readiness'); return { status: r.status, text: (await r.text()).slice(0, 100), ms: Date.now() - t0 }; })());
  rec('api-liveness', await (async () => { const r = await fetch(API + '/actuator/health/liveness'); return { status: r.status, text: (await r.text()).slice(0, 100) }; })());
  rec('api-publish-while-down', await api('POST', '/v1/communications', { tenantId: T, publisher: 'p', type: 'OUTAGE', severity: 'MAJOR', title: 'during outage' }));
  await page.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(7000);
  rec('ui-feed-while-down', { text: await main(), badge: await badge(), cards: await page.locator('article').count() });
  await page.screenshot({ path: path.resolve(__dirname, '..', 'shots', '21-feed-mongo-down.png') });
  await page.getByRole('tab', { name: 'Publish' }).click(); await page.waitForTimeout(300);
  await page.getByRole('textbox', { name: 'Title' }).fill('Publish while the database is down'); await page.locator('form button[type=submit]').click(); await page.waitForTimeout(7000);
  rec('ui-publish-while-down', { banner: await page.locator('form [role=alert][tabindex="-1"]').innerText().catch(() => null) });
  await page.screenshot({ path: path.resolve(__dirname, '..', 'shots', '22-publish-mongo-down.png') });
  execSync('docker start ux2-mongo'); const tStart = Date.now(); rec('mongo-started', {});
  let ready; for (let i = 0; i < 80; i++) { const r = await fetch(API + '/actuator/health/readiness').catch(() => null); if (r && r.status === 200) { ready = Date.now() - tStart; break; } await new Promise((r) => setTimeout(r, 500)); }
  rec('api-ready-again', { afterMs: ready });
  rec('api-feed-after', await api('GET', `/v1/feed?tenantId=${T}`));
  await page.locator('form button[type=submit]').click(); await page.waitForTimeout(3000);
  rec('ui-publish-after', { heading: await page.locator('main h2').first().innerText().catch(() => null), banner: await page.locator('form [role=alert][tabindex="-1"]').innerText().catch(() => null) });
  await page.getByRole('tab', { name: 'Feed' }).click(); await page.waitForTimeout(3000);
  rec('ui-feed-after', { cards: await page.locator('article').count(), badge: await badge(), text: await main() });
  fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'ux2-dbdown-log.json'), JSON.stringify(log, null, 2)); await browser.close();
})().catch((e) => { console.error(e); fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'ux2-dbdown-log.json'), JSON.stringify(log, null, 2)); process.exit(1); });
