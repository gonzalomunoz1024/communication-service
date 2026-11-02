import json, sys
cmd = sys.argv[1]
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    print("<unparseable: %s>" % raw[:140].replace("\n", " ")); sys.exit(0)
def items(x, *keys):
    if isinstance(x, list): return x
    for k in keys:
        if isinstance(x, dict) and isinstance(x.get(k), list): return x[k]
    return [x]
def pick(o, keys): return {k: o.get(k) for k in keys if k in o}
MK = ["id","service","status","openNoticeId","openCommunicationId","noticeId","communicationId","consecutiveDown","consecutiveUp","downStreak","upStreak","instances","instanceCount","lastReportAt","lastChangeAt","publisher","paused","stale"]
if cmd == "status":
    lr = d.get("lastReport") or {}
    print("status=%s target=%r lastTarget=%r upSeen=%s msg=%r comps=%s sent=%s sendErr=%r" % (lr.get("status"), d.get("target"), d.get("lastTarget"), d.get("upSeen"), lr.get("message"), json.dumps(lr.get("components"), separators=(",",":")) if lr.get("components") else None, d.get("reportsSent"), (d.get("sendError") or "")[:70] or None))
elif cmd == "mon":
    for m in items(d, "content", "items", "monitors"):
        st = m.get("state") or {}
        print("  monitor", json.dumps(pick(m, MK), separators=(",", ":"))[:200], "state:", json.dumps(pick(st, ["lastStatus","lastSummary","consecutiveFailures","consecutiveSuccesses","openNoticeId","lastObservedAt","stale","paused"]), separators=(",", ":"))[:400])
elif cmd == "keys":
    xs = items(d, "content", "items", "monitors"); print(sorted(xs[0].keys()) if xs else [])
elif cmd == "monid":
    for m in items(d, "content", "items", "monitors"):
        if m.get("service") == sys.argv[2]: print(m.get("id")); break
elif cmd == "inst":
    xs = items(d, "content", "items", "instances")
    print("  instances:", len(xs))
    for i in xs: print("   ", json.dumps(i, separators=(",", ":"))[:440])
elif cmd == "feed":
    xs = items(d, "content", "items")
    print("  feed items:", len(xs))
    for i in xs: print("   ", json.dumps(pick(i, ["id","type","status","severity","service","title","summary","message","startsAt","expiresAt","publisher","source","retiredAt"]), separators=(",", ":"))[:440])
elif cmd == "feedcount":
    print(len(items(d, "content", "items")))
elif cmd == "feedid":
    xs = items(d, "content", "items"); print(xs[0].get("id") if xs else "")
elif cmd == "raw":
    print(json.dumps(d, separators=(",", ":"))[: int(sys.argv[2]) if len(sys.argv) > 2 else 900])
