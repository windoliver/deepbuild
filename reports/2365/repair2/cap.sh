#!/bin/bash
# usage: cap.sh <out-file> <node-bin> <command...>
# Runs the command with <node-bin>'s folder first in PATH; saves the command, the Node version and the output.
out="$1"; node_bin="$2"; shift 2
{
  echo "\$ PATH=$(dirname "$node_bin"):\$PATH $*"
  echo "node: $("$node_bin" -v) ($node_bin)"
  echo "started: $(date -u +%Y-%m-%dT%H:%M:%SZ); load averages: $(uptime | sed 's/.*load averages: //')"
  echo "-----"
  PATH="$(dirname "$node_bin"):$PATH" "$@" 2>&1
  code=$?
  echo "-----"
  echo "EXIT $code; ended: $(date -u +%Y-%m-%dT%H:%M:%SZ); load averages: $(uptime | sed 's/.*load averages: //')"
} | sed "s#$HOME#<home>#g" > "$out"
