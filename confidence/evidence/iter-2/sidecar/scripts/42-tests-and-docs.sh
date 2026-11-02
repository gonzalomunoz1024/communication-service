#!/bin/bash
# vs2: test-change hygiene since iteration 1, README /status table vs live keys, README env table vs config.go, README build command on the host, doc claims with file references
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar2; EV=/home/claude/communication-service/confidence/evidence/iter-2/sidecar
cd /home/claude/communication-service
echo "== $(date -u +%FT%TZ) head $(git rev-parse --short HEAD) branch $(git branch --show-current); working tree (sidecar): $(git status --short sidecar | wc -l) modified files"
echo "## 1. sidecar commits since the iteration-1 head 0e14838"; git log --oneline 0e14838..HEAD -- sidecar
echo "## 2. test files changed"; git diff --stat 0e14838..HEAD -- 'sidecar/**/*_test.go' | cat
echo "   removed lines in *_test.go (all of them):"; git diff 0e14838..HEAD -- 'sidecar/**/*_test.go' | grep '^-[^-]' | sed 's/^/     /'
echo "   removed assertion lines (t.Error|t.Fatal|Errorf|Fatalf): $(git diff 0e14838..HEAD -- 'sidecar/**/*_test.go' | grep '^-[^-]' | grep -cE 't\.(Error|Fatal)')"
echo "   t.Skip sites now:"; grep -rn 't.Skip' sidecar --include='*_test.go' | sed 's/^/     /'
echo "   TestAppThatStopsListeningStaysDownUntilItIsBack: assertions added (+) / removed (-):"; git diff 0e14838..HEAD -- sidecar/internal/agent/agent_test.go | awk '/^@@.*TestAppThatStopsListening/,/^@@.*TestAppNeverSeenUp/' | grep -E '^[-+].*(t\.Error|t\.Fatal|not listening)' | sed 's/^/     /' | head -8
echo "## 3. README /status table vs the live keys"
python3 - $EV/10-lifecycle.txt $EV/11-ladder.txt <<'PY'
import re,sys,ast
readme=open("sidecar/README.md").read()
_,_,table=readme.partition("`/status` answers with:")
doc=set()
for line in table.split("\n"):
    if line.startswith("|"):
        first=line.split("|")[1]
        if "Field" in first or "---" in first: continue
        doc|=set(re.findall(r"`([A-Za-z]+)`", first))
live=set()
for p in sys.argv[1:]:
    for m in re.finditer(r"(?:raw /status keys|send error is set \(for the README field check\)): (\[[^\]]+\])", open(p).read()): live|=set(ast.literal_eval(m.group(1)))
