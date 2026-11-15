#!/bin/sh
# A stand-in for the login-service launcher (DEEP_HUB_LAUNCHER) that refuses, as issue #2200's "today" has it: it
# appends its name and arguments to calls.log beside it, as #19's stand-ins do, and exits 1, so no hub is started
# and no test waits for one.
here=$(cd "$(dirname "$0")" && pwd -P)
printf '%s %s\n' "$(basename "$0")" "$*" >> "$here/calls.log"
exit 1
