#!/bin/bash
# One SessionStart per side: start Claude Code, give its hooks time, read the hub's record, stop both.
# Usage: CHECKOUT=<this repo> listing.sh <tree> <label>   (e2e-root beside it names the run folder, from mktemp -d)
S=$(dirname "$0"); R=$(cat "$S/e2e-root"); TREE=$1; LABEL=$2
E2E_ROOT=$R FORGE_SRC=$CHECKOUT/tests/acceptance/1773/fixtures bash "$S/e2e.sh" "$TREE" "$LABEL" >/dev/null
sleep 40
tmux capture-pane -p -t "e2e1773-$LABEL" > "$S/$LABEL-pane.txt"
tmux kill-session -t "e2e1773-$LABEL"
kill -TERM "$(cat "$R/$LABEL/hub.pid")"; rm -f "$R/$LABEL/home/.claude/.credentials.json"
sqlite3 -readonly "$R/$LABEL/home/.deepbuild/ledger.db" "select log_pos, kind, coalesce(json_extract(data,'$.server'),'') from events where kind in ('session.start','session.rules_delivered','mcp.tools_listed') order by log_pos"
