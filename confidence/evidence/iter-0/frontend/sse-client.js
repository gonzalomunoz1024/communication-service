// timestamped SSE client: node sse-client.js <url> <seconds>
const http = require('http')
const [url, secs] = [process.argv[2], Number(process.argv[3] || 40)]
const t0 = Date.now(); const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`
const u = new URL(url)
const req = http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Accept: 'text/event-stream', 'X-Client-Id': 'fe-verifier' } }, (res) => {
  console.log(stamp(), 'response', res.statusCode)
  res.on('data', (d) => console.log(stamp(), 'data', JSON.stringify(d.toString().replace(/\n/g, '\\n').slice(0, 70))))
  res.on('end', () => { console.log(stamp(), 'stream ENDED (server closed it)'); process.exit(0) })
})
req.on('error', (e) => { console.log(stamp(), 'error', e.message); process.exit(0) })
setTimeout(() => { console.log(stamp(), `still open after ${secs}s`); process.exit(0) }, secs * 1000)
