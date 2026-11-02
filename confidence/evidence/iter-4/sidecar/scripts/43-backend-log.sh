#!/bin/bash
# The two private backends' logs (A :19300 on the shared Mongo db vs4_main; B :19302 on vs4-mongo), summarised:
# levels, stack frames, request lines by status, every non-request INFO and every WARN message grouped.
W=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad/sidecar4
mask(){ sed -E 's/^[0-9T:.Z-]+ +(INFO|WARN|ERROR|DEBUG) [0-9]+ --- \[[^]]*\] /\1 /; s/[0-9a-f]{8}-[0-9a-f-]{27}/<id>/g; s/[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.]+Z?( UTC)?/<t>/g; s/\(([0-9]+) ms\)/(N ms)/; s/vs4-[a-z0-9-]+/<vs4-…>/g; s/[a-z0-9-]+-7f9c6d5b4-[a-z0-9]+/<pod>/g; s/client=[^ ]+/client=<id>/' | awk '{$1=$1};1' | cut -c1-${1:-150}; }
for f in backend-19300 backend-19302; do
  L=$W/logs/$f.txt
  echo "### $f: $(wc -l < $L) lines; INFO $(grep -c ' INFO ' $L), WARN $(grep -c ' WARN ' $L), ERROR $(grep -c ' ERROR ' $L), DEBUG $(grep -c ' DEBUG ' $L); stack-trace frames (lines starting with 'at '): $(grep -cE '^\s+at ' $L)"
  echo "  request lines (ClientIdWebFilter, INFO, with the client id) by method/path/status:"
  grep 'ClientIdWebFilter' $L | grep -oE '(GET|POST|PUT|DELETE|OPTIONS) /[^ ?]*[^ ]* -> [0-9]{3}' | sed -E 's/\?[^ ]*//; s#/[0-9a-f]{8}-[0-9a-f-]{27}#/{id}#g' | sort | uniq -c | sort -rn | head -12 | sed 's/^/   /'
  echo "  other INFO messages (grouped, ids masked):"
  grep ' INFO ' $L | grep -v ClientIdWebFilter | grep -vE 'Started|Starting|Netty|No active profile|Mongo|cluster|Monitor thread|Bootstrapping|Finished Spring|Exposing|Tomcat|Initializ|Using|Opened connection|Adding discovered|Picked up|LiveReload|Version' | mask 130 | sed -E 's/(after|in) [0-9.]+ ?s/\1 N s/g' | sort | uniq -c | sort -rn | head -16 | sed 's/^/   /'
  echo "  WARN messages (grouped):"
  grep ' WARN ' $L | mask 150 | sort | uniq -c | sort -rn | head -10 | sed 's/^/   /'
  echo "  secret-looking strings: $(grep -ciE 'bearer |api[_-]?key|secret=|token=' $L) (the only 'password' text is the Mongo driver's settings dump 'password=null': $(grep -c 'password=null' $L) line(s))"
done
