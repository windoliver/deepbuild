#!/bin/sh
# Hand e2e for #2134: the built deep-hook, no hub, each call fed to it as Claude Code's PreToolUse payload on stdin.
# No cloud or package command is ever run. Usage: sh docs/evidence/2134/run.sh <repo> > e2e.txt
set -u
REPO=${1:?repo}
HOOK="$REPO/target/debug/deep-hook"
T=$(mktemp -d /tmp/dh2134e2e-XXXXXX)
H="$T/h"
mkdir -p "$H/.deepbuild" "$H/.aws" "$H/w"
chmod 700 "$H/.deepbuild"
# The shipped rules, plus a standing rule for the account profile dev signs into.
node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
r.standing = [{ effect: "cloud-resource", owner: "aws:111111111111" }];
fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 2) + "\n", { mode: 0o600 });
' "$REPO/crates/deep-hook/default-rules.json" "$H/.deepbuild/rules.json"
printf '{"version":"0.0.0","at":"2026-11-21T00:00:00Z"}\n' > "$H/.deepbuild/setup-finished.json"
printf '[profile dev]\nsso_account_id = 111111111111\n[profile prod]\nsso_account_id = 222222222222\n' > "$H/.aws/config"

echo "# deep-hook $(git -C "$REPO" rev-parse --short HEAD), $(date -u +%Y-%m-%dT%H:%M:%SZ), load $(sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg)"
echo "# home: <tmp>/h; standing: aws:111111111111 (profile dev); no hub"

pre() {
  payload=$(node -e 'console.log(JSON.stringify({session_id:"e2e-2134",transcript_path:process.argv[2]+"/t.jsonl",cwd:process.argv[2]+"/w",hook_event_name:"PreToolUse",permission_mode:"default",tool_name:"Bash",tool_input:{command:process.argv[1]},tool_use_id:"toolu_e2e"}))' "$1" "$H")
  out=$(printf '%s' "$payload" | env -i HOME="$H" PATH="$PATH" LC_ALL=C "$HOOK" claude-code PreToolUse 2>"$T/err")
  code=$?
  echo
  echo "\$ PreToolUse Bash: $1"
  echo "exit $code"
  [ -n "$out" ] && echo "stdout: $out"
  [ -s "$T/err" ] && sed "s|$T|<tmp>|g; s|^|stderr: |" "$T/err"
}

check() {
  entry=$(node -e 'console.log(JSON.stringify({entry:{match:process.argv[1],scope:"all_repos",mode:"block",reason:"r",next_step:"n",fail_closed:true},call:{tool_name:"Bash",tool_input:{command:process.argv[2]},cwd:process.argv[3]}}))' "$1" "$2" "$H/w")
  echo
  echo "\$ check $1: $2"
  printf '%s' "$entry" | env -i HOME="$H" PATH="$PATH" LC_ALL=C "$HOOK" check
}

echo; echo "## AC1: the owner is the creating run's"
pre 'aws s3 ls --profile dev; aws kms create-key --profile prod'
pre 'aws s3 ls --profile dev && aws kms create-key --profile prod'
pre 'aws kms create-key --profile dev'
pre 'aws s3 ls --profile prod && aws kms create-key --profile dev'
pre 'AWS_PROFILE=prod aws kms create-key'
pre 'aws kms create-key --profile dev && aws kms create-key --profile dev'

echo; echo "## AC2: an option's value is never the subcommand"
check effect:cloud-resource 'pulumi -C infra up'
check effect:cloud-resource 'cdk --profile prod deploy'
check effect:dependency 'npm --prefix web install left-pad'
check effect:cloud-resource 'pulumi -C up preview'
pre 'pulumi -C infra up'
pre 'cdk --profile prod deploy'

rm -rf "$T"
