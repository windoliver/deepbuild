#!/bin/bash
# Test-only: `bash mcp-record.sh <dir> <command> [args...]` becomes the MCP server command itself (exec keeps this process's
# PID, so the server stays the agent's direct child, which the hub's binding of a deep_* call to its session requires), while
# two tee processes copy what the agent sent to <dir>/in.jsonl and what the server answered to <dir>/out.jsonl, one JSON-RPC
# message per line, unchanged. ac1-agents.live.test.ts registers it in front of `deep mcp` to record a session's deep_drive calls.
dir=$1
shift
exec "$@" < <(/usr/bin/tee -a "$dir/in.jsonl") > >(/usr/bin/tee -a "$dir/out.jsonl")
