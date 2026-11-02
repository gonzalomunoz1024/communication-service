#!/usr/bin/env python3
"""E2E Integration Verifier, iteration 1: end-to-end checks for the behaviours that changed in iteration 1
(G-1-4 first byte, G-1-8 probes, G-1-5 operator-retired auto notice, G-1-20 409 after expiresAt, G-1-21 error
bodies, G-1-22 access log) against private backends A (19501) / B (19502) and the Vite proxy (3501). Stdlib only.
Prints one line per check: <F-id> <PASS|FAIL> <check> :: <detail>. Exit code = number of FAILs."""
import json, sys, time, uuid, http.client, subprocess, datetime, re

A, B, UI = "127.0.0.1:19501", "127.0.0.1:19502", "127.0.0.1:3501"
CID = "e2e1-verifier"
RUN = uuid.uuid4().hex[:6]
LOG_A = "/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/e2e1/backendA.log"
RESULTS = []

def now_iso(delta_s=0):
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=delta_s)).isoformat().replace("+00:00", "Z")

def req(host, method, path, body=None, headers=None, client_id=CID, timeout=15, raw_body=None):
    h = {"Accept": "application/json"}
    if client_id is not None:
        h["X-Client-Id"] = client_id
    data = None
    if body is not None:
        h["Content-Type"] = "application/json"; data = json.dumps(body).encode()
    if raw_body is not None:
        data = raw_body
    if headers:
        h.update(headers)
    c = http.client.HTTPConnection(host, timeout=timeout)
    c.request(method, path, body=data, headers=h)
    r = c.getresponse(); raw = r.read()
    hdrs = {k.lower(): v for k, v in r.getheaders()}
    try:
        parsed = json.loads(raw) if raw else None
    except Exception:
        parsed = raw.decode(errors="replace")
    c.close()
    return r.status, hdrs, parsed

def check(fid, name, ok, detail=""):
    RESULTS.append((fid, name, bool(ok), detail))
    print(f"{fid} {'PASS' if ok else 'FAIL'} {name} :: {detail}"[:700], flush=True)
    return ok

