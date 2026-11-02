// Minimal production-shaped front: static files of the built UI + a reverse proxy for /v1 to the backend.
// Unlike Vite's dev proxy it ends the browser's response when the upstream stream closes (what nginx/HAProxy/an
// OpenShift Route do). HOLD=1: while the backend is unreachable, keep /v1 requests pending (retrying the upstream
// connect every 500 ms, up to HOLD_MS) instead of answering 502 at once.
//   node rp.js <listenPort> <backendPort> <distDir>
const http = require('http'), fs = require('fs'), path = require('path')
const [LISTEN, BACKEND, DIST] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]]
const HOLD = process.env.HOLD === '1', HOLD_MS = Number(process.env.HOLD_MS || 45000)
const T0 = Date.now(); const stamp = () => `+${((Date.now() - T0) / 1000).toFixed(1)}s`
const log = (m) => process.stdout.write(`${stamp()} ${m}\n`)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || !path.extname(p)) p = '/index.html'
  const f = path.join(DIST, p); if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404).end('not found'); return }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res)
}
function proxy(req, res, body, started = Date.now()) {
  const isStream = req.url.includes('/v1/feed/stream')
  const up = http.request({ host: '127.0.0.1', port: BACKEND, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${BACKEND}` } }, (ur) => {
    if (isStream) log(`stream ${req.url.slice(0, 60)}… last-event-id=${req.headers['last-event-id'] ?? '(none)'} → upstream ${ur.statusCode}`)
    res.writeHead(ur.statusCode, ur.headers); ur.pipe(res)
    const end = (why) => { if (!res.writableEnded) { if (isStream) log(`upstream stream ${why} → ending the browser's response`); res.end() } }
    ur.on('end', () => end('ended')); ur.on('aborted', () => end('aborted')); ur.on('close', () => end('closed')); ur.on('error', (e) => end('error ' + e.code))
  })
  up.on('error', (e) => {
    if (HOLD && Date.now() - started < HOLD_MS && e.code === 'ECONNREFUSED') { if (isStream) log(`stream request held: backend refused (${e.code}); retrying in 500 ms (last-event-id=${req.headers['last-event-id'] ?? '(none)'})`); return setTimeout(() => proxy(req, res, body, started), 500) }
    log(`${req.method} ${req.url.slice(0, 60)} → 502 (${e.code})`); if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('bad gateway')
  })
  // the browser went away (tab closed, EventSource.close()): drop the upstream stream too. (`res`, not `req`: a body-less GET's req closes at once)
  res.on('close', () => { if (isStream && !res.writableEnded) up.destroy() })
  up.end(body)
}
http.createServer((req, res) => {
  if (!req.url.startsWith('/v1/')) return serveStatic(req, res)
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => proxy(req, res, Buffer.concat(chunks)))
}).listen(LISTEN, '127.0.0.1', () => log(`front on http://127.0.0.1:${LISTEN} → backend :${BACKEND}, HOLD=${HOLD}`))
