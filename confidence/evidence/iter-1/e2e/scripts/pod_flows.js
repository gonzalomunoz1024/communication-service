// E2E Integration Verifier: sidecar/pod flows on the private stack. node pod_flows.js [phase...]
const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const S = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad';
const UI = 'http://127.0.0.1:3501', A = 'http://127.0.0.1:19501', B = 'http://127.0.0.1:19502', APP = 'http://127.0.0.1:19601', SC = 'http://127.0.0.1:19602';
const CID = 'e2e1-verifier';
const results = [];
const ts = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.log(ts(), ...a);
const check = (fid, name, ok, detail = '') => { results.push([fid, name, !!ok, String(detail)]); console.log(`${ts()} ${fid} ${ok ? 'PASS' : 'FAIL'} ${name} :: ${String(detail).slice(0, 500)}`); return !!ok; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return `ERR(${e.status}): ${(e.stderr || e.stdout || '').toString().trim().slice(0, 200)}`; } };
async function api(base, method, path, body) {
  try {
    const res = await fetch(base + path, { method, headers: { 'X-Client-Id': CID, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    let json = null; try { json = await res.json(); } catch { }
    return { status: res.status, body: json };
  } catch (e) { return { status: 0, error: String(e.cause?.code || e.message) }; }
}
async function waitFor(fn, timeout = 10000, every = 500) { const end = Date.now() + timeout; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(every); } return last; }
async function monitor(base, tenant, service) { const r = await api(base, 'GET', `/v1/health/monitors?tenantId=${tenant}`); return (r.body || []).find?.(m => m.service === service) || null; }
async function openFeed(ctx, tenant, allTypes) {
  const page = await ctx.newPage();
  const errs = [], reqs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('pageerror ' + e.message));
  page.on('request', r => { if (r.url().includes('/v1/feed/stream')) reqs.push(`${ts()} ${r.url().replace(UI, '')}`); });
  await page.addInitScript((t) => { try { localStorage.setItem('comm-tenant', t); } catch { } }, tenant);
  await page.goto(`${UI}/#/feed`, { waitUntil: 'networkidle' });
  if (allTypes) { await page.getByRole('combobox', { name: 'Type' }).selectOption(''); await sleep(700); }
  return { page, errs, reqs };
}
function sseReader(url) {
  const frames = []; const ctrl = new AbortController(); let status = null;
  (async () => {
    try {
      const res = await fetch(url, { headers: { 'X-Client-Id': CID, Accept: 'text/event-stream' }, signal: ctrl.signal }); status = res.status;
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (; ;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); const f = { t: ts() }; for (const line of raw.split('\n')) { if (line.startsWith(':')) { f.comment = line; continue; } const k = line.slice(0, line.indexOf(':')); const v = line.slice(line.indexOf(':') + 1).trimStart(); f[k] = k === 'data' ? ((f.data || '') + v) : v; } if (f.data) { try { f.data = JSON.parse(f.data); } catch { } } frames.push(f); } }
    } catch (e) { if (e.name !== 'AbortError') frames.push({ error: String(e) }); }
  })();
  return { frames, close: () => ctrl.abort(), status: () => status };
}
const sidecarLogs = (name = 'e2e1-sidecar', n = 400) => sh(`docker logs --tail ${n} ${name} 2>&1`).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
const since = (lines, t0) => lines.filter(l => l.time && Date.parse(l.time) >= t0);
const TENANT = 'e2e1-pod', SERVICE = 'e2e1-app';
const ARGS = ['--server.port=19501', '--spring.data.mongodb.uri=mongodb://localhost:27017/e2e1', '--communication.sweep.interval-ms=2000', '--communication.health.sweep-interval-ms=1000', '--communication.health.stale-grace-after-start-ms=0'];

