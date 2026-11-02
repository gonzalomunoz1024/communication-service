#!/usr/bin/env bash
# hung-db-timing.sh — README "When Mongo is down": a database that hangs (docker pause) answers 503 after "about 20 s (15 s for a write)".
# One call per pause, issued alone right after the pause, on private backend B (:19601) over its own ux4-mongo.
B=http://127.0.0.1:19601; H='X-Client-Id: ux4-reviewer'; CT='Content-Type: application/json'
ready(){ for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' $B/actuator/health/readiness)" = 200 ] && return 0; sleep 1; done; return 1; }
one(){ local label=$1; shift; docker pause ux4-mongo >/dev/null; local out; out=$(curl -s -o /tmp/hung.$$ -w '%{http_code} %{time_total}s' "$@"); printf '%-34s -> %s %s\n' "$label" "$out" "$(head -c 120 /tmp/hung.$$)"; docker unpause ux4-mongo >/dev/null; ready; sleep 6; }
date -u +'start %FT%TZ'
one "publish (a write)"       -X POST $B/v1/communications -H "$H" -H "$CT" -d '{"tenantId":"ux4-hung","publisher":"ux4","type":"OUTAGE","severity":"MINOR","title":"hung db timing"}'
one "GET /v1/feed (a read)"   $B'/v1/feed?tenantId=ux4-hung' -H "$H"
one "publish again (a write)" -X POST $B/v1/communications -H "$H" -H "$CT" -d '{"tenantId":"ux4-hung","publisher":"ux4","type":"OUTAGE","severity":"MINOR","title":"hung db timing 2"}'
date -u +'end %FT%TZ'; rm -f /tmp/hung.$$
