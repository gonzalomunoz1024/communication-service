# vs3 helper: compact views of sidecar /status, backend monitors/instances/feed and stub request logs.
import json, sys, datetime
def load():
    t = sys.stdin.read()
    try: return json.loads(t)
    except Exception: return {"_raw": t[:300]}
def ts(s):
    if not s: return None
    s = s.replace("Z", "+00:00")
    if "." in s:
        head, rest = s.split(".", 1); frac = ""; tz = ""
        for i, ch in enumerate(rest):
            if not ch.isdigit(): frac, tz = rest[:i], rest[i:]; break
        else: frac = rest
        s = head + "." + (frac + "000000")[:6] + tz
    return datetime.datetime.fromisoformat(s)
cmd = sys.argv[1]; arg = sys.argv[2:] 
d = load()
if cmd == "status":
    lr = d.get("lastReport") or {}
    comps = lr.get("components")
    print("target=%s lastTarget=%s upSeen=%s last=%s msg=%r comps=%s sent=%s lastSendAt=%s sendError=%r" % (
        d.get("target"), d.get("lastTarget"), d.get("upSeen"), lr.get("status"), lr.get("message"),
        json.dumps(comps, separators=(",", ":")) if comps else None, d.get("reportsSent"),
        (d.get("lastSendAt") or "")[11:23] or None, d.get("sendError")))
elif cmd == "mon":
    if not isinstance(d, list): print("  ", d); sys.exit()
    for m in d:
        st = m.get("state", {}); p = m.get("policy", {})
        print("  %s id=%s url=%s publisher=%s stale=%s last=%s summary=%r unhealthy=%s healthy=%s notice=%s" % (
            m.get("service"), m.get("id")[:8], m.get("url"), p.get("publisher"), p.get("staleAfterSeconds"), st.get("lastStatus"),
            st.get("lastSummary"), st.get("unhealthyStreak"), st.get("healthyStreak"), st.get("openCommunicationId") or st.get("openNotice") or st.get("incidentCommunicationId")))
elif cmd == "monid":
    for m in (d if isinstance(d, list) else []):
        if m.get("service") == arg[0]: print(m.get("id")); break
elif cmd == "monfull":
    for m in (d if isinstance(d, list) else []):
        if m.get("service") == arg[0]: print(json.dumps(m.get("state"), separators=(",", ":")))
elif cmd == "inst":
    items = d if isinstance(d, list) else d.get("items", d)
    if not isinstance(items, list): print("  ", d); sys.exit()
    for i in items:
        print("  %s status=%s left=%s lastSeen=%s msg=%r comps=%s ns=%s node=%s cluster=%s version=%s sidecar=%s" % (
            i.get("instanceId") or i.get("id"), i.get("status"), i.get("left"), (i.get("lastSeenAt") or "")[11:23], i.get("message"),
            json.dumps(i.get("components") or i.get("failing"), separators=(",", ":")), i.get("namespace"), i.get("node"), i.get("cluster"), i.get("version"), i.get("sidecar")))
elif cmd == "feed":
    for i in d.get("items", []):
        print("  %s %s %r status=%s sev=%s publisher=%s ref=%s startsAt=%s" % (i.get("id","")[:8], i.get("type"), i.get("title"), i.get("status"), i.get("severity"), i.get("publisher"), i.get("externalRef"), (i.get("startsAt") or "")[11:19]))
    if not d.get("items"): print("  (feed empty)")
elif cmd == "feedcount":
    print(len(d.get("items", [])))
elif cmd == "reqs":   # stub request log; arg[0] optional = start index
    start = int(arg[0]) if arg else 0
    prev = None; t0 = ts(d[0]["at"]) if d else None
    for k, r in enumerate(d[start:], start):
        b = r.get("body") or {}; inst = b.get("instance") or {}
        at = ts(r["at"])
        gap = "" if prev is None else "%+.1fs" % (at - prev).total_seconds()
        print("  #%02d %s %s answer=%s status=%s leaving=%s msg=%r comps=%s" % (k, r["at"][11:23], gap.rjust(7), r.get("answer"), b.get("status"), inst.get("leaving"), b.get("message"), json.dumps(b.get("components"), separators=(",", ":")) if b.get("components") else None))
        prev = at
elif cmd == "count":
    print(len(d))
elif cmd == "gaps":   # arrival gaps in seconds, from arg[0] (index) on
    start = int(arg[0]) if arg else 0
    ats = [ts(r["at"]) for r in d[start:]]
    g = [round((b - a).total_seconds(), 1) for a, b in zip(ats, ats[1:])]
    print("n=%d gaps=%s max=%s" % (len(ats), g, max(g) if g else None))
