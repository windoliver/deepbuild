#!/bin/bash
# Hand e2e for #2629: a real `deep hub run` from this checkout's build, then `deep install` of
# packages/jobs/score and packages/jobs/import from one other checkout. Usage: e2e.sh <checkout> <label>
set -u
WT=$(/usr/bin/git -C "$(dirname "$0")" rev-parse --show-toplevel)
CO=$1; LABEL=$2
case "$(node -v 2>/dev/null)" in v24.*) ;; *) echo "e2e.sh needs Node 24 as node on PATH" >&2; exit 2;; esac
export PATH="$(dirname "$(command -v node)"):/usr/bin:/bin:/usr/sbin"
H=$(mktemp -d "${TMPDIR:-/tmp}/h-XXXX")
mkdir -p "$H/home"; echo confirmed > "$H/confirm"
for v in $(env | grep -oE '^(DEEP_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)[A-Za-z0-9_]*'); do unset "$v"; done
export HOME="$H/home" XDG_CONFIG_HOME="$H/home/.config" LC_ALL=C DEEP_HUB_TEST_CONFIRM="$H/confirm"
SRC=$(/usr/bin/git -C "$WT" status --porcelain -- packages/extension-host/src)
echo "== $LABEL: $CO"
echo "-- build: HEAD $(/usr/bin/git -C "$WT" rev-parse --short HEAD), packages/extension-host/src ${SRC:+changed: }${SRC:-as committed}"
echo "-- dist/digest.js hashes: $(grep -oE "stat\.mode & 0o[0-7]+[^\`]*" "$WT/packages/extension-host/dist/digest.js" | head -1)"
echo "-- dist/host.js chmods copies: $(grep -c 'chmodSync(join(dst' "$WT/packages/extension-host/dist/host.js")"
echo "-- checkout HEAD $(/usr/bin/git -C "$CO" rev-parse --short HEAD); files with the owner execute bit, then the first plain files:"
for p in score import; do (cd "$CO/packages/jobs/$p" && find . -type f -perm -u+x -exec stat -f "%Sp $p/%N" {} + | sort -k2; find . -type f ! -perm -u+x -exec stat -f "%Sp $p/%N" {} + | sort -k2 | head -3); done
cd "$WT"
node packages/cli/dist/main.js hub run > "$H/hub.out" 2> "$H/hub.err" &
HUB=$!
for i in $(seq 1 120); do grep -q '"ready"' "$H/hub.out" 2>/dev/null && break; sleep 1; done
echo "-- hub (pid $HUB) ready: $(grep -c '"ready":true' "$H/hub.out")"
for p in score import; do
  echo "\$ deep install $CO/packages/jobs/$p"
  (cd "$H" && node "$WT/packages/cli/dist/main.js" install "$CO/packages/jobs/$p" 2>&1); echo "exit $?"
done
kill "$HUB"; wait "$HUB" 2>/dev/null
echo "-- hub $HUB stopped"
