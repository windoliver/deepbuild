#!/bin/sh
# A stand-in for a system tool these tests never let the hub reach (launchctl, systemctl, claude): it appends its name
# and arguments to calls.log beside it and exits 0. `claude --version` answers with the newest version Claude Code's
# facts cover. Copied from tests/acceptance/83/fixtures/stub-bin.sh (same repo, same license).
here=$(cd "$(dirname "$0")" && pwd)
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >> "$here/calls.log"
if [ "$name" = claude ] && [ "$1" = --version ]; then
  printf '%s (Claude Code)\n' "$(cat "$here/claude.version")"
fi
exit 0
