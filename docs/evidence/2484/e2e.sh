#!/bin/bash
# #2484 hand e2e: a PATH lsof that warns of mounts it can't stat, then the slot check and a port really in use.
E=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$E/../../.." && pwd)
export PATH=$E/bin:$PATH
export LSOF_LOG=$(mktemp); trap 'rm -f "$LSOF_LOG"' EXIT
chmod +x "$E/bin/lsof"; : > "$LSOF_LOG"
cd "$R" || exit 9
clear
echo "== #2484 e2e at $(/usr/bin/git log --oneline -1 | cut -c1-60)"
echo "== lsof on PATH: $(command -v lsof | sed "s#$E#docs/evidence/2484#") (the real one: /usr/sbin/lsof)"
echo "== 1. the warning lsof, without -w, on a pid that listens on nothing:"
LC_ALL=C lsof -nP -a -iTCP -sTCP:LISTEN -p $$ -Fn; echo "   status=$?"
echo "== 2. the same call with -w:"
LC_ALL=C lsof -w -nP -a -iTCP -sTCP:LISTEN -p $$ -Fn; echo "   status=$?"
echo "== 3. node scripts/slots-check.mjs under this lsof:"
: > "$LSOF_LOG"
node scripts/slots-check.mjs; echo "   exit=$?"
echo "   lsof calls the check made: $(wc -l < "$LSOF_LOG" | tr -d ' '), with -w: $(grep -c -e '^-w ' "$LSOF_LOG")"
echo "== 4. the environment kit under this lsof: reference fill, then a fill with a port really in use beside its lease:"
node "$E/port.mjs" "$R"; echo "   exit=$?"
echo "== done"
