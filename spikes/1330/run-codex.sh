#!/bin/zsh
set -u
S=${0:A:h}
CODEX=${CODEX:?set CODEX to a codex binary}
NODE=${NODE:-$(command -v node)}
T=$(mktemp -d /tmp/c1330.XXXX); H=$T/home; W=$T/wt; mkdir -p $H/.ssh $H/.codex $W $T/tmp
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
(cd $W && git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm init)
cat > $T/sock.mjs <<'C'
import { createServer } from 'node:net'; import { appendFileSync } from 'node:fs';
createServer((c) => c.on('data', (d) => appendFileSync(process.argv[3], `HOOK ${d}`))).listen(process.argv[2]);
C
$NODE $T/sock.mjs $T/hub.sock $T/hook.log & SOCKPID=$!
cat > $T/hook.mjs <<'C'
import { connect } from 'node:net'; let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{ const c = connect(process.argv[2]); c.on('connect',()=>{ c.end((JSON.parse(s).hook_event_name ?? 'unknown')+'\n'); }); c.on('error',e=>{ process.stderr.write('hook socket '+e.code); process.exit(0);}); });
C
echo "{\"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"exec $NODE $T/hook.mjs $T/hub.sock\"}]}],\"SessionStart\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"exec $NODE $T/hook.mjs $T/hub.sock\"}]}]}}" > $H/.codex/hooks.json
[ -n "${CONFIG:-}" ] && print -r -- "${CONFIG//HOMEDIR/$H}" > $H/.codex/config.toml
(cd $W && env -i HOME=$H CODEX_HOME=$H/.codex PATH=$(dirname $NODE):/usr/bin:/bin $NODE $S/trust.mjs $CODEX $W $H/.codex/config.toml)
FAKE_SCRIPT=${FAKE_SCRIPT:-'["npm test",{"command":"cat ~/.ssh/id_ed25519; echo rc=$?","escalate":true}]'} FAKE_LOG=$T/model.log $NODE $S/fake-openai.mjs > $T/port & FAKEPID=$!
sleep 1; PORT=$(cat $T/port)
cd $W
env -i HOME=$H CODEX_HOME=$H/.codex PATH=$(dirname $NODE):/usr/bin:/bin:/usr/sbin:/sbin TMPDIR=$T/tmp FAKE_KEY=sk-fake \
  $CODEX exec --json --skip-git-repo-check -c model_provider=fake -c "model_providers.fake={name=\"fake\",base_url=\"http://127.0.0.1:$PORT/v1\",wire_api=\"responses\",env_key=\"FAKE_KEY\"}" -m gpt-fake ${=EXTRA:-} "go" < /dev/null > $T/out.jsonl 2> $T/err.txt
echo "exit=$?"
cat $T/model.log | sort | uniq -c
grep -o '"aggregated_output":"[^"]*"' $T/out.jsonl | cut -c1-400
echo "--- zshrc:"; cat $H/.zshrc; echo "--- hook log:"; cat $T/hook.log 2>/dev/null; echo "--- err:"; tail -c 800 $T/err.txt; echo; echo "T=$T"
kill $SOCKPID $FAKEPID
