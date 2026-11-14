#!/bin/bash
# Manual e2e for #1632: a real Claude Code session, deep mcp connected to a real hub, /clear, then deep_ask and deep_claim.
# Usage: e2e.sh <tree> <tmpdir>   (tree: a built checkout; tmpdir: holds home/ with credentials and proj/)
set -u
TREE=$1; T=$2
export PATH=$HOME/.local/bin:$PATH
H=$T/home
CLI="node $TREE/packages/cli/dist/main.js"
python3 - "$H" "$T/proj" <<'EOF'
import json, sys
h, proj = sys.argv[1], sys.argv[2]
p = f'{h}/.claude.json'
s = json.load(open(p))
s.update(hasCompletedOnboarding=True, theme='dark', bypassPermissionsModeAccepted=True)
s.setdefault('projects', {})[proj] = {'hasTrustDialogAccepted': True, 'allowedTools': []}
json.dump(s, open(p, 'w'))
EOF
HOME=$H DEEP_HUB_TEST_FACTS=$T/facts setsid $CLI hub run > $T/hub.log 2>&1 &
echo $! > $T/hub.pid
for i in $(seq 1 50); do [ -S $H/.deepbuild/hub.sock ] && break; sleep 0.2; done
tmux new-session -d -s e2e1632 -x 200 -y 50 -c $T/proj "HOME=$H DISABLE_AUTOUPDATER=1 claude --allowedTools 'mcp__deepbuild' --model haiku"
echo started
