#!/bin/bash
# Hand e2e for #1358 with the real launchd, in two throwaway homes under /Users/Shared (outside every temp folder,
# outside the real home). Loads com.deepbuild.hub only if nothing holds the label, signals only the hub of the job its
# own plist loaded, and boots out only that job.
NODEBIN=$HOME/.nvm/versions/node/v24.22.0/bin
REAL=$HOME
SCRATCH=$(cd "$(dirname "$0")" && pwd)
WT='<checkout>'
DEEP="$NODEBIN/node $WT/packages/cli/dist/main.js"
DOMAIN=gui/$(id -u)
LABEL=com.deepbuild.hub
pause() { # step name: wait for the screenshot of this step, then clear the screen for the next one
  [ -n "$STEP_DIR" ] || return 0
  touch "$STEP_DIR/at-$1"
  for i in $(seq 1 3000); do [ -e "$STEP_DIR/go-$1" ] && break; sleep 0.2; done
  printf '\033[2J\033[3J\033[H'
}
say() { printf '\n== %s\n' "$*"; }
show() { printf '$ %s\n' "$*"; }
field() { /bin/launchctl print $DOMAIN/$LABEL 2>/dev/null | sed -n "s/^[[:space:]]*$1 = //p" | head -1; }
mine() { local path; path=$(field path); [ -n "$path" ] && [ "${path#"$BASE"/}" != "$path" ]; }

say "machine"; sw_vers | tr '\n' ' '; echo; $NODEBIN/node --version; echo "checkout: $(/usr/bin/git -C "$WT" rev-parse HEAD), PR #2803's head (the #2801 fix), a fresh GitHub clone"; echo "load average $(sysctl -n vm.loadavg)  (other sessions' builds keep this Mac busy; each step waits for the hub, none times out)"; date -u +%FT%TZ

say "precondition: nothing holds the label"
show "launchctl print $DOMAIN/$LABEL"
if /bin/launchctl print $DOMAIN/$LABEL >/dev/null 2>&1; then echo "ABORT: $LABEL is loaded; not touching it"; exit 9; fi
echo "not loaded"
snapshot() { # what a hub of the real home would write there: its socket, record, token, state and evidence, and its plist
  for f in .deepbuild/hub.sock .deepbuild/ledger.db .deepbuild/control.token .deepbuild/hub.state Library/LaunchAgents/com.deepbuild.hub.plist; do
    if [ -e "$REAL/$f" ]; then echo "~/$f $(stat -f '%z bytes, modified %Sm' "$REAL/$f")"; else echo "~/$f absent"; fi
  done
  echo "~/.deepbuild/evidence: $(ls "$REAL/.deepbuild/evidence" 2>/dev/null | wc -l | tr -d ' ') entries"
}
snapshot > "$SCRATCH/dh1358-before.$$"

