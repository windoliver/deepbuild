#!/bin/sh
# A stand-in for Claude Code's `claude` binary, the boundary these tests don't own (README: Stand-ins). It answers
# what `deep doctor`, setup and the runner may ask of Claude Code, from files beside it, and never makes a model call:
#   claude --version            "<claude.version> (Claude Code)"
#   claude auth status          the JSON in claude.auth (Claude Code's own shape: loggedIn, authMethod, apiProvider,
#                               subscriptionType), exit 0
#   claude mcp add|add-json|remove|get|list
#                               Claude Code's MCP registry, kept where Claude Code keeps it (claude-mcp.mjs)
#   claude -p|--print …         a test prompt: reads the prompt on stdin and answers one successful turn, as
#                               stream-json (system init, one assistant message, a success result), json or text
#   anything else               exit 0, printing nothing
# Every call appends "<name> <args>" to calls.log beside it first, so a test sees each call and its order.
here=$(cd "$(dirname "$0")" && pwd -P)
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >> "$here/calls.log" 2>/dev/null
version=$(cat "$here/$name.version" 2>/dev/null)

case "$1" in
  --version|-v) printf '%s (Claude Code)\n' "$version"; exit 0 ;;
  auth)
    if [ "$2" = status ]; then cat "$here/$name.auth"; exit 0; fi
    exit 0 ;;
  mcp) shift; exec "$(cat "$here/node.path")" "$here/claude-mcp.mjs" "$@" ;;
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
session=$(printf '%08x-0000-4000-8000-%012x' $$ $$)
model=claude-haiku-4-5
case "$format" in
  stream-json)
    printf '{"type":"system","subtype":"init","session_id":"%s","model":"%s","tools":[],"mcp_servers":[],"permissionMode":"dontAsk","apiKeySource":"none","claude_code_version":"%s"}\n' "$session" "$model" "$version"
    printf '{"type":"assistant","message":{"id":"msg_dh19d","type":"message","role":"assistant","model":"%s","content":[{"type":"text","text":"OK"}],"usage":{"input_tokens":8,"output_tokens":1}},"session_id":"%s"}\n' "$model" "$session"
    printf '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"num_turns":1,"result":"OK","session_id":"%s","total_cost_usd":0,"usage":{"input_tokens":8,"output_tokens":1}}\n' "$session" ;;
  json)
    printf '{"type":"result","subtype":"success","is_error":false,"duration_ms":12,"num_turns":1,"result":"OK","session_id":"%s","total_cost_usd":0,"usage":{"input_tokens":8,"output_tokens":1}}\n' "$session" ;;
  *) printf 'OK\n' ;;
esac
exit 0
