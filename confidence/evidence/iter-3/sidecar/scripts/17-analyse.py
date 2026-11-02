# Recomputes the G-3-29 figures from the recorded data (stub request lines / sidecar WARN lines), naive UTC.
import re, sys, json, datetime
def t(hms): return datetime.datetime.strptime(hms[:12], "%H:%M:%S.%f")
mode, path = sys.argv[1], sys.argv[2]
txt = open(path).read()
if mode == "a":
    down = t(re.search(r"(\d\d:\d\d:\d\d\.\d{3}) two accepted reports", txt).group(1))
    up = t(re.search(r"(\d\d:\d\d:\d\d\.\d{3}) service answers 202 again", txt).group(1))
    reqs = [(t(m.group(1)), int(m.group(2))) for m in re.finditer(r"#\d\d (\d\d:\d\d:\d\d\.\d{3})\s+\S*\s*answer=(\d+)", txt)]
    att = [r for r in reqs if r[0] >= down]
    i = next(k for k, r in enumerate(att) if r[1] == 202)
    gaps = [round((b[0] - a[0]).total_seconds(), 1) for a, b in zip(att[:i], att[1:i + 1])]
    print("  refused attempts: %d (first %.1f s after the last accepted report: the heartbeat)" % (i, (att[0][0] - [r for r in reqs if r[0] < down][-1][0]).total_seconds()))
    print("  gaps from each refused attempt to the next attempt: %s  max %.1f s (cap 30 s)" % (gaps, max(gaps)))
    print("  first accepted attempt: %.1f s after the service answered 202 again, %.1f s after the last refused attempt" % ((att[i][0] - up).total_seconds(), gaps[-1]))
else:
    up = t(re.search(r"(\d\d:\d\d:\d\d\.\d{3}) the service listens again", txt).group(1))
    acc = [t(m.group(1)) for m in re.finditer(r"#\d\d (\d\d:\d\d:\d\d\.\d{3})\s+\S*\s*answer=202", txt)]
    warn = []
    for l in open(sys.argv[3]):
        try: d = json.loads(l)
        except Exception: continue
        if d.get("msg") == "report failed; will retry": warn.append((t(d["time"][11:23]), d.get("in"), d.get("error")))
    print("  refused attempts (WARN lines): %d, steps %s" % (len(warn), [w[1] for w in warn]))
    print("  attempt times: %s" % [w[0].strftime("%H:%M:%S.%f")[:12] for w in warn])
    print("  first refused attempt %.1f s after the first accepted report (the 45 s heartbeat rounded to a tick)" % (warn[0][0] - acc[0]).total_seconds())
    g = [round((b[0] - a[0]).total_seconds(), 1) for a, b in zip(warn, warn[1:])]
    first_ok = [a for a in acc if a > up][0]
    g.append(round((first_ok - warn[-1][0]).total_seconds(), 1))
    print("  gaps from each refused attempt to the next attempt: %s  max %.1f s (cap 30 s; the interval is 45 s)" % (g, max(g)))
    print("  first accepted attempt: %.1f s after the service listened again, %.1f s after the last refused attempt" % ((first_ok - up).total_seconds(), g[-1]))
    print("  error text of a refused attempt: %s" % warn[0][2][:140])
