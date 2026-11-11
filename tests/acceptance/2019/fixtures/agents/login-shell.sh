#!/bin/sh
# Your login shell, as a stand-in (#2019's acceptance suite): it keeps the PATH it was started with, so the agents setup
# finds are the test home's stand-ins, never this machine's.
[ "$1" = "-l" ] && shift
exec /bin/sh "$@"
