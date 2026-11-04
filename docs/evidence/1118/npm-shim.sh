#!/bin/sh
echo "$(date +%s) $(pwd -P) $*" >> "$NPM_LOG"
exec $HOME_REAL/.local/bin/npm "$@"
