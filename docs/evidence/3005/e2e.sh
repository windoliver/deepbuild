#!/bin/bash
# Hand e2e for #3005: a real `deep hub run` from this checkout's build, its home under $TMPDIR, then
# `deep install` of packages/jobs/score, import and typeset. Usage: TMPDIR=<dir> e2e.sh <label>
# Run once with a TMPDIR that runs through a symlink (/tmp/... on macOS) and once with its real path.
set -u
WT=$(/usr/bin/git -C "$(dirname "$0")" rev-parse --show-toplevel)
LABEL=$1
case "$(node -v 2>/dev/null)" in v24.*) ;; *) echo "e2e.sh needs Node 24 as node on PATH" >&2; exit 2;; esac
export PATH="$(dirname "$(command -v node)"):/usr/bin:/bin:/usr/sbin"
H=$(mktemp -d "${TMPDIR:-/tmp}/h-XXXX")
mkdir -p "$H/home"; echo confirmed > "$H/confirm"
for v in $(env | grep -oE '^(DEEP_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)[A-Za-z0-9_]*'); do unset "$v"; done
export HOME="$H/home" XDG_CONFIG_HOME="$H/home/.config" LC_ALL=C DEEP_HUB_TEST_CONFIRM="$H/confirm"
SRC=$(/usr/bin/git -C "$WT" status --porcelain -- packages/extension-host/src)
echo "== $LABEL"
echo "-- build: HEAD $(/usr/bin/git -C "$WT" rev-parse --short HEAD), packages/extension-host/src ${SRC:+changed: }${SRC:-as committed}"
echo "-- dist/jobs.js spawns by real path: $(grep -c 'realpathSync(join(folder' "$WT/packages/extension-host/dist/jobs.js")"
echo "-- hub home $HOME, its real path $(cd "$HOME" && pwd -P)"
cd "$WT"
node packages/cli/dist/main.js hub run > "$H/hub.out" 2> "$H/hub.err" &
HUB=$!
for i in $(seq 1 120); do grep -q '"ready"' "$H/hub.out" 2>/dev/null && break; sleep 1; done
echo "-- hub ready: $(grep -c '"ready":true' "$H/hub.out")"
for p in score import typeset; do
  echo "\$ deep install packages/jobs/$p"
  (cd "$H" && node "$WT/packages/cli/dist/main.js" install "$WT/packages/jobs/$p" 2>&1); echo "exit $?"
done
kill "$HUB"; wait "$HUB" 2>/dev/null
echo "-- hub stopped"
rm -rf "$H"
