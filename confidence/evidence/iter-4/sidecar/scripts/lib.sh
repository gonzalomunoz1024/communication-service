# vs4 helpers (adapted from the iteration-3 verifier's lib.sh; names, ports and image changed to vs4).
S=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad; W=$S/sidecar4
R=/home/claude/communication-service
IMG=health-sidecar:vs4; STUBIMG=gcr.io/distroless/static-debian12:nonroot
P="python3 -I $W/scripts/vs4.py"
SEC="--user 1000660000:0 --read-only --cap-drop ALL --security-opt no-new-privileges"
BE=http://127.0.0.1:19300; BEC=http://172.17.0.1:19300; H='X-Client-Id: vs4-verifier'
ts(){ date -u +%H:%M:%S.%3N; }
st(){ curl -s --max-time 2 http://127.0.0.1:$1/status | $P status; }
raw(){ curl -s --max-time 2 http://127.0.0.1:$1/status; }
mon(){ curl -s --max-time 3 -H "$H" "${2:-$BE}/v1/health/monitors?tenantId=$1" | $P mon; }
monid(){ curl -s --max-time 3 -H "$H" "${3:-$BE}/v1/health/monitors?tenantId=$1" | $P monid $2; }
inst(){ local id=$(monid $1 $2 ${3:-$BE}); if [ -z "$id" ]; then echo "  (no monitor for $2)"; return; fi; curl -s --max-time 3 -H "$H" "${3:-$BE}/v1/health/monitors/$id/instances" | $P inst; }
feed(){ curl -s --max-time 3 -H "$H" "${2:-$BE}/v1/feed?tenantId=$1" | $P feed; }
reqs(){ curl -s --max-time 3 http://127.0.0.1:$1/__requests; }
nreq(){ reqs $1 | $P count; }
# netns pod: a holder container owns the namespace; host ports are published there.
pod(){ # $1 name, then -p mappings...
  local n=$1; shift
  docker run -d --name $n --user 65532:65532 "$@" -v $W/bin:/vs4:ro $STUBIMG /vs4/stub -mode hold >/dev/null
}
app(){ # $1 pod, $2 name, rest = stub args
  local p=$1 n=$2; shift 2
  docker run -d --name $n --network container:$p --user 1001:0 -v $W/bin:/vs4:ro $STUBIMG /vs4/stub "$@" >/dev/null
}
sidecar(){ # $1 pod, $2 name, rest = -e args
  local p=$1 n=$2; shift 2
  docker run -d --name $n --network container:$p $SEC "$@" $IMG >/dev/null
}
logshape(){ # $1 = log file
python3 -I - "$1" <<'PY'
import json,sys,collections
lines=open(sys.argv[1]).read().splitlines(); bad=0; c=collections.Counter(); keys=set()
for l in lines:
    try: d=json.loads(l); c[(d.get("level"),d.get("msg"))]+=1; keys|=set(d)
    except Exception: bad+=1
print("  lines:",len(lines),"non-JSON:",bad,"keys seen:",sorted(keys))
for (lv,m),n in sorted(c.items(), key=lambda x:(-x[1],str(x))): print("   %3d  %-5s %s"%(n,lv,m))
PY
}
cleanup(){ docker rm -f "$@" >/dev/null 2>&1; true; }
