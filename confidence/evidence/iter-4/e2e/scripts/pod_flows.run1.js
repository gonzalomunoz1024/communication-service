// E2E verifier (iteration 4; the iteration-3 script plus G-4-15 in unknownpod, G-4-16 in words, G-4-25 in capture): the emulated pod (e2e4-netns + e2e4-app + e2e4-sidecar) against backend A and the UI.
// node pod_flows.js <scenario>...   scenarios: down degraded words unknownpod sigterm deadapp ordering silence capture pull logs
// (iteration 4: adapted from the iteration-2 script; G-3-16 timing in degraded, G-3-25 in down, new words (G-3-30) and unknownpod (G-3-18))
const { chromium } = require('playwright')
const { execSync, spawn } = require('child_process')
const fs = require('fs')
const A = 'http://127.0.0.1:19501', UI = 'http://127.0.0.1:19530'
const POD = { app: 'http://127.0.0.1:19540', status: 'http://127.0.0.1:19541' }
const POD2 = { app: 'http://127.0.0.1:19542', status: 'http://127.0.0.1:19543' }
const S = '/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e4'
const OUT = `${S}/out`, SHOT = `${OUT}/screenshots`; fs.mkdirSync(SHOT, { recursive: true })
const RUN = Date.now().toString(36)
const results = []
const stamp = () => new Date().toISOString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function check(id, name, cond, detail = '') { results.push([id, name, !!cond]); console.log(`${stamp()} ${cond ? 'PASS' : 'FAIL'} ${id} ${name} :: ${String(detail).slice(0, 1000)}`) }
function sh(cmd, opts = {}) { try { return execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim() } catch (e) { return `ERR(${e.status}): ${(e.stderr || e.stdout || e.message).toString().trim().slice(0, 300)}` } }
async function api(method, path, body, headers = { 'X-Client-Id': 've4-pod-checks' }) {
  const res = await fetch(A + path, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
  const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}
const getJson = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return await r.json() } catch { return null } }
const status = (pod = POD) => getJson(`${pod.status}/status`)
const appSet = async (st, db, pod = POD) => (await fetch(`${pod.app}/__set?status=${st}&db=${db}`, { method: 'POST' })).json()
const monitor = async (service = 've4-app', tenant = 've4') => ((await api('GET', `/v1/health/monitors?tenantId=${tenant}`)).json || []).find((m) => m.service === service)
const instances = async (mid) => (await api('GET', `/v1/health/monitors/${mid}/instances`)).json || []
async function waitFor(fn, ms = 10000, every = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return { ok: true, ms: Date.now() - t0, value: v } } catch {} await sleep(every) } return { ok: false, ms: Date.now() - t0 } }
const card = (page, title) => page.locator('article', { hasText: title })
async function openFeed(page, tenant = 've4') {
  await page.goto(`${UI}/#/feed`)
  await page.getByRole('textbox', { name: 'Tenant', exact: true }).fill(tenant)
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 15000 })
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'All types' })
  await page.evaluate((run) => { window.__ve4 = run }, RUN)
}
const notReloaded = (page) => page.evaluate(() => window.__ve4).then((v) => v === RUN)
const sidecarLog = (name = 'e2e4-sidecar') => sh(`docker logs ${name} 2>&1`).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return { raw: l } } })
const backendLog = () => fs.readFileSync(`${OUT}/backendA.txt`, 'utf8').split('\n')
const PODNAME = 've4-app-6d4f8b7c9-ab12c'
const SIDECAR_ENV = (podName, extra = '') => `-e CS_ENDPOINT=http://172.17.0.1:19501 -e CS_TENANT=ve4 -e CS_SERVICE=ve4-app -e CS_CLIENT_ID=ve4-app-repo -e CS_INTERVAL=3s -e CS_HEARTBEAT=10s -e CS_RETRY_DELAY=1s -e CS_STARTUP_GRACE=30s -e POD_NAME=${podName} -e POD_NAMESPACE=ve4-ns -e NODE_NAME=worker-7 -e CS_CLUSTER=sandbox -e CS_VERSION=2.1.0 ${extra}`
const RESTRICTED = '--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges'
let browser, page

async function baseline() {
  const m = await monitor(); const inst = m ? await instances(m.id) : []
  const me = inst.find((i) => i.instanceId === PODNAME)
  check('F-91', 'the pod auto-registered a push-only monitor (url absent, publisher health-sidecar, thresholds 2/2) and is UP', m && !m.url && m.policy.publisher === 'health-sidecar' && m.policy.failureThreshold === 2 && m.policy.recoveryThreshold === 2 && m.state.lastStatus === 'UP', m ? `id=${m.id} summary=${m.state.lastSummary} staleAfter=${m.policy.staleAfterSeconds} minHealthy=${m.policy.minHealthyPercent}` : 'no monitor')
  check('F-75', 'the instance record carries the Downward API identity and the sidecar version from the real sidecar', me && me.status === 'UP' && me.left === false && me.namespace === 've4-ns' && me.node === 'worker-7' && me.cluster === 'sandbox' && me.version === '2.1.0' && me.sidecar === 'e2e4', JSON.stringify(me))
  return m
}

