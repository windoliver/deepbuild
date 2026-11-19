#!/bin/bash
# By-hand e2e for #1879: install one package, then start the same home with and without --safe.
set -u
R=$1; OUT=$2
export PATH=$HOME/.local/bin:/usr/bin:/bin
T=$(mktemp -d /tmp/e1879-XXXX); H=$T/h; P=$T/pkg; mkdir -p $H $T/proj; echo confirmed > $T/confirm
cp -r $R/tests/acceptance/1879/fixtures/probe $P; mv $P/index.ts.fixture $P/index.ts
node --input-type=module -e "
import { packageDigest } from '$R/packages/extension-host/dist/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
const p='$P/deepbuild.json'; const m=JSON.parse(readFileSync(p,'utf8')); m.digest=packageDigest('$P'); writeFileSync(p, JSON.stringify(m,null,2)+'\n');"
CLI=$R/packages/cli/dist/main.js
for k in $(env | grep -oE '^(DEEP_|CLAUDE|CODEX|AI_AGENT|VITEST)[A-Za-z0-9_]*'); do unset $k; done
export HOME=$H XDG_CONFIG_HOME=$H/.config LC_ALL=C DEEP_HUB_TEST_CONFIRM=$T/confirm
loads() { node -e "
const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('$H/.deepbuild/ledger.db', { readOnly: true });
const n = db.prepare(\"SELECT count(*) AS n FROM events WHERE kind = 'process.starting' AND json_extract(data, '\$.cwd') LIKE '$H/.deepbuild/run-%'\").get().n; console.log(n);" 2>/dev/null; }
start() { setsid node $CLI hub run "$@" >$T/out 2>$T/err & PID=$!; for i in $(seq 1 120); do grep -q ready $T/out 2>/dev/null && return; sleep 0.5; done; echo "hub didn't start"; cat $T/err; }
stop() { kill -TERM $PID; wait $PID 2>/dev/null; sleep 1; }
{
echo "## 1. deep hub run, then deep install of test/safe-probe"
start; echo "ready: $(head -1 $T/out)"
(cd $T/proj && node $CLI install $P 2>&1); echo "install exit $?"
stop; echo "package process starts in the record so far (its check and its load): $(loads)"
echo; echo "## 2. the same home: deep hub run --safe"
start --safe; echo "ready: $(head -1 $T/out)"; sleep 15
echo "hub stderr (not loaded lines):"; grep "not loaded" $T/err || echo "(none)"
echo "package process starts in the record after the --safe start: $(loads)"
echo "deep install on the --safe hub:"; (cd $T/proj && node $CLI install $P >$T/inst 2>&1); c=$?; tail -3 $T/inst; echo "install exit $c"
stop; echo "package process starts in the record after deep install on the --safe hub: $(loads)"
echo; echo "## 3. the same home: deep hub run (no --safe)"
start; echo "ready: $(head -1 $T/out)"; sleep 15
echo "hub stderr (not loaded lines):"; grep "not loaded" $T/err || echo "(none)"
stop; echo "package process starts in the record after the plain start: $(loads) (one more: its load)"
} 2>&1 | sed "s#$T#<tmp>#g; s#$HOME#~#g; s#$R#<repo>#g" > $OUT
rm -rf $T
