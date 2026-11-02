#!/usr/bin/env bash
# G-4-30 mutation check: the repository's spec 07, unchanged, on a fresh compose stack built from the iteration-3 code
# (jar of 4a0e84e = scratchpad/communication-service-iter3.jar, frontend of 6c15715) or, as the control, the code under
# test (iteration-4 jar, the repo's frontend/dist). Harness: a copy of e2e/ (tests byte-identical), images renamed e2e4-mut-*.
# mut-run.sh <iter3|iter4>
set -u
SCR=/tmp/claude-0/-home-claude-communication-service/108be4b6-9bf3-5769-a509-9fa03f369540/scratchpad
S=$SCR/e2e4; M=$S/mut; H=$M/h
case ${1:-} in
  iter3) cp $SCR/communication-service-iter3.jar $H/build/libs/communication-service-0.0.1-SNAPSHOT.jar; ln -sfn $M/iter3/frontend $H/frontend ;;
  iter4) cp $SCR/communication-service-iter4.jar $H/build/libs/communication-service-0.0.1-SNAPSHOT.jar; ln -sfn /home/claude/communication-service/frontend $H/frontend ;;
  *) echo "usage: mut-run.sh iter3|iter4"; exit 2 ;;
esac
export MUT_TAG=$1 GO_IMAGE=local/go-toolset:1.27 BASE_IMAGE=gcr.io/distroless/static-debian12:nonroot VERSION=mut-$1 REVISION=mut-$1
cd $H/e2e
echo "== $(date -u +%FT%TZ) variant $1: jar sha256 $(sha256sum $H/build/libs/*.jar | cut -c1-16), frontend $(readlink $H/frontend), dist $(ls $H/frontend/dist/assets/*.js | xargs -n1 basename)"
diff -r /home/claude/communication-service/e2e/tests tests >/dev/null && echo "tests/ byte-identical to the repository's"
./stack.sh down >/dev/null 2>&1
./stack.sh up 2>&1 | grep -E 'stack:' | tail -3
npx playwright test tests/07-f92-database-down.spec.ts 2>&1 | grep -v -E '^\s*$|WebServer|^\s+at ' | cut -c1-600
echo "playwright exit=${PIPESTATUS[0]}"
./stack.sh down >/dev/null 2>&1; echo "stack down; $(docker ps -a --filter name=e2e- --format '{{.Names}}' | wc -l) e2e-* containers left"