// ---------------------------------------------------------------------------------------------------- down (F-91, G-2-16)
async function down() {
  console.log(`## down: app DOWN -> sidecar -> OUTAGE in the UI, with the new send policy (${stamp()})`)
  const m = await baseline()
  const s0 = await status(); const sent0 = s0.reportsSent
  const logLen0 = sidecarLog().length
  const tFlip = Date.now(); await appSet('DOWN', 'DOWN')
  const firstDown = await waitFor(async () => { const s = await status(); return s && s.lastReport && s.lastReport.status === 'DOWN' && s.reportsSent > sent0 ? s : null }, 15000, 100)
  const tFirst = Date.now()
  const noticeP = waitFor(async () => { const mm = await monitor(); return mm && mm.state.openCommunicationId ? mm : null }, 30000, 200)
  const cardP = waitFor(() => card(page, 've4-app is down').isVisible(), 30000, 150)
  const [notice, cardSeen] = await Promise.all([noticeP, cardP])
  const sAfter = await status()
  check('F-91', 'first DOWN report left the sidecar within the probe interval + retry delay', firstDown.ok && firstDown.ms < 6000, `first DOWN report ${firstDown.ms} ms after the flip (reportsSent ${sent0} -> ${firstDown.value && firstDown.value.reportsSent}, message="${firstDown.value && firstDown.value.lastReport.message}")`)
  check('F-91', 'OUTAGE notice opened and its card appeared live in the UI', notice.ok && cardSeen.ok && (await notReloaded(page)), `notice ${notice.ms} ms and card ${cardSeen.ms} ms after the first DOWN report; ${Date.now() - tFlip - cardSeen.ms - (tFirst - tFlip) >= 0 ? '' : ''}from the flip: card at ${(tFirst - tFlip) + cardSeen.ms} ms`)
  check('F-91', 'G-2-16: the second DOWN observation came one probe interval later (3 s), not at the heartbeat (10 s): notice < 7 s after the first DOWN report', notice.ok && notice.ms < 7000 && sAfter.reportsSent - sent0 >= 2, `notice after ${notice.ms} ms; reports sent since the flip: ${sAfter.reportsSent - sent0}`)
  const c = card(page, 've4-app is down'); const text = (await c.innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('F-91', "the card is an Outage, Major, service tag ve4-app, publisher health-sidecar, body names the pod", /Outage/.test(text) && /Major/.test(text) && /ve4-app/.test(text) && /health-sidecar/.test(text) && text.includes(PODNAME), text.slice(0, 300))
  await page.screenshot({ path: `${SHOT}/f91-outage-in-ui.png` })
  const html = await c.innerHTML().catch(() => '')
  check('F-40', "G-3-25: the automated card shows 'Automatic' instead of the internal health:<monitor>:<n> reference, and its body has no ** markers or sub-second times", /Automatic/.test(text) && !/health:[0-9a-f-]{8,}/.test(text) && !/\*\*/.test(text) && !/\d\d:\d\d:\d\d\.\d/.test(text), text.slice(0, 400))
  const inst = (await instances(m.id)).find((i) => i.instanceId === PODNAME)
  check('F-91', 'the instance record is DOWN with the sidecar message, not left', inst && inst.status === 'DOWN' && inst.left === false && /DOWN/.test(inst.message || ''), JSON.stringify(inst))
  const newLines = sidecarLog().slice(logLen0)
  const downInfo = newLines.filter((l) => l.msg === 'reported' && l.status === 'DOWN')
  check('F-89', 'G-2-16 logging: the DOWN transition is logged once at INFO while several DOWN reports were sent (repeats at DEBUG, hidden at the default level)', downInfo.length === 1 && downInfo[0].level === 'INFO' && sAfter.reportsSent - sent0 >= 2, `INFO reported-DOWN lines=${downInfo.length}, reports sent=${sAfter.reportsSent - sent0}; new log lines: ${newLines.map((l) => `${l.level} ${l.msg} ${l.status || ''}`).join(' | ').slice(0, 300)}`)
  // recovery
  const sentR = (await status()).reportsSent; const tUp = Date.now(); await appSet('UP', 'UP')
  const firstUp = await waitFor(async () => { const s = await status(); return s && s.lastReport.status === 'UP' && s.reportsSent > sentR ? s : null }, 15000, 100)
  const retiredP = waitFor(async () => { const mm = await monitor(); return mm && !mm.state.openCommunicationId && mm.state.lastStatus === 'UP' ? mm : null }, 40000, 200)
  const goneP = waitFor(async () => (await card(page, 've4-app is down').count()) === 0, 40000, 150)
  const [ret, gone] = await Promise.all([retiredP, goneP])
  check('F-91', 'app UP -> notice retired and the card leaves the UI (recovery threshold 2: the second UP arrives at the heartbeat, 10 s)', ret.ok && gone.ok && (await notReloaded(page)), `first UP report ${firstUp.ms} ms after the flip; retired ${ret.ms} ms and card gone ${gone.ms} ms after the flip`)
  const perm = notice.ok ? await api('GET', `/v1/feed/${notice.value.state.openCommunicationId}`) : { json: {} }
  check('F-91', "the notice's permalink reads RETIRED and the history says recovered", perm.json.status === 'RETIRED', `${perm.json.status} body=${(perm.json.body || '').replace(/\s+/g, ' ').slice(0, 160)}`)
  const full = notice.ok ? (await api('GET', `/v1/communications/${notice.value.state.openCommunicationId}`)).json : {}
  const actors = [...new Set((full.history || []).map((h) => h.actor))]
  check('F-40', "G-3-25: published, updated and retired under one name (health-sidecar, the monitor's publisher); history ends 'recovered'", full.publisher === 'health-sidecar' && actors.length === 1 && actors[0] === 'health-sidecar' && /recovered/.test((full.history || []).slice(-1)[0]?.action || ''), `publisher=${full.publisher} history=${JSON.stringify((full.history || []).map((h) => [h.actor, (h.action || '').slice(0, 60)]))}`)
  const bl = backendLog().filter((l) => /opened OUTAGE|retired notice/.test(l)).slice(-2).map((l) => l.replace(/.*(opened|retired)/, '$1').slice(0, 120))
  check('F-89', 'backend logged the open and the retire at INFO', bl.length === 2, bl.join(' || '))
}

// ---------------------------------------------------------------------------------------------- degraded (F-70, F-38 via sidecar)
async function degraded() {
  console.log(`## degraded: UP with a failing component, then WARN (${stamp()})`)
  const m = await monitor(); const sent0 = (await status()).reportsSent
  const t0 = Date.now(); await appSet('UP', 'DOWN')
  const first = await waitFor(async () => { const s = await status(); return s && s.reportsSent > sent0 ? s : null }, 15000, 100)
  const deg = await waitFor(async () => { const mm = await monitor(); return mm && mm.state.lastStatus === 'DEGRADED' ? mm : null }, 15000, 200)
  const notice = await waitFor(async () => { const mm = await monitor(); return mm && mm.state.openCommunicationId ? mm : null }, 30000, 200)
  const cardSeen = await waitFor(() => card(page, 've4-app is degraded').isVisible(), 10000, 150)
  const sNow = await status()
  check('F-38', 'sidecar status UP with component db DOWN -> backend DEGRADED', first.ok && deg.ok && sNow.lastReport.status === 'UP' && sNow.lastReport.components.db.status === 'DOWN', `report after ${first.ms} ms (status ${sNow.lastReport.status}, db ${sNow.lastReport.components.db.status}); monitor DEGRADED after ${deg.ms} ms`)
  check('F-91', "G-3-16: HEALTH notice 've4-app is degraded' (MINOR) in the UI one probe interval after the first report (UP with a DOWN component is sent every probe, not at the 10 s heartbeat)", notice.ok && cardSeen.ok && deg.ms + notice.ms < 7000 && sNow.reportsSent - sent0 >= 2, `first report ${first.ms} ms after the flip; monitor DEGRADED +${deg.ms} ms; notice ${deg.ms + notice.ms} ms after the first report (${first.ms + deg.ms + notice.ms} ms after the flip); card +${cardSeen.ms} ms after the notice; reports since flip ${sNow.reportsSent - sent0}`)
  if (cardSeen.ok) { const t = (await card(page, 've4-app is degraded').innerText()).replace(/\s+/g, ' '); check('F-91', 'the degraded card is type Health, severity Minor, names db', /Health/.test(t) && /Minor/.test(t) && /db/.test(t), t.slice(0, 240)); await page.screenshot({ path: `${SHOT}/f91-degraded-in-ui.png` }) }
  // WARN passes through as a word the service treats as DEGRADED (F-70)
  const sentW = (await status()).reportsSent; await appSet('WARN', 'UP')
  const warn = await waitFor(async () => { const s = await status(); return s && s.reportsSent > sentW && s.lastReport.status === 'WARN' ? s : null }, 15000, 100)
  const inst = await waitFor(async () => (await instances(m.id)).find((i) => i.instanceId === PODNAME && i.status === 'DEGRADED' && !/DOWN/.test(i.message || '')), 10000, 200)
  check('F-70', "app says WARN -> sidecar reports 'WARN' -> backend instance DEGRADED", warn.ok && inst.ok, `sidecar lastReport.status=${warn.value && warn.value.lastReport.status}; instance=${JSON.stringify(inst.value || {}).slice(0, 200)}`)
  const sentU = (await status()).reportsSent; await appSet('UP', 'UP')
  const ret = await waitFor(async () => { const mm = await monitor(); return mm && !mm.state.openCommunicationId && mm.state.lastStatus === 'UP' ? mm : null }, 40000, 200)
  const gone = await waitFor(async () => (await card(page, 've4-app is degraded').count()) === 0, 10000, 150)
  check('F-91', 'back to UP -> degraded notice retired, card gone', ret.ok && gone.ok, `retired ${ret.ms} ms after the flip`)
}

// ------------------------------------------------------------------------- words (G-3-30 through the real sidecar)
async function words() {
  console.log(`## words: G-3-30 'pass'/'fail', then G-4-16 padded and white-space-only words from the app through the real sidecar to the notice (${stamp()})`)
  const m = await monitor()
  const setRaw = async (st, db) => (await fetch(`${POD.app}/__set?status=${encodeURIComponent(st)}&db=${encodeURIComponent(db)}`, { method: 'POST' })).json()
  const show = (x) => JSON.stringify(x)
  const noNotice = async () => { const x = await monitor(); return x && !x.state.openCommunicationId && x.state.lastStatus === 'UP' ? x : null }
  // back to UP UP and wait until nothing is open (the second UP report comes at the 10 s heartbeat)
  const recover = async () => { await setRaw('UP', 'UP'); const r = await waitFor(noNotice, 45000, 250); await waitFor(async () => (await page.locator('article', { hasText: 've4-app is' }).count()) === 0, 10000, 150); return r }
  // G-3-30 first (unchanged from iteration 3)
  const sent0 = (await status()).reportsSent
  await setRaw('UP', 'pass')
  const sentPass = await waitFor(async () => { const s = await status(); return s && s.reportsSent > sent0 && s.lastReport.components && s.lastReport.components.db && s.lastReport.components.db.status === 'pass' ? s : null }, 20000, 150)
  await sleep(7000) // two more probes at 3 s: a false DEGRADED would have opened a notice by now
  let mm = await monitor(); let inst = (await instances(m.id)).find((i) => i.instanceId === PODNAME)
  check('F-70', "G-3-30: the app's component 'pass' reaches the service as 'pass' and reads UP there: no DEGRADED, no notice", sentPass.ok && mm.state.lastStatus === 'UP' && !mm.state.openCommunicationId && inst && inst.status === 'UP', `sidecar sent db=${sentPass.value && sentPass.value.lastReport.components.db.status} (${sentPass.ms} ms); monitor=${mm.state.lastStatus} summary=${mm.state.lastSummary} instance=${inst && inst.status} open=${mm.state.openCommunicationId || 'none'}`)
  // cases that must open a notice: [label, app status word, app db word, sidecar status sent, notice type, title suffix, body must match]
  const opening = [
    ["G-3-30 component 'fail'", 'UP', 'fail', 'UP', 'HEALTH', 'is degraded', /db: DOWN/],
    ["G-4-16 status ' DOWN\\t' (padded)", ' DOWN\t', 'UP', 'DOWN', 'OUTAGE', 'is down', null],
    ["G-4-16 status '   ' (spaces only, the app answers 503)", '   ', 'UP', 'DOWN', 'OUTAGE', 'is down', null],
    ["G-4-16 status '\\u0001' (U+0001 only, 503)", '\u0001', 'UP', 'DOWN', 'OUTAGE', 'is down', null],
    ["G-4-16 status 'pass\\u2003' (EM SPACE is not trimmed: an unknown word)", 'pass ', 'UP', 'PASS ', 'HEALTH', 'is degraded', null],
    ["G-4-16 status '\\u00a0' (NBSP only: an unknown word)", ' ', 'UP', ' ', 'HEALTH', 'is degraded', null],
    ["G-4-16 component ' fail ' (padded)", 'UP', ' fail ', 'UP', 'HEALTH', 'is degraded', /db: DOWN/],
  ]
  for (const [label, st, db, sentStatus, type, suffix, bodyRe] of opening) {
    const before = (await status()).reportsSent; const t0 = Date.now(); await setRaw(st, db)
    const first = await waitFor(async () => { const s = await status(); return s && s.reportsSent > before && s.lastReport.status === sentStatus && (db === 'UP' || (s.lastReport.components && s.lastReport.components.db && s.lastReport.components.db.status === db)) ? s : null }, 15000, 100)
    const notice = await waitFor(async () => { const x = await monitor(); return x && x.state.openCommunicationId ? x : null }, 30000, 200)
    const title = `ve4-app ${suffix}`
    const cardSeen = await waitFor(() => card(page, title).isVisible(), 10000, 150)
    const fi = notice.ok ? (await api('GET', `/v1/feed/${notice.value.state.openCommunicationId}`)).json : {}
    const pod = (await instances(m.id)).find((i) => i.instanceId === PODNAME) || {}
    const ok = first.ok && notice.ok && cardSeen.ok && fi.type === type && fi.title === title && (!bodyRe || bodyRe.test(fi.body || ''))
    check('F-70', `${label}: the sidecar sends ${show(sentStatus)} -> the service opens ${type} '${title}' -> the card is live in the UI`, ok, `first report ${first.ms} ms after the flip (status ${show(first.value && first.value.lastReport.status)}, message ${show(first.value && first.value.lastReport.message)}); monitor ${notice.value && notice.value.state.lastStatus} notice ${notice.ms} ms later, card +${cardSeen.ms} ms; instance ${pod.status} ${show(pod.message || '')}; notice ${fi.type}/${fi.severity} "${fi.title}" body="${(fi.body || '').replace(/\s+/g, ' ').slice(0, 220)}"`)
    const r = await recover()
    check('F-70', `${label}: back to UP -> the notice is retired and the card leaves`, r.ok, `retired ${r.ms} ms after UP UP`)
  }
  // cases that must open nothing
  const quiet = [
    ["G-4-16 status 'up ' (padded, the app answers 503 because its word is not exactly UP)", 'up ', 'UP', 'UP', 'UP'],
    ["G-4-16 component '\\u0001' (trimmed to blank: UNKNOWN, not failing)", 'UP', '\u0001', 'UP', 'UP'],
  ]
  for (const [label, st, db, sentStatus, monitorStatus] of quiet) {
    const before = (await status()).reportsSent; await setRaw(st, db)
    const sent = await waitFor(async () => { const s = await status(); return s && s.reportsSent > before && s.lastReport.status === sentStatus && (db === 'UP' || (s.lastReport.components && s.lastReport.components.db && s.lastReport.components.db.status === db)) ? s : null }, 20000, 150)
    await sleep(7000)
    mm = await monitor(); inst = (await instances(m.id)).find((i) => i.instanceId === PODNAME)
    check('F-70', `${label}: the sidecar sends ${show(sentStatus)}, the service reads ${monitorStatus}, no notice`, sent.ok && mm.state.lastStatus === monitorStatus && !mm.state.openCommunicationId && inst && inst.status === monitorStatus, `sent=${show(sent.value && sent.value.lastReport.status)} db=${show(sent.value && sent.value.lastReport.components && sent.value.lastReport.components.db && sent.value.lastReport.components.db.status)} (${sent.ms} ms); monitor=${mm.state.lastStatus} summary=${mm.state.lastSummary} instance=${inst && inst.status} open=${mm.state.openCommunicationId || 'none'}`)
  }
  await recover()
}

// ------------------------------------------------------------- unknownpod (G-3-18: a pod that never answers UP)
async function unknownpod() {
  console.log(`## unknownpod: a sidecar whose app never listens; UNKNOWN after the grace goes out at the heartbeat only (${stamp()})`)
  sh('docker rm -f e2e4-sidecar5 e2e4-netns5 2>/dev/null')
  sh('docker run -d --name e2e4-netns5 -p 127.0.0.1:19545:9465 golang:1.24 sleep infinity')
  sh(`docker run -d --name e2e4-sidecar5 --network container:e2e4-netns5 ${RESTRICTED} -e CS_ENDPOINT=http://172.17.0.1:19501 -e CS_TENANT=ve4unk -e CS_SERVICE=ve4-never-up -e CS_CLIENT_ID=ve4-unk-repo -e CS_INTERVAL=2s -e CS_HEARTBEAT=8s -e CS_STARTUP_GRACE=4s -e POD_NAME=ve4-never-up-0 health-sidecar:e2e4`)
  const st = () => getJson('http://127.0.0.1:19545/status')
  const s1 = await waitFor(async () => { const s = await st(); return s && s.reportsSent >= 1 ? s : null }, 20000, 200)
  await sleep(8000) // past the 4 s grace
  const a = await st(); const tA = Date.now()
  await sleep(40000)
  const b = await st(); const secs = (Date.now() - tA) / 1000
  const n = b.reportsSent - a.reportsSent
  const mons = (await api('GET', '/v1/health/monitors?tenantId=ve4unk')).json || []
  const mm = mons.find((x) => x.service === 've4-never-up')
  check('F-72', `G-3-18: after the grace the never-UP pod reports UNKNOWN with a config hint at the 8 s heartbeat (${secs.toFixed(0)} s window: about ${Math.round(secs / 8)} reports), not on every 2 s probe (about ${Math.round(secs / 2.2)})`, b.lastReport.status === 'UNKNOWN' && n >= 3 && n <= 7, `reports in the window=${n}; lastReport=${JSON.stringify({ status: b.lastReport.status, message: b.lastReport.message }).slice(0, 220)}`)
  check('F-72', 'the service ignores UNKNOWN: the auto-registered monitor opens no notice', mm && !mm.state.openCommunicationId && mm.state.lastStatus !== 'DOWN', mm ? `monitor lastStatus=${mm.state.lastStatus} summary=${mm.state.lastSummary}` : 'no monitor')
  check('F-72', "G-4-15: the all-UNKNOWN rollup quotes the pod's own words: '1 pod starting, none reporting yet (ve4-never-up-0: no health target found after 4s: … set CS_PORT and CS_PATH)'", mm && /^1 pod starting, none reporting yet \(ve4-never-up-0: no health target found after 4s: .*set CS_PORT and CS_PATH\)$/.test(mm.state.lastSummary || ''), mm ? `summary=${mm.state.lastSummary}` : 'no monitor')
  sh('docker rm -f e2e4-sidecar5 e2e4-netns5')
  for (const x of mons) await api('DELETE', `/v1/health/monitors/${x.id}`)
}

// ----------------------------------------------------------------------------------------------------- sigterm (F-76, F-48)
async function sigterm() {
  console.log(`## sigterm: docker stop (SIGTERM) -> leaving report (${stamp()})`)
  const m = await monitor(); const n0 = sidecarLog().length
  const t0 = Date.now(); const out = sh('docker stop -t 10 e2e4-sidecar'); const elapsed = Date.now() - t0
  const exit = sh("docker inspect -f '{{.State.ExitCode}}' e2e4-sidecar")
  const lines = sidecarLog().slice(n0)
  const inst = (await instances(m.id)).find((i) => i.instanceId === PODNAME)
  const mm = await monitor()
  check('F-76', "SIGTERM: 'leaving report sent', exit code 0, well under the 30 s grace", lines.some((l) => l.msg === 'leaving report sent') && exit === '0' && elapsed < 5000, `stop took ${elapsed} ms exit=${exit} lines=${lines.map((l) => l.msg).join(' | ')}`)
  check('F-48', 'the instance is marked left at once and the rollup has no live pod; no notice opened', inst && inst.left === true && !mm.state.openCommunicationId, `left=${inst && inst.left} message=${inst && inst.message} monitor=${mm.state.lastStatus} summary=${mm.state.lastSummary}`)
  await sleep(4000)
  const mm2 = await monitor()
  check('F-48', 'a service whose only pod left cleanly is not declared DOWN (scaled to zero, 4 s later)', !mm2.state.openCommunicationId, `monitor=${mm2.state.lastStatus} summary=${mm2.state.lastSummary}`)
  sh('docker start e2e4-sidecar')
  const back = await waitFor(async () => { const i = (await instances(m.id)).find((x) => x.instanceId === PODNAME); return i && i.left === false && i.status === 'UP' ? i : null }, 20000, 200)
  const mm3 = await monitor()
  check('F-88', 'restarted sidecar -> UP again, left=false, no notice', back.ok && mm3.state.lastStatus === 'UP' && !mm3.state.openCommunicationId, `back after ${back.ms} ms summary=${mm3.state.lastSummary}`)
}

// -------------------------------------------------------------------------------------------- deadapp (F-88, G-2-16 message)
async function deadapp() {
  console.log(`## deadapp: the app process dies while the sidecar keeps running in the pod (${stamp()})`)
  const m = await monitor(); const n0 = sidecarLog().length; const sent0 = (await status()).reportsSent
  const t0 = Date.now(); sh('docker stop -t 1 e2e4-app')
  const first = await waitFor(async () => { const s = await status(); return s && s.reportsSent > sent0 && s.lastReport.status === 'DOWN' ? s : null }, 15000, 100)
  const s1 = first.value || (await status())
  check('F-88', "DOWN reported from the first failed probe with 'app is not listening (last target …)' (G-2-16), target cleared, lastTarget kept", first.ok && /app is not listening/.test(s1.lastReport.message) && /last target http:\/\/127\.0\.0\.1:8080/.test(s1.lastReport.message) && !s1.target && s1.lastTarget, `after ${first.ms} ms: message="${s1.lastReport.message}" target="${s1.target}" lastTarget="${s1.lastTarget}"`)
  const notice = await waitFor(async () => { const mm = await monitor(); return mm && mm.state.openCommunicationId ? mm : null }, 30000, 200)
  const cardSeen = await waitFor(() => card(page, 've4-app is down').isVisible(), 10000, 150)
  const text = cardSeen.ok ? (await card(page, 've4-app is down').innerText()).replace(/\s+/g, ' ') : ''
  const inst = (await instances(m.id)).find((i) => i.instanceId === PODNAME)
  check('F-88', 'OUTAGE naming the pod in the UI; the instance record carries the not-listening message', notice.ok && cardSeen.ok && text.includes(PODNAME) && inst && /not listening/.test(inst.message || ''), `notice ${notice.ms} ms after the first DOWN report; instance.message="${inst && inst.message}"`)
  await page.screenshot({ path: `${SHOT}/f88-dead-app-outage.png` })
  const lines = sidecarLog().slice(n0)
  check('F-89', "log: 'health target gone; will rediscover' and one INFO 'reported' DOWN with the not-listening message", lines.some((l) => /health target gone/.test(l.msg)) && lines.filter((l) => l.msg === 'reported' && l.status === 'DOWN').length === 1 && /not listening/.test(lines.find((l) => l.msg === 'reported' && l.status === 'DOWN')?.message || ''), lines.map((l) => `${l.level} ${l.msg} ${l.status || ''} ${(l.message || '').slice(0, 50)}`).join(' | ').slice(0, 400))
  const n1 = sidecarLog().length; const tStart = Date.now(); sh('docker start e2e4-app')
  const found = await waitFor(() => sidecarLog().slice(n1).find((l) => l.msg === 'health target found'), 15000, 200)
  const ret = await waitFor(async () => { const mm = await monitor(); return mm && !mm.state.openCommunicationId && mm.state.lastStatus === 'UP' ? mm : null }, 40000, 200)
  const gone = await waitFor(async () => (await card(page, 've4-app is down').count()) === 0, 10000, 150)
  check('F-88', "app back -> 'health target found' -> UP -> notice retired, card gone", found.ok && ret.ok && gone.ok, `rediscovered ${found.ms} ms, retired ${ret.ms} ms after the start`)
}

// --------------------------------------------------------------------------- ordering (F-72, F-88, F-91 second pod, minHealthyPercent)
async function ordering() {
  console.log(`## ordering: a second pod whose sidecar starts before its app; 1 of 2 pods DOWN keeps the service UP (${stamp()})`)
  const m = await monitor()
  sh('docker rm -f e2e4-sidecar2 e2e4-app2 e2e4-netns2 2>/dev/null')
  sh('docker run -d --name e2e4-netns2 -p 127.0.0.1:19542:8080 -p 127.0.0.1:19543:9465 golang:1.24 sleep infinity')
  sh(`docker run -d --name e2e4-sidecar2 --network container:e2e4-netns2 ${RESTRICTED} ${SIDECAR_ENV('ve4-app-6d4f8b7c9-cd34e')} health-sidecar:e2e4`)
  const unknown = await waitFor(async () => { const s = await status(POD2); return s && s.lastReport && s.lastReport.status === 'UNKNOWN' ? s : null }, 15000, 200)
  const mm = await monitor()
  check('F-72', "sidecar before the app: reports UNKNOWN 'starting: waiting for the app to listen'; the service stays UP, no notice", unknown.ok && /starting/.test(unknown.value.lastReport.message) && mm.state.lastStatus === 'UP' && !mm.state.openCommunicationId, `after ${unknown.ms} ms: "${unknown.value && unknown.value.lastReport.message}" monitor=${mm.state.lastStatus} summary=${mm.state.lastSummary}`)
  await sleep(1500)
  const t0 = Date.now(); sh('docker run -d --name e2e4-app2 --network container:e2e4-netns2 fakeapp:e2e')
  const up2 = await waitFor(async () => { const s = await status(POD2); return s && s.lastReport.status === 'UP' ? s : null }, 15000, 200)
  const two = await waitFor(async () => { const x = await monitor(); return /2 of 2/.test(x.state.lastSummary || '') ? x : null }, 15000, 200)
  check('F-88', "app started after the sidecar: found and UP; rollup '2 of 2 pods UP'", up2.ok && two.ok, `UP after ${up2.ms} ms; summary=${two.value && two.value.state.lastSummary}`)
  const sent0 = (await status(POD2)).reportsSent; await appSet('DOWN', 'DOWN', POD2)
  await waitFor(async () => { const s = await status(POD2); return s && s.reportsSent >= sent0 + 2 ? s : null }, 15000, 100)
  await sleep(2500)
  const one = await monitor()
  check('F-91', "one of two pods DOWN: service still UP ('1 of 2 pods UP'), no notice (minHealthyPercent 50)", one.state.lastStatus === 'UP' && /1 of 2/.test(one.state.lastSummary || '') && !one.state.openCommunicationId, `summary=${one.state.lastSummary} open=${one.state.openCommunicationId || 'none'}`)
  await appSet('UP', 'UP', POD2)
  await waitFor(async () => { const x = await monitor(); return /2 of 2/.test(x.state.lastSummary || '') }, 20000, 200)
  const n0 = sidecarLog('e2e4-sidecar2').length
  sh('docker kill -s KILL e2e4-sidecar2'); const exitK = sh("docker inspect -f '{{.State.ExitCode}}' e2e4-sidecar2"); sh('docker start e2e4-sidecar2')
  const back = await waitFor(() => sidecarLog('e2e4-sidecar2').slice(n0).find((l) => l.msg === 'reported' && l.status === 'UP'), 15000, 200)
  const after = await monitor()
  check('F-88', 'sidecar SIGKILL + restart (liveness restart): back UP, no new notice, app unaffected', exitK !== '0' && back.ok && !after.state.openCommunicationId && after.state.lastStatus === 'UP', `kill exit=${exitK} back after ${back.ms} ms summary=${after.state.lastSummary}`)
  sh('docker stop -t 10 e2e4-sidecar2')
  const left = await waitFor(async () => (await instances(m.id)).find((i) => i.instanceId === 've4-app-6d4f8b7c9-cd34e' && i.left), 10000, 200)
  const one2 = await waitFor(async () => { const x = await monitor(); return /1 of 1/.test(x.state.lastSummary || '') ? x : null }, 10000, 200)
  check('F-48', "pod 2 leaves cleanly: left=true, rollup back to '1 of 1 pod UP', no notice", left.ok && one2.ok && !one2.value.state.openCommunicationId, `summary=${one2.value && one2.value.state.lastSummary}`)
  sh('docker rm -f e2e4-sidecar2 e2e4-app2 e2e4-netns2')
}

// ------------------------------------------------------------------------------------ silence (F-48/F-92: vanish without leaving, 90 s)
async function silence() {
  console.log(`## silence: SIGKILL sidecar and app (no leaving report) -> DOWN after the 90 s window (${stamp()})`)
  const m = await monitor(); const s0 = await status()
  const warnBefore = backendLog().filter((l) => /push-only monitors are silent at once/.test(l)).length
  const tKill = Date.now(); sh('docker kill -s KILL e2e4-sidecar'); sh('docker kill -s KILL e2e4-app')
  const lastSeen = new Date(s0.lastReport.observedAt).getTime()
  const notice = await waitFor(async () => { const mm = await monitor(); return mm && mm.state.openCommunicationId ? mm : null }, 150000, 500)
  const cardSeen = await waitFor(() => card(page, 've4-app is down').isVisible(), 10000, 200)
  const fi = notice.ok ? (await api('GET', `/v1/feed/${notice.value.state.openCommunicationId}`)).json : {}
  const sinceLast = (Date.now() - cardSeen.ms - lastSeen) / 1000
  check('F-48', 'a pod that vanished without leaving: OUTAGE after the 90 s staleness window, naming the pod', notice.ok && cardSeen.ok && (fi.body || '').includes(PODNAME) && notice.ms > 80000 && notice.ms < 130000, `notice ${(notice.ms / 1000).toFixed(1)} s after the kill (~${sinceLast.toFixed(1)} s after the last report); title="${fi.title}" body="${(fi.body || '').replace(/\s+/g, ' ').slice(0, 200)}"`)
  await page.screenshot({ path: `${SHOT}/f48-silent-pod-outage.png` })
  const inst = (await instances(m.id)).find((i) => i.instanceId === PODNAME)
  check('F-48', 'instance record: not left, lastSeenAt from before the kill', inst && inst.left === false && new Date(inst.lastSeenAt).getTime() <= tKill + 500, JSON.stringify(inst).slice(0, 200))
  const warnAfter = backendLog().filter((l) => /push-only monitors are silent at once/.test(l)).length
  check('F-48', 'the staleness valve did not pause (no "silent at once" warning)', warnAfter === warnBefore, `valve warnings before=${warnBefore} after=${warnAfter}`)
  sh('docker start e2e4-app'); sh('docker start e2e4-sidecar')
  const ret = await waitFor(async () => { const mm = await monitor(); return mm && !mm.state.openCommunicationId && mm.state.lastStatus === 'UP' ? mm : null }, 40000, 300)
  const gone = await waitFor(async () => (await card(page, 've4-app is down').count()) === 0, 10000, 200)
  check('F-48', 'pod back -> UP -> notice retired, card gone', ret.ok && gone.ok, `retired ${(ret.ms / 1000).toFixed(1)} s after the start`)
}

// ---------------------------------------------------------------------- capture (F-75 wire, F-74 slow/400/500 paths, F-92)
async function capture() {
  console.log(`## capture: the sidecar's wire contract through a recording stub, then the slow / permanent-4xx / 5xx paths (${stamp()})`)
  const file = `${OUT}/capture-requests.jsonl`; fs.writeFileSync(file, '')
  const srv = spawn('node', [`${S}/scripts/capture.js`, '19560', file], { stdio: ['ignore', fs.openSync(`${OUT}/capture-server.txt`, 'a'), fs.openSync(`${OUT}/capture-server.txt`, 'a')], detached: true }); srv.unref()
  await sleep(700)
  const mode = async (m) => fetch('http://127.0.0.1:19560/__mode', { method: 'POST', body: JSON.stringify({ mode: m }) })
  sh('docker rm -f e2e4-sidecar3 2>/dev/null')
  sh(`docker run -d --name e2e4-sidecar3 --network container:e2e4-netns ${RESTRICTED} -e CS_ENDPOINT=http://172.17.0.1:19560 -e CS_TENANT=ve4cap -e CS_SERVICE=ve4-cap -e CS_CLIENT_ID=ve4-cap-repo -e CS_LISTEN=:9466 -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_RETRY_DELAY=500ms -e CS_REPORT_TIMEOUT=1s -e CS_VERSION=3.0.0 -e POD_NAME=ve4-cap-0 -e POD_NAMESPACE=cap-ns -e NODE_NAME=node-c -e CS_CLUSTER=cl health-sidecar:e2e4`)
  const got = await waitFor(() => { const l = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean); return l.length >= 1 ? JSON.parse(l[0]) : null }, 15000, 200)
  const r = got.value || {}; const h = r.headers || {}; let body = {}; try { body = JSON.parse(r.body) } catch {}
  check('F-75', 'wire: POST /v1/health/reports, Content-Type/Accept application/json, X-Client-Id = CS_CLIENT_ID, User-Agent health-sidecar/<version>', r.method === 'POST' && r.url === '/v1/health/reports' && /application\/json/.test(h['content-type']) && /application\/json/.test(h.accept) && h['x-client-id'] === 've4-cap-repo' && h['user-agent'] === 'health-sidecar/e2e4', JSON.stringify({ method: r.method, url: r.url, ct: h['content-type'], accept: h.accept, cid: h['x-client-id'], ua: h['user-agent'] }))
  const inst = body.instance || {}
  check('F-75', 'wire body: tenantId, service, status, components, observedAt (UTC ms), publisher health-sidecar, instance{id, namespace, node, cluster, version, sidecar}, no leaving', body.tenantId === 've4cap' && body.service === 've4-cap' && body.status === 'UP' && body.components && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(body.observedAt) && body.publisher === 'health-sidecar' && inst.id === 've4-cap-0' && inst.namespace === 'cap-ns' && inst.node === 'node-c' && inst.cluster === 'cl' && inst.version === '3.0.0' && inst.sidecar === 'e2e4' && inst.leaving === undefined, r.body && r.body.slice(0, 400))
  const replay = await fetch(`${A}/v1/health/reports`, { method: 'POST', headers: { 'content-type': h['content-type'], accept: h.accept, 'x-client-id': h['x-client-id'], 'user-agent': h['user-agent'] }, body: r.body })
  const rj = await replay.json().catch(() => ({}))
  check('F-75', 'the captured request replayed verbatim to the real backend -> 202 (monitor ve4cap/ve4-cap, instance ve4-cap-0)', replay.status === 202 && rj.service === 've4-cap', `${replay.status} ${JSON.stringify(rj.state || {}).slice(0, 120)}`)
  const long = (n) => ({ ...body, instance: { ...inst, id: 'p'.repeat(n) } })
  const ok253 = await api('POST', '/v1/health/reports', long(253), { 'X-Client-Id': 've4-cap-repo' }); const bad254 = await api('POST', '/v1/health/reports', long(254), { 'X-Client-Id': 've4-cap-repo' })
  check('F-75', 'instance id 253 chars -> 202, 254 -> 400 naming the field', ok253.status === 202 && bad254.status === 400 && /instance|id/.test(bad254.text), `${ok253.status} / ${bad254.status} ${bad254.text.slice(0, 160)}`)
  // slow backend: CS_REPORT_TIMEOUT=1s must fire and the sidecar backs off (F-92 "slow backend")
  const n0 = sidecarLog('e2e4-sidecar3').length; await mode('slow'); const tSlow = Date.now()
  const slow = await waitFor(() => sidecarLog('e2e4-sidecar3').slice(n0).find((l) => l.msg === 'report failed; will retry' && /deadline|Timeout|timeout/i.test(l.error || '')), 15000, 200)
  check('F-92', "slow backend: CS_REPORT_TIMEOUT (1 s) fires -> 'report failed; will retry' with the deadline error and a backoff", slow.ok && slow.value.in, `after ${slow.ms} ms: error="${(slow.value && slow.value.error || '').slice(0, 120)}" in=${slow.value && slow.value.in}`)
  await mode('ok'); await sleep(4500)
  const recovered = sidecarLog('e2e4-sidecar3').slice(n0).filter((l) => l.msg === 'reported' || (l.msg === 'report failed; will retry'))
  // permanent 4xx: logged as rejected, not retried before the heartbeat
  const n1 = sidecarLog('e2e4-sidecar3').length; const reqBefore = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length; await mode('400'); const t400 = Date.now()
  const rej = await waitFor(() => sidecarLog('e2e4-sidecar3').slice(n1).find((l) => l.msg === 'report rejected'), 15000, 200)
  const tRej = Date.now()
  await sleep(3000)
  const reqsAfter3s = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => new Date(x.at).getTime() > tRej)
  check('F-74', "permanent 4xx: ERROR 'report rejected', no retry within 3 s (next send at the 4 s heartbeat), no backoff state", rej.ok && rej.value.level === 'ERROR' && reqsAfter3s.length === 0, `rejected after ${rej.ms} ms error="${(rej.value && rej.value.error || '').slice(0, 100)}"; requests in the 3 s after: ${reqsAfter3s.length}`)
  const n2 = sidecarLog('e2e4-sidecar3').length; await mode('500')
  const b1 = await waitFor(() => { const l = sidecarLog('e2e4-sidecar3').slice(n2).filter((x) => x.msg === 'report failed; will retry'); return l.length >= 2 ? l : null }, 20000, 200)
  check('F-74', "5xx: 'report failed; will retry' with exponential backoff (in 1s, then 2s)", b1.ok && b1.value[0].in === '1s' && b1.value[1].in === '2s', b1.value ? b1.value.map((l) => `${l.in}:${(l.error || '').slice(0, 40)}`).join(' | ') : 'none')
  await mode('ok')
  const okAgain = await waitFor(() => sidecarLog('e2e4-sidecar3').slice(n2).find((x) => x.msg === 'reported' || x.msg === 'report delivered again'), 15000, 200)
  const again = sidecarLog('e2e4-sidecar3').slice(n2).filter((x) => x.msg === 'report delivered again')
  check('F-74', 'backend healthy again -> the retry succeeds, backoff cleared', okAgain.ok || again.length > 0, `reported ${okAgain.ms} ms after the stub recovered`)
  check('F-89', "G-4-25: the first report accepted after failed sends is logged once at INFO 'report delivered again' with failedAttempts and failingFor", again.length === 1 && again[0].level === 'INFO' && again[0].failedAttempts >= 2 && /s$/.test(again[0].failingFor || ''), JSON.stringify(again).slice(0, 300))
  sh('docker rm -f e2e4-sidecar3'); try { process.kill(-srv.pid) } catch {} try { process.kill(srv.pid) } catch {}
  // a sidecar whose body the real backend rejects (254-char instance id): the permanent path against the real service
  sh('docker rm -f e2e4-sidecar4 2>/dev/null')
  sh(`docker run -d --name e2e4-sidecar4 --network container:e2e4-netns ${RESTRICTED} -e CS_ENDPOINT=http://172.17.0.1:19501 -e CS_TENANT=ve4bad -e CS_SERVICE=ve4-bad -e CS_CLIENT_ID=ve4-bad-repo -e CS_LISTEN=:9467 -e CS_INTERVAL=2s -e CS_HEARTBEAT=4s -e CS_INSTANCE_ID=${'q'.repeat(254)} health-sidecar:e2e4`)
  const rej2 = await waitFor(() => sidecarLog('e2e4-sidecar4').find((l) => l.msg === 'report rejected'), 15000, 200)
  check('F-92', "bad input from the sidecar: the real backend's 400 is logged as 'report rejected' (permanent), the message names the problem", rej2.ok && /400/.test(rej2.value.error || '') && /instance|id|253/.test(rej2.value.error || ''), `error="${(rej2.value && rej2.value.error || '').slice(0, 200)}"`)
  sh('docker rm -f e2e4-sidecar4')
  const mons = (await api('GET', '/v1/health/monitors?tenantId=ve4cap')).json || []
  for (const mo of mons) await api('DELETE', `/v1/health/monitors/${mo.id}`)
  const mons2 = (await api('GET', '/v1/health/monitors?tenantId=ve4bad')).json || []
  for (const mo of mons2) await api('DELETE', `/v1/health/monitors/${mo.id}`)
}

