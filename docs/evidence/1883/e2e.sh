#!/bin/bash
# By-hand e2e for #1883 in an isolated HOME. Usage: e2e.sh <repo checkout> [plant]
set -u
REPO=$1; PLANT=${2:-}
NODE=$(command -v node)
CLI=$REPO/packages/cli/dist/main.js
H=$(mktemp -d /tmp/e2e1883-XXXX); export HOME=$H
BIN=$H/bin; LP="$BIN:$(dirname $NODE):/usr/local/bin:/usr/bin:/bin"
export PATH="$LP" SHELL=/bin/sh LC_ALL=C
unset $(env | grep -oE '^(CLAUDE|DEEP_|CODEX)[A-Z_]*') 2>/dev/null
mkdir -p $H/.deepbuild $BIN $H/.claude $H/dotfiles
cp $REPO/crates/deep-hook/default-rules.json $H/.deepbuild/rules.json
VER=$($NODE -e 'const f=require(process.argv[1]);const s=Object.keys(f.sandbox?.versions??{});console.log([...f.versions].reverse().find(v=>!s.includes(v))??f.versions.at(-1))' $REPO/adapters/claude-code.facts.json)
cat > $H/.deepbuild/config.json <<J
{"asks":{"deadline":{"taste":"3d","authority":"1d","unblock":"2d","exception":"2d","choice":"2d","definition":"4h"},"default":{"taste":"recommended","authority":"no","unblock":"stay-blocked","exception":"no-change","choice":"recommended","definition":"leave-out"},"fallback":["change-owner"],"fold":5},"runner":{"login_path":"$LP"}}
J
for f in .zprofile .bash_profile .profile; do echo "export PATH=\"$LP\"" > $H/$f; done
echo confirmed > $H/confirm
printf '#!%s\nif(process.argv.includes("--version")){console.log("%s (Claude Code)");process.exit(0)}\nrequire("fs").writeFileSync(process.env.HOME+"/standin.pid",String(process.pid));setTimeout(()=>{},60000);process.on("SIGTERM",()=>process.exit(0))\n' $NODE $VER > $BIN/claude; chmod 755 $BIN/claude
# A dotfile manager's link: ~/.claude.json -> ~/dotfiles/claude.json, mode 0600.
printf '{\n  "theme": "dark"\n}\n' > $H/dotfiles/claude.json; chmod 600 $H/dotfiles/claude.json
ln -s $H/dotfiles/claude.json $H/.claude.json
git init -q --bare -b main $H/origin.git; mkdir -p $H/src/shop; cd $H/src/shop
git init -q -b main; echo hi > README.md; git add -A; git -c user.name=e -c user.email=e@example.invalid commit -qm s; git remote add origin $H/origin.git; git push -q -u origin main 2>/dev/null
cd $H
echo "== HOME=$H plant=${PLANT:-none} stand-in version $VER"
echo "== before:"; ls -l $H/.claude.json; stat -c 'mode %a %n' $H/dotfiles/claude.json
DEEP_HUB_PLANT=$PLANT DEEP_HUB_TEST_CONFIRM=$H/confirm DEEP_HUB_TEST_FORGE=http://127.0.0.1:9 $NODE $CLI hub run > $H/hub.out 2> $H/hub.err &
HUB=$!
for i in $(seq 60); do grep -q ready $H/hub.out 2>/dev/null && break; sleep 1; done
head -c 300 $H/hub.out; echo
A=$($NODE $CLI start approve --repo $H/src/shop --issues 1883 --agents claude-code --at-once 1 --plan-share 100 --json); echo "approve: $A"
ASK=$(echo "$A" | $NODE -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).ask))')
sleep 2
$NODE $CLI inbox --json > $H/inbox.json 2>&1
OPT=allow
echo "answer $ASK $OPT:"; $NODE $CLI inbox answer $ASK $OPT
echo "start:"; $NODE $CLI start --repo $H/src/shop --issue 1883 --agent claude-code --prompt 'Say ready.' --json
sleep 2
echo "== after:"; ls -l $H/.claude.json; stat -L -c 'mode %a %n (followed)' $H/.claude.json; stat -c 'mode %a %n' $H/dotfiles/claude.json
echo "-- link target content:"; cat $H/dotfiles/claude.json
[ -L $H/.claude.json ] && echo "RESULT: still a symlink" || { echo "RESULT: REPLACED by a regular file; its content:"; cat $H/.claude.json; }
[ -f $H/standin.pid ] && kill -TERM $(cat $H/standin.pid) 2>/dev/null
for p in $(pgrep -P $HUB); do kill -TERM $p 2>/dev/null; done; kill -TERM $HUB; wait $HUB 2>/dev/null
cd /; rm -rf "$H"
