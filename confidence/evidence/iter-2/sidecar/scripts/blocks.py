import sys, yaml, json
# usage: blocks.py <label=file> ... ; prints the sidecar block (sorted JSON) per file and the pairwise key diffs
def sidecar(stream):
    for doc in yaml.safe_load_all(stream):
        if not doc or doc.get("kind") not in ("Deployment", "StatefulSet"): continue
        spec = doc["spec"]["template"]["spec"]
        for lst in ("containers", "initContainers"):
            for c in spec.get(lst) or []:
                if c.get("name") == "health-sidecar":
                    return doc["kind"] + "/" + doc["metadata"]["name"], lst, c
    return None, None, None
def flat(o, p=""):
    out = {}
    if isinstance(o, dict):
        for k, v in o.items(): out.update(flat(v, p + "." + str(k)))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            key = v.get("name") if isinstance(v, dict) and "name" in v else str(i)
            out.update(flat(v, p + "[" + str(key) + "]"))
    else: out[p] = o
    return out
forms = {}
for arg in sys.argv[1:]:
    label, path = arg.split("=", 1)
    wl, lst, c = sidecar(open(path).read())
    if c is None: print("%s: NO health-sidecar block" % label); continue
    f = flat(c)
    forms[label] = f
    print("%s: %s %s keys=%d restartPolicy=%s image=%s" % (label, wl, lst, len(f), c.get("restartPolicy"), c.get("image")))
labels = list(forms)
base = labels[0]
for other in labels[1:]:
    a, b = forms[base], forms[other]
    diff = sorted(set(a.items()) ^ set(b.items()))
    print("diff %s vs %s: %s" % (base, other, "none" if not diff else ""))
    for k, v in diff:
        if k == ".restartPolicy": continue
        print("   %s: %s=%r %s=%r" % (k, base, a.get(k), other, b.get(k)))