// ------------------------------------------------------------------------------------------- pull (F-37/39/40 through the UI)
async function pull() {
  console.log(`## pull: a URL monitor against a stub flipping UP / DEGRADED / DOWN (${stamp()})`)
  await fetch('http://127.0.0.1:19551/__set?status=UP&db=UP', { method: 'POST' })
  const reg = await api('POST', '/v1/health/monitors', { tenantId: 've4', service: 'pull-svc', url: 'http://127.0.0.1:19551/actuator/health', intervalSeconds: 5, timeoutMs: 1000, publisher: 've4-monitor' })
  check('F-91', 'register a pull monitor -> 201 with the policy echoed', reg.status === 201 && reg.json.policy.intervalSeconds === 5 && reg.json.policy.publisher === 've4-monitor', `${reg.status} ${JSON.stringify(reg.json.policy || {}).slice(0, 160)}`)
  const mid = reg.json.id
  const mon = async () => (await api('GET', `/v1/health/monitors/${mid}`)).json
  const up = await waitFor(async () => { const x = await mon(); return x.state.lastStatus === 'UP' && x.state.lastProbeAt ? x : null }, 15000, 300)
  check('F-91', 'first probe -> UP with lastProbeAt', up.ok, `after ${up.ms} ms summary=${up.value && up.value.state.lastSummary}`)
  await fetch('http://127.0.0.1:19551/__set?status=UP&db=DOWN', { method: 'POST' }); const t1 = Date.now()
  const deg = await waitFor(async () => { const x = await mon(); return x.state.openCommunicationId && x.state.lastStatus === 'DEGRADED' ? x : null }, 30000, 300)
  const degCard = await waitFor(() => card(page, 'pull-svc is degraded').isVisible(), 10000, 200)
  const degText = degCard.ok ? (await card(page, 'pull-svc is degraded').innerText()).replace(/\s+/g, ' ') : ''
  check('F-91', "stub UP with db DOWN -> DEGRADED after 2 probes -> HEALTH notice 'pull-svc is degraded' (Minor) in the UI naming db", deg.ok && degCard.ok && /Health/.test(degText) && /Minor/.test(degText) && /db/.test(degText), `notice ${deg.ms} ms after the flip; ${degText.slice(0, 200)}`)
  const degId = deg.value && deg.value.state.openCommunicationId
  await fetch('http://127.0.0.1:19551/__set?status=DOWN&db=DOWN', { method: 'POST' }); const t2 = Date.now()
  const dn = await waitFor(async () => { const x = await mon(); return x.state.openCommunicationId && x.state.openCommunicationId !== degId && x.state.lastStatus === 'DOWN' ? x : null }, 30000, 300)
  const dnCard = await waitFor(() => card(page, 'pull-svc is down').isVisible(), 10000, 200)
  const degGone = await waitFor(async () => (await card(page, 'pull-svc is degraded').count()) === 0, 10000, 200)
  const oldDeg = degId ? (await api('GET', `/v1/feed/${degId}`)).json : {}
  check('F-91', "stub DOWN -> the streak restarts -> OUTAGE 'pull-svc is down' replaces the HEALTH notice (which is retired)", dn.ok && dnCard.ok && degGone.ok && oldDeg.status === 'RETIRED', `outage ${dn.ms} ms after the flip; previous notice ${oldDeg.status}`)
  await page.screenshot({ path: `${SHOT}/f91-pull-outage-in-ui.png` })
  const probe = await api('POST', `/v1/health/monitors/${mid}/probe`)
  check('F-91', 'POST /probe applies a probe at once (200, lastProbeAt advances)', probe.status === 200 && probe.json.state.lastProbeAt > dn.value.state.lastProbeAt, `${probe.status} ${probe.json.state && probe.json.state.lastProbeAt}`)
  await fetch('http://127.0.0.1:19551/__set?status=UP&db=UP', { method: 'POST' }); const t3 = Date.now()
  const rec = await waitFor(async () => { const x = await mon(); return !x.state.openCommunicationId && x.state.lastStatus === 'UP' ? x : null }, 30000, 300)
  const dnGone = await waitFor(async () => (await card(page, 'pull-svc is down').count()) === 0, 10000, 200)
  check('F-91', 'stub UP -> recovered after 2 probes -> notice retired, card gone', rec.ok && dnGone.ok, `retired ${rec.ms} ms after the flip`)
  const del = await api('DELETE', `/v1/health/monitors/${mid}`)
  check('F-91', 'DELETE the monitor -> 204', del.status === 204, `${del.status}`)
}

