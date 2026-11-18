#!/bin/bash
# #2801 hand e2e (macOS): start a dev hub in a throwaway home, then poll `deep hub status` every 2 s from the moment
# `deep hub start` returns; a second start polls hub.health on the socket every 100 ms from the moment the socket
# exists, to see every answer during the core's start. Paths are redacted in the output.
# Run from the repo root with Node 24 and a built checkout (npm run build --workspaces; cargo build --locked -p deep-hook).
set -u
CLI="$PWD/packages/cli/dist/main.js"
TMP=$(cd "$(mktemp -d -t e2801)" && pwd -P)
OWN="$HOME"
export HOME="$TMP/home"; mkdir -p "$HOME"
redact() { sed -e "s#$TMP#<tmp>#g" -e "s#${TMP#/private}#<tmp>#g" -e "s#$PWD#<repo>#g" -e "s#$OWN#~#g"; }
stop() { node "$CLI" hub stop --root "$1" >/dev/null 2>&1 || { echo "hub at $1 did not stop; its folder is kept" | redact; KEEP=1; }; }
KEEP=0
bad=0
echo "#2801 e2e: $(/usr/bin/git rev-parse --abbrev-ref HEAD) $(/usr/bin/git rev-parse --short HEAD)   node $(node -v)   load: $(sysctl -n vm.loadavg | tr -d '{}')"

R="$TMP/a"
echo; echo "\$ deep hub start --root <tmp>/a, then deep hub status every 2 s"
t0=$(date +%s)
node "$CLI" hub start --root "$R" 2>&1 | redact; code=${PIPESTATUS[0]}
echo "exit $code after $(( $(date +%s) - t0 )) s"; [ "$code" -eq 0 ] || bad=$((bad+1))
for i in $(seq 1 8); do
  out=$(node "$CLI" hub status --root "$R" 2>&1); code=$?
  echo "try $i  $(date +%T)  exit $code  $(echo "$out" | redact | cut -c1-150)"
  case "$out" in *TypeError*|*"Cannot read propert"*|*"no answer"*) bad=$((bad+1));; esac
  [ $code -eq 0 ] || bad=$((bad+1))
  sleep 2
done
stop "$R"

R="$TMP/b"
echo; echo "\$ deep hub start --root <tmp>/b, hub.health every 100 ms from the moment the socket exists"
node "$CLI" hub start --root "$R" > "$TMP/start-b.log" 2>&1 &
start=$!
for _ in $(seq 1 6000); do [ -S "$R/hub.sock" ] && break; sleep 0.01; done
node --input-type=module - "$R" > "$TMP/poll-b.log" 2>&1 <<'JS'
import { join } from 'node:path';
const { control } = await import(join(process.cwd(), 'packages/hub/dist/service.js'));
const root = process.argv[2], t0 = Date.now(), seen = new Map();
while (Date.now() - t0 < 150_000) {
  let key;
  try { await control(join(root, 'hub.sock'), join(root, 'control.token'), 'hub.health', {}, 2000); key = 'health JSON (pid, start, gates ...)'; }
  catch (e) { key = String(e.message).replace(/,"evidence":\[\]/, '').replace(/"path":"",/, '').slice(0, 170); }
  const s = seen.get(key) ?? { n: 0, first: Date.now() - t0 }; s.n++; seen.set(key, s);
  if (key.startsWith('health')) break;
  await new Promise((r) => setTimeout(r, 100));
}
for (const [key, s] of seen) console.log(`${String(s.n).padStart(3)} x from ${s.first} ms: ${key}`);
JS
wait $start; code=$?
echo "deep hub start exit $code"; [ "$code" -eq 0 ] || bad=$((bad+1))
redact < "$TMP/start-b.log"
redact < "$TMP/poll-b.log"
grep -q 'health JSON' "$TMP/poll-b.log" || bad=$((bad+1))
grep -qE 'TypeError|Cannot read propert' "$TMP/poll-b.log" && bad=$((bad+1))
stop "$R"
[ "$KEEP" -eq 0 ] && rm -rf "$TMP"
echo; [ $bad -eq 0 ] && echo "E2E OK: no internal error, no drop to no answer" || echo "E2E FAILED ($bad bad tries)"
