#!/bin/bash
# Hand e2e for #2977: a real `deep hub run` from this checkout's build in a fresh home, then `deep install` of
# packages/jobs/score and packages/jobs/import, each timed. Install runs a package's code in the platform sandbox, so
# the first install meets the supervisor's warm-up of its sandbox-report stream. Lists the hub's `log stream`
# children before and after, and what the hub wrote to stderr. Usage: e2e.sh <label>
set -u
WT=$(/usr/bin/git -C "$(dirname "$0")" rev-parse --show-toplevel)
LABEL=$1
case "$(node -v 2>/dev/null)" in v24.*) ;; *) echo "e2e.sh needs Node 24 as node on PATH" >&2; exit 2;; esac
export PATH="$(dirname "$(command -v node)"):/usr/bin:/bin:/usr/sbin"
H=$(mktemp -d "${TMPDIR:-/tmp}/h-XXXX")
mkdir -p "$H/home"; echo confirmed > "$H/confirm"
for v in $(env | grep -oE '^(DEEP_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)[A-Za-z0-9_]*'); do unset "$v"; done
export HOME="$H/home" XDG_CONFIG_HOME="$H/home/.config" LC_ALL=C DEEP_HUB_TEST_CONFIRM="$H/confirm"
SRC=$(/usr/bin/git -C "$WT" status --porcelain -- packages/supervisor/src)
ms() { node -e 'console.log(Math.round(performance.timeOrigin + performance.now()))'; }
streams() { ps -A -o ppid=,command= | awk -v p="$1" '$1 == p && /\/usr\/bin\/log stream/' | sed -E 's/.*--predicate //'; }
echo "== $LABEL"
echo "-- macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)), load $(uptime | sed 's/.*averages: //')"
echo "-- build: HEAD $(/usr/bin/git -C "$WT" rev-parse --short HEAD), packages/supervisor/src ${SRC:+changed: }${SRC:-as committed}"
echo "-- dist/supervisor.js warms filters at once: $(grep -c 'filters.map((filter) => this.stream(filter))' "$WT/packages/supervisor/dist/supervisor.js")"
cd "$WT"
node packages/cli/dist/main.js hub run > "$H/hub.out" 2> "$H/hub.err" &
HUB=$!
for i in $(seq 1 120); do grep -q '"ready"' "$H/hub.out" 2>/dev/null && break; sleep 1; done
echo "-- hub (pid $HUB) ready: $(grep -c '"ready":true' "$H/hub.out")"
echo "-- its log stream children at ready:"; streams "$HUB" | sed 's/^/   /'
for p in score import; do
  echo "\$ deep install packages/jobs/$p"
  t0=$(ms); (cd "$H" && node "$WT/packages/cli/dist/main.js" install "$WT/packages/jobs/$p" 2>&1 | grep -e '^Installed' -e 'isn' -e 'rror'); code=$?; t1=$(ms)
  echo "   took $((t1 - t0)) ms"
done
echo "-- its log stream children after:"; streams "$HUB" | sed 's/^/   /'
echo "-- hub stderr:"; sed 's/^/   /' "$H/hub.err" | head -5
kill "$HUB"; wait "$HUB" 2>/dev/null
echo "-- hub $HUB stopped"