def curl(args, timeout=10):
    p = subprocess.run(["curl", "-sS", *args], capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr.strip()

# ---------------------------------------------------------------- G-1-4: first byte on an empty tenant
def first_byte():
    t = f"e2e1-empty-{RUN}"
    cases = [
        ("A direct, X-Client-Id header", f"http://{A}/v1/feed/stream?tenantId={t}", ["-H", f"X-Client-Id: {CID}"]),
        ("A direct, ?clientId=", f"http://{A}/v1/feed/stream?tenantId={t}&clientId={CID}", []),
        ("B direct, header", f"http://{B}/v1/feed/stream?tenantId={t}", ["-H", f"X-Client-Id: {CID}"]),
        ("Vite dev proxy :3501, ?clientId= (what the browser does)", f"http://{UI}/v1/feed/stream?tenantId={t}&clientId={CID}", []),
    ]
    for name, url, extra in cases:
        rc, out, err = curl(["-N", "-o", "/dev/null", "-m", "3", "-H", "Accept: text/event-stream", *extra, "-w", "%{http_code} %{content_type} %{time_starttransfer}", url])
        m = re.match(r"(\d+) (\S*) ([\d.]+)", out.strip())
        code, ctype, ttfb = (m.group(1), m.group(2), float(m.group(3))) if m else ("?", "?", 99.0)
        check("F-18", f"empty tenant: status+headers+first byte within 1 s via {name}", code == "200" and ttfb < 1.0 and "text/event-stream" in ctype, f"http={code} content-type={ctype} time_starttransfer={ttfb:.4f}s (curl rc={rc}: 28 = our own 3 s cut)")
    rc, out, err = curl(["-N", "-m", "1.5", "-H", f"X-Client-Id: {CID}", "-H", "Accept: text/event-stream", f"http://{A}/v1/feed/stream?tenantId={t}"])
    check("F-18", "the first bytes of the stream are the ':connected' comment", out.startswith(":connected"), repr(out[:60]))
    # a non-empty tenant still begins with the comment, then the snapshot
    st, h, c = req(A, "POST", "/v1/communications", {"tenantId": f"{t}-full", "publisher": "e2e1-sre", "type": "OUTAGE", "severity": "MAJOR", "title": f"e2e1 {RUN} item"})
    rc, out, err = curl(["-N", "-m", "1.5", "-H", f"X-Client-Id: {CID}", "-H", "Accept: text/event-stream", f"http://{A}/v1/feed/stream?tenantId={t}-full"])
    check("F-18", "non-empty tenant: ':connected' then the snapshot frame with id", out.startswith(":connected") and "event:snapshot" in out.replace(" ", "") and "\nid:" in out, repr(out[:140]))
    req(A, "POST", f"/v1/communications/{c['id']}/retire", {"note": "cleanup"})

# ---------------------------------------------------------------- G-1-8: Actuator probes
def probes():
    for host, name in ((A, "A"), (B, "B")):
        for path in ("/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness"):
            st, h, b = req(host, "GET", path, client_id=None)
            check("F-92", f"{name} GET {path} without X-Client-Id -> 200 {{status: UP}} (G-1-8)", st == 200 and isinstance(b, dict) and b.get("status") == "UP", f"{st} {b}")
    st, h, b = req(A, "GET", "/actuator/health", client_id=None)
    check("F-92", "health details stay hidden on the unauthenticated endpoint (no components)", st == 200 and "components" not in (b or {}), f"{b}")
    st, h, b = req(A, "GET", "/actuator/health/readiness", client_id=CID)
    check("F-92", "readiness also answers with a client id", st == 200, f"{st}")
    for path in ("/actuator/env", "/actuator/beans", "/actuator/metrics", "/actuator/loggers", "/actuator/threaddump"):
        st, h, b = req(A, "GET", path, client_id=None)
        check("F-92", f"GET {path} -> 404 (only health is exposed)", st == 404, f"{st}")
    st, h, b = req(A, "GET", "/actuator", client_id=None)
    links = sorted((b or {}).get("_links", {}).keys()) if isinstance(b, dict) else b
    check("F-92", "/actuator index lists health only", st == 404 or (st == 200 and all(k.startswith("health") or k == "self" for k in links)), f"{st} {links}")

# ---------------------------------------------------------------- G-1-5: operator retires an auto notice while the failure continues
def reopen():
    t, svc = f"e2e1-reopen-{RUN}", "flaky"
    def rep(status):
        return req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": svc, "status": status, "publisher": "e2e1-pusher"})
    rep("DOWN"); st, h, m = rep("DOWN")
    first = (m.get("state") or {}).get("openCommunicationId") if isinstance(m, dict) else None
    check("F-91", "two DOWN reports open an OUTAGE (failureThreshold 2)", st == 202 and bool(first), f"{st} open={first} summary={(m.get('state') or {}).get('lastSummary') if isinstance(m, dict) else m}")
    st, h, r = req(A, "POST", f"/v1/communications/{first}/retire", {"actor": "operator", "note": "closed by hand while the service still fails"})
    check("F-06", "an operator retires the auto notice by hand -> 200 RETIRED", st == 200 and r.get("status") == "RETIRED", f"{st} {r.get('status') if isinstance(r, dict) else r}")
    st, h, m2 = rep("DOWN")
    open2 = (m2.get("state") or {}).get("openCommunicationId")
    check("F-91", "the next DOWN observation notices the retirement: the monitor forgets the notice and counts again (G-1-5)", st == 202 and open2 is None, f"{st} open={open2} summary={(m2.get('state') or {}).get('lastSummary')}")
    second, n = None, 0
    for i in range(4):
        st, h, m3 = rep("DOWN"); n += 1
        oc = (m3.get("state") or {}).get("openCommunicationId")
        if oc and oc != first:
            second = oc; break
        time.sleep(0.2)
    check("F-91", "continued failure opens a fresh OUTAGE (new id) once the threshold is crossed again", second is not None, f"new={second} after {n} more DOWN report(s); first={first}")
    st, h, f = req(A, "GET", f"/v1/feed?tenantId={t}&type=OUTAGE")
    ids = [i["id"] for i in f.get("items", [])] if isinstance(f, dict) else f
    check("F-91", "the feed shows exactly the fresh notice, not the retired one", st == 200 and ids == [second], f"feed ids={ids}")
    rep("UP"); st, h, m4 = rep("UP")
    st2, h2, c = req(A, "GET", f"/v1/communications/{second}")
    last = (c.get("history") or [{}])[-1] if isinstance(c, dict) else {}
    check("F-91", "two UP reports retire the fresh notice with 'recovered'", (m4.get("state") or {}).get("openCommunicationId") is None and c.get("status") == "RETIRED" and "recovered" in (last.get("action") or ""), f"status={c.get('status')} last={last.get('action')}")
    rc, out, err = curl(["-s", "file://" + LOG_A]) if False else (0, "", "")
    try:
        lines = [l for l in open(LOG_A, errors="replace") if "counting again" in l or "closed externally" in l]
    except Exception as e:
        lines = []
    check("F-89", "backend A logged that the notice was closed externally and it is counting again", len(lines) >= 1, (lines[-1].strip()[-160:] if lines else "no such line"))
    st, h, mons = req(A, "GET", f"/v1/health/monitors?tenantId={t}")
    for mo in mons if isinstance(mons, list) else []:
        req(A, "DELETE", f"/v1/health/monitors/{mo['id']}")

# ---------------------------------------------------------------- G-1-20: 409 right after expiresAt, before the sweep
def expiry_409():
    t = f"e2e1-exp-{RUN}"
    st, h, c = req(A, "POST", "/v1/communications", {"tenantId": t, "publisher": "e2e1-sre", "type": "OUTAGE", "severity": "MAJOR", "title": f"e2e1 {RUN} short-lived", "expiresAt": now_iso(1.0)})
    time.sleep(1.15)
    st2, h2, stored = req(A, "GET", f"/v1/communications/{c['id']}")
    st3, h3, r = req(A, "POST", f"/v1/communications/{c['id']}/retire", {"note": "too late"})
    st4, h4, u = req(A, "PUT", f"/v1/communications/{c['id']}", {"expectedVersion": c["version"], "title": "late edit"})
    pre_sweep = stored.get("status") == "ACTIVE"
    check("F-06", "retire 0.15 s after expiresAt -> 409 even before the sweeper stored EXPIRED (G-1-20)", st3 == 409, f"stored status when asked={stored.get('status')} ({'before' if pre_sweep else 'after'} the 2 s sweep) retire={st3} {r}")
    check("F-12", "update after expiresAt -> 409", st4 == 409, f"{st4} {u}")

# ---------------------------------------------------------------- G-1-21: error bodies name the problem
def error_bodies():
    st, h, b = req(A, "GET", "/v1/communications/does-not-exist")
    check("F-07", "404 names the missing id", st == 404 and "does-not-exist" in json.dumps(b), f"{st} {b}")
    st, h, b = req(A, "GET", "/v1/feed/does-not-exist")
    check("F-07", "permalink 404 names the id", st == 404 and "does-not-exist" in json.dumps(b), f"{st} {b}")
    st, h, b = req(A, "DELETE", "/v1/feed?tenantId=x")
    msg = json.dumps(b)
    check("F-07", "405 names the verb / the allowed methods", st == 405 and ("DELETE" in msg or "GET" in msg), f"{st} {b}")
    st, h, b = req(A, "POST", "/v1/communications", raw_body=b"hello", headers={"Content-Type": "text/plain"})
    check("F-07", "415 names the expected media type", st == 415 and "json" in json.dumps(b).lower(), f"{st} {b}")
    st, h, b = req(A, "POST", "/v1/communications", {"tenantId": "x", "publisher": "p", "type": "OUTAGE", "severity": "BOGUS", "title": "t"})
    msg = json.dumps(b)
    check("F-07", "unknown enum value -> 400 naming the field and the allowed values", st == 400 and "severity" in msg and "CRITICAL" in msg, f"{st} {b}")
    st, h, b = req(A, "POST", "/v1/communications", raw_body=b"{not json", headers={"Content-Type": "application/json"})
    check("F-07", "malformed JSON -> 400 with a readable error", st == 400 and isinstance(b, dict) and "error" in b, f"{st} {b}")

# ---------------------------------------------------------------- G-1-22: access log
def access_log():
    pat = re.compile(r"client=e2e1-verifier GET /v1/feed -> 200 \(\d+ ms\)")  # the path is logged without its query string
    before = sum(1 for l in open(LOG_A, errors="replace") if pat.search(l))
    st, h, b = req(A, "GET", f"/v1/feed?tenantId=e2e1-log-{RUN}")
    time.sleep(0.4)
    lines = [l.rstrip() for l in open(LOG_A, errors="replace") if pat.search(l)]
    check("F-89", "every identified request is logged at INFO with client id, verb, path, status and duration (G-1-22)", st == 200 and len(lines) == before + 1, f"matching lines {before} -> {len(lines)}; last: {lines[-1][-120:] if lines else 'none'}")
    st, h, b = req(A, "GET", f"/v1/feed?tenantId=e2e1-log-{RUN}", client_id=None)
    time.sleep(0.3)
    lines = [l.rstrip() for l in open(LOG_A, errors="replace") if "rejected GET /v1/feed" in l]
    check("F-89", "a rejected (unidentified) request is logged too", st == 401 and len(lines) >= 1, lines[-1][-160:] if lines else "no line")

if __name__ == "__main__":
    steps = [first_byte, probes, reopen, expiry_409, error_bodies, access_log]
    only = sys.argv[1:]
    for fn in steps:
        if only and fn.__name__ not in only:
            continue
        print(f"### {fn.__name__} {now_iso()}", flush=True)
        try:
            fn()
        except Exception as e:
            import traceback
            check("ERR", fn.__name__, False, f"exception {e!r} {traceback.format_exc()[-400:]}")
    fails = [r for r in RESULTS if not r[2]]
    print(f"\nSUMMARY: {len(RESULTS)} checks, {len(RESULTS) - len(fails)} pass, {len(fails)} fail")
    for r in fails:
        print("  FAIL", r[0], r[1], "::", r[3][:300])
    sys.exit(min(len(fails), 100))
