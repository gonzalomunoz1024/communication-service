#!/usr/bin/env bash
source "$(dirname "$0")/env.sh"
for p in A B; do [ -f "$S/backend$p.pid" ] && kill "$(cat "$S/backend$p.pid")" 2>/dev/null; done
[ -f "$S/vite.pid" ] && kill "$(cat "$S/vite.pid")" 2>/dev/null
pkill -f "vite preview --host 127.0.0.1 --port $UI_PORT" 2>/dev/null
docker rm -f $(docker ps -aq --filter name=e2e3-) 2>/dev/null
echo "private stack down"
