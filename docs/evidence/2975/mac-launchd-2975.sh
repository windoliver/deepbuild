#!/bin/bash
# #2975 criterion 7, macOS half, on the real launchd: scratch gui-domain jobs (labels of their own, a temp HOME)
# running the built hub with the plist keys service.ts writes. Touches no other job; the real hub is never signalled.
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin
NODE=$(command -v node); DOMAIN=gui/$(id -u)
HOOK=$HOME/private/deepbuild-core/.claude/worktrees/friendly-noyce-6165fa/target/debug/deep-hook
D=$(mktemp -d /tmp/d2975-l-XXXX); cd "$D" || exit 1
echo "dir $D load: $(sysctl -n vm.loadavg) $(sw_vers -productVersion)"
git clone -q --branch claude/issue-2975-signal-restart https://github.com/windoliver/deepbuild.git repo && cd repo || exit 1
npm ci --silent >/dev/null 2>&1 || { echo "npm ci failed"; exit 1; }
# deep-hook is unchanged on this branch: the worktree's build of it, copied (no cargo build while lanes run).
mkdir -p target/debug && cp "$HOOK" target/debug/deep-hook
pid() { launchctl print "$DOMAIN/$L" 2>/dev/null | awk '/^\tpid = /{print $3; exit}'; }
answers() { HOME=$H "$NODE" "$D/repo/packages/cli/dist/main.js" hub status >/dev/null 2>&1; }
back() { for i in $(seq 1 $(( $1 * 2 ))); do p=$(pid); if [ -n "$p" ] && [ "$p" != "$2" ] && answers; then echo "$p"; return; fi; sleep 0.5; done; echo none; }
state() { launchctl print "$DOMAIN/$L" 2>/dev/null | awk -F' = ' '/^\t(state|runs|last exit code|pid) = /{gsub(/^\t/,"",$1); printf "%s=%s ", $1, $2}'; }
cleanup() { launchctl bootout "$DOMAIN/$L" 2>/dev/null; rm -f "$P"; }
run_case() {
  rev=$1; name=$2
  git checkout -q "$rev" -- packages/hub/src
  npm run build --workspaces --silent >/dev/null 2>&1 || { echo "build failed at $rev"; exit 1; }
  H=$D/h-$name; mkdir -p "$H/logs"; L=com.deepbuild.check2975.$name; P=$D/$L.plist
  # The plist's keys as service.ts writes them (KeepAlive with SuccessfulExit false), with this sandbox's program and HOME.
  grep -q "<key>SuccessfulExit</key>" packages/hub/src/service.ts || { echo "no SuccessfulExit in service.ts"; exit 1; }
  cat > "$P" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$L</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$D/repo/packages/cli/dist/main.js</string><string>hub</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin</string><key>HOME</key><string>$H</string></dict>
  <key>StandardOutPath</key><string>$H/logs/hub.log</string><key>StandardErrorPath</key><string>$H/logs/hub.log</string>
</dict></plist>
PLIST
  echo "== $name at $(git rev-parse --short $rev): KeepAlive SuccessfulExit=false"
  launchctl bootstrap "$DOMAIN" "$P" || { echo "bootstrap refused"; return; }
  p0=$(back 90 0); echo "started: pid $p0"
  [ "$p0" = none ] && { tail -5 "$H/logs/hub.log"; cleanup; return; }
  kill -TERM "$p0"; p1=$(back 40 "$p0"); echo "after kill -TERM: back as $p1; $(state)"
  [ "$p1" = none ] && { cleanup; return; }
  last=$p1
  for n in 1 2 3 4 5; do kill -TERM "$last"; nx=$(back 60 "$last"); echo "kill $n of 5 in a row: back as $nx"; [ "$nx" = none ] && break; last=$nx; done
  # The startup window: a signal as soon as launchd has a new PID, before the hub can answer.
  for sig in TERM INT; do
    kill -TERM "$last"; for i in $(seq 1 400); do q=$(pid); [ -n "$q" ] && [ "$q" != "$last" ] && break; sleep 0.05; done
    kill -$sig "$q" 2>/dev/null && echo "early kill -$sig sent to $q"; ne=$(back 60 "$q"); echo "after an early kill -$sig: back as $ne; $(state)"; last=$ne
  done
  kill -INT "$last"; ni=$(back 60 "$last"); echo "after kill -INT: back as $ni; $(state)"
  launchctl bootout "$DOMAIN/$L"; sleep 15; echo "after launchctl bootout and 15 s: loaded: $(launchctl print "$DOMAIN/$L" >/dev/null 2>&1 && echo yes || echo no); answers: $(answers && echo yes || echo no); last pid alive: $(kill -0 "$ni" 2>/dev/null && echo yes || echo no)"
  grep -h '"hub.stopped"\|signal:SIG' "$H/.deepbuild"/*.log 2>/dev/null | head -0
  rm -f "$P"
}
run_case HEAD~3 base
run_case HEAD fix
git checkout -q HEAD -- packages/hub/src
launchctl list | grep check2975 || echo "no check2975 jobs left"
cd / && rm -rf "$D" && echo "removed $D"
