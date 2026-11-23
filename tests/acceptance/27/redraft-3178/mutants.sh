#!/bin/bash
# The wrong programs no DEEP_HUB_PLANT or named twin reaches (README: Criteria to tests), each a one-line mutant of the
# hub's built dist laid over an APFS clone of a built checkout, and waits.test.ts run there. Nothing in the checkout
# itself changes.
#   bash mutants.sh <built checkout> <scratch folder> <hold-end-unrecorded | run-without-deadline | overrun-dropped>
# Its log is <scratch folder>/<mutant>.log and its diff <scratch folder>/<mutant>.diff; the clone is
# <scratch folder>/<mutant>/ (remove it when done).
set -u
SRC=$1; OUT=$2; MUTANT=$3
CLONE=$OUT/$MUTANT
rm -rf "$CLONE"
cp -cR "$SRC" "$CLONE" || exit 9
case $MUTANT in
  # The unanswered hold's case: a hold that runs out with the question open ends with nothing on the record.
  hold-end-unrecorded)
    FILE=$CLONE/packages/hub/dist/stop-judging.js
    OLD='            if (asks.length)
                await this.options.events.appendReading(session, meta.agent, `This stop was held'
    NEW='            if (false)
                await this.options.events.appendReading(session, meta.agent, `This stop was held' ;;
  # The check run's case: deep_run starts the run without the deadline its spec gives.
  run-without-deadline)
    FILE=$CLONE/packages/hub/dist/mcp-operations.js
    OLD='cwd: tree.dir, deadline_ms: deadline ?? null });'
    NEW='cwd: tree.dir, deadline_ms: null });' ;;
  # The agent command's case: a call past its expected time is never recorded as an overrun.
  overrun-dropped)
    FILE=$CLONE/packages/hub/dist/core-worker.js
    OLD='return void core.overrun(message).catch(() => undefined);'
    NEW='return;' ;;
  *) echo "unknown mutant $MUTANT"; exit 2 ;;
esac
# One literal replacement, of a text found exactly once.
OLD="$OLD" NEW="$NEW" /usr/bin/python3 -I -c '
import os, sys
f = sys.argv[1]; t = open(f).read(); old = os.environ["OLD"]
if t.count(old) != 1: sys.exit(f"BLOCKED: the mutant text is in {f} {t.count(old)} times, not once")
open(f, "w").write(t.replace(old, os.environ["NEW"]))' "$FILE" || exit 3
# The mutant must have changed the file, or the run would prove nothing.
if /usr/bin/cmp -s "$FILE" "$SRC/${FILE#$CLONE/}"; then echo "BLOCKED: $MUTANT left $FILE unchanged"; exit 3; fi
/usr/bin/diff "$SRC/${FILE#$CLONE/}" "$FILE" > "$OUT/$MUTANT.diff"
cd "$CLONE" || exit 9
echo "mutant $MUTANT at $(date), load $(sysctl -n vm.loadavg)" > "$OUT/$MUTANT.log"
npx vitest run tests/acceptance/27/redraft-3178/waits.test.ts --reporter=verbose >> "$OUT/$MUTANT.log" 2>&1
echo "exit $? at $(date), load $(sysctl -n vm.loadavg)" >> "$OUT/$MUTANT.log"
