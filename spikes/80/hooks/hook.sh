#!/bin/sh
# Throwaway #80 spike hook (not the real hook client, not the adapter). It acts only in the spike's folders,
# ~/deepbuild-spike80/*, and in the one Claude Code session whose ID ~/deepbuild-spike80/self.on
# holds. Everywhere else it exits 0 at once and prints nothing.
here=$(cd "$(dirname "$0")" && pwd)
case "$PWD/" in
  "$HOME"/deepbuild-spike80/*) ;;
  *) [ -n "$CLAUDE_CODE_SESSION_ID" ] && [ -e "$HOME/deepbuild-spike80/self.on" ] \
       && [ "$(cat "$HOME/deepbuild-spike80/self.on")" = "$CLAUDE_CODE_SESSION_ID" ] || exit 0 ;;
esac
exec "$(command -v node || echo /opt/homebrew/bin/node)" "$here/hook.mjs" "$@"
