#!/bin/zsh
# Spike: real Claude Code 2.1.308, fake model, own sandbox; walls and the hook socket.
set -u
S=${0:A:h}
CLAUDE=${CLAUDE:?set CLAUDE to a claude binary}
NODE=${NODE:-$(command -v node)}
T=$(mktemp -d /tmp/s1330.XXXX); H=$T/home; W=$T/wt; mkdir -p $H/.ssh $W $T/tmp
echo SECRET-KEY > $H/.ssh/id_ed25519; echo '# zshrc' > $H/.zshrc
cat > $W/child.mjs <<'C'
import { readFileSync, appendFileSync } from 'node:fs'; import { connect } from 'node:net';
const home = process.env.HOME; const out = [];
try { readFileSync(`${home}/.ssh/id_ed25519`, 'utf8'); out.push('READ ok'); } catch (e) { out.push(`READ refused ${e.code}`); }
try { appendFileSync(`${home}/.zshrc`, 'x\n'); out.push('WRITE ok'); } catch (e) { out.push(`WRITE refused ${e.code}`); }
try { appendFileSync(`./inside.txt`, 'x\n'); out.push('WRITE-WT ok'); } catch (e) { out.push(`WRITE-WT refused ${e.code}`); }
await new Promise((r) => { const s = connect(80, '93.184.215.14'); s.setTimeout(4000); s.on('connect', () => { out.push('NET ok'); s.destroy(); r(); }); s.on('error', (e) => { out.push(`NET refused ${e.code}`); r(); }); s.on('timeout', () => { out.push('NET timeout'); s.destroy(); r(); }); });
console.log(out.join(' | '));
C
echo '{"name":"w","scripts":{"test":"node child.mjs"}}' > $W/package.json
# A stand-in hub socket, and a Stop hook that reaches it.
cat > $T/sock.mjs <<'C'
import { createServer } from 'node:net'; import { appendFileSync } from 'node:fs';
createServer((c) => c.on('data', (d) => appendFileSync(process.argv[3], `HOOK ${d}`))).listen(process.argv[2]);
C
$NODE $T/sock.mjs $T/hub.sock $T/hook.log & SOCKPID=$!
cat > $T/hook.mjs <<'C'
import { connect } from 'node:net'; let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{ const c = connect(process.argv[2]); c.on('connect',()=>{ c.end(JSON.parse(s).hook_event_name+'\n'); }); c.on('error',e=>{ require('fs'); process.stderr.write('hook socket '+e.code); process.exit(0);}); });
C
FAKE_SCRIPT=${FAKE_SCRIPT:-'[{"name":"Bash","input":{"command":"npm test","description":"t"}},{"name":"Bash","input":{"command":"cat ~/.ssh/id_ed25519; echo rc=$?","description":"t","dangerouslyDisableSandbox":true}}]'}
FAKE_SCRIPT=$FAKE_SCRIPT FAKE_LOG=$T/model.log $NODE $S/fake-model.mjs > $T/port & FAKEPID=$!
sleep 1; PORT=$(cat $T/port)
SETTINGS=${SETTINGS:-'{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true,"allowUnsandboxedCommands":false,"failIfUnavailable":true,"filesystem":{"denyRead":["~/.ssh"]},"network":{"allowedDomains":[]}},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"NODE HOOK SOCK"}]}]}}'}
SETTINGS=${SETTINGS//NODE/$NODE}; SETTINGS=${SETTINGS//HOOK/$T/hook.mjs}; SETTINGS=${SETTINGS//SOCK/$T/hub.sock}
cd $W
env -i HOME=$H PATH=$(dirname $NODE):/usr/bin:/bin:/usr/sbin:/sbin TMPDIR=$T/tmp ANTHROPIC_BASE_URL=http://127.0.0.1:$PORT ANTHROPIC_API_KEY=sk-fake \
  $CLAUDE -p "go" --output-format stream-json --verbose --setting-sources project --strict-mcp-config --settings "$SETTINGS" ${EXTRA:-} < /dev/null > $T/out.jsonl 2> $T/err.txt
echo "exit=$?"; mkdir -p $T/tmp
grep -o '"content":"[^"]*READ[^"]*"' $T/out.jsonl | head; grep -o 'tool_result","content":"[^"]\{0,300\}' $T/out.jsonl | head -5
echo "--- zshrc:"; cat $H/.zshrc; echo "--- hook log:"; cat $T/hook.log 2>/dev/null; echo "--- err:"; head -c 600 $T/err.txt; echo; echo "T=$T"
kill $SOCKPID $FAKEPID
