#!/usr/bin/env python3
"""E2E Integration Verifier, iteration 0: HTTP/SSE contract checks against private backends A (18081) and B (18082).
Stdlib only. Prints one line per check: <F-id> <PASS|FAIL> <check> :: <detail>. Exit code = number of FAILs (capped 100)."""
import json, sys, time, threading, uuid, http.client, urllib.parse, concurrent.futures, datetime, socket

A = "127.0.0.1:18081"
B = "127.0.0.1:18082"
CID = "e2e-verifier"
RESULTS = []
RUN = uuid.uuid4().hex[:6]

def now_iso(delta_s=0):
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=delta_s)).isoformat().replace("+00:00", "Z")

def req(host, method, path, body=None, headers=None, client_id=CID, timeout=15):
    h = {"Accept": "application/json"}
    if client_id is not None:
        h["X-Client-Id"] = client_id
    if body is not None:
        h["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    else:
        data = None
    if headers:
        h.update(headers)
    c = http.client.HTTPConnection(host, timeout=timeout)
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    raw = r.read()
    hdrs = {k.lower(): v for k, v in r.getheaders()}
    try:
        parsed = json.loads(raw) if raw else None
    except Exception:
        parsed = raw.decode(errors="replace")
    c.close()
    return r.status, hdrs, parsed

def check(fid, name, ok, detail=""):
    RESULTS.append((fid, name, bool(ok), detail))
    print(f"{fid} {'PASS' if ok else 'FAIL'} {name} :: {detail}"[:600], flush=True)
    return ok

class SSE:
    """Reads an SSE stream in a thread; frames are dicts {id, event, data(json), t} plus comments."""
    def __init__(self, host, path, client_id=CID, headers=None, via_query=False):
        self.frames, self.comments, self.status, self.ctype, self.error = [], [], None, None, None
        self.host, self.path, self.client_id, self.headers, self.via_query = host, path, client_id, headers or {}, via_query
        self._stop = threading.Event()
        self.t0 = time.time()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        self.body_text = ""
    def _run(self):
        try:
            h = {"Accept": "text/event-stream"}
            if self.client_id and not self.via_query:
                h["X-Client-Id"] = self.client_id
            h.update(self.headers)
            self.conn = http.client.HTTPConnection(self.host, timeout=120)
            self.conn.request("GET", self.path, headers=h)
            r = self.conn.getresponse()
            self.status = r.status
            self.ctype = r.getheader("Content-Type")
            if r.status != 200:
                self.body_text = r.read().decode(errors="replace")
                return
            cur = {}
            while not self._stop.is_set():
                line = r.readline()
                if not line:
                    break
                line = line.decode(errors="replace").rstrip("\n").rstrip("\r")
                if line == "":
                    if cur:
                        try:
                            cur["data"] = json.loads(cur.get("data", "null"))
                        except Exception:
                            pass
                        cur["t"] = round(time.time() - self.t0, 3)
                        self.frames.append(cur)
                    cur = {}
                elif line.startswith(":"):
                    self.comments.append((round(time.time() - self.t0, 3), line))
                else:
                    k, _, v = line.partition(":")
                    v = v[1:] if v.startswith(" ") else v
                    cur[k] = (cur.get(k, "") + v) if k == "data" and "data" in cur else v
        except Exception as e:
            self.error = repr(e)
    def wait_for(self, pred, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            for f in self.frames:
                if pred(f):
                    return f
            time.sleep(0.05)
        return None
    def wait_open(self, timeout=10):
        end = time.time() + timeout
        while time.time() < end and self.status is None and self.error is None:
            time.sleep(0.05)
        return self.status
    def close(self):
        self._stop.set()
        try:
            self.conn.sock.shutdown(socket.SHUT_RDWR)
            self.conn.close()
        except Exception:
            pass

def comm_of(f):
    return (f.get("data") or {}).get("communication") or {}

def publish(host, tenant, **over):
    body = {"tenantId": tenant, "publisher": "e2e-sre", "type": "OUTAGE", "severity": "MAJOR",
            "title": f"e2e {RUN} {over.get('title', 'outage')}", "affectedServices": ["svc-a"]}
    body.update(over)
    return req(host, "POST", "/v1/communications", body)

# ---------------------------------------------------------------- F-27 caller identification
def f27():
    st, h, b = req(A, "GET", "/v1/feed?tenantId=e2e-x", client_id=None)
    check("F-27", "no X-Client-Id -> 401 {error}", st == 401 and isinstance(b, dict) and "error" in b, f"{st} {b}")
    st, h, b = req(A, "GET", "/v1/feed?tenantId=e2e-x", client_id="bad id!")
    check("F-27", "malformed X-Client-Id -> 400", st == 400, f"{st} {b}")
    st, h, b = req(A, "POST", "/v1/health/reports", {"tenantId": "e2e-x", "service": "s", "status": "UP"}, client_id=None)
    check("F-27", "health report without id -> 401", st == 401, f"{st} {b}")
    s = SSE(A, f"/v1/feed/stream?tenantId=e2e-x&clientId={CID}", via_query=True)
    st = s.wait_open()
    check("F-27", "stream with ?clientId= and no header -> 200 text/event-stream", st == 200 and (s.ctype or "").startswith("text/event-stream"), f"{st} {s.ctype}")
    s.close()
    s = SSE(A, "/v1/feed/stream?tenantId=e2e-x", client_id=None)
    st = s.wait_open()
    check("F-27", "stream without any id -> 401", st == 401, f"{st} {s.body_text[:120]}")
    s.close()
    st, h, b = req(A, "GET", "/v3/api-docs", client_id=None)
    check("F-27", "/v3/api-docs exempt (no header) -> 200", st == 200, f"{st}")
    st, h, b = req(A, "GET", "/swagger-ui.html", client_id=None)
    check("F-27", "/swagger-ui.html exempt -> 200/302", st in (200, 302), f"{st} location={h.get('location')}")
    c = http.client.HTTPConnection(A, timeout=10); c.request("OPTIONS", "/v1/feed?tenantId=e2e-x"); r = c.getresponse(); r.read()
    check("F-27", "OPTIONS /v1/feed without id is not 401", r.status != 401, f"{r.status}")

# ---------------------------------------------------------------- F-01 publish + created event
def f01():
    t = f"e2e-pub-{RUN}"
    s = SSE(A, f"/v1/feed/stream?tenantId={t}")
    s.wait_open()
    st, h, b = publish(A, t)
    check("F-01", "POST -> 201 + Location + ACTIVE + audience CUSTOMERS", st == 201 and "location" in h and b.get("status") == "ACTIVE" and b.get("audience") == "CUSTOMERS",
          f"{st} location={h.get('location')} status={b.get('status')} audience={b.get('audience')}")
    cid = b.get("id")
    check("F-01", "Location names the resource", (h.get("location") or "").endswith(f"/v1/communications/{cid}"), h.get("location"))
    ev = s.wait_for(lambda f: f.get("event") == "created" and comm_of(f).get("id") == cid, 5)
    check("F-01", "SSE 'created' frame for it (id = seq)", ev is not None and str(ev.get("id")) == str(ev["data"].get("seq")), f"{ev and {k: ev[k] for k in ('id','event','t')}}")
    st2, h2, b2 = publish(A, t, startsAt=now_iso(3600), title="future")
    check("F-01", "future startsAt -> SCHEDULED", st2 == 201 and b2.get("status") == "SCHEDULED", f"{st2} {b2.get('status')}")
    st3, h3, b3 = publish(A, t, startsAt=now_iso(-3600), title="past")
    check("F-01", "past startsAt -> ACTIVE", st3 == 201 and b3.get("status") == "ACTIVE", f"{st3} {b3.get('status')}")
    s.close()
    return t, cid

# ---------------------------------------------------------------- F-02 drafts
def f02():
    t = f"e2e-draft-{RUN}"
    s = SSE(A, f"/v1/feed/stream?tenantId={t}")
    s.wait_open()
    st, h, b = publish(A, t, draft=True, title="draft")
    cid = b.get("id")
    check("F-02", "draft=true -> 201 DRAFT", st == 201 and b.get("status") == "DRAFT", f"{st} {b.get('status')}")
    st, h, page = req(A, "GET", f"/v1/feed?tenantId={t}")
    check("F-02", "draft absent from feed", st == 200 and all(i["id"] != cid for i in page["items"]), f"{st} items={len(page['items'])}")
    st, h, b2 = req(A, "GET", f"/v1/feed/{cid}")
    check("F-02", "draft permalink -> 404", st == 404, f"{st} {b2}")
    time.sleep(1.5)
    check("F-02", "no stream event for a draft", not any(comm_of(f).get("id") == cid for f in s.frames), f"frames={[(f.get('event'), comm_of(f).get('id')) for f in s.frames]}")
    st, h, b3 = req(A, "POST", f"/v1/communications/{cid}/publish")
    check("F-02", "publish draft -> 200 ACTIVE", st == 200 and b3.get("status") == "ACTIVE", f"{st} {b3.get('status') if isinstance(b3, dict) else b3}")
    ev = s.wait_for(lambda f: f.get("event") == "created" and comm_of(f).get("id") == cid, 5)
    check("F-02", "CREATED event emitted on publish", ev is not None, f"{ev and ev.get('event')}")
    st, h, b4 = req(A, "POST", f"/v1/communications/{cid}/publish")
    check("F-02", "publish again -> 409", st == 409, f"{st} {b4}")
    st, h, b5 = req(A, "GET", f"/v1/feed/{cid}")
    check("F-02", "permalink after publish -> 200 ACTIVE", st == 200 and b5.get("status") == "ACTIVE", f"{st}")
    s.close()

# ---------------------------------------------------------------- F-06 retire
def f06():
    t = f"e2e-retire-{RUN}"
    s = SSE(A, f"/v1/feed/stream?tenantId={t}")
    s.wait_open()
    st, h, b = publish(A, t)
    cid = b["id"]
    st, h, r = req(A, "POST", f"/v1/communications/{cid}/retire", {"actor": "e2e-admin", "note": "resolved by e2e"})
    hist = r.get("history", []) if isinstance(r, dict) else []
    check("F-06", "retire -> 200 RETIRED with note+actor in history", st == 200 and r.get("status") == "RETIRED" and any("resolved by e2e" in (e.get("action") or "") and e.get("actor") == "e2e-admin" for e in hist),
          f"{st} {r.get('status') if isinstance(r, dict) else r} last={hist[-1] if hist else None}")
    ev = s.wait_for(lambda f: f.get("event") == "retired" and comm_of(f).get("id") == cid, 5)
    check("F-06", "SSE 'retired' frame", ev is not None, f"{ev and ev.get('event')}")
    st, h, r2 = req(A, "POST", f"/v1/communications/{cid}/retire", {})
    check("F-06", "retire again -> 200 idempotent, still RETIRED, no new history", st == 200 and r2.get("status") == "RETIRED" and len(r2.get("history", [])) == len(hist), f"{st} hist {len(hist)}->{len(r2.get('history', []))}")
    st, h, b2 = publish(A, t, title="no-actor")
    st, h, r3 = req(A, "POST", f"/v1/communications/{b2['id']}/retire", {})
    check("F-06", "actor defaults to publisher", st == 200 and r3.get("history", [{}])[-1].get("actor") == "e2e-sre", f"{st} actor={r3.get('history', [{}])[-1].get('actor')}")
    st, h, b3 = publish(A, t, title="expiring", expiresAt=now_iso(1.5))
    time.sleep(4.5)  # sweeper every 2 s converges stored status to EXPIRED
    st, h, r4 = req(A, "POST", f"/v1/communications/{b3['id']}/retire", {"note": "too late"})
    check("F-06", "retire EXPIRED -> 409", st == 409, f"{st} {r4}")
    ev2 = s.wait_for(lambda f: f.get("event") == "expired" and comm_of(f).get("id") == b3["id"], 5)
    check("F-18", "sweeper emits 'expired' frame", ev2 is not None, f"{ev2 and ev2.get('event')}")
    s.close()

# ---------------------------------------------------------------- F-07 validation
def f07():
    t = f"e2e-val-{RUN}"
    base = {"tenantId": t, "publisher": "e2e-sre", "type": "OUTAGE", "severity": "MAJOR", "title": "x"}
    cases = [
        ("missing title", {**base, "title": ""}, "title"),
        ("missing tenantId", {**base, "tenantId": ""}, "tenantId"),
        ("missing publisher", {**base, "publisher": ""}, "publisher"),
        ("title > 200", {**base, "title": "t" * 201}, "title"),
        ("body > 16384 bytes", {**base, "body": "b" * 16385}, "body"),
        ("21 affectedServices", {**base, "affectedServices": [f"s{i}" for i in range(21)]}, "affectedServices"),
        ("MAINTENANCE without endsAt", {**base, "type": "MAINTENANCE", "severity": "INFO"}, "endsAt"),
        ("OUTAGE with INFO severity", {**base, "severity": "INFO"}, "severity"),
        ("endsAt before startsAt", {**base, "startsAt": now_iso(3600), "endsAt": now_iso(60)}, "endsAt"),
        ("expiresAt before startsAt", {**base, "startsAt": now_iso(3600), "expiresAt": now_iso(60)}, "expiresAt"),
        ("ticket without number", {**base, "ticket": {"system": "servicenow"}}, "number"),
        ("unknown type", {**base, "type": "BOGUS"}, "type"),
        ("malformed JSON timestamp", {**base, "startsAt": "yesterday"}, "startsAt"),
    ]
    for name, body, field in cases:
        st, h, b = req(A, "POST", "/v1/communications", body)
        msg = (b.get("error") if isinstance(b, dict) else str(b)) or ""
        check("F-07", f"{name} -> 400 naming '{field}'", st == 400 and field.lower() in msg.lower(), f"{st} {msg[:140]}")
    st, h, b = req(A, "GET", "/v1/feed")
    check("F-07", "GET /v1/feed without tenantId -> 400", st == 400, f"{st} {b}")
    st, h, b = req(A, "GET", f"/v1/feed?tenantId={t}&page=-1")
    check("F-14", "page=-1 -> 400", st == 400, f"{st} {b}")
    st, h, b = req(A, "GET", f"/v1/feed?tenantId={t}&size=0")
    check("F-14", "size=0 -> 400", st == 400, f"{st} {b}")

# ---------------------------------------------------------------- F-08/F-09 ticket + externalRef
def f09():
    t = f"e2e-ticket-{RUN}"
    st, h, b = publish(A, t, ticket={"number": " inc0077001 "}, title="with ticket")
    tk = b.get("ticket") or {}
    check("F-09", "ticket normalised (INC0077001, system servicenow) and externalRef defaults to it", st == 201 and tk.get("number") == "INC0077001" and tk.get("system") == "servicenow" and b.get("externalRef") == "INC0077001",
          f"{st} ticket={tk} externalRef={b.get('externalRef')}")
    check("F-09", "ticket.url present only when servicenow.instance-url configured (unset here -> absent)", "url" not in tk, f"url={tk.get('url')}")
    st2, h2, b2 = publish(A, t, ticket={"number": "INC0077001"}, title="same ticket again")
    check("F-08", "second notice on the same ticket without explicit externalRef -> 409 duplicate", st2 == 409 and "externalRef" in json.dumps(b2), f"{st2} {b2}")
    st3, h3, b3 = publish(A, t, ticket={"number": "INC0077001"}, externalRef=f"second-{RUN}", title="same ticket, own ref")
    check("F-08", "same ticket with its own externalRef -> 201", st3 == 201, f"{st3} {b3.get('externalRef') if isinstance(b3, dict) else b3}")
    st4, h4, b4 = publish(A, t, ticket={"number": "ABC"}, title="bad ticket")
    check("F-09", "malformed ticket.number -> 400", st4 == 400, f"{st4} {b4}")
    st5, h5, b5 = publish(A, t, ticket={"number": "INC0077002", "url": "ftp://x"}, title="bad url")
    check("F-09", "ticket.url must be http(s) -> 400", st5 == 400, f"{st5} {b5}")
    st6, h6, b6 = publish(A, t, title="attach later", externalRef=f"attach-{RUN}")
    st7, h7, b7 = req(A, "PUT", f"/v1/communications/{b6['id']}", {"expectedVersion": b6["version"], "ticket": {"number": "inc0077003"}})
    hist = b7.get("history", []) if isinstance(b7, dict) else []
    check("F-09", "PUT attaches a ticket later with audit 'ticket attached'", st7 == 200 and (b7.get("ticket") or {}).get("number") == "INC0077003" and any("ticket" in (e.get("action") or "") for e in hist),
          f"{st7} ticket={b7.get('ticket') if isinstance(b7, dict) else b7} last={hist[-1] if hist else None}")
    st8, h8, page = req(A, "GET", f"/v1/feed?tenantId={t}")
    item = next((i for i in page["items"] if i["id"] == b["id"]), None)
    check("F-09", "feed item carries the ticket", item is not None and (item.get("ticket") or {}).get("number") == "INC0077001", f"{item and item.get('ticket')}")
    st9, h9, b9 = req(A, "PUT", f"/v1/communications/{b6['id']}", {"expectedVersion": 0, "title": "stale"})
    check("F-12", "PUT with stale expectedVersion -> 409", st9 == 409, f"{st9} {b9}")
    st10, h10, b10 = req(A, "PUT", f"/v1/communications/{b6['id']}", {"title": "no version"})
    check("F-12", "PUT without expectedVersion -> 400", st10 == 400, f"{st10} {b10}")

# ---------------------------------------------------------------- F-14 feed filters / paging
def f14():
    t = f"e2e-feed-{RUN}"
    seed = [
        dict(title="a-major", severity="MAJOR", affectedServices=["svc-a"]),
        dict(title="b-critical", severity="CRITICAL", affectedServices=["svc-b"]),
        dict(title="a-minor-incident", type="INCIDENT", severity="MINOR", affectedServices=["svc-a"]),
        dict(title="maint", type="MAINTENANCE", severity="INFO", endsAt=now_iso(3600), affectedServices=["svc-a"]),
        dict(title="internal-change", type="CHANGE", severity="INFO", audience="INTERNAL", affectedServices=["svc-c"]),
    ]
    ids = {}
    for sdef in seed:
        st, h, b = publish(A, t, **sdef)
        if st != 201:
            check("F-14", f"seed {sdef['title']}", False, f"{st} {b}"); return
        ids[sdef["title"]] = b["id"]
    def titles(q):
        st, h, page = req(A, "GET", f"/v1/feed?tenantId={t}&{q}")
        return st, page, sorted(i["title"].split()[-1] for i in page["items"]) if st == 200 else None
    st, page, tt = titles("size=100")
    check("F-14", "all 5 visible, sorted severity desc then startsAt desc", st == 200 and len(page["items"]) == 5 and [i["severity"] for i in page["items"]] == ["CRITICAL", "MAJOR", "MINOR", "INFO", "INFO"], f"{st} {[i['title'].split()[-1] for i in page['items']]}")
    check("F-14", "Page shape {items,page,size,totalElements,hasNext}", set(page) == {"items", "page", "size", "totalElements", "hasNext"}, f"{sorted(page)}")
    st, page, tt = titles("service=svc-a"); check("F-14", "service filter exact match", tt == ["a-major", "a-minor-incident", "maint"], f"{tt}")
    st, page, tt = titles("type=INCIDENT"); check("F-14", "type filter", tt == ["a-minor-incident"], f"{tt}")
    st, page, tt = titles("severity=MAJOR"); check("F-14", "severity is an inclusive minimum", tt == ["a-major", "b-critical"], f"{tt}")
    st, page, tt = titles("audience=INTERNAL"); check("F-14", "audience filter", tt == ["internal-change"], f"{tt}")
    st, page, tt = titles("size=2&page=0"); check("F-14", "paging: size=2 page=0 -> 2 items, hasNext true, total 5", len(page["items"]) == 2 and page["hasNext"] is True and page["totalElements"] == 5, f"{page['hasNext']} {page['totalElements']}")
    st, page, tt = titles("size=2&page=2"); check("F-14", "paging: last page hasNext false", len(page["items"]) == 1 and page["hasNext"] is False, f"{len(page['items'])} {page['hasNext']}")
    st, page, tt = titles("size=500"); check("F-14", "size capped at 100", st == 200 and page["size"] == 100, f"size={page.get('size')}")
    st, page, tt = titles("type=BOGUS"); check("F-14", "unknown enum filter -> 400", st == 400, f"{st}")
    st, page, tt = titles("activeAt=" + urllib.parse.quote(now_iso(-86400))); check("F-14", "activeAt in the past -> nothing was active then", st == 200 and len(page["items"]) == 0, f"{st} {len(page['items']) if st == 200 else page}")

# ---------------------------------------------------------------- F-15/F-16 effective status + scheduled visibility
def f15_16():
    t = f"e2e-vis-{RUN}"
    st, h, m = publish(A, t, type="MAINTENANCE", severity="INFO", title="soon", startsAt=now_iso(3), endsAt=now_iso(120))
    st, h, page = req(A, "GET", f"/v1/feed?tenantId={t}")
    it = next((i for i in page["items"] if i["id"] == m["id"]), None)
    check("F-16", "MAINTENANCE starting in 3 s listed as SCHEDULED (upcoming)", it is not None and it["status"] == "SCHEDULED", f"{it and it['status']}")
    time.sleep(3.3)
    st, h, page = req(A, "GET", f"/v1/feed?tenantId={t}")
    it = next((i for i in page["items"] if i["id"] == m["id"]), None)
    st2, h2, stored = req(A, "GET", f"/v1/communications/{m['id']}")
    check("F-15", "right after startsAt the feed says ACTIVE (effective) regardless of stored status", it is not None and it["status"] == "ACTIVE", f"feed={it and it['status']} stored={stored.get('status')} (sweeper every 2 s)")
    st, h, e = publish(A, t, title="short-lived", expiresAt=now_iso(2))
    st, h, page = req(A, "GET", f"/v1/feed?tenantId={t}")
    check("F-15", "item with expiresAt=now+2s is visible now", any(i["id"] == e["id"] for i in page["items"]), "")
    time.sleep(2.2)
    st, h, page = req(A, "GET", f"/v1/feed?tenantId={t}")
    st2, h2, perm = req(A, "GET", f"/v1/feed/{e['id']}")
    st3, h3, stored = req(A, "GET", f"/v1/communications/{e['id']}")
    check("F-15", "0.2 s after expiresAt: gone from feed, permalink 200 EXPIRED", all(i["id"] != e["id"] for i in page["items"]) and st2 == 200 and perm.get("status") == "EXPIRED", f"feed-has={any(i['id'] == e['id'] for i in page['items'])} permalink={st2}/{perm.get('status')} stored={stored.get('status')}")
    st, h, m1 = publish(A, t, type="MAINTENANCE", severity="INFO", title="tomorrow", startsAt=now_iso(86400), endsAt=now_iso(90000))
    st, h, o1 = publish(A, t, title="outage-tomorrow", startsAt=now_iso(86400))
    st, h, m2 = publish(A, t, type="MAINTENANCE", severity="INFO", title="in-10-days", startsAt=now_iso(10 * 86400), endsAt=now_iso(10 * 86400 + 3600))
    st, h, page = req(A, "GET", f"/v1/feed?tenantId={t}")
    have = {i["id"] for i in page["items"]}
    check("F-16", "maintenance tomorrow visible; outage tomorrow hidden; maintenance in 10 days hidden (P7D)", m1["id"] in have and o1["id"] not in have and m2["id"] not in have, f"m1={m1['id'] in have} o1={o1['id'] in have} m2={m2['id'] in have}")
    st, h, page = req(A, "GET", f"/v1/feed?tenantId={t}&includeUpcoming=false")
    have = {i["id"] for i in page["items"]}
    check("F-16", "includeUpcoming=false hides the upcoming maintenance", m1["id"] not in have, "")
    st, h, perm = req(A, "GET", f"/v1/feed/{o1['id']}")
    check("F-17", "permalink of a hidden future outage -> 200 SCHEDULED", st == 200 and perm.get("status") == "SCHEDULED", f"{st} {perm.get('status')}")

# ---------------------------------------------------------------- F-18 stream contract
def f18():
    t = f"e2e-sse-{RUN}"
    st, h, a1 = publish(A, t, title="pre-existing")
    st, h, m = publish(A, t, type="MAINTENANCE", severity="INFO", title="activates", startsAt=now_iso(2), endsAt=now_iso(300))
    s = SSE(A, f"/v1/feed/stream?tenantId={t}")
    s.wait_open()
    snaps = s.wait_for(lambda f: f.get("event") == "snapshot" and comm_of(f).get("id") == m["id"], 5)
    snap1 = s.wait_for(lambda f: f.get("event") == "snapshot" and comm_of(f).get("id") == a1["id"], 5)
    check("F-18", "one 'snapshot' frame per visible item (2), each with an id", snaps is not None and snap1 is not None and "id" in snaps and "id" in snap1, f"snapshots={[comm_of(f).get('title') for f in s.frames if f.get('event') == 'snapshot']}")
    act = s.wait_for(lambda f: f.get("event") == "activated" and comm_of(f).get("id") == m["id"], 8)
    check("F-18", "sweeper emits 'activated' when the scheduled start passes", act is not None, f"{act and act.get('t')}s")
    st, h, upd = req(A, "PUT", f"/v1/communications/{a1['id']}", {"expectedVersion": a1["version"], "title": f"e2e {RUN} edited"})
    up = s.wait_for(lambda f: f.get("event") == "updated" and comm_of(f).get("id") == a1["id"], 5)
    check("F-18", "'updated' frame on PUT with new title", up is not None and comm_of(up).get("title", "").endswith("edited"), f"{st} {up and comm_of(up).get('title')}")
    req(A, "POST", f"/v1/communications/{a1['id']}/retire", {"note": "done"})
    rt = s.wait_for(lambda f: f.get("event") == "retired" and comm_of(f).get("id") == a1["id"], 5)
    check("F-18", "'retired' frame on retire", rt is not None, "")
    ids = [int(f["id"]) for f in s.frames if f.get("event") != "snapshot" and "id" in f]
    check("F-18", "live frame ids are strictly increasing", ids == sorted(ids) and len(set(ids)) == len(ids), f"{ids}")
    check("F-18", "frame names are event types lower-cased; data.type matches", all(f.get("event") == (f.get("data") or {}).get("type", "").lower() for f in s.frames), f"{sorted({f.get('event') for f in s.frames})}")
    t0 = time.time()
    while time.time() - t0 < 17 and not s.comments:
        time.sleep(0.2)
    check("F-18", "keepalive comment within ~15 s", bool(s.comments), f"{s.comments[:2]}")
    s.close()

# ---------------------------------------------------------------- F-20 resume
def f20():
    t = f"e2e-resume-{RUN}"
    st, h, first = publish(A, t, title="first")
    s = SSE(A, f"/v1/feed/stream?tenantId={t}")
    s.wait_open()
    seen = s.wait_for(lambda f: comm_of(f).get("id") == first["id"], 5)
    s.close()
    last_id = seen["id"]
    req(A, "POST", f"/v1/communications/{first['id']}/retire", {"note": "gone while away"})
    st, h, second = publish(A, t, title="second")
    time.sleep(0.8)
    r = SSE(A, f"/v1/feed/stream?tenantId={t}", headers={"Last-Event-ID": str(last_id)})
    st = r.wait_open()
    time.sleep(1.5)
    frames = [(f.get("event"), comm_of(f).get("title", "").split()[-1]) for f in r.frames]
    ok = st == 200 and frames[:2] == [("retired", "first"), ("created", "second")] and not any(e == "snapshot" for e, _ in frames)
    check("F-20", "reconnect with Last-Event-ID header replays RETIRED then CREATED, no snapshot", ok, f"status={st} frames={frames} body={r.body_text[:200]}")
    r.close()
    r = SSE(A, f"/v1/feed/stream?tenantId={t}&lastEventId={last_id}")
    st = r.wait_open(); time.sleep(1.0)
    check("F-20", "?lastEventId= query form", st == 200, f"status={st} body={r.body_text[:200]}")
    r.close()
    r = SSE(A, f"/v1/feed/stream?tenantId={t}&lastEventId=999999999")
    st = r.wait_open(); time.sleep(1.0)
    frames = [(f.get("event"), comm_of(f).get("title", "").split()[-1]) for f in r.frames]
    check("F-20", "never-issued lastEventId -> fresh snapshot", st == 200 and frames and all(e == "snapshot" for e, _ in frames), f"status={st} frames={frames} body={r.body_text[:200]}")
    r.close()
    r = SSE(A, f"/v1/feed/stream?tenantId={t}", headers={"Last-Event-ID": "not-a-number"})
    st = r.wait_open(); time.sleep(1.0)
    frames = [(f.get("event"), comm_of(f).get("title", "").split()[-1]) for f in r.frames]
    check("F-20", "non-numeric Last-Event-ID ignored -> snapshot", st == 200 and frames and all(e == "snapshot" for e, _ in frames), f"status={st} frames={frames} body={r.body_text[:200]}")
    r.close()

# ---------------------------------------------------------------- F-21 fan-out A <-> B
def f21():
    t = f"e2e-fanout-{RUN}"
    sa = SSE(A, f"/v1/feed/stream?tenantId={t}")
    sb = SSE(B, f"/v1/feed/stream?tenantId={t}")
    sa.wait_open(); sb.wait_open()
    t0 = time.time()
    st, h, c = publish(B, t, title="via-B")
    ea = sa.wait_for(lambda f: f.get("event") == "created" and comm_of(f).get("id") == c["id"], 5)
    eb = sb.wait_for(lambda f: f.get("event") == "created" and comm_of(f).get("id") == c["id"], 5)
    check("F-21", "publish through B -> 'created' on A's stream (and B's)", ea is not None and eb is not None, f"A after {ea and round(ea['t'] - (t0 - sa.t0), 2)}s, B after {eb and round(eb['t'] - (t0 - sb.t0), 2)}s")
    req(A, "POST", f"/v1/communications/{c['id']}/retire", {"note": "via A"})
    rb = sb.wait_for(lambda f: f.get("event") == "retired" and comm_of(f).get("id") == c["id"], 5)
    ra = sa.wait_for(lambda f: f.get("event") == "retired" and comm_of(f).get("id") == c["id"], 5)
    check("F-21", "retire through A -> 'retired' on B's stream", rb is not None and ra is not None, "")
    check("F-21", "same seq ids on both nodes", ea and eb and ea["id"] == eb["id"] and ra["id"] == rb["id"], f"A={ea and ea['id']},{ra and ra['id']} B={eb and eb['id']},{rb and rb['id']}")
    sa.close(); sb.close()

# ---------------------------------------------------------------- F-36 / F-38 / F-46 / F-50 health reports
def f36_38_46_50():
    t = f"e2e-health-{RUN}"
    st, h, b = req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": "pushsvc", "status": "UP", "publisher": "e2e-pusher"})
    mon = b if isinstance(b, dict) else {}
    check("F-36", "first push -> 202 + monitor, auto-registered push-only (url null), publisher from report", st == 202 and mon.get("url") is None and mon.get("policy", {}).get("publisher") == "e2e-pusher" and mon.get("tenantId") == t, f"{st} url={mon.get('url')} publisher={mon.get('policy', {}).get('publisher')} id={mon.get('id')}")
    mid = mon.get("id")
    st, h, b = req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": "pushsvc"})
    check("F-36", "report without status -> 400 naming status", st == 400 and "status" in json.dumps(b), f"{st} {b}")
    st, h, b = req(A, "POST", "/v1/health/reports", {"service": "pushsvc", "status": "UP"})
    check("F-36", "report without tenantId -> 400", st == 400, f"{st} {b}")
    st, h, b = req(A, "GET", f"/v1/health/monitors?tenantId={t}")
    check("F-36", "GET monitors?tenantId lists it with state", st == 200 and any(m["id"] == mid and "state" in m for m in b), f"{st} n={len(b) if isinstance(b, list) else b}")
    # F-38 vocabulary (non-instance reports evaluate directly)
    vocab = [("OK", "UP"), ("OUT_OF_SERVICE", "DOWN"), ("WARN", "DEGRADED"), ("healthy", "UP"), ("FATAL", "DOWN")]
    for code, expected in vocab:
        st, h, m = req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": "pushsvc", "status": code})
        got = m.get("state", {}).get("lastStatus") if isinstance(m, dict) else m
        check("F-38", f"status '{code}' -> {expected}", st == 202 and got == expected, f"{st} lastStatus={got} summary={m.get('state', {}).get('lastSummary') if isinstance(m, dict) else ''}")
    st, h, m = req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": "pushsvc", "status": "UP", "components": {"db": {"status": "UP", "components": {"primary": {"status": "DOWN", "details": {"error": "x" * 300}}}}, "ping": {"status": "UP"}}})
    summ = m.get("state", {}).get("lastSummary", "") if isinstance(m, dict) else ""
    check("F-38", "UP overall with a nested DOWN component -> DEGRADED, flattened name db.primary in summary", st == 202 and m.get("state", {}).get("lastStatus") == "DEGRADED" and "db.primary" in summ, f"{st} lastStatus={m.get('state', {}).get('lastStatus')} summary={summ[:160]}")
    st, h, m = req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": "pushsvc", "status": "UNKNOWN"})
    check("F-38", "UNKNOWN report carries no information (streaks untouched, 202)", st == 202, f"{st} lastStatus={m.get('state', {}).get('lastStatus') if isinstance(m, dict) else m}")
    # F-46 instances
    inst = lambda i, **o: {"tenantId": t, "service": "podsvc", "status": "UP", "instance": {"id": i, "namespace": "ns", "node": "n1", "cluster": "c", "version": "1", **o}}
    st1, h, m1 = req(A, "POST", "/v1/health/reports", inst("pod-b"))
    st2, h, m2 = req(A, "POST", "/v1/health/reports", inst("pod-a"))
    pid = m1.get("id") if isinstance(m1, dict) else None
    st, h, lst = req(A, "GET", f"/v1/health/monitors/{pid}/instances")
    check("F-46", "two pods recorded, listed ordered by id with lastSeenAt", st == 200 and [x["instanceId"] for x in lst] == ["pod-a", "pod-b"] and all("lastSeenAt" in x for x in lst), f"{st} {[(x.get('instanceId'), x.get('status'), x.get('left')) for x in lst] if isinstance(lst, list) else lst}")
    req(A, "POST", "/v1/health/reports", inst("pod-a"))
    st, h, lst = req(A, "GET", f"/v1/health/monitors/{pid}/instances")
    check("F-46", "repeat report upserts (still 2)", st == 200 and len(lst) == 2, f"{len(lst) if isinstance(lst, list) else lst}")
    check("F-46", "rollup summary counts pods", "2 of 2" in (m2.get("state", {}).get("lastSummary") or "") or "2 of 2" in json.dumps(req(A, "GET", f"/v1/health/monitors/{pid}")[2]), f"{req(A, 'GET', f'/v1/health/monitors/{pid}')[2].get('state', {}).get('lastSummary')}")
    st, h, b = req(A, "GET", "/v1/health/monitors/does-not-exist/instances")
    check("F-46", "unknown monitor -> 404", st == 404, f"{st}")
    check("F-49", "instance-registered monitor gets staleAfterSeconds 90 and minHealthyPercent 50", m1.get("policy", {}).get("staleAfterSeconds") == 90 and m1.get("policy", {}).get("minHealthyPercent") == 50, f"{m1.get('policy')}")
    # F-48 leaving
    st, h, m3 = req(A, "POST", "/v1/health/reports", inst("pod-b", leaving=True))
    st, h, lst = req(A, "GET", f"/v1/health/monitors/{pid}/instances")
    pb = next((x for x in lst if x["instanceId"] == "pod-b"), {})
    check("F-48", "leaving=true -> instance left=true and dropped from the rollup (1 of 1)", pb.get("left") is True and "1 of 1" in (m3.get("state", {}).get("lastSummary") or ""), f"left={pb.get('left')} summary={m3.get('state', {}).get('lastSummary')}")
    # F-50 concurrency: 20 parallel instance reports for a fresh service
    svc = f"burst-{RUN}"
    def one(i):
        return req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": svc, "status": "UP", "instance": {"id": f"pod-{i:02d}"}})[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
        codes = list(ex.map(one, range(20)))
    st, h, mons = req(A, "GET", f"/v1/health/monitors?tenantId={t}")
    bm = next((m for m in mons if m["service"] == svc), {})
    st, h, lst = req(A, "GET", f"/v1/health/monitors/{bm.get('id')}/instances")
    check("F-50", "20 parallel instance reports -> all 202, one monitor, 20 pods recorded", codes.count(202) == 20 and len([m for m in mons if m["service"] == svc]) == 1 and isinstance(lst, list) and len(lst) == 20, f"codes={sorted(set(codes))} x{len(codes)} 202s={codes.count(202)} monitors={len([m for m in mons if m['service'] == svc])} pods={len(lst) if isinstance(lst, list) else lst} summary={bm.get('state', {}).get('lastSummary')}")
    # F-48 silence / scaled to zero with an explicitly registered short window
    st, h, reg = req(A, "POST", "/v1/health/monitors", {"tenantId": t, "service": "silent", "staleAfterSeconds": 5, "failureThreshold": 1, "recoveryThreshold": 1})
    st, h, reg0 = req(A, "POST", "/v1/health/monitors", {"tenantId": t, "service": "scaled", "staleAfterSeconds": 5, "failureThreshold": 1, "recoveryThreshold": 1})
    for p in ("p1", "p2"):
        req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": "silent", "status": "UP", "instance": {"id": p}})
        req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": "scaled", "status": "UP", "instance": {"id": p}})
    for p in ("p1", "p2"):
        req(A, "POST", "/v1/health/reports", {"tenantId": t, "service": "scaled", "status": "UP", "instance": {"id": p, "leaving": True}})
    time.sleep(9)
    st, h, feed = req(A, "GET", f"/v1/feed?tenantId={t}&type=OUTAGE&service=silent")
    st2, h2, feed0 = req(A, "GET", f"/v1/feed?tenantId={t}&type=OUTAGE&service=scaled")
    st3, h3, msil = req(A, "GET", f"/v1/health/monitors/{reg['id']}")
    st4, h4, mscl = req(A, "GET", f"/v1/health/monitors/{reg0['id']}")
    body = feed["items"][0]["body"] if feed["items"] else ""
    check("F-48", "pods silent past the window -> OUTAGE naming them", len(feed["items"]) == 1 and "p1" in body and "p2" in body, f"items={len(feed['items'])} title={feed['items'][0]['title'] if feed['items'] else None} body={body[:160]} state={msil.get('state', {}).get('lastSummary')}")
    check("F-48", "all pods left -> scaled to zero, no notice", len(feed0["items"]) == 0, f"items={len(feed0['items'])} state={mscl.get('state', {}).get('lastSummary')} lastStatus={mscl.get('state', {}).get('lastStatus')}")

if __name__ == "__main__":
    steps = [f27, f01, f02, f06, f07, f09, f14, f15_16, f18, f20, f21, f36_38_46_50]
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
