#!/bin/bash
# Usage: per-process.sh <deep-drive binary> <dest dir> — each journey in a deep-drive process of its own.
for j in needs-you session project; do node "$(dirname "$0")/drive-shots.mjs" "$1" "$2" "$j" | tail -1; done
