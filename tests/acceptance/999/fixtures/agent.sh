#!/bin/sh
# One session's Claude Code on the test host, as far as its processes go (README, A session on the host): a long-lived
# shell there whose children are that session's hook commands and its tools' own commands. It runs each hook as Claude
# Code does, `/bin/sh -c <the command in ~/.claude/settings.json>` with the hook's JSON on stdin, in the session's
# folder; the installed command starts with `exec`, so deep-hook is this shell's own child, as it is Claude Code's. It
# decides nothing about DeepBuild.
#
#   sh agent.sh <work folder>     prints `ready`, then answers one line per line it reads
#
#   in:   <n> <cwd> <command> <stdin>        cwd, command and stdin in base64; `-` for an empty stdin
#   out:  <n> <exit code> <stdout>- <stderr>-  stdout and stderr in base64, each followed by `-`
#
# One command at a time, in the order read. It ends when its stdin closes, as the harness's SSH session ends.
w=$1
mkdir -p "$w" || exit 3
echo ready
while IFS=' ' read -r n cwd cmd input; do
  [ -n "$cmd" ] || continue
  d=$(printf %s "$cwd" | base64 -d)
  c=$(printf %s "$cmd" | base64 -d)
  if [ "$input" = - ]; then : > "$w/in"; else printf %s "$input" | base64 -d > "$w/in"; fi
  (cd "$d" && exec sh -c "$c") < "$w/in" > "$w/out" 2> "$w/err"
  code=$?
  printf '%s %s %s- %s-\n' "$n" "$code" "$(base64 -w0 < "$w/out")" "$(base64 -w0 < "$w/err")"
done
