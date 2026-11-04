#!/bin/sh
# A stand-in for Claude Code's `claude` binary in the fast tests, the boundary they don't own. It answers what
# `deep setup` and `deep doctor` ask of Claude Code, from files beside it, and never makes a model call:
#   claude --version         "<claude.version> (Claude Code)": a version Claude Code's facts cover
#   claude auth status       Claude Code's own JSON, signed in
#   claude -p|--print …      a test prompt: reads it on stdin and answers one successful turn (json or text)
#   anything else            exit 0, printing nothing
# Every call appends "claude <args>" to calls.log beside it. (Adapted from tests/acceptance/19/doctor/fixtures/claude.sh.)
here=$(cd "$(dirname "$0")" && pwd -P)
printf 'claude %s\n' "$*" >> "$here/calls.log" 2>/dev/null
case "$1" in
  --version|-v) printf '%s (Claude Code)\n' "$(cat "$here/claude.version")"; exit 0 ;;
  auth)
    [ "$2" = status ] && printf '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}\n'
    exit 0 ;;
esac
print=no
format=text
while [ $# -gt 0 ]; do
  case "$1" in
    -p|--print) print=yes ;;
    --output-format) shift; format="$1" ;;
    --output-format=*) format="${1#--output-format=}" ;;
  esac
  shift
done
[ "$print" = yes ] || exit 0
cat > /dev/null
if [ "$format" = json ]; then
  printf '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"num_turns":1,"result":"OK","session_id":"00000000-0000-4000-8000-000000000668","total_cost_usd":0}\n'
else
  printf 'OK\n'
fi
exit 0
