S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar2
IMG=gcr.io/distroless/static-debian12:latest; V="-v $W/bin:/bin-ro:ro"; J="python3 $W/j.py"
SEC="--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges"
BE=http://127.0.0.1:19300; BEC=http://172.17.0.1:19300
ts(){ date -u +%H:%M:%S.%3N; }
st(){ curl -s --max-time 2 http://127.0.0.1:$1/status | $J status; }
raw(){ curl -s --max-time 2 http://127.0.0.1:$1/status; }
mon(){ curl -s --max-time 3 -H "X-Client-Id: vs2-verifier" "$BE/v1/health/monitors?tenantId=$1" | $J mon; }
monid(){ curl -s --max-time 3 -H "X-Client-Id: vs2-verifier" "$BE/v1/health/monitors?tenantId=$1" | $J monid $2; }
inst(){ local id=$(monid $1 $2); if [ -z "$id" ]; then echo "  (no monitor for $2)"; return; fi; curl -s --max-time 3 -H "X-Client-Id: vs2-verifier" "$BE/v1/health/monitors/$id/instances" | $J inst; }
feed(){ curl -s --max-time 3 -H "X-Client-Id: vs2-verifier" "$BE/v1/feed?tenantId=$1" | $J feed; }
fc(){ curl -s --max-time 3 -H "X-Client-Id: vs2-verifier" "$BE/v1/feed?tenantId=$1" | $J feedcount; }
feedid(){ curl -s --max-time 3 -H "X-Client-Id: vs2-verifier" "$BE/v1/feed?tenantId=$1" | $J feedid; }
nreq(){ curl -s --max-time 3 http://127.0.0.1:$1/__requests | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'; }
reqs(){ curl -s --max-time 3 http://127.0.0.1:$1/__requests; }
logshape(){ # $1 = log file: JSON check + (level,msg) tally
python3 - "$1" <<'PY'
import json,sys,collections
lines=open(sys.argv[1]).read().splitlines(); bad=0; c=collections.Counter(); keys=set()
for l in lines:
    try: d=json.loads(l); c[(d.get("level"),d.get("msg"))]+=1; keys|=set(d)
    except Exception: bad+=1
print("  lines:",len(lines),"non-JSON:",bad,"keys seen:",sorted(keys))
for (lv,m),n in sorted(c.items(), key=lambda x:(-x[1],str(x))): print("   %3d  %-5s %s"%(n,lv,m))
PY
}
