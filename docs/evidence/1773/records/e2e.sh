#!/bin/bash
# Manual e2e for #1773: a real Claude Code session in a home set up by `deep setup`, with a real hub, makes deep_*
# calls through the `deepbuild` server; then the hub's record is read for overruns, readings and tool lists.
# Usage: e2e.sh <tree> <label>   (tree: a built checkout; label: names the run's folder under $E2E_ROOT)
set -u
TREE=$1; LABEL=$2
T=$E2E_ROOT/$LABEL; H=$T/home; P=$T/proj
CLI="node $TREE/packages/cli/dist/main.js"
export PATH=$HOME/.local/bin:$PATH
rm -rf "$T"; mkdir -p "$H" "$P"
git -C "$P" init -q && git -C "$P" -c user.email=e2e@example.invalid -c user.name=e2e commit -q --allow-empty -m init
# Facts widened to Claude Code 2.1.317, the version on this box (the shipped facts stop at 2.1.308).
mkdir -p "$T/facts" && cp "$TREE"/adapters/*.facts.json "$T/facts/"
python3 - "$T/facts/claude-code.facts.json" <<'EOF'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
def widen(x):
    if isinstance(x, list):
        if '2.1.308' in x and '2.1.317' not in x: x.append('2.1.317')
        for i in x: widen(i)
    elif isinstance(x, dict):
        if '2.1.308' in x and '2.1.317' not in x: x['2.1.317'] = x['2.1.308']
        for v in list(x.values()): widen(v)
widen(d); json.dump(d, open(p, 'w'), indent=1)
EOF
HOME=$H $CLI setup > "$T/setup.log" 2>&1; echo "setup exit $?" >> "$T/setup.log"
# setup starts a hub of its own in this home, without the widened facts: stop it by its PID, found by its HOME.
for pid in $(pgrep -u "$(id -u)" -f 'main.js hub run'); do
  tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -qx "HOME=$H" && { echo "setup's hub $pid stopped" >> "$T/setup.log"; kill -TERM "$pid"; }
done
sleep 2
mkdir -p "$H/forge" && cp "$FORGE_SRC/server.mjs" "$H/forge/"   # FORGE_SRC: tests/acceptance/1773/fixtures
echo '{"name":"forge","version":"1.0.0","tools":[{"name":"list_issues","inputSchema":{"type":"object"}}]}' > "$H/forge/tools.json"
install -m 600 "$HOME/.claude/.credentials.json" "$H/.claude/.credentials.json"
python3 - "$H" "$P" <<'EOF'
import json, sys
h, proj = sys.argv[1], sys.argv[2]
p = f'{h}/.claude.json'
s = json.load(open(p))
s.update(hasCompletedOnboarding=True, theme='dark', bypassPermissionsModeAccepted=True)
s.setdefault('projects', {})[proj] = {'hasTrustDialogAccepted': True, 'allowedTools': []}
# A third-party stdio server beside DeepBuild's two, so a list that skips ours still has one to show.
s['mcpServers']['forge'] = {'type': 'stdio', 'command': 'node', 'args': [f'{h}/forge/server.mjs']}
json.dump(s, open(p, 'w'))
EOF
HOME=$H DEEP_HUB_TEST_FACTS=$T/facts setsid $CLI hub run > "$T/hub.log" 2>&1 &
echo $! > "$T/hub.pid"
for i in $(seq 1 100); do [ -S "$H/.deepbuild/hub.sock" ] && break; sleep 0.2; done
tmux new-session -d -s "e2e1773-$LABEL" -x 160 -y 50 -c "$P" "HOME=$H DISABLE_AUTOUPDATER=1 claude --allowedTools 'mcp__deepbuild' --model haiku"
echo started "$T"