// ------------------------------------------------------------------------------------------------------ logs (F-89)
async function logs() {
  console.log(`## logs: JSON slog from the sidecar, INFO lines from the backend (${stamp()})`)
  const raw = sh('docker logs e2e4-sidecar 2>&1').split('\n').filter(Boolean)
  const parsed = raw.map((l) => { try { return JSON.parse(l) } catch { return null } })
  const bad = raw.filter((_, i) => !parsed[i])
  const msgs = new Set(parsed.filter(Boolean).map((l) => l.msg))
  const start = parsed.find((l) => l && l.msg === 'health sidecar starting') || {}
  check('F-89', 'every sidecar log line is JSON; start line names version/service/tenant/instance/endpoint', bad.length === 0 && start.version === 'e2e4' && start.service === 've4-app' && start.tenant === 've4' && start.instance === PODNAME && start.endpoint, `lines=${raw.length} non-json=${bad.length} start=${JSON.stringify(start).slice(0, 200)}`)
  const want = ['health sidecar starting', 'health target found', 'reported', 'leaving report sent', 'health target gone; will rediscover']
  check('F-89', "sidecar messages present: starting, target found, reported, leaving report sent, target gone", want.every((w) => msgs.has(w)), `msgs=${[...msgs].join(' | ')}`)
  const levels = parsed.filter(Boolean).reduce((a, l) => ((a[l.level] = (a[l.level] || 0) + 1), a), {})
  check('F-89', 'no DEBUG noise at the default level; WARN only for send failures', !levels.DEBUG && parsed.filter((l) => l && l.level === 'WARN').every((l) => /report failed|leaving report failed/.test(l.msg)), JSON.stringify(levels))
  fs.writeFileSync(`${OUT}/e2e4-sidecar-log.txt`, raw.join('\n'))
  const bl = backendLog()
  const access = bl.filter((l) => /client=ve4-app-repo POST \/v1\/health\/reports -> 202/.test(l))
  const rejected = bl.filter((l) => / -> 40[01] /.test(l) && /client=/.test(l)).length
  const opened = bl.filter((l) => /opened (OUTAGE|HEALTH)/.test(l)).length, retired = bl.filter((l) => /retired notice/.test(l)).length
  const errors = bl.filter((l) => / ERROR /.test(l)), traces = bl.filter((l) => /^\s+at [\w.$]+\(/.test(l)).length
  const warns = bl.filter((l) => / WARN /.test(l)).map((l) => l.replace(/^.*WARN \d+ --- \[[^\]]*\] \[[^\]]*\] \S+\s+: /, '').slice(0, 90))
  const warnKinds = [...new Set(warns.map((w) => w.replace(/[0-9a-f-]{36}|\d+/g, '#')))]
  check('F-89', 'backend: INFO access log per identified request (sidecar POSTs), notice open/retire at INFO, no ERROR with stack traces', access.length > 5 && opened >= 3 && retired >= 3 && errors.length === 0 && traces === 0, `sidecar access lines=${access.length} opened=${opened} retired=${retired} ERROR=${errors.length} stacktrace-lines=${traces} WARN kinds=${warnKinds.join(' || ').slice(0, 300)}`)
  check('F-89', 'no secrets or Mongo URIs with credentials in the logs', !bl.some((l) => /mongodb:\/\/[^@\s]+@/.test(l)) && !raw.some((l) => /password|secret/i.test(l)), '')
}

const SCEN = { down, degraded, words, unknownpod, sigterm, deadapp, ordering, silence, capture, pull, logs }
async function main() {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCEN)
  browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); page = await ctx.newPage()
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/409|ERR_ABORTED|Failed to load resource/.test(m.text())) pageErrors.push(m.text()) })
  await openFeed(page, 've4')
  for (const n of names) { try { await SCEN[n]() } catch (e) { check('RUN', `scenario ${n} crashed`, false, (e.stack || String(e)).slice(0, 400)) } }
  check('F-91', 'no page errors / console errors in the UI during the pod flows', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || '))
  await browser.close()
  const fails = results.filter((r) => !r[2]).length
  console.log(`## summary: ${results.length - fails} pass, ${fails} fail at ${stamp()}`)
  process.exit(Math.min(99, fails))
}
main().catch((e) => { console.log('FAIL RUN script crashed :: ' + (e.stack || e)); process.exit(98) })
