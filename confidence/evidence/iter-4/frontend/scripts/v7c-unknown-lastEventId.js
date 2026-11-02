// F-92 / F-20, corrected split of the last v7 check (whose "expired (1)" premise was wrong: the shared log still retains seq 1,
// TTL 86400 s, see results/shared-log-retention.txt, so ?lastEventId=1 is a legitimate replay). Here: ids never issued by the
// shared log, as ?lastEventId= and as the Last-Event-ID header, must get a fresh snapshot first; true expiry is v7b (private DB).
const L = require('./lib')
const { record, api, publishBody } = L
L.setFile('v7c-unknown-lastEventId')
;(async () => {
  const tenant = `vf4-lei-${Date.now().toString(36)}`
  await api('POST', '/v1/communications', publishBody(tenant, { title: 'snapshot fallback seed' }))
  await L.wait(1500) // let the live tail pass the seed's created event, so the frames below are the stream's own answer
  const read = async (p, headers = {}) => new Promise((resolve) => { const ctl = new AbortController(); const chunks = []; fetch(`${L.API}${p}`, { headers: { 'X-Client-Id': L.CLIENT, ...headers }, signal: ctl.signal }).then(async (r) => { const reader = r.body.getReader(); const dec = new TextDecoder(); const t = setTimeout(() => ctl.abort(), 2500); try { while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(dec.decode(value)) } } catch {} clearTimeout(t); resolve({ status: r.status, body: chunks.join('') }) }).catch((e) => resolve({ status: 0, body: String(e) })) })
  const names = (b) => [...b.matchAll(/^event: ?(\w+)$/gm)].map((m) => m[1])
  const head = await read(`/v1/feed/stream?tenantId=${tenant}`)
  const q = await read(`/v1/feed/stream?tenantId=${tenant}&lastEventId=999999999`)
  const h = await read(`/v1/feed/stream?tenantId=${tenant}`, { 'Last-Event-ID': '999999999' })
  record('F-92', 'an id never issued by the log (999999999), as ?lastEventId= or as the Last-Event-ID header → 200 and a fresh snapshot first (the fallback the client relies on), same frames as a fresh subscription', q.status === 200 && names(q.body)[0] === 'snapshot' && h.status === 200 && names(h.body)[0] === 'snapshot' && JSON.stringify(names(q.body)) === JSON.stringify(names(head.body)), { fresh: names(head.body), query: names(q.body), header: names(h.body) })
  L.flush()
})().catch((e) => { console.error('SCRIPT ERROR', e); L.flush(); process.exit(1) })
