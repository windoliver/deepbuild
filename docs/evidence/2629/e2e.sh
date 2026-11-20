#!/bin/bash
# Hand e2e for #2629: a real `deep hub run` from the worktree's build, then `deep install` of
# packages/jobs/score and packages/jobs/import from one checkout. Usage: e2e.sh <checkout> <label>
set -u
WT=~/private/deepbuild-core/.claude/worktrees/fix-2564-stream-flush-catch-7c0e0b
CO=$1; LABEL=$2
export PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node | grep ^v24 | tail -1)/bin:/usr/bin:/bin:/usr/sbin"
H=$(mktemp -d <tmp>/h-XXXX)
mkdir -p "$H/home"; echo confirmed > "$H/confirm"
for v in $(env | grep -oE '^(DEEP_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)[A-Za-z0-9_]*'); do unset "$v"; done
export HOME="$H/home" XDG_CONFIG_HOME="$H/home/.config" LC_ALL=C DEEP_HUB_TEST_CONFIRM="$H/confirm"
echo "== $LABEL: $CO (worktree $(/usr/bin/git -C $WT rev-parse --short HEAD), digest.ts $(/usr/bin/git -C $WT diff --quiet HEAD -- packages/extension-host/src/digest.ts && echo as-committed || echo with-fix))"
for p in score import; do echo "-- modes in packages/jobs/$p:"; (cd "$CO/packages/jobs/$p" && find . -type f -exec stat -f '%Sp %N' {} + | sort -k2 | head -6); done
cd "$WT"
node packages/cli/dist/main.js hub run > "$H/hub.out" 2> "$H/hub.err" &
HUB=$!
for i in $(seq 1 120); do grep -q '"ready"' "$H/hub.out" 2>/dev/null && break; sleep 1; done
echo "-- hub (pid $HUB): $(head -c 200 "$H/hub.out")"
for p in score import; do
  echo "\$ deep install $CO/packages/jobs/$p"
  (cd "$H" && node "$WT/packages/cli/dist/main.js" install "$CO/packages/jobs/$p" 2>&1); echo "exit $?"
done
kill "$HUB"; wait "$HUB" 2>/dev/null
echo "-- hub $HUB stopped"
