#!/bin/bash
# One e2e case: start the stand-in Gmail, run the driver against it, stop the stand-in by its own PID.
# Usage: one.sh <repo> <case>
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
E=$(cd "$(dirname "$0")" && pwd)
REPO=$1
CASE=$2
LOG=$(mktemp /tmp/dh1889-standin-XXXXXX)
node "$E/standin.mjs" "$CASE" > "$LOG" 2>&1 &
SPID=$!
for i in $(seq 1 50); do grep -q '^PORT ' "$LOG" && break; sleep 0.1; done
PORT=$(grep '^PORT ' "$LOG" | awk '{print $2}')
echo "== case $CASE: stand-in Gmail PID $SPID on 127.0.0.1:$PORT (git $(/usr/bin/git -C "$REPO" rev-parse --short HEAD), gmail find: $(/usr/bin/git -C "$REPO" diff --quiet HEAD -- packages/sources/gmail/index.ts && echo as committed || echo working tree))"
node "$E/drive.mjs" "$REPO" "$PORT" "$CASE"
CODE=$?
kill -TERM "$SPID"
wait "$SPID" 2>/dev/null
echo "-- stand-in log:"
grep -v '^PORT ' "$LOG"
rm -f "$LOG"
echo "== case $CASE: driver exit $CODE"
exit $CODE