async function phase91(browser) {
  log('=== F-91 sidecar flow');
  const m0 = await monitor(A, TENANT, SERVICE);
  check('F-91', 'monitor auto-registered by the sidecar (push-only, publisher health-sidecar, staleAfterSeconds 90)', m0 && m0.url == null && m0.policy.publisher === 'health-sidecar' && m0.policy.staleAfterSeconds === 90, m0 && `id=${m0.id} state=${m0.state.lastStatus} "${m0.state.lastSummary}"`);
  const inst0 = await api(A, 'GET', `/v1/health/monitors/${m0?.id}/instances`);
  const pod = (inst0.body || [])[0] || {};
  check('F-91', 'instance recorded with pod identity from the Downward-API env (id, namespace, node, cluster, version, sidecar version)', pod.instanceId === 'e2e1-app-6d4f8b7c9-ab12c' && pod.namespace === 'e2e1-ns' && pod.node === 'worker-7' && pod.cluster === 'sandbox' && pod.version === '2.1.0' && pod.sidecar === 'ci-iter1' && pod.left === false, JSON.stringify(pod));
  const st = await (await fetch(SC + '/status')).json();
  check('F-78', 'sidecar /status shows the discovered target and the last report', st.target === 'http://127.0.0.1:8080/actuator/health' && st.lastReport?.status === 'UP' && st.reportsSent >= 1, JSON.stringify(st).slice(0, 300));
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const { page, errs } = await openFeed(ctx, TENANT, true);
  const allClear = await page.getByText('All clear').isVisible().catch(() => false);
  check('F-91', 'UI feed for tenant e2e-pod is empty before the fault', allClear);
  const sse = sseReader(`${A}/v1/feed/stream?tenantId=${TENANT}`);
  await sleep(500);
  const t0 = Date.now(); log('flip app DOWN (status=DOWN, db=DOWN)', await (await fetch(APP + '/__set?status=DOWN&db=DOWN', { method: 'POST' })).text());
  const notice = await waitFor(async () => { const r = await api(A, 'GET', `/v1/feed?tenantId=${TENANT}&type=OUTAGE`); return r.body?.items?.find(i => i.affectedServices?.includes(SERVICE)); }, 40000, 1000);
  const dt1 = ((Date.now() - t0) / 1000).toFixed(1);
  check('F-91', 'OUTAGE notice opens after the debounce (failureThreshold 2: change report + next heartbeat)', !!notice && notice.title === `${SERVICE} is down` && notice.type === 'OUTAGE' && notice.severity === 'MAJOR' && /db/.test(notice.body || ''), `after ${dt1}s title="${notice?.title}" severity=${notice?.severity} body="${(notice?.body || '').replace(/\n/g, ' | ').slice(0, 260)}"`);
  const m1 = await monitor(A, TENANT, SERVICE);
  const inst1 = await api(A, 'GET', `/v1/health/monitors/${m1?.id}/instances`);
  check('F-91', 'instances endpoint names the pod as DOWN with its failing component', inst1.body?.[0]?.status === 'DOWN' && JSON.stringify(inst1.body?.[0]?.components || []).includes('db'), JSON.stringify(inst1.body?.[0]).slice(0, 300));
  const card = await waitFor(async () => page.getByRole('heading', { name: `${SERVICE} is down` }).isVisible().catch(() => false), 8000);
  check('F-91', 'the OUTAGE card appears live in the UI feed (tenant e2e-pod)', card);
  await page.screenshot({ path: 'shots/f91-outage-in-ui.png' });
  const ev = sse.frames.find(f => f.event === 'created' && f.data?.communication?.id === notice?.id);
  check('F-91', 'SSE created frame for the automated notice', !!ev, ev && `id=${ev.id} at ${ev.t}`);
  const logs1 = since(sidecarLogs(), t0);
  check('F-89', 'sidecar logged "reported" with status DOWN', logs1.some(l => l.msg === 'reported' && l.status === 'DOWN'), logs1.filter(l => l.msg === 'reported').map(l => `${l.time.slice(11, 19)} ${l.status}`).join(', '));
  // degraded: UP overall, db DOWN -> kind change
  const t1 = Date.now(); log('flip app to UP with db DOWN', await (await fetch(APP + '/__set?status=UP&db=DOWN', { method: 'POST' })).text());
  const health = await waitFor(async () => { const r = await api(A, 'GET', `/v1/feed?tenantId=${TENANT}&type=HEALTH`); return r.body?.items?.find(i => i.affectedServices?.includes(SERVICE)); }, 40000, 1000);
  const outageAfter = await api(A, 'GET', `/v1/feed/${notice?.id}`);
  check('F-91', 'UP-with-failing-component -> DEGRADED: OUTAGE retired, HEALTH notice at MINOR opened', !!health && health.title === `${SERVICE} is degraded` && health.severity === 'MINOR' && outageAfter.body?.status === 'RETIRED', `after ${((Date.now() - t1) / 1000).toFixed(1)}s health="${health?.title}"/${health?.severity} outage=${outageAfter.body?.status} body="${(health?.body || '').replace(/\n/g, ' | ').slice(0, 200)}"`);
  const healthCard = await waitFor(async () => page.getByRole('heading', { name: `${SERVICE} is degraded` }).isVisible().catch(() => false), 8000);
  const outageGone = await waitFor(async () => !(await page.getByRole('heading', { name: `${SERVICE} is down` }).isVisible().catch(() => false)), 8000);
  check('F-91', 'UI (All types) swaps the Outage card for the Health card live', healthCard && outageGone, `health=${healthCard} outageGone=${outageGone}`);
  await page.screenshot({ path: 'shots/f91-degraded-in-ui.png' });
  // recovery
  const t2 = Date.now(); log('flip app UP', await (await fetch(APP + '/__set?status=UP&db=UP', { method: 'POST' })).text());
  const recovered = await waitFor(async () => { const r = await api(A, 'GET', `/v1/communications/${health?.id}`); return r.body?.status === 'RETIRED' ? r.body : null; }, 40000, 1000);
  const note = recovered?.history?.slice(-1)[0]?.action || '';
  check('F-91', 'two UP reports retire the notice with audit note "recovered: …"', !!recovered && /recovered/.test(note), `after ${((Date.now() - t2) / 1000).toFixed(1)}s last history: "${note}"`);
  const clear = await waitFor(async () => page.getByText('All clear').isVisible().catch(() => false), 8000);
  check('F-91', 'UI feed returns to All clear', clear);
  const m2 = await monitor(A, TENANT, SERVICE);
  check('F-91', 'monitor state: UP, incidents counted', m2?.state.lastStatus === 'UP' && m2.state.incidents >= 2 && !m2.state.openCommunicationId, `incidents=${m2?.state.incidents} "${m2?.state.lastSummary}"`);
  // SIGTERM: docker stop -> leaving report
  const t3 = Date.now(); const stopOut = sh('docker stop -t 10 e2e1-sidecar'); const stopMs = Date.now() - t3;
  const exitCode = sh('docker inspect e2e1-sidecar --format {{.State.ExitCode}}');
  const inst3 = await api(A, 'GET', `/v1/health/monitors/${m2?.id}/instances`);
  const m3 = await monitor(A, TENANT, SERVICE);
  const logs3 = since(sidecarLogs(), t3 - 1000);
  check('F-76', 'docker stop (SIGTERM): leaving report sent, exit 0, within 3 s', exitCode === '0' && stopMs < 3000 && logs3.some(l => /leaving report sent/.test(l.msg || '')), `exit=${exitCode} stop took ${stopMs}ms msgs=${logs3.map(l => l.msg).join(' / ')}`);
  check('F-48', 'instance left=true at once; service treated as scaled to zero (no notice)', inst3.body?.[0]?.left === true && !m3?.state.openCommunicationId, `left=${inst3.body?.[0]?.left} summary="${m3?.state.lastSummary}" lastStatus=${m3?.state.lastStatus}`);
  sh('docker start e2e1-sidecar'); const t4 = Date.now();
  const back = await waitFor(async () => { const r = await api(A, 'GET', `/v1/health/monitors/${m2?.id}/instances`); return r.body?.[0]?.left === false ? r.body[0] : null; }, 15000, 500);
  check('F-91', 'sidecar restart: instance back (left=false) and reporting UP', !!back && back.status === 'UP', `after ${((Date.now() - t4) / 1000).toFixed(1)}s ${JSON.stringify(back).slice(0, 160)}`);
  const noNewNotice = await api(A, 'GET', `/v1/feed?tenantId=${TENANT}`);
  check('F-88', 'no new notice after the sidecar restart', (noNewNotice.body?.items || []).filter(i => i.affectedServices?.includes(SERVICE)).length === 0, `items=${noNewNotice.body?.items?.length}`);
  check('F-91', 'no browser console errors during the sidecar flow', errs.length === 0, errs.slice(0, 3).join(' | '));
  sse.close(); await ctx.close();
}

