// Does the Vite dev proxy end the client's SSE response when the upstream backend dies? (plain Node http client through :3000 → :8080 is shared, so use :3011 → aux backend; but that backend is being restarted by t4c; use the shared stack read-only with a probe tenant instead and observe only the open/close semantics on a *different* path: here we only time how long the proxied SSE stays open after the aux backend is killed by t4c.)
const http = require('http')
const PORT = require('fs').readFileSync(__dirname + '/aux-port.txt', 'utf8').trim()
const t0 = Date.now(); const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`
const req = http.get({ host: '127.0.0.1', port: 3011, path: '/v1/feed/stream?tenantId=fe-proxyprobe&clientId=fe-verifier', headers: { Accept: 'text/event-stream' } }, (res) => {
  console.log(stamp(), 'proxied SSE response', res.statusCode)
  res.on('data', (d) => console.log(stamp(), 'data', JSON.stringify(d.toString().slice(0, 60))))
  res.on('end', () => { console.log(stamp(), 'proxied SSE ENDED by proxy'); process.exit(0) })
  res.on('close', () => { console.log(stamp(), 'proxied SSE CLOSED'); process.exit(0) })
})
req.on('error', (e) => { console.log(stamp(), 'error', e.message); process.exit(0) })
setInterval(async () => { try { const r = await fetch(`http://127.0.0.1:${PORT}/v1/feed?tenantId=x`, { headers: { 'X-Client-Id': 'fe-verifier' } }); console.log(stamp(), 'backend GET', r.status) } catch (e) { console.log(stamp(), 'backend GET failed:', e.cause ? e.cause.code : e.message) } }, 3000)
setTimeout(() => { console.log(stamp(), 'giving up after 70 s: proxied SSE never closed'); process.exit(0) }, 70000)
