#!/bin/sh
# A stand-in for Codex in a test home (#2019's acceptance suite): its version, a version its facts cover, its sign-in,
# and its app-server, which answers hooks/list (codex-app-server.cjs). No model is called.
here=$(dirname "$0")
case "$1" in
  --version) echo "codex-cli 0.160.0" ;;
  login) echo "Logged in using ChatGPT" ;;
  app-server) exec "${NODE:-node}" "$here/codex-app-server.cjs" ;;
esac
exit 0
