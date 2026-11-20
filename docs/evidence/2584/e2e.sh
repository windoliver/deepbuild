#!/bin/bash
# Hand e2e for #2584: a real hub, `deep env up` in a worktree whose environment leases one port (web),
# while a real dmg mount sits under a folder this user can't enter, so every lsof warns "can't stat()".
# Usage: e2e.sh <repo checkout> <label>
set -u
REPO=$1; LABEL=$2
source ~/.nvm/nvm.sh >/dev/null; nvm use 24 >/dev/null
NODE=$(command -v node)
CLI=$REPO/packages/cli/dist/main.js
D=$(mktemp -d /tmp/e2584-XXXX)  # short: the hub socket path must fit 104 bytes
export HOME=$D/home LC_ALL=C; mkdir -p $HOME
G="/usr/bin/git -c user.name=e2584 -c user.email=e2584@example.invalid -c commit.gpgsign=false"
echo "== $LABEL: repo $REPO at $(/usr/bin/git -C $REPO rev-parse --short HEAD), dir $D, node $($NODE -v)"

# The app: listens on 127.0.0.1:$web and answers /health.
mkdir -p $D/repo/.deepbuild
cat > $D/repo/app.mjs <<'EOF'
import http from 'node:http';
http.createServer((q, r) => { r.writeHead(200); r.end('{"ok":true}'); }).listen(Number(process.env.web), '127.0.0.1');
EOF
cat > $D/repo/.deepbuild/done.yaml <<EOF
environment:
  up: '$NODE app.mjs'
  ports: [web]
  ready: { http: 'http://127.0.0.1:\${web}/health', within: 20 }
EOF
(cd $D/repo && $G init -q -b main && $G add -A && $G commit -q -m 'test repo' && $G worktree add -q -b wt $D/wt)

# The mount lsof can't stat.
hdiutil create -quiet -size 2m -fs HFS+ -volname e2584 -ov $D/t.dmg 2>/dev/null
mkdir -p $D/locked/mnt
hdiutil attach -quiet $D/t.dmg -mountpoint $D/locked/mnt -nobrowse 2>/dev/null
chmod 000 $D/locked
echo "-- lsof for a free port now:"; /usr/sbin/lsof -nP -iTCP:3999 -sTCP:LISTEN -Fp; echo "   (lsof exit $?)"

# A port something already listens on: 3000, the first the hub would lease.
$NODE -e "require('net').createServer().listen(3000,'127.0.0.1',()=>console.log('blocker listening on 3000 pid',process.pid))" &
BLOCKER=$!; sleep 1
echo "-- lsof for 3000 (taken):"; /usr/sbin/lsof -nP -iTCP:3000 -sTCP:LISTEN -Fp; echo "   (lsof exit $?)"

# The hub.
$NODE $CLI hub run --root $D/root > $D/hub.out 2> $D/hub.err &
HUB=$!
for i in $(seq 1 100); do grep -q ready $D/hub.out 2>/dev/null && break; sleep 0.2; done
echo "-- hub (pid $HUB): $(head -1 $D/hub.out)"

echo "-- deep env up --json in the worktree:"
(cd $D/wt && $NODE $CLI env up --root $D/root --json); echo "   (deep env up exit $?)"
echo "-- deep env down --json:"
(cd $D/wt && $NODE $CLI env down --root $D/root --json); echo "   (deep env down exit $?)"

kill -TERM $HUB; wait $HUB 2>/dev/null
kill -TERM $BLOCKER; wait $BLOCKER 2>/dev/null
chmod 755 $D/locked; hdiutil detach -quiet $D/locked/mnt
echo "-- after cleanup, lsof for a free port:"; /usr/sbin/lsof -nP -iTCP:3999 -sTCP:LISTEN -Fp; echo "   (lsof exit $?)"
echo "-- hub stderr tail:"; tail -5 $D/hub.err
