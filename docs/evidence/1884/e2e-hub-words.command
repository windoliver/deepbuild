#!/bin/bash
# Hub words for an uncovered version, e2e by hand (PR 2976, Part of #1884). Built on #1884's e2e1884.command: the real `deep doctor` and a real dev hub (`deep hub run`) with the real deep-hook, Claude Code's
# shipped facts (2.1.299, 2.1.304, 2.1.308), a stand-in `claude` on PATH at a listed version and at one between two.
set -u
printf "\e[3;0;0t\e[8;75;230t"; clear
WT=~/private/deepbuild-core/.claude/worktrees/nostalgic-hellman-822286
NODEBIN=$HOME/.nvm/versions/node/v24.22.0/bin
CLI=$WT/packages/cli/dist/main.js
HOOK=$WT/target/debug/deep-hook
E=$(mktemp -d /tmp/e2ewords.XXXXXX)
export HOME=$E/h
mkdir -p "$HOME/.deepbuild" "$E/w"
for k in $(env | grep -oE '^(DEEP_|CLAUDE|CODEX_)[A-Za-z0-9_]*'); do unset "$k"; done
export PATH=$NODEBIN:/usr/bin:/bin:/usr/sbin:/sbin
deep() { node "$CLI" "$@"; }
printf '{"v":1,"entries":{"e2e-rm-build":{"match":"shell:rm -rf build","scope":"all_repos","mode":"block","reason":"Guarded in this e2e.","next_step":"Leave it.","fail_closed":false}}}\n' > "$HOME/.deepbuild/rules.json"

echo "== facts: $(node -e "console.log(require('$WT/adapters/claude-code.facts.json').versions.join(', '))")   (branch $(/usr/bin/git -C "$WT" rev-parse --short HEAD) + fix)"
mkdir -p "$E/bin"; printf '{"runner":{"login_path":"%s"}}\n' "$E/bin:$NODEBIN:/usr/bin:/bin:/usr/sbin:/sbin" > "$HOME/.deepbuild/config.json"
echo confirmed > "$E/confirm"
DEEP_HUB_TEST_CONFIRM=$E/confirm DEEP_HUB_TEST_FORGE=http://127.0.0.1:9 node "$CLI" hub run > "$E/hub.out" 2> "$E/hub.err" &
HUB=$!
for i in $(seq 1 600); do grep -q ready "$E/hub.out" 2>/dev/null && break; sleep 0.2; done
echo "== dev hub: pid $HUB, $(head -1 "$E/hub.out" | cut -c1-90)"

for V in 2.1.304 2.1.300; do
  echo
  echo "################ stand-in claude $V on PATH ################"
  mkdir -p "$E/bin-$V"
  printf '#!/bin/sh\n[ "$1" = "--version" ] && { echo "%s (Claude Code)"; exit 0; }\nexit 1\n' "$V" > "$E/bin-$V/claude"
  chmod 755 "$E/bin-$V/claude"
  echo "\$ which claude; claude --version"
  PATH=$E/bin-$V:$PATH; which claude; claude --version
  echo "\$ deep doctor --json | grep claude.binary"
  deep doctor --json | grep '"claude.binary"' | node -e 'for (const l of require("fs").readFileSync(0,"utf8").trim().split("\n")) { const i = JSON.parse(l); console.log(`${i.item}  ${i.level}  ${i.code}\n  ${i.evidence.replace(process.env.HOME, "~")}`); }'
  SID=$(uuidgen | tr A-Z a-z); P=$(uuidgen | tr A-Z a-z); T=$HOME/.claude/projects/e2e/$SID.jsonl
  mkdir -p "$(dirname "$T")"
  NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  printf '{"parentUuid":null,"isSidechain":false,"promptId":"%s","type":"user","message":{"role":"user","content":"Clean the build."},"permissionMode":"default","uuid":"u1-%s","timestamp":"%s","userType":"external","entrypoint":"cli","cwd":"%s","sessionId":"%s","version":"%s","gitBranch":"main"}\n' "$P" "$SID" "$NOW" "$E/w" "$SID" "$V" > "$T"
  printf '{"parentUuid":"u1-%s","isSidechain":false,"type":"assistant","message":{"model":"claude-haiku-5-5","id":"msg_e2e","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_e2e%s","name":"Bash","input":{"command":"rm -rf build"}}],"stop_reason":"tool_use","usage":{"input_tokens":2,"output_tokens":5}},"uuid":"u2-%s","timestamp":"%s","userType":"external","entrypoint":"cli","cwd":"%s","sessionId":"%s","version":"%s","gitBranch":"main"}\n' "$SID" "${SID:0:8}" "$SID" "$NOW" "$E/w" "$SID" "$V" >> "$T"
  echo "\$ deep-hook claude-code PreToolUse  (session ${SID:0:8}, Bash 'rm -rf build', guarded in block mode)"
  OUT=$(cd "$E/w" && printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse","prompt_id":"%s","tool_name":"Bash","tool_input":{"command":"rm -rf build"},"tool_use_id":"toolu_e2e%s"}' "$SID" "$T" "$E/w" "$P" "${SID:0:8}" | "$HOOK" claude-code PreToolUse 2>"$E/hook-$V.err")
  CODE=$?
  echo "  exit $CODE  ($([ $CODE = 2 ] && echo 'blocked: the session is gated' || echo 'let through: the session is watch-only'))  stderr: $(head -c 160 "$E/hook-$V.err")"
  echo "\$ deep status   (the hub's own report)"
  sleep 2
  ST=$(deep status 2>&1 | sed "s|$HOME|~|g")
  echo "$ST" | sed "s/^/    /"
  echo "$ST" | grep -q "${SID:0:8}.*watch-only" && echo "  => hub: session ${SID:0:8} watch-only" || echo "  => hub: session ${SID:0:8} not watch-only"
done

echo
echo "################ deep start under an approved run ################"
R=$E/shop; mkdir -p "$R"; git -C "$R" init -q -b main; git -C "$R" -c user.name=e2e -c user.email=e2e@example.invalid commit -q --allow-empty -m sample
ASK=$(deep start approve --repo "$R" --issues 1 --agents claude-code --home "claude-code=$HOME/.claude" --at-once 1 --plan-share 100 --json | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).ask)')
YES=$(sqlite3 "$HOME/.deepbuild/ledger.db" "SELECT data FROM events WHERE kind = 'ask.created' ORDER BY log_pos DESC LIMIT 1" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).options.find((o) => o.decision === "allow").id)')
echo "\$ deep start approve ... ; deep inbox answer $ASK $YES"
deep inbox answer "$ASK" "$YES" | sed "s/^/    /"
for V in 2.1.300 2.1.400; do
  printf '#!/bin/sh\necho "%s (Claude Code)"\n' "$V" > "$E/bin/claude"; chmod 755 "$E/bin/claude"
  echo "\$ deep start --repo ~/shop --issue 1 --agent claude-code --prompt go   (claude $V on the login PATH)"
  deep start --repo "$R" --issue 1 --agent claude-code --prompt go 2>&1 | sed -e "s|$E|~|g" -e "s/^/    /"
done

echo
kill "$HUB"; for i in $(seq 1 50); do kill -0 "$HUB" 2>/dev/null || break; sleep 0.2; done
kill -0 "$HUB" 2>/dev/null && echo "hub $HUB still running" || echo "== stopped the hub I started (pid $HUB)"
rm -rf "$E"
echo "== removed $E"