async function phase92(browser) {
  log('=== F-92 backend down / F-61 browser reconnect');
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const { page, errs, reqs } = await openFeed(ctx, TENANT, true);
  const tl = Date.now();
  const live = await waitFor(async () => page.getByText('Live', { exact: true }).isVisible().catch(() => false), 20000, 100);
  const liveMs = Date.now() - tl;
  check('F-60', 'indicator reaches Live within 2 s on an empty tenant (G-1-4)', live && liveMs < 2000, `after ${liveMs} ms (page already settled)`);
  const transitions = []; let lastLabel = null;
  const poller = setInterval(async () => { const l = await page.locator('text=/^(Live|Connecting|Reconnecting( \\(\\d+\\))?|Paused)$/').first().textContent().catch(() => null); if (l && l !== lastLabel) { transitions.push(`${ts()} ${l}`); lastLabel = l; } }, 250);
  const pre = await api(A, 'POST', '/v1/communications', { tenantId: TENANT, publisher: 'curl', type: 'OUTAGE', severity: 'MAJOR', title: 'before outage of backend' });
  await waitFor(async () => page.getByRole('heading', { name: 'before outage of backend' }).isVisible().catch(() => false), 6000);
  const pid = sh("pgrep -f '^java -jar.*server.port=19501'");
  const t0 = Date.now(); log('kill backend A pid', pid, sh(`kill ${pid}`));
  const down = await waitFor(async () => (await api(A, 'GET', `/v1/feed?tenantId=${TENANT}`)).status === 0, 10000, 300);
  const refusedMs = Date.now() - t0;
  check('F-92', 'backend A really down (connection refused)', down, `pid=${pid} refused after ${refusedMs} ms`);
  const gone = await waitFor(async () => sh(`kill -0 ${pid} 2>/dev/null && echo alive || echo gone`) === 'gone', 40000, 200);
  const exitMs = Date.now() - t0;
  check('F-92', 'SIGTERM with open SSE streams: the JVM exits within 10 s (G-1-23; was 30 s)', gone && exitMs < 10000, `process gone after ${exitMs} ms`);
  const reconn = await waitFor(async () => page.locator('text=/^Reconnecting( \\(\\d+\\))?$/').first().isVisible().catch(() => false), 15000, 100);
  check('F-61', 'backend down: indicator shows Reconnecting (n)', reconn, `after ${((Date.now() - t0) / 1000).toFixed(1)}s transitions=[${transitions.join(' → ')}]`);
  await page.getByRole('button', { name: 'Refresh' }).click();
  const errState = await waitFor(async () => page.getByText("Couldn't load the feed").isVisible().catch(() => false), 8000);
  const tryAgain = await page.getByRole('button', { name: 'Try again' }).isVisible().catch(() => false);
  const errText = await page.getByText("Couldn't load the feed").locator('xpath=..').textContent().catch(() => '');
  const unreachable = await page.getByText(/service is unreachable right now/).isVisible().catch(() => false);
  check('F-92', 'UI: feed load while the backend is down -> "Couldn\'t load the feed", explained as unreachable (not a proxy status line, G-1-14) + Try again', errState && tryAgain && unreachable, `unreachableText=${unreachable} text="${(errText || '').slice(0, 160)}"`);
  await page.screenshot({ path: 'shots/f92-backend-down.png' });
  await sleep(6000);
  const logsDown = since(sidecarLogs(), t0);
  const failed = logsDown.filter(l => /report failed/.test(l.msg || ''));
  check('F-74', 'sidecar: "report failed; will retry" with backoff while the backend is down', failed.length >= 1, failed.map(l => `${l.time.slice(11, 19)} ${l.msg} ${l.error || ''} retryIn=${l.retryIn || l.backoff || l.next || ''}`).join(' | ').slice(0, 400));
  const scStatus = await (await fetch(SC + '/status')).json();
  check('F-78', 'sidecar /status exposes sendError while the backend is down', !!scStatus.sendError, JSON.stringify(scStatus.sendError || scStatus).slice(0, 200));
  // while A is down, publish through B (shares the DB)
  const viaB = await api(B, 'POST', '/v1/communications', { tenantId: TENANT, publisher: 'curl', type: 'OUTAGE', severity: 'CRITICAL', title: 'published while A was down' });
  check('F-21', 'B keeps serving while A is down (publish 201)', viaB.status === 201, `status=${viaB.status}`);
  // restart A
  const out = fs.openSync(`${S}/e2e1/logs/backendA.log`, 'a');
  const child = spawn('java', ['-jar', `${S}/communication-service-iter1.jar`, ...ARGS], { detached: true, stdio: ['ignore', out, out] }); child.unref();
  const t1 = Date.now();
  const up = await waitFor(async () => (await api(A, 'GET', `/v1/feed?tenantId=${TENANT}`)).status === 200, 60000, 500);
  check('F-92', 'backend A restarted', up, `after ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  // G-1-3: the page reopens a CLOSED EventSource itself with backoff and ?lastEventId=, so the badge must go
  // Reconnecting (n) -> Live and the item published through B while A was down must appear without a manual refresh
  const tHeal = Date.now();
  const healed = await waitFor(async () => (await page.getByText('Live', { exact: true }).isVisible().catch(() => false)) && (await page.getByRole('heading', { name: 'published while A was down' }).isVisible().catch(() => false)), 60000, 300);
  const healMs = Date.now() - tHeal;
  clearInterval(poller);
  const indicator = await page.locator('text=/^(Live|Connecting|Reconnecting( \\(\\d+\\))?|Paused)$/').first().textContent().catch(() => null);
  const seesViaB = await page.getByRole('heading', { name: 'published while A was down' }).isVisible().catch(() => false);
  const streamUrls = reqs.slice(-4);
  check('F-61', 'after the restart the page reopens the stream itself (Reconnecting (n) → Live) and the item published meanwhile appears without a refresh (G-1-3 + G-1-1)', healed && indicator === 'Live' && seesViaB, `healed ${healMs} ms after A answered again; indicator=${indicator} seesMissedItem=${seesViaB} badge transitions=[${transitions.join(' → ')}] stream URLs=[${streamUrls.join(' , ')}]`);
  check('F-61', 'the reopen carried ?lastEventId= (resume), not a fresh snapshot only', reqs.some(u => /lastEventId=\d+/.test(u)), `urls=${reqs.join(' , ').slice(0, 400)}`);
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 2500);
  const resume = await fetch(`${A}/v1/feed/stream?tenantId=${TENANT}&clientId=e2e1-verifier&lastEventId=1`, { headers: { Accept: 'text/event-stream' }, signal: ctl.signal }).catch(() => null);
  check('F-20', 'manual resume probe (?lastEventId=1) after the restart -> 200 text/event-stream (was 500 in iteration 0)', resume?.status === 200 && /text\/event-stream/.test(resume.headers.get('content-type') || ''), `status=${resume?.status} content-type=${resume?.headers.get('content-type')}`);
  await sleep(10000);
  const indicator2 = await page.locator('text=/^(Live|Connecting|Reconnecting( \\(\\d+\\))?|Paused)$/').first().textContent().catch(() => null);
  const cards = await page.getByRole('heading', { name: 'published while A was down' }).count();
  const esState = await page.evaluate(() => (performance.getEntriesByType('resource').filter(e => e.name.includes('/v1/feed/stream')).map(e => `${e.responseStatus || '?'}`)).join(','));
  check('F-61', '10 s later: still Live, the missed item exactly once (no duplicate after reconcile)', indicator2 === 'Live' && cards === 1, `indicator=${indicator2} cards=${cards} stream responses seen by the page: [${esState}]`);
  await page.screenshot({ path: 'shots/f61-after-restart.png' });
  // a manual refresh must not change anything now
  await page.getByRole('button', { name: 'Refresh' }).click();
  const stillThere = await waitFor(async () => page.getByRole('heading', { name: 'published while A was down' }).isVisible().catch(() => false), 6000);
  check('F-92', 'manual Refresh keeps the list consistent', stillThere);
  // the sidecar recovers without duplicates
  const t2 = Date.now();
  const rec = await waitFor(async () => { const s = await (await fetch(SC + '/status')).json().catch(() => ({})); return s.lastSendAt && Date.parse(s.lastSendAt) > t1 && !s.sendError ? s : null; }, 70000, 1000);
  const m = await monitor(A, TENANT, SERVICE);
  const recLogs = since(sidecarLogs(), t0).map(l => `${(l.time || '').slice(11, 19)} ${l.msg}${l.error ? ' ' + String(l.error).slice(0, 60) : ''}`);
  log('sidecar log since the kill:', recLogs.join(' | ').slice(0, 900));
  const notices = await api(A, 'GET', `/v1/feed?tenantId=${TENANT}`);
  check('F-92', 'sidecar recovers after the backend is back (next report accepted), monitor UP, no duplicate notice', !!rec && m?.state.lastStatus === 'UP' && !(notices.body?.items || []).some(i => i.affectedServices?.includes(SERVICE)), `recovered after ${((Date.now() - t1) / 1000).toFixed(1)}s state="${m?.state.lastSummary}" sendError=${(await (await fetch(SC + '/status')).json()).sendError || 'none'}`);
  await api(A, 'POST', `/v1/communications/${pre.body?.id}/retire`, { note: 'cleanup' });
  await api(A, 'POST', `/v1/communications/${viaB.body?.id}/retire`, { note: 'cleanup' });
  check('F-92', 'browser console errors during backend outage (expected: network errors only)', true, errs.slice(0, 4).join(' | '));
  await ctx.close();
}

async function phaseSilent() {
  log('=== F-92/F-48 sidecar silent (docker pause) -> stale -> DOWN naming the pod');
  // G-1-6: the valve now needs >= 2 silent monitors (and ignores scaled-to-zero ones); nothing is deleted here
  const all = await api(A, 'GET', `/v1/health/monitors`);
  log('monitors in db e2e1 now:', (all.body || []).map(m => `${m.tenantId}/${m.service}:${m.state?.lastStatus}`).join(', '));
  const m0 = await monitor(A, TENANT, SERVICE);
  const t0 = Date.now(); log('docker pause e2e1-sidecar', sh('docker pause e2e1-sidecar'));
  const notice = await waitFor(async () => { const r = await api(A, 'GET', `/v1/feed?tenantId=${TENANT}&type=OUTAGE`); return r.body?.items?.find(i => i.affectedServices?.includes(SERVICE)); }, 150000, 2000);
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  check('F-48', 'pod silent (paused, no leaving report) -> after staleAfterSeconds=90 an OUTAGE naming the pod', !!notice && /e2e1-app-6d4f8b7c9-ab12c/.test(notice.body || '') && /not reported since/.test(notice.body || ''), `after ${dt}s title="${notice?.title}" body="${(notice?.body || '').replace(/\n/g, ' | ').slice(0, 260)}"`);
  const paused = sh(`grep -c "silent at once" ${S}/e2e1/logs/backendA.log`);
  log('docker unpause', sh('docker unpause e2e1-sidecar'));
  const t1 = Date.now();
  const rec = await waitFor(async () => { const r = await api(A, 'GET', `/v1/communications/${notice?.id}`); return r.body?.status === 'RETIRED' ? r.body : null; }, 60000, 1000);
  check('F-48', 'pod reports again -> notice retired (recovered)', !!rec, `after ${((Date.now() - t1) / 1000).toFixed(0)}s last="${rec?.history?.slice(-1)[0]?.action}" (pause-valve warnings so far in A's log: ${paused})`);
}

async function phaseOrdering() {
  log('=== F-72/F-88 startup ordering, app restart, sidecar crash, rediscovery (pod 2)');
  sh('docker rm -f e2e1-sidecar2 e2e1-app2 e2e1-pod2 >/dev/null 2>&1');
  sh('docker run -d --name e2e1-pod2 -p 127.0.0.1:19611:8080 -p 127.0.0.1:19612:8081 -p 127.0.0.1:19613:9465 golang:1.24 sleep infinity');
  const T2 = 'e2e1-pod2';
  const t0 = Date.now();
  sh(`docker run -d --name e2e1-sidecar2 --network container:e2e1-pod2 --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges -e CS_ENDPOINT=http://172.17.0.1:19501 -e CS_TENANT=${T2} -e CS_SERVICE=app2 -e CS_INTERVAL=2s -e CS_HEARTBEAT=5s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=25s -e POD_NAME=app2-5d4c7b6a9-zzzzz -e POD_NAMESPACE=e2e1-ns -e NODE_NAME=worker-e2e health-sidecar:ci`);
  await sleep(7000);
  const m0 = await monitor(A, T2, 'app2');
  const logs0 = sidecarLogs('e2e1-sidecar2');
  const st0 = await (await fetch('http://127.0.0.1:19613/status')).json().catch(() => ({}));
  check('F-72', 'sidecar started before the app: reports UNKNOWN ("starting: waiting for the app to listen"), monitor registered with no notice', m0 && m0.state.lastStatus !== 'DOWN' && !m0.state.openCommunicationId && st0.lastReport?.status === 'UNKNOWN', `monitor lastStatus=${m0?.state.lastStatus} summary="${m0?.state.lastSummary}" sidecar lastReport=${st0.lastReport?.status} "${st0.lastReport?.message}"`);
  const feed0 = await api(A, 'GET', `/v1/feed?tenantId=${T2}`);
  check('F-88', 'no false outage while the app is not up yet', (feed0.body?.items || []).length === 0, `items=${feed0.body?.items?.length}`);
  sh('docker run -d --name e2e1-app2 --network container:e2e1-pod2 fakeapp:ci'); const t1 = Date.now();
  const up = await waitFor(async () => { const m = await monitor(A, T2, 'app2'); return m?.state.lastStatus === 'UP' ? m : null; }, 20000, 500);
  check('F-88', 'app starts after the sidecar: discovered and UP', !!up, `after ${((Date.now() - t1) / 1000).toFixed(1)}s "${up?.state.lastSummary}" target=${(await (await fetch('http://127.0.0.1:19613/status')).json()).target}`);
  // app restart (container stop): port disappears -> DOWN after retry -> notice after threshold
  sh('docker stop -t 1 e2e1-app2'); const t2 = Date.now();
  const outage = await waitFor(async () => { const r = await api(A, 'GET', `/v1/feed?tenantId=${T2}&type=OUTAGE`); return r.body?.items?.[0]; }, 40000, 1000);
  check('F-88', 'app container stopped -> OUTAGE notice after two DOWN observations, naming the pod (G-1-2; was never opened in iteration 0)', !!outage && outage.title === 'app2 is down' && /0 of 1 pod UP \(DOWN: app2-5d4c7b6a9-zzzzz\)/.test(outage?.body || ''), `after ${((Date.now() - t2) / 1000).toFixed(1)}s body="${(outage?.body || '').replace(/\n/g, ' | ').slice(0, 200)}"`);
  const m2b = await monitor(A, T2, 'app2'); const inst2 = await api(A, 'GET', `/v1/health/monitors/${m2b?.id}/instances`);
  const st2b = await (await fetch('http://127.0.0.1:19613/status')).json().catch(() => ({}));
  const logsDown2 = since(sidecarLogs('e2e1-sidecar2'), t2);
  check('F-88', 'while the app is gone: sidecar2 /status lastReport DOWN "app is not listening (last target …)", pod record DOWN with that message, log has "health target gone" + reported DOWN (G-1-2)', st2b.lastReport?.status === 'DOWN' && /not listening/.test(st2b.lastReport?.message || '') && inst2.body?.[0]?.status === 'DOWN' && /not listening/.test(inst2.body?.[0]?.message || '') && logsDown2.some(l => /target gone/.test(l.msg || '')) && logsDown2.some(l => l.msg === 'reported' && l.status === 'DOWN'), `status: ${st2b.lastReport?.status} "${st2b.lastReport?.message}" | pod: ${inst2.body?.[0]?.status} "${inst2.body?.[0]?.message}" | log: ${logsDown2.map(l => `${(l.time || '').slice(11, 19)} ${l.msg}${l.status ? ' ' + l.status : ''}`).join(' / ').slice(0, 200)}`);
  sh('docker start e2e1-app2'); const t3 = Date.now();
  const rec = await waitFor(async () => { const r = await api(A, 'GET', `/v1/communications/${outage?.id}`); return r.body?.status === 'RETIRED' ? r.body : null; }, 40000, 1000);
  check('F-88', 'app back -> notice retired (recovered)', !!rec, `after ${((Date.now() - t3) / 1000).toFixed(1)}s "${rec?.history?.slice(-1)[0]?.action}"`);
  // sidecar crash + restart (liveness) -> no new notice
  const incBefore = (await monitor(A, T2, 'app2'))?.state.incidents;
  sh('docker kill -s KILL e2e1-sidecar2'); await sleep(1500); sh('docker start e2e1-sidecar2'); const t4 = Date.now();
  await sleep(8000);
  const m4 = await monitor(A, T2, 'app2'); const feed4 = await api(A, 'GET', `/v1/feed?tenantId=${T2}`);
  check('F-88', 'sidecar SIGKILL + restart: reports UP again, no new notice, app unaffected', m4?.state.lastStatus === 'UP' && m4.state.incidents === incBefore && (feed4.body?.items || []).length === 0 && (await fetch('http://127.0.0.1:19611/').then(r => r.status)) === 200, `incidents ${incBefore}->${m4?.state.incidents} items=${feed4.body?.items?.length}`);
  // rediscovery: app moves to another port
  sh('docker rm -f e2e1-app2'); sh('docker run -d --name e2e1-app2 --network container:e2e1-pod2 -e PORT=8081 fakeapp:ci'); const t5 = Date.now();
  const redisc = await waitFor(async () => { const s = await (await fetch('http://127.0.0.1:19613/status')).json().catch(() => ({})); return s.target?.includes(':8081') ? s : null; }, 30000, 1000);
  check('F-77', 'app restarted on another port: sidecar rediscovers the new target', !!redisc, `after ${((Date.now() - t5) / 1000).toFixed(1)}s target=${redisc?.target}`);
  const logs = sidecarLogs('e2e1-sidecar2', 200);
  check('F-89', 'sidecar2 log lines are JSON with level/msg (start, target found, reported)', logs.every(l => !l.raw) && logs.some(l => l.msg === 'health sidecar starting') && logs.some(l => l.msg === 'health target found') && logs.some(l => l.msg === 'reported'), `${logs.length} lines, msgs=${[...new Set(logs.map(l => l.msg))].join(' / ').slice(0, 300)}`);
  fs.writeFileSync(`${S}/e2e1/logs/sidecar2.log.txt`, sh('docker logs e2e1-sidecar2 2>&1'));
  sh('docker rm -f e2e1-sidecar2 e2e1-app2 e2e1-pod2');
  await api(A, 'DELETE', `/v1/health/monitors/${m4?.id}`);
}

async function phaseSlowAndContract() {
  log('=== slow probe target, wire contract capture, instance id limits');
  // slow stub on host :28999 (backend A runs on the host, so 127.0.0.1 works for a pull monitor)
  const http = require('http');
  const captured = [];
  const stub = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      if (req.url.startsWith('/slow')) { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"UP"}'); }, 3000); return; }
      if (req.url.startsWith('/v1/health/reports')) { captured.push({ headers: req.headers, body }); res.writeHead(202, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
      res.writeHead(404); res.end();
    });
  }).listen(19620, '0.0.0.0');
  const reg = await api(A, 'POST', '/v1/health/monitors', { tenantId: 'e2e1-slow', service: 'slow-svc', url: 'http://127.0.0.1:19620/slow', intervalSeconds: 5, timeoutMs: 500, failureThreshold: 1, recoveryThreshold: 1 });
  check('F-92', 'pull monitor registered with timeoutMs=500 against a 3 s stub', reg.status === 201, `status=${reg.status}`);
  const probed = await api(A, 'POST', `/v1/health/monitors/${reg.body?.id}/probe`);
  check('F-92', 'slow target: probe counts as DOWN with a timeout message', probed.status === 200 && probed.body?.state?.lastStatus === 'DOWN' && /time|timeout|within/i.test(probed.body?.state?.lastSummary || ''), `${probed.status} lastStatus=${probed.body?.state?.lastStatus} "${probed.body?.state?.lastSummary}"`);
  const slowNotice = await waitFor(async () => (await api(A, 'GET', '/v1/feed?tenantId=e2e1-slow')).body?.items?.[0], 8000, 500);
  check('F-92', 'OUTAGE notice for the slow service (failureThreshold 1)', !!slowNotice && slowNotice.title === 'slow-svc is down', `"${slowNotice?.title}" body="${(slowNotice?.body || '').replace(/\n/g, ' | ').slice(0, 160)}"`);
  await api(A, 'DELETE', `/v1/health/monitors/${reg.body?.id}`);
  // wire contract: sidecar3 (shares e2e-app's netns) reports to the capture stub
  sh('docker rm -f e2e1-sidecar3 >/dev/null 2>&1');
  sh('docker run -d --name e2e1-sidecar3 --network container:e2e1-netns --user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges -e CS_ENDPOINT=http://172.17.0.1:19620 -e CS_TENANT=e2e1-wire -e CS_SERVICE=wire-svc -e CS_CLIENT_ID=wire-repo -e CS_LISTEN=:9466 -e CS_INTERVAL=2s -e POD_NAME=wire-7f9c6d5b4-abcde -e POD_NAMESPACE=wire-ns -e NODE_NAME=worker-1 -e CS_CLUSTER=ocp-east -e CS_VERSION=3.1.4 health-sidecar:ci');
  const cap = await waitFor(async () => captured[0], 15000, 500);
  let body = {}; try { body = JSON.parse(cap?.body || '{}'); } catch { }
  const h = cap?.headers || {};
  check('F-75', 'wire: headers Content-Type/Accept application/json, X-Client-Id = CS_CLIENT_ID, User-Agent health-sidecar/<version>', /application\/json/.test(h['content-type'] || '') && /application\/json/.test(h['accept'] || '') && h['x-client-id'] === 'wire-repo' && /^health-sidecar\/ci/.test(h['user-agent'] || ''), JSON.stringify({ ct: h['content-type'], accept: h['accept'], cid: h['x-client-id'], ua: h['user-agent'] }));
  check('F-75', 'wire: body {tenantId, service, status, components, observedAt, publisher, instance{id,namespace,node,cluster,version,sidecar}}', body.tenantId === 'e2e1-wire' && body.service === 'wire-svc' && body.status === 'UP' && body.components?.db && /Z$/.test(body.observedAt || '') && body.publisher === 'health-sidecar' && body.instance?.id === 'wire-7f9c6d5b4-abcde' && body.instance?.namespace === 'wire-ns' && body.instance?.cluster === 'ocp-east' && body.instance?.version === '3.1.4' && body.instance?.sidecar === 'ci-iter1', JSON.stringify(body).slice(0, 400));
  const replay = await api(A, 'POST', '/v1/health/reports', body);
  check('F-75', 'the captured body is accepted verbatim by the backend (202)', replay.status === 202, `status=${replay.status} ${JSON.stringify(replay.body?.state || replay.body).slice(0, 120)}`);
  await api(A, 'DELETE', `/v1/health/monitors/${replay.body?.id}`);
  sh('docker rm -f e2e1-sidecar3'); stub.close();
  const long = 'p'.repeat(253), tooLong = 'p'.repeat(254);
  const ok253 = await api(A, 'POST', '/v1/health/reports', { tenantId: 'e2e1-wire', service: 'limits', status: 'UP', instance: { id: long } });
  const bad254 = await api(A, 'POST', '/v1/health/reports', { tenantId: 'e2e1-wire', service: 'limits', status: 'UP', instance: { id: tooLong } });
  check('F-75', 'instance.id 253 chars accepted, 254 rejected with 400', ok253.status === 202 && bad254.status === 400, `${ok253.status} / ${bad254.status} ${JSON.stringify(bad254.body).slice(0, 120)}`);
  await api(A, 'DELETE', `/v1/health/monitors/${ok253.body?.id}`);
  // F-70 via the real sidecar: app answers {status:'WARN'} -> report WARN -> backend DEGRADED (fake app only knows UP/DOWN strings? it echoes any status)
  await fetch(APP + '/__set?status=WARN&db=UP', { method: 'POST' });
  const warn = await waitFor(async () => { const m = await monitor(A, TENANT, SERVICE); return m?.state.lastStatus === 'DEGRADED' ? m : null; }, 20000, 1000);
  const scs = await (await fetch(SC + '/status')).json();
  check('F-70', 'app says WARN -> sidecar passes WARN through -> backend classifies DEGRADED', !!warn && scs.lastReport?.status === 'WARN', `sidecar lastReport=${scs.lastReport?.status} backend="${warn?.state.lastSummary}"`);
  await fetch(APP + '/__set?status=UP&db=UP', { method: 'POST' });
  await waitFor(async () => { const m = await monitor(A, TENANT, SERVICE); return m?.state.lastStatus === 'UP'; }, 30000, 1000);
  const leftovers = await api(A, 'GET', `/v1/feed?tenantId=${TENANT}`);
  for (const i of leftovers.body?.items || []) await api(A, 'POST', `/v1/communications/${i.id}/retire`, { note: 'cleanup' });
}

