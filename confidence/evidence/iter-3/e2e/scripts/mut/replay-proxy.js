// Mutation harness for G-3-12 (verifier-only, never part of the repository): an HTTP proxy between the suite's
// Vite preview (COMM_BACKEND) and the compose backend. mode "pass" forwards everything untouched (the control);
// mode "strip" removes ?lastEventId= and the Last-Event-ID header from /v1/feed/stream requests, which is what a
// backend that does not replay looks like from the page: every resume gets a fresh snapshot instead of the missed events.
const http = require('http')
const [port, mode] = [Number(process.argv[2] || 19590), process.argv[3] || 'pass']
const UP = { host: '127.0.0.1', port: 28080 }
let n = 0
http.createServer((req, res) => {
  let path = req.url
  const headers = { ...req.headers, host: `${UP.host}:${UP.port}` }
  const stream = path.startsWith('/v1/feed/stream')
  if (mode === 'strip' && stream) {
    const u = new URL(path, 'http://x'); const had = u.searchParams.get('lastEventId') || headers['last-event-id']
    u.searchParams.delete('lastEventId'); delete headers['last-event-id']; path = u.pathname + u.search
    if (had) console.log(`${new Date().toISOString()} #${++n} stripped last id ${had} from ${req.url.slice(0, 90)}`)
  }
  const up = http.request({ ...UP, method: req.method, path, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers)
    r.pipe(res)
    r.on('aborted', () => res.destroy()); r.on('error', () => res.destroy())
    r.on('close', () => { if (!r.complete) res.destroy() })
  })
  up.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end() } else res.destroy() })
  req.pipe(up)
  res.on('close', () => up.destroy())
}).listen(port, '127.0.0.1', () => console.log(`replay proxy (${mode}) :${port} -> ${UP.host}:${UP.port}`))
