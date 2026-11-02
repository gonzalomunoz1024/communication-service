// E2E verifier (iteration 4): G-4-4 / G-2-7 across two nodes. A pull monitor on a slow target (3 s answers, interval 5 s,
// timeout 5 s) while backends A and B both run the health sweep every second; on-demand probes are forced on A and B.
// node forced_probes.js -> PASS/FAIL lines; exit code = number of FAILs
const http = require('http')
const A = 'http://127.0.0.1:19501', B = 'http://127.0.0.1:19502'
const PORT = 19552, DELAY = 3000
const RUN = Date.now().toString(36)
const results = []
const stamp = () => new Date().toISOString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function check(id, name, cond, detail = '') { results.push([id, name, !!cond]); console.log(`${stamp()} ${cond ? 'PASS' : 'FAIL'} ${id} ${name} :: ${String(detail).slice(0, 1200)}`) }
async function api(base, method, path, body) {
  const t0 = Date.now()
  const res = await fetch(base + path, { method, headers: { 'X-Client-Id': 've4-forced', Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) })
  const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text, ms: Date.now() - t0 }
}
// the slow target: every GET answers UP after DELAY ms and is counted
const hits = []
const server = http.createServer((req, res) => {
  hits.push(Date.now())
  setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'UP', components: { db: { status: 'UP' } } })) }, DELAY)
})
async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  console.log(`## forced probes on two sweeping nodes, run ${RUN} (${stamp()})`)
  const reg = await api(A, 'POST', '/v1/health/monitors', { tenantId: 've4-forced', service: `slow-${RUN}`, url: `http://127.0.0.1:${PORT}/actuator/health`, intervalSeconds: 5, timeoutMs: 5000 })
  check('F-91', 'register a pull monitor on a 3 s target (interval 5 s, timeout 5 s) -> 201', reg.status === 201, `${reg.status} ${reg.text.slice(0, 160)}`)
  const id = reg.json.id
  const first = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 20000) { const m = await api(B, 'GET', `/v1/health/monitors/${id}`); if (m.json && m.json.state.lastProbeAt) return m.json; await sleep(300) } return null })()
  check('F-91', 'the sweeps probe it (B reads lastProbeAt set)', !!first, first ? `lastStatus=${first.state.lastStatus} lastProbeAt=${first.state.lastProbeAt}` : 'never probed')
  // sequential: alternate A and B, 12 forced probes, each awaited, while both nodes sweep every second
  const seq = []
  for (let i = 0; i < 12; i++) {
    const node = i % 2 === 0 ? A : B
    const h0 = hits.length
    const r = await api(node, 'POST', `/v1/health/monitors/${id}/probe`)
    seq.push({ node: node === A ? 'A' : 'B', status: r.status, ms: r.ms, targetHits: hits.length - h0, err: r.status !== 200 ? r.text.slice(0, 100) : undefined })
  }
  const ok = seq.filter((x) => x.status === 200).length
  check('F-91', 'G-4-4: 12 on-demand probes forced alternately on A and B while both sweep every second -> 12/12 answered 200 (iteration 3: 0/30 on one node)', ok === 12, `200 x${ok}; ${seq.map((x) => `${x.node}:${x.status}/${x.ms}ms/hits+${x.targetHits}${x.err ? ` ${x.err}` : ''}`).join(' ')}`)
  check('F-91', 'G-4-4: a forced probe takes one target round trip (about 3 s), not one per retry', seq.every((x) => x.status !== 200 || x.ms < 3000 + 2500), `durations ms: ${seq.map((x) => x.ms).join(',')}`)
  // parallel: A and B forced at the same instant, 5 rounds
  const par = []
  for (let i = 0; i < 5; i++) {
    const [ra, rb] = await Promise.all([api(A, 'POST', `/v1/health/monitors/${id}/probe`), api(B, 'POST', `/v1/health/monitors/${id}/probe`)])
    par.push(`A:${ra.status}/${ra.ms}ms${ra.status !== 200 ? `(${ra.text.slice(0, 60)})` : ''} B:${rb.status}/${rb.ms}ms${rb.status !== 200 ? `(${rb.text.slice(0, 60)})` : ''}`)
  }
  const par200 = par.join(' ').match(/:200\//g) || []
  check('F-91', 'G-4-4: A and B forced at the same instant (5 rounds, 10 probes) while both sweep -> all 200 (a 409 would be the documented persistent conflict)', par200.length === 10, par.join(' | '))
  const after = await api(A, 'GET', `/v1/health/monitors/${id}`)
  check('F-91', 'the monitor is still UP with no notice, probed by sweeps and forced probes alike', after.json && after.json.state.lastStatus === 'UP' && !after.json.state.openCommunicationId, `state=${JSON.stringify(after.json && after.json.state).slice(0, 300)}; target GETs in total=${hits.length}`)
  const del = await api(A, 'DELETE', `/v1/health/monitors/${id}`)
  check('F-91', 'DELETE the monitor -> 204', del.status === 204, `${del.status}`)
  server.close()
  const fails = results.filter((r) => !r[2]).length
  console.log(`## summary: ${results.length - fails} pass, ${fails} fail at ${stamp()}`)
  process.exit(Math.min(99, fails))
}
main().catch((e) => { console.log('FAIL RUN script crashed :: ' + (e.stack || e)); process.exit(98) })
