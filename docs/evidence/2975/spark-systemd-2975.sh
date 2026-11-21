#!/bin/bash
# #2975 AC7, Linux half, on a real systemd --user: a scratch unit (its own name, a temp HOME) running the built hub.
# The unit text is what service.ts writes, read from the built dist at each commit. Touches no other unit.
. ~/.cargo/env; . ~/.nvm/nvm.sh >/dev/null; nvm use 24 >/dev/null
export XDG_RUNTIME_DIR=/run/user/$(id -u)
D=$(mktemp -d /tmp/d2975-sd-XXXX); cd "$D" || exit 1
UNITDIR=$HOME/.config/systemd/user
echo "dir $D load: $(cat /proc/loadavg)"
git clone -q --branch claude/issue-2975-signal-restart https://github.com/windoliver/deepbuild.git repo && cd repo || exit 1
npm ci --silent >/dev/null 2>&1 || { echo "npm ci failed"; exit 1; }
cargo build -q --locked -p deep-hook 2>&1 | tail -3
NODE=$(command -v node)
pid() { systemctl --user show -p MainPID --value "$U"; }
answers() { HOME=$H "$NODE" "$D/repo/packages/cli/dist/main.js" hub status >/dev/null 2>&1; }
# Waits up to $1 s for a hub with a PID other than $2 that answers; prints the PID or "none".
back() { for i in $(seq 1 $(( $1 * 2 ))); do p=$(pid); if [ "$p" != 0 ] && [ "$p" != "$2" ] && answers; then echo "$p"; return; fi; sleep 0.5; done; echo none; }
state() { echo "ActiveState=$(systemctl --user show -p ActiveState --value "$U") Result=$(systemctl --user show -p Result --value "$U") NRestarts=$(systemctl --user show -p NRestarts --value "$U")"; }
run_case() {
  rev=$1; name=$2
  git checkout -q "$rev" -- packages/hub/src
  npm run build --workspaces --silent >/dev/null 2>&1 || { echo "build failed at $rev"; exit 1; }
  H=$D/home-$name; mkdir -p "$H"; U=deep2975-check-$name.service
  # The [Service] lines service.ts writes, with this sandbox's program and HOME.
  "$NODE" -e '
    const s = require("fs").readFileSync(process.argv[1], "utf8");
    const m = s.match(/\[Service\]\n([\s\S]*?)\n\n\[Install\]/); if (!m) process.exit(2);
    const lines = m[1].split("\n").filter((l) => !/^(ExecStart|Environment)=/.test(l)).filter((l) => !l.includes("${"));
    process.stdout.write(lines.join("\n") + "\n");' "$D/repo/packages/hub/dist/service.js" > "$D/service-$name.txt" || { echo "no unit text in dist"; exit 1; }
  printf '[Unit]\nDescription=deep2975 check %s\n\n[Service]\nExecStart=%s %s hub run\nEnvironment="PATH=%s" "HOME=%s"\n%s\nLimitNOFILE=4096\n' \
    "$name" "$NODE" "$D/repo/packages/cli/dist/main.js" "$(dirname "$NODE"):/usr/bin:/bin" "$H" "$(grep -v LimitNOFILE "$D/service-$name.txt")" > "$UNITDIR/$U"
  systemctl --user daemon-reload
  echo "== $name at $(git rev-parse --short $rev): $(grep -E '^(Restart|Success|RestartForce)' "$UNITDIR/$U" | tr '\n' ' ')"; systemd-analyze --user verify "$UNITDIR/$U" 2>&1 | grep -v "^$" | head -3
  systemctl --user start "$U"; p0=$(back 60 0); echo "started: pid $p0"
  kill -TERM "$p0"; p1=$(back 30 "$p0"); echo "after kill -TERM: back as $p1; $(state)"
  [ "$p1" = none ] && { systemctl --user stop "$U"; rm -f "$UNITDIR/$U"; systemctl --user reset-failed "$U" 2>/dev/null; systemctl --user daemon-reload; return; }
  last=$p1
  for n in 1 2 3 4 5; do kill -TERM "$last"; nx=$(back 60 "$last"); echo "kill $n of 5 in a row: back as $nx"; [ "$nx" = none ] && break; last=$nx; done
  echo "after five: $(state)"
  # The startup window: a SIGTERM as soon as systemd has a new PID, before the hub can answer.
  kill -TERM "$last"; for i in $(seq 1 200); do q=$(pid); [ "$q" != 0 ] && [ "$q" != "$last" ] && break; sleep 0.05; done
  kill -TERM "$q" 2>/dev/null && echo "early kill sent to $q"; ne=$(back 60 "$q"); echo "after an early kill: back as $ne; $(state)"
  last=$ne
  kill -TERM "$last"; for i in $(seq 1 200); do q=$(pid); [ "$q" != 0 ] && [ "$q" != "$last" ] && break; sleep 0.05; done
  kill -INT "$q" 2>/dev/null && echo "early kill -INT sent to $q"; ne=$(back 60 "$q"); echo "after an early kill -INT: back as $ne; $(state)"
  last=$ne
  kill -INT "$last"; ni=$(back 60 "$last"); echo "after kill -INT: back as $ni"
  systemctl --user stop "$U"; sleep 15; echo "after systemctl --user stop and 15 s: $(state); answers: $(answers && echo yes || echo no)"
  rm -f "$UNITDIR/$U"; systemctl --user reset-failed "$U" 2>/dev/null; systemctl --user daemon-reload
}
run_case HEAD~2 base
run_case HEAD fix
git checkout -q HEAD -- packages/hub/src
ls "$UNITDIR" | grep deep2975 || echo "no deep2975 units left"
rm -rf "$D" && echo "removed $D"