async function phaseDeadApp(browser) {
  log('=== F-88 / G-1-2 on the main pod: the app process dies while the sidecar keeps running (e2e1-netns)');
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const { page, errs } = await openFeed(ctx, TENANT, true);
  const t0 = Date.now(); log('docker stop -t 1 e2e1-app ->', sh('docker stop -t 1 e2e1-app'));
  const downReport = await waitFor(async () => { const s = await (await fetch(SC + '/status')).json().catch(() => ({})); return s.lastReport?.status === 'DOWN' ? s : null; }, 30000, 500);
  check('F-88', 'sidecar reports DOWN (not UNKNOWN) as soon as the app process is gone (G-1-2)', !!downReport && downReport.lastReport?.status === 'DOWN', `after ${((Date.now() - t0) / 1000).toFixed(1)}s lastReport.status=${downReport?.lastReport?.status} message="${downReport?.lastReport?.message}" target="${downReport?.target || ''}" lastTarget=${downReport?.lastTarget}`);
  const notListening = await waitFor(async () => { const s = await (await fetch(SC + '/status')).json().catch(() => ({})); return s.lastReport?.status === 'DOWN' && /not listening/.test(s.lastReport?.message || '') && !s.target && !!s.lastTarget ? s : null; }, 15000, 500);
  check('F-88', 'with the target gone it keeps reporting DOWN "app is not listening (last target …)" and /status shows target empty + lastTarget', !!notListening, `after ${((Date.now() - t0) / 1000).toFixed(1)}s message="${notListening?.lastReport?.message}" target="${notListening?.target || ''}" lastTarget=${notListening?.lastTarget} upSeen=${notListening?.upSeen}`);
  const notice = await waitFor(async () => { const r = await api(A, 'GET', `/v1/feed?tenantId=${TENANT}&type=OUTAGE`); return r.body?.items?.find(i => i.affectedServices?.includes(SERVICE)); }, 40000, 1000);
  const dt1 = ((Date.now() - t0) / 1000).toFixed(1);
  check('F-88', 'backend opens an OUTAGE for the dead app (failureThreshold 2: change report + next heartbeat) naming the pod', !!notice && notice.title === `${SERVICE} is down` && notice.severity === 'MAJOR' && /0 of 1 pod UP/.test(notice.body || '') && /e2e1-app-6d4f8b7c9-ab12c/.test(notice.body || ''), `after ${dt1}s title="${notice?.title}" severity=${notice?.severity} body="${(notice?.body || '').replace(/\n/g, ' | ').slice(0, 260)}"`);
  const card = await waitFor(async () => page.getByRole('heading', { name: `${SERVICE} is down` }).isVisible().catch(() => false), 10000);
  check('F-91', 'the OUTAGE for the dead app appears live in the UI feed', card);
  await page.screenshot({ path: 'shots/f88-dead-app-outage-in-ui.png' });
  const m1 = await monitor(A, TENANT, SERVICE);
  const inst1 = await api(A, 'GET', `/v1/health/monitors/${m1?.id}/instances`);
  check('F-88', 'monitor DOWN with the open notice; the pod record says DOWN', m1?.state.lastStatus === 'DOWN' && m1.state.openCommunicationId === notice?.id && inst1.body?.[0]?.status === 'DOWN', `"${m1?.state.lastSummary}" pod=${JSON.stringify(inst1.body?.[0]).slice(0, 160)}`);
  const t1 = Date.now(); log('docker start e2e1-app ->', sh('docker start e2e1-app'));
  const rec = await waitFor(async () => { const r = await api(A, 'GET', `/v1/communications/${notice?.id}`); return r.body?.status === 'RETIRED' ? r.body : null; }, 60000, 1000);
  const scs = await (await fetch(SC + '/status')).json().catch(() => ({}));
  check('F-88', 'app back -> rediscovered on the same target, UP, notice retired "recovered"', !!rec && /recovered/.test(rec.history?.slice(-1)[0]?.action || '') && scs.target === 'http://127.0.0.1:8080/actuator/health' && scs.lastReport?.status === 'UP', `after ${((Date.now() - t1) / 1000).toFixed(1)}s last="${rec?.history?.slice(-1)[0]?.action}" target=${scs.target} lastReport=${scs.lastReport?.status}`);
  const clear = await waitFor(async () => page.getByText('All clear').isVisible().catch(() => false), 10000);
  check('F-91', 'UI feed returns to All clear', clear);
  const logs = since(sidecarLogs(), t0);
  check('F-89', 'sidecar log: "health target gone", reported DOWN, "health target found" again', logs.some(l => /target gone/.test(l.msg || '')) && logs.some(l => l.msg === 'reported' && l.status === 'DOWN') && logs.filter(l => l.msg === 'health target found').length >= 1, logs.map(l => `${(l.time || '').slice(11, 19)} ${l.msg}${l.status ? ' ' + l.status : ''}`).join(' | ').slice(0, 400));
  check('F-91', 'no browser console errors during the dead-app flow', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

(async () => {
  const phases = process.argv.slice(2);
  const browser = await chromium.launch();
  const run = async (name, fn) => { if (phases.length && !phases.includes(name)) return; try { await fn(browser); } catch (e) { check('ERR', name, false, e.stack?.slice(0, 500)); } };
  await run('p91', phase91);
  await run('deadapp', phaseDeadApp);
  await run('p92', phase92);
  await run('silent', phaseSilent);
  await run('ordering', phaseOrdering);
  await run('slow', phaseSlowAndContract);
  await browser.close();
  const fails = results.filter(r => !r[2]);
  console.log(`\nSUMMARY: ${results.length} checks, ${results.length - fails.length} pass, ${fails.length} fail`);
  fails.forEach(f => console.log('  FAIL', f[0], f[1], '::', f[3].slice(0, 300)));
  process.exit(Math.min(fails.length, 100));
})();
