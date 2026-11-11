#!/bin/sh
# A stand-in for Claude Code in a test home (#2019's acceptance suite): its version, a version its facts cover, and its
# sign-in. Nothing else runs; no model is called.
case "$1" in
  --version|-v) echo "2.1.308 (Claude Code)" ;;
  auth) echo '{"loggedIn": true, "authMethod": "claude.ai"}' ;;
esac
exit 0