PID1=; PID2=
BASE=$(mktemp -d /Users/Shared/dh1358-e2e-XXXXXX) || exit 1
A=$BASE/a; B=$BASE/b; mkdir -p "$A" "$B"
echo "homes: $A  $B"
run() { # home, args...
  local home=$1; shift
  show "HOME=$home deep $*"
  env -i HOME="$home" PATH="$NODEBIN:/usr/bin:/bin:/usr/sbin:/sbin" SHELL=/bin/sh $DEEP "$@"
  echo "exit $?"
}
job() { show "launchctl print $DOMAIN/$LABEL   (the job's own lines)"; /bin/launchctl print $DOMAIN/$LABEL 2>&1 | grep -E $'^\t(path|state|pid|program|runs|last exit code) = ' ; }
plistenv() { show "plutil: EnvironmentVariables in the plist launchd loaded"; plutil -extract EnvironmentVariables xml1 -o - "$1/Library/LaunchAgents/$LABEL.plist" | plutil -p -; }
hubhome() { show "ps eww -p $1: HOME of the running hub"; ps eww -o command= -p "$1" | tr ' ' '\n' | grep '^HOME=' || echo "pid $1 is not running"; }
hubup() { # home: wait until the hub's core answers deep hub status
  show "HOME=$1 deep hub status   (until the hub's core answers a control call)"
  local up='' code; for i in $(seq 1 90); do env -i HOME="$1" PATH="$NODEBIN:/usr/bin:/bin:/usr/sbin:/sbin" SHELL=/bin/sh $DEEP hub status > "$SCRATCH/status.out" 2>&1; code=$?
    [ $code = 0 ] && { up=$i; break; }; { echo "$(date -u +%TZ) step $2 try $i exit $code: $(tr '\n' ' ' < "$SCRATCH/status.out")"; } >> "$SCRATCH/status-wait.log"; sleep 2; done
  if [ -n "$up" ]; then echo "exit 0 at try $up: $(cut -c1-110 "$SCRATCH/status.out")..."; [ "$up" -gt 1 ] && echo "(tries 1-$((up - 1)) did not get the hub's health; each one's output is in status-wait.log)"; else echo "the hub did not answer deep hub status within 3 minutes"; fi
}
cleanup() {
  say "cleanup: boot out only the job this run loaded"
  if [ -z "$(field path)" ]; then echo "nothing loaded";
  elif mine; then show "launchctl bootout $DOMAIN/$LABEL"; /bin/launchctl bootout $DOMAIN/$LABEL; echo "exit $?";
  else echo "LEFT ALONE: loaded from $(field path), not this run's"; fi
  for i in $(seq 1 300); do /bin/launchctl print $DOMAIN/$LABEL >/dev/null 2>&1 || break; sleep 0.2; done
  show "launchctl print $DOMAIN/$LABEL"; if /bin/launchctl print $DOMAIN/$LABEL >/dev/null 2>&1; then echo "still loaded from $(field path)"; else echo "no service: the label is free again"; fi
  pids=$(echo $PID1 $PID2 | tr ' ' ',')
  if [ -n "$pids" ]; then show "ps -p $pids   (this run's hubs, by PID)"; ps -p "$pids" -o pid=,command= || echo "none is running"; fi
  say "the real home: what its hub would write, before and after"
  cat "$SCRATCH/dh1358-before.$$"
  snapshot > "$SCRATCH/dh1358-after.$$"
  if diff "$SCRATCH/dh1358-before.$$" "$SCRATCH/dh1358-after.$$"; then echo "unchanged"; else echo "CHANGED (the lines above)"; fi
  rm -f "$SCRATCH/dh1358-before.$$" "$SCRATCH/dh1358-after.$$"
  cp "$A/.deepbuild/logs/hub.log" "$SCRATCH/hub-a.log" 2>/dev/null
  rm -rf "$BASE"; show "test -e $BASE"; if [ -e "$BASE" ]; then echo "still there"; else echo "gone: the run's folder is removed"; fi
  pause 4
}
trap cleanup EXIT

pause 0
say "1. home A, label free: bootstrap, and the hub launchd starts has A's HOME (criterion 3)"
run "$A" hub start
job
if ! mine; then echo "ABORT: the loaded job is not this run's"; exit 9; fi
plistenv "$A"
PID1=$(field pid)
hubhome "$PID1"
hubup "$A" 1
show "ls A/.deepbuild"; COLUMNS=120 ls -C "$A/.deepbuild"
show "lsof: files the hub holds open under a .deepbuild"; lsof -p "$PID1" 2>/dev/null | grep -o '/[^ ]*\.deepbuild/[^ ]*' | sed "s#/[^/]*\$##" | sort | uniq -c

pause 1
say "2. home B, label held by A's plist: starts nothing, exits 3, names A's plist and the bootout (criterion 1)"
run "$B" hub start
echo "A's hub pid now: $(field pid) (was $PID1); runs = $(field runs)"
show "ls -A B/.deepbuild (no socket, no ledger)"; ls -A "$B/.deepbuild" 2>&1
show "ls -A B/.deepbuild/logs"; [ -n "$(ls -A "$B/.deepbuild/logs" 2>/dev/null)" ] && ls -A "$B/.deepbuild/logs" || echo "(empty)"
show "ls -A B/Library/LaunchAgents"; if [ -d "$B/Library/LaunchAgents" ]; then [ -n "$(ls -A "$B/Library/LaunchAgents")" ] && ls -A "$B/Library/LaunchAgents" || echo "(empty)"; else echo "(no such folder: B wrote no plist)"; fi

pause 2
say "3. home A, its own job loaded but its hub stopped: kickstarts it as before (criterion 2)"
if ! mine || [ "$(field pid)" != "$PID1" ]; then echo "ABORT: the job or its pid changed; signalling nothing"; exit 9; fi
show "kill -TERM $PID1   (the hub of this run's own job, by PID; it exits 0, so KeepAlive leaves the job loaded and stopped)"
kill -TERM "$PID1"
for i in $(seq 1 300); do kill -0 "$PID1" 2>/dev/null || break; sleep 0.2; done
sleep 3
job
show "test -e A/.deepbuild/hub.sock"; if [ -e "$A/.deepbuild/hub.sock" ]; then echo "socket present"; else echo "socket absent: no hub is running for A"; fi
run "$A" hub start
job
PID2=$(field pid)
echo "hub pid $PID2 (was $PID1)"
hubup "$A" 3
hubhome "$PID2"
show "hub log (A): the ready lines"; grep -o '"ready":true,"pid":[0-9]*' "$A/.deepbuild/logs/hub.log"
pause 3
