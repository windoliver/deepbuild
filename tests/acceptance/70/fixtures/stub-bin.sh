#!/bin/sh
# A stand-in for `claude`, which `deep setup` looks for: `claude --version` answers with the newest version Claude
# Code's facts cover, and anything else exits 0. systemctl, systemd-run and bwrap are never stood in for here.
here=$(cd "$(dirname "$0")" && pwd)
if [ "$1" = --version ]; then
  printf '%s (Claude Code)\n' "$(cat "$here/claude.version")"
fi
exit 0
