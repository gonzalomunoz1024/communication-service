// ux3-dbdown.js — the database goes away under a running service (private backend :19601 on my own Mongo ux3-mongo :19617, Vite :3601)
const { chromium } = require('playwright'); const { execSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const API = 'http://127.0.0.1:19601', UI = 'http://127.0.0.1:3601', T = 'ux3-db', ST = 'http://127.0.0.1:19619/status';
const log = []; const rec = (s, d) => { log.push({ step: s, at: new Date().toISOString(), ...d }); console.log(`[${s}]`, JSON.stringify(d).slice(0, 600)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, p, body) { const t0 = Date.now(); try { const r = await fetch(API + p, { method, headers: { 'X-Client-Id': 'ux3-reviewer', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(40000) }); const text = await r.text(); return { status: r.status, text: text.slice(0, 200), ms: Date.now() - t0 }; } catch (e) { return { error: String(e).slice(0, 120), ms: Date.now() - t0 }; } }
const sc = async () => { try { const d = await (await fetch(ST)).json(); return { sendError: d.sendError || null, reportsSent: d.reportsSent, lastSendAt: d.lastSendAt, last: d.lastReport && d.lastReport.status }; } catch (e) { return { error: String(e).slice(0, 80) }; } };
const LIVE = () => { window.__ann = []; const t0 = performance.now(); const seen = new WeakMap(); const check = () => { document.querySelectorAll('[role=status],[role=alert],[aria-live]').forEach((el) => { const txt = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (seen.get(el) !== txt) { seen.set(el, txt); window.__ann.push({ t: Math.round(performance.now() - t0), role: el.getAttribute('role'), text: txt.slice(0, 160) }); } }); }; new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true }); };
(async () => {
  rec('seed', await api('POST', '/v1/communications', { tenantId: T, publisher: 'ux3-oncall', type: 'OUTAGE', severity: 'MAJOR', title: 'Seeded before the database outage', affectedServices: ['db-api'] }));
  execSync('docker rm -f ux3-sc-b ux3-app-b >/dev/null 2>&1 || true');
  execSync('docker run -d --name ux3-sc-b -p 127.0.0.1:19619:9465 --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges -e CS_ENDPOINT=http://172.17.0.1:19601 -e CS_TENANT=ux3-db -e CS_SERVICE=db-api -e CS_INTERVAL=3s -e CS_HEARTBEAT=10s -e CS_STARTUP_GRACE=20s health-sidecar:ci');
  execSync('docker run -d --name ux3-app-b --network container:ux3-sc-b fakeapp:ci');
  await sleep(8); rec('sidecar-before', await sc());
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' }); await ctx.addInitScript(LIVE);
  const page = await ctx.newPage();
  await page.goto(UI); await page.evaluate((t) => { localStorage.setItem('comm-tenant', t); localStorage.setItem('comm-publisher', 'ux3-oncall'); localStorage.setItem('atlas-theme', 'light'); }, T); await page.reload(); await page.waitForTimeout(2000);
  const badge = (p = page) => p.locator('main span[role=status][aria-live=polite]').first().innerText().catch(() => null);
  const main = (p = page) => p.locator('main').innerText().then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 460));
  rec('before', { cards: await page.locator('article').count(), badge: await badge() }); await page.evaluate(() => { window.__ann = []; });
  execSync('docker stop ux3-mongo'); const tDown = Date.now(); rec('mongo-stopped', {});
  rec('api-feed-while-down', await api('GET', `/v1/feed?tenantId=${T}`));
  rec('api-readiness', await (async () => { const t0 = Date.now(); const r = await fetch(API + '/actuator/health/readiness'); return { status: r.status, text: (await r.text()).slice(0, 100), ms: Date.now() - t0 }; })());
  rec('api-liveness', await (async () => { const r = await fetch(API + '/actuator/health/liveness'); return { status: r.status, text: (await r.text()).slice(0, 100) }; })());
  rec('api-publish-while-down', await api('POST', '/v1/communications', { tenantId: T, publisher: 'p', type: 'OUTAGE', severity: 'MAJOR', title: 'during outage' }));
  await page.getByRole('button', { name: 'Refresh' }).click(); await page.waitForTimeout(7000);
  rec('ui-feed-while-down', { text: await main(), badge: await badge(), cards: await page.locator('article').count() });
  await page.screenshot({ path: path.resolve(__dirname, '..', 'shots', '26-feed-mongo-down.png') });
  // a colleague opens the page during the outage
  const p2 = await ctx.newPage(); await p2.goto(UI); await p2.waitForTimeout(500); const b2 = [];
  for (let i = 0; i < 12; i++) { b2.push(`${i * 2}s:${await badge(p2)}`); await p2.waitForTimeout(2000); }
  rec('ui-fresh-page-while-down', { badgeOverTime: b2, text: await main(p2) });
  await p2.screenshot({ path: path.resolve(__dirname, '..', 'shots', '27-fresh-page-mongo-down.png') });
  await page.getByRole('tab', { name: 'Publish' }).click(); await page.waitForTimeout(300);
  await page.getByRole('textbox', { name: 'Title' }).fill('Publish while the database is down'); await page.locator('form button[type=submit]').click(); await page.waitForTimeout(7000);
  rec('ui-publish-while-down', { banner: await page.locator('form [role=alert][tabindex="-1"]').innerText().catch(() => null) });
  await page.screenshot({ path: path.resolve(__dirname, '..', 'shots', '28-publish-mongo-down.png') });
  for (let i = 0; i < 12; i++) { const s = await sc(); if (s.sendError) { rec('sidecar-while-down', { ...s, afterDownMs: Date.now() - tDown }); break; } await sleep(2000); if (i === 11) rec('sidecar-while-down', { ...s, note: 'no sendError within 24 s' }); }
  rec('announcements-while-down', { page1: await page.evaluate(() => window.__ann), page2: await p2.evaluate(() => window.__ann).then((a) => a.slice(-8)) });
  execSync('docker start ux3-mongo'); const tStart = Date.now(); rec('mongo-started', { downForMs: tStart - tDown });
  let ready; for (let i = 0; i < 80; i++) { const r = await fetch(API + '/actuator/health/readiness').catch(() => null); if (r && r.status === 200) { ready = Date.now() - tStart; break; } await sleep(500); }
  rec('api-ready-again', { afterMs: ready }); rec('api-feed-after', await api('GET', `/v1/feed?tenantId=${T}`));
  await page.locator('form button[type=submit]').click(); await page.waitForTimeout(3000);
  rec('ui-publish-after', { heading: await page.locator('main h2').first().innerText().catch(() => null), banner: await page.locator('form [role=alert][tabindex="-1"]').innerText().catch(() => null) });
  await page.getByRole('tab', { name: 'Feed' }).click(); await page.waitForTimeout(3000);
  rec('ui-feed-after', { cards: await page.locator('article').count(), badge: await badge(), text: await main() });
  await sleep(12000); rec('ui-fresh-page-after', { badge: await badge(p2), cards: await p2.locator('article').count() }); rec('sidecar-after', await sc());
  await browser.close(); execSync('docker rm -f ux3-sc-b ux3-app-b >/dev/null 2>&1 || true');
  fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'ux3-dbdown-log.json'), JSON.stringify(log, null, 2));
})().catch((e) => { console.error(e); try { execSync('docker start ux3-mongo'); } catch {} fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'ux3-dbdown-log.json'), JSON.stringify(log, null, 2)); process.exit(1); });
