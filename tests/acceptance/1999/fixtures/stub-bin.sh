#!/bin/sh
# A stand-in for a tool these tests never let anything reach (launchctl, systemctl, claude, codex), adapted from
# tests/acceptance/83/fixtures/stub-bin.sh: it appends its name and arguments to calls.log beside it and exits 0.
# `claude --version` and `codex --version` answer with the newest version each agent's facts cover, so setup finds a
# covered agent. A headless model call (`claude -p` or `--print`, `codex exec` or `codex e`) answers with a plausible
# sentence, so a sentence taken from a model looks right and only this log shows where it came from (README, No model).
here=$(cd "$(dirname "$0")" && pwd)
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >> "$here/calls.log"
if [ "${1:-}" = --version ]; then
  case "$name" in
    claude) printf '%s (Claude Code)\n' "$(cat "$here/claude.version")" ;;
    codex) printf 'codex-cli %s\n' "$(cat "$here/codex.version")" ;;
  esac
  exit 0
fi
for arg in "$@"; do
  case "$name:$arg" in
    claude:-p|claude:--print) printf 'Changed total.ts.\n'; exit 0 ;;
  esac
done
if [ "$name" = codex ] && { [ "${1:-}" = exec ] || [ "${1:-}" = e ]; }; then printf 'Changed total.ts.\n'; fi
exit 0
