#!/bin/sh
# Stands in for an agent's CLI (`claude`, `codex`) first on every child's PATH (README, The world), so no real agent,
# and so no model, is ever reachable from the hub or a hook. It logs how it was called beside itself and fails.
echo "$(basename "$0") $*" >> "$(dirname "$0")/calls.log"
echo "$(basename "$0"): a stand-in; nothing runs in these tests" >&2
exit 1
