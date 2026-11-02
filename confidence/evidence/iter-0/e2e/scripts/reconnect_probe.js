// How does the browser's EventSource (through the Vite dev proxy) behave when the backend dies and comes back?
const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process'); const fs = require('fs');
const S = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad';
const A = 'http://127.0.0.1:18081', UI = 'http://127.0.0.1:3001', T = 'e2e-reconnect';
const ts = () => new Date().toISOString().slice(11, 23);
const sh = (c) => { try { return execSync(c, { encoding: 'utf8' }).trim(); } catch (e) { return 'ERR ' + (e.stderr || '').toString().slice(0, 100); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = async (base, m, p, b) => { try { const r = await fetch(base + p, { method: m, headers: { 'X-Client-Id': 'e2e-verifier', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined, signal: AbortSignal.timeout(5000) }); return { status: r.status, body: await r.json().catch(() => null) }; } catch (e) { return { status: 0 }; } };
(async () => {
  await api(A, 'POST', '/v1/communications', { tenantId: T, publisher: 'curl', type: 'OUTAGE', severity: 'MAJOR', title: 'existing item so the stream commits at once' });
  // curl through the proxy and curl direct, in the background, to see when each connection ends
  sh(`rm -f ${S}/e2e/logs/curl_proxy.txt ${S}/e2e/logs/curl_direct.txt`);
  const curlProxy = spawn('bash', ['-c', `curl -sN --max-time 120 -H 'X-Client-Id: e2e-verifier' '${UI}/v1/feed/stream?tenantId=${T}' >> ${S}/e2e/logs/curl_proxy.txt 2>&1; echo "EXIT=$? at $(date -u +%T.%N)" >> ${S}/e2e/logs/curl_proxy.txt`], { detached: true, stdio: 'ignore' }); curlProxy.unref();
  const curlDirect = spawn('bash', ['-c', `curl -sN --max-time 120 -H 'X-Client-Id: e2e-verifier' '${A}/v1/feed/stream?tenantId=${T}' >> ${S}/e2e/logs/curl_direct.txt 2>&1; echo "EXIT=$? at $(date -u +%T.%N)" >> ${S}/e2e/logs/curl_direct.txt`], { detached: true, stdio: 'ignore' }); curlDirect.unref();
  const browser = await chromium.launch(); const page = await browser.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem('comm-tenant', t); } catch { } }, T);
  await page.goto(`${UI}/#/feed`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => {
    window.__es = []; const es = new EventSource(`/v1/feed/stream?tenantId=${t}&clientId=probe`);
    const rec = (k, extra) => window.__es.push({ t: new Date().toISOString().slice(11, 23), k, rs: es.readyState, ...extra });
    es.onopen = () => rec('open'); es.onerror = () => rec('error');
    ['snapshot', 'created', 'retired'].forEach(n => es.addEventListener(n, (e) => rec(n, { id: e.lastEventId })));
    window.__probe = es;
  }, T);
  await sleep(1500);
  const ind = async () => page.locator('text=/^(Live|Connecting|Reconnecting|Paused)$/').first().textContent().catch(() => null);
  console.log(ts(), 'before kill: UI indicator =', await ind(), 'probe events =', JSON.stringify(await page.evaluate(() => window.__es)));
  const pid = sh("pgrep -f '^java -jar.*server.port=18081'"); console.log(ts(), 'SIGTERM backend A pid', pid, sh(`kill ${pid}`));
  let downAt = null; for (let i = 0; i < 60; i++) { if ((await api(A, 'GET', `/v1/feed?tenantId=${T}`)).status === 0) { downAt = ts(); break; } await sleep(250); }
  console.log(ts(), 'backend A refuses connections since', downAt, '| java process gone:', sh("pgrep -f '^java -jar.*server.port=18081' || echo yes"));
  for (const w of [5, 15, 30]) { await sleep(w === 5 ? 5000 : 10000 + (w === 30 ? 5000 : 0)); console.log(ts(), `+${w}s after down: UI indicator =`, await ind(), '| probe readyState =', await page.evaluate(() => window.__probe.readyState), '| probe events =', JSON.stringify(await page.evaluate(() => window.__es.slice(-3)))); }
  console.log(ts(), 'curl via proxy:', sh(`tail -c 300 ${S}/e2e/logs/curl_proxy.txt | tr '\\n' ' '`), '\n', ts(), 'curl direct:', sh(`tail -c 200 ${S}/e2e/logs/curl_direct.txt | tr '\\n' ' '`));
  const out = fs.openSync(`${S}/e2e/logs/backendA.log`, 'a');
  const child = spawn('java', ['-jar', `${S}/communication-service.jar`, '--server.port=18081', '--spring.data.mongodb.uri=mongodb://localhost:27017/e2e', '--communication.sweep.interval-ms=2000', '--communication.health.sweep-interval-ms=1000', '--communication.health.stale-grace-after-start-ms=0'], { detached: true, stdio: ['ignore', out, out] }); child.unref();
  let upAt = null; for (let i = 0; i < 120; i++) { if ((await api(A, 'GET', `/v1/feed?tenantId=${T}`)).status === 200) { upAt = ts(); break; } await sleep(500); }
  console.log(ts(), 'backend A back at', upAt);
  const pub = await api(A, 'POST', '/v1/communications', { tenantId: T, publisher: 'curl', type: 'OUTAGE', severity: 'CRITICAL', title: 'published after the restart' });
  for (const w of [5, 20, 40]) { await sleep(w === 5 ? 5000 : w === 20 ? 15000 : 20000); console.log(ts(), `+${w}s after restart: UI indicator =`, await ind(), '| sees new item =', await page.getByRole('heading', { name: 'published after the restart' }).isVisible().catch(() => false), '| probe readyState =', await page.evaluate(() => window.__probe.readyState), '| probe events =', JSON.stringify(await page.evaluate(() => window.__es.slice(-4)))); }
  console.log(ts(), 'curl via proxy:', sh(`tail -c 300 ${S}/e2e/logs/curl_proxy.txt | tr '\\n' ' '`), '\n', ts(), 'curl direct:', sh(`tail -c 300 ${S}/e2e/logs/curl_direct.txt | tr '\\n' ' '`));
  console.log(ts(), 'stream requests in backend A log after restart (Last-Event-ID attempts):', sh(`grep -c "seq expression" ${S}/e2e/logs/backendA.log`), 'x "second seq expression" errors total');
  await page.screenshot({ path: `${S}/e2e/shots/f61-probe-after-restart.png` });
  await browser.close();
  for (const i of (await api(A, 'GET', `/v1/feed?tenantId=${T}`)).body?.items || []) await api(A, 'POST', `/v1/communications/${i.id}/retire`, { note: 'cleanup' });
})();
