#!/bin/sh
# A stand-in for one Claude Code process (README: The fixture). It runs deep-hook as Claude Code runs a hook entry:
# as its own child, the hook's JSON on stdin, in the session's folder, so every hook names this process as its parent.
#
#   sh agent.sh <deep-hook> <steps folder> [<loop folder>]
#
# <steps folder>/NN-<Event>.json run in name order, each as `deep-hook claude-code <Event>`; after each it prints
# `hook <Event> <exit code>`, then `ready` once all have run. With no loop folder it then waits, as an agent at its
# prompt does, until the test stops it by PID. With one it keeps working: every few seconds the PostToolUse of its
# current Bash call and the PreToolUse of the next, from <loop folder>/post.json and pre.json with @N@ the call's
# number, the first call (0) being the last step's.
hook=$1
steps=$2
loop=$3
for f in "$steps"/*.json; do
  name=$(basename "$f" .json)
  event=${name#*-}
  "$hook" claude-code "$event" < "$f" > /dev/null 2>&1
  echo "hook $event $?"
done
echo ready
if [ -z "$loop" ]; then exec sleep 3600; fi
n=0
while :; do
  sleep 3
  sed "s/@N@/$n/g" "$loop/post.json" > "$loop/now.json"
  "$hook" claude-code PostToolUse < "$loop/now.json" > /dev/null 2>&1
  n=$((n + 1))
  sed "s/@N@/$n/g" "$loop/pre.json" > "$loop/now.json"
  "$hook" claude-code PreToolUse < "$loop/now.json" > /dev/null 2>&1
done
