#!/bin/sh
# A stand-in for Codex's `codex` binary, the boundary these tests don't own (README: Stand-ins). It never makes a
# model call:
#   codex --version         "codex-cli <codex.version>"
#   codex login status      "Logged in using ChatGPT" on stderr, exit <codex.login> (0 unless a test writes otherwise)
#   codex exec …            a test prompt: reads the prompt on stdin (`-`) and prints one successful turn as
#                           `codex exec --json` does (thread.started, turn.started, an agent_message, turn.completed)
#   codex mcp list          no servers
#   anything else           exit 0, printing nothing
# Every call appends "<name> <args>" to calls.log beside it first.
here=$(cd "$(dirname "$0")" && pwd -P)
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >> "$here/calls.log" 2>/dev/null

case "$1" in
  --version|-V) printf 'codex-cli %s\n' "$(cat "$here/$name.version")"; exit 0 ;;
  login)
    if [ "$2" = status ]; then
      code=$(cat "$here/$name.login" 2>/dev/null || echo 0)
      if [ "$code" = 0 ]; then printf 'Logged in using ChatGPT\n' >&2; else printf 'Not logged in\n' >&2; fi
      exit "$code"
    fi
    exit 0 ;;
  exec|e)
    cat > /dev/null
    printf '{"type":"thread.started","thread_id":"%08x-0000-7000-8000-%012x"}\n' $$ $$
    printf '{"type":"turn.started"}\n'
    printf '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}\n'
    printf '{"type":"turn.completed","usage":{"input_tokens":8,"cached_input_tokens":0,"output_tokens":1}}\n'
    exit 0 ;;
  mcp)
    if [ "$2" = list ]; then printf 'No MCP servers configured yet. Try `codex mcp add my-tool -- my-command`.\n'; fi
    exit 0 ;;
esac
exit 0