print("   README table:", sorted(doc)); print("   live keys (10: no error, 11: with sendError):", sorted(live))
print("   documented but never seen:", sorted(doc-live) or "none", "| seen but undocumented:", sorted(live-doc) or "none")
PY
echo "## 4. README configuration table vs the variables config.go reads"
python3 - <<'PY'
import re
cfg=open("sidecar/internal/config/config.go").read(); readme=open("sidecar/README.md").read()
code=set(re.findall(r'(?:str|num|dur|boolean)\("([A-Z_]+)"', cfg))|set(re.findall(r'ParsePortRanges\(str\("([A-Z_]+)"', cfg))
_,_,table=readme.partition("## Configuration"); table=table.split("## Debugging")[0]
doc=set(re.findall(r"`((?:CS_|POD_|NODE_)[A-Z_]+)`", table))
print("   code reads:", sorted(code)); print("   in code, not in README table:", sorted(code-doc) or "none", "| in README table, not in code:", sorted(doc-code) or "none")
PY
echo "## 5. README build command on the host (go 1.24.7 host, toolchain switch): go build -ldflags=\"-s -w -X main.version=1.0.0\" -o health-sidecar ./cmd/health-sidecar"
(cd sidecar && go build -ldflags="-s -w -X main.version=1.0.0" -o $W/bin/health-sidecar-readme ./cmd/health-sidecar); echo "   exit=$? size=$(stat -c %s $W/bin/health-sidecar-readme) bytes, $(go version -m $W/bin/health-sidecar-readme | head -1 | awk '{print $2}')"
env -i CS_ENDPOINT=http://127.0.0.1:1 CS_TENANT=retail CS_SERVICE=demo CS_PORT=19392 CS_PROBE=tcp CS_LISTEN=127.0.0.1:19392 CS_INTERVAL=1s $W/bin/health-sidecar-readme >/dev/null 2>&1 & pid=$!; sleep 1
echo "   /status.version = $(curl -s http://127.0.0.1:19392/status | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])') (README: VERSION becomes the binary's version)"; kill -TERM $pid; wait $pid 2>/dev/null; echo "   exit after SIGTERM: $?"
echo "## 6. README 'Build' section claims"; sed -n '/^## Build/,$p' sidecar/README.md | grep -nE 'Go 1.25|go-toolset|REVISION|VERSION|skip|CI' | sed 's/^/   /'
echo "   go.mod: $(grep '^go ' sidecar/go.mod) | Dockerfile: $(grep -oE 'go-toolset:[0-9.]+' sidecar/Dockerfile) GOTOOLCHAIN=$(grep -oE 'GOTOOLCHAIN=[a-z]+' sidecar/Dockerfile)"
echo "## 7. README send-policy and log claims vs measured (file refs)"
echo "   L105-106 'probed once more after 2 s before it counts'           -> 13-variants CASE 1/2 (one failed request: UP kept; RETRY_DELAY=0: DOWN sent)"
echo "   L107-112 'while UP: change + heartbeat 30 s; not UP: every probe' -> 12-send-policy PHASE 1 (1 report/30 s UP) PHASE 2 (5 reports/30 s DOWN, gaps 5.0-5.6 s) PHASE 5 (UNKNOWN every probe); 10-lifecycle A2/B0 (+1 vs +7 per 30 s)"
echo "   L113-118 startup grace / pinned never-UP                        -> 10-lifecycle STEP F, 13-variants CASE 6/7"
echo "   L119-123 'app is not listening (last target …) from the probe that finds its port gone' -> 10-lifecycle STEP B (+3.6 s), 11-ladder log, 12-send-policy"
echo "   L124-125 SIGTERM leaving                                          -> 10-lifecycle STEP E/G, 11-ladder STEP 7"
echo "   L126-127 backoff up to 60 s                                       -> 16-failure-paths CASE 1/2 (1,2,4 s); shared pod log 03:43-03:50 'in':'1m0s' (docker logs sidecar, read-only)"
echo "   L179-182 INFO on change, DEBUG in between                         -> 10-lifecycle STEP B/H, 12-send-policy PHASE 2/3"
echo "   L184-196 /status table + pinned by TestStatusJSONMatchesTheDocumentedContract -> §3 above; agent_test.go:$(grep -n 'func TestStatusJSONMatchesTheDocumentedContract' sidecar/internal/agent/agent_test.go | cut -d: -f1)"
echo "   L19 'about 10 MB image on UBI micro'                               -> NOT VERIFIABLE here (UBI registry blocked; distroless stand-in 16.3 MB, binary 6.8 MB)"
echo "   L166-167 '/status shows … the last probe result, the last report sent' vs table L192 'the last report composed' -> wording: lastReport is the last report COMPOSED (10-lifecycle: lastReport changes while reportsSent does not, e.g. STEP B +3.6 s sent=13 then +4.2 s sent=14)"
echo "## 8. the shared pod (health-sidecar:ci = ci-iter2, read-only): $(curl -s http://127.0.0.1:19465/status | python3 -c 'import json,sys; d=json.load(sys.stdin); print("version", d["version"], "target", d.get("target"), "upSeen", d["upSeen"], "reportsSent", d["reportsSent"], "sendError", d.get("sendError"))')"
echo "   log levels since start: $(docker logs sidecar 2>&1 | python3 -c 'import json,sys,collections; c=collections.Counter(); [c.update([(json.loads(l)["level"], json.loads(l)["msg"])]) for l in sys.stdin if l.strip()]; print(dict(c))')"
echo "## DONE"
