import json, glob, os, collections, sys
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results')
by = collections.defaultdict(lambda: {'pass': 0, 'fail': 0, 'fails': []})
files = {}
for f in sorted(glob.glob(R + '/*.json')):
    try: d = json.load(open(f))
    except Exception as e: print('bad json', f, e); continue
    if not isinstance(d, list): continue
    name = os.path.basename(f)
    files[name] = (sum(1 for e in d if e['ok']), sum(1 for e in d if not e['ok']))
    for e in d:
        k = by[e['feature']]
        if e['ok']: k['pass'] += 1
        else: k['fail'] += 1; k['fails'].append(f"{name}: {e['name']}")
print('# Frontend verifier: automated browser checks, aggregated per feature (iter-0)\n')
print('| file | passed | failed |\n|---|---|---|')
for n, (p, f) in files.items(): print(f'| {n} | {p} | {f} |')
print('\n| feature | checks passed | checks failed | failed checks |\n|---|---|---|---|')
for feat in sorted(by): k = by[feat]; print(f"| {feat} | {k['pass']} | {k['fail']} | {'<br>'.join(k['fails']) or '-'} |")
