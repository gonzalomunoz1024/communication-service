// A stub communication-service for the sidecar's wire contract: records every request (headers + body) to a JSONL
// file and answers per mode: ok -> 202 {}, slow -> never answers (CS_REPORT_TIMEOUT path), 400 -> 400 {error}
// (permanent rejection path), 500 -> 500 {error} (backoff path). POST /__mode {"mode":"..."} switches.
const http = require('http'); const fs = require('fs');
const PORT = Number(process.argv[2] || 19560); const FILE = process.argv[3] || '/tmp/capture-requests.jsonl';
let mode = 'ok'; let n = 0;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url === '/__mode') { try { mode = JSON.parse(body).mode; } catch {} res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ mode })); }
    n += 1;
    const rec = { n, at: new Date().toISOString(), mode, method: req.method, url: req.url, headers: req.headers, body };
    fs.appendFileSync(FILE, JSON.stringify(rec) + '\n');
    if (mode === 'slow') return; // hold the socket open: the sidecar's CS_REPORT_TIMEOUT must fire
    const code = mode === '400' ? 400 : mode === '500' ? 500 : 202;
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(code === 202 ? JSON.stringify({ id: 'stub', state: { lastStatus: 'UP' } }) : JSON.stringify({ error: `stub says ${code}` }));
  });
}).listen(PORT, '0.0.0.0', () => console.log(`capture stub on :${PORT} -> ${FILE}`));
