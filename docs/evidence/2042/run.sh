#!/bin/bash
# Hand e2e for #2042: each payload piped into the real built deep-hook, hub stopped, then with a dev hub running.
printf "\033[8;44;165t"; clear
W=$(cd "$(dirname "$0")/../../.." && pwd)
E=$(cd "$(dirname "$0")" && pwd)
NODE=$HOME/.nvm/versions/node/v24.22.0/bin/node
H=/tmp/e2e-2042
rm -rf "$H"
mkdir -p "$H/.deepbuild" "$H/w"
chmod 700 "$H/.deepbuild"
cp "$W/crates/deep-hook/default-rules.json" "$H/.deepbuild/rules.json"
printf '%s\n' '{"asks":{"deadline":{"taste":"3d","authority":"1d","unblock":"2d","exception":"2d","choice":"2d","definition":"4h"},"default":{"taste":"recommended","authority":"no","unblock":"stay-blocked","exception":"no-change","choice":"recommended","definition":"leave-out"},"fallback":["change-owner"],"fold":5}}' > "$H/.deepbuild/config.json"
VERSION=$("$NODE" -p "require('$W/packages/cli/package.json').version")
printf '{"version":"%s","at":"%s"}\n' "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$H/.deepbuild/setup-finished.json"
/usr/bin/python3 -I "$E/payloads.py" "$H/payloads"
HOOK="$W/target/debug/deep-hook"

feed() {
  local f=$1
  local err code words
  err=$(env -i HOME="$H" PATH=/usr/bin:/bin LC_ALL=C "$HOOK" claude-code PreToolUse < "$H/payloads/$f" 2>&1 >/dev/null)
  code=$?
  words=$(printf '%s\n' "$err" | grep -e 'DeepBuild' | head -1 | cut -c1-118)
  [ -z "$words" ] && words="(allowed, nothing printed)"
  printf '%-24s exit %s  %s\n' "$f" "$code" "$words"
}

echo "== #2042 hand e2e: deep-hook $(cd "$W" && /usr/bin/git rev-parse --short HEAD) (the fix), shipped rules.json, load $(sysctl -n vm.loadavg)"
echo "-- hub STOPPED (nothing listens at $H/.deepbuild/hub.sock)"
for f in $(ls "$H/payloads"); do feed "$f"; done

echo "-- starting a dev hub"
env -i HOME="$H" PATH="$(dirname "$NODE"):/usr/bin:/bin" XDG_CONFIG_HOME="$H/.config" XDG_CACHE_HOME="$H/.cache" LC_ALL=C \
  "$NODE" "$W/packages/cli/dist/main.js" hub run > "$H/hub.out" 2> "$H/hub.err" &
HUB=$!
for i in $(seq 1 600); do grep -q '"ready":true' "$H/hub.out" 2>/dev/null && break; sleep 0.1; done
echo "-- hub RUNNING, pid $HUB: $(head -1 "$H/hub.out" | cut -c1-60)"
# Warm-up calls, as a just-started hub is slow at first.
for i in 1 2 3; do feed 08-valid-ls > /dev/null; done
for f in $(ls "$H/payloads"); do feed "$f"; done
echo "-- stopping the hub this run started, by its pid $HUB"
kill "$HUB"
wait "$HUB" 2>/dev/null
kill -0 "$HUB" 2>/dev/null && echo "hub $HUB still running" || echo "hub $HUB stopped"
echo "== done"
