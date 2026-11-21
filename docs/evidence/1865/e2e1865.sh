#!/bin/bash
# #1865 hand e2e: an installed-root hub under a temp HOME (never the real ~/.deepbuild or launchd), the login service
# played by #1865's stand-in, the OS confirmation by a stub. Token values and temp paths are redacted in all output.
set -u
R=$(git rev-parse --show-toplevel)
NODEBIN=$(dirname "$(command -v node)")  # Node 24
NODE=$NODEBIN/node
CLI=$R/packages/cli/dist/main.js
CLIENT=$R/tests/acceptance/1865/fixtures/client.mjs
T=$(mktemp -d /tmp/e2e1865.XXXXXX)
mkdir -p "$T/home" "$T/bin" "$T/launchd"
printf '#!/bin/sh\nT1865_LAUNCHD=%s exec %s %s "$@"\n' "$T/launchd" "$NODE" "$R/tests/acceptance/1865/fixtures/launcher.mjs" > "$T/bin/launcher"
for n in launchctl systemctl; do printf '#!/bin/sh\necho "stand-in %s: not the real service manager" >&2\nexit 1\n' "$n" > "$T/bin/$n"; done
printf '#!/bin/sh\nprintf "%%s\\n" "$1" >> %s\n[ "$(cat %s)" = confirmed ]\n' "$T/asks.log" "$T/confirm.mode" > "$T/bin/confirm"
chmod +x "$T/bin/"*
echo cancelled > "$T/confirm.mode"; : > "$T/asks.log"
E=(env -i HOME="$T/home" PATH="$T/bin:$NODEBIN:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR="$T/" LC_ALL=C TERM="${TERM:-xterm}" DEEP_HUB_LAUNCHER="$T/bin/launcher" DEEP_HUB_TEST_CONFIRM="$T/bin/confirm")
SOCK="$T/home/.deepbuild/hub.sock"; TOK="$T/home/.deepbuild/control.token"
red() { local t=""; [ -f "$TOK" ] && t=$(cat "$TOK"); if [ -n "$t" ]; then sed -e "s|$t|<token>|g" -e "s|$T|<tmp>|g" -e "s|$HOME|~|g"; else sed -e "s|$T|<tmp>|g" -e "s|$HOME|~|g"; fi; }
deep() { "${E[@]}" "$NODE" "$CLI" "$@"; }
hub() { deep hub status 2>&1 | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const h=JSON.parse(s);console.log(`hub up: pid ${h.pid}, start ${h.start}`)}catch{console.log("hub: "+s.trim())}})' | red; }
raw() { "${E[@]}" "$NODE" "$CLIENT" "$SOCK" "$TOK" "$@" 2>&1 | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=s.trim().split("\n").at(-1);try{console.log("reply: "+JSON.stringify(JSON.parse(l).reply))}catch{console.log(l)}})' | red; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "1. Start the installed hub (temp HOME, stand-in login service); OS confirmation stub: cancelled"
deep hub start 2>&1 | red; hub

step "2. A token holder sends hub.stop() straight to the socket, naming no process"
raw hub.stop '{}'; sleep 3; hub

step "3. The same, naming its process: the hub asks the OS, which cancels"
raw hub.stop '{}' --peer; sleep 3; hub
echo "asks the OS saw: $(wc -l < "$T/asks.log" | tr -d ' ') ($(tail -1 "$T/asks.log"))"

step "4. deep hub stop with the OS confirmation cancelled"
deep hub stop 2>&1 | red; echo "exit ${PIPESTATUS[0]}"; hub

step "5. A restart on the token alone: hub.restart, no prompt; the login service brings it back"
old=$(hub)
raw hub.restart '{}'
for i in $(seq 1 60); do sleep 1; out=$(hub); case "$out" in *"hub up"*) [ "$out" != "$old" ] && break;; esac; done
echo "$out (after ${i} s)"
grep -E '"event":"(exit|start)"' "$T/launchd/launchd.jsonl" | tail -2 | red
echo "asks the OS saw: $(wc -l < "$T/asks.log" | tr -d ' ')"

step "6. deep hub stop, the OS confirming you"
echo confirmed > "$T/confirm.mode"
deep hub stop 2>&1 | red; echo "exit ${PIPESTATUS[0]}"
echo "asks the OS saw: $(wc -l < "$T/asks.log" | tr -d ' ') ($(tail -1 "$T/asks.log"))"
sleep 2; hub
echo "waiting 35 s (three of launchd's 10 s throttles) for the login service not to start it again..."
sleep 35; hub
grep -E '"event":"(exit|start)"' "$T/launchd/launchd.jsonl" | tail -2 | red

step "7. Cleanup: stop the stand-in supervisor this run started, by its PID; remove the temp folder"
SUP=$(cat "$T/launchd/supervisor.pid" 2>/dev/null); [ -n "$SUP" ] && kill "$SUP" 2>/dev/null && echo "stopped stand-in supervisor pid $SUP"
rm -rf "$T"; echo "removed <tmp>"
