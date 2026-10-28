#!/bin/sh
# A stand-in for the programs these tests never let `deep` reach on this Mac: claude, codex, launchctl and
# systemctl (README: Stand-ins). It appends its name and arguments to calls.log beside it and exits 0. It never
# starts a session, never sends a prompt and never registers a login service.
#   claude --version      the newest Claude Code version the adapter's facts cover (claude.version beside it)
#   claude auth status    the JSON in claude.auth beside it (signed in through claude.ai unless a test writes it)
#   codex --version       codex-cli and the version in codex.version beside it
#   codex login status    the text in codex.login beside it, exit 0 (signed in)
here=$(cd "$(dirname "$0")" && pwd)
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >> "$here/calls.log"
case "$name:$1:$2" in
  claude:--version:*) printf '%s (Claude Code)\n' "$(cat "$here/claude.version")" ;;
  claude:auth:status) cat "$here/claude.auth" ;;
  codex:--version:*) printf 'codex-cli %s\n' "$(cat "$here/codex.version")" ;;
  codex:login:status) cat "$here/codex.login" ;;
esac
exit 0
