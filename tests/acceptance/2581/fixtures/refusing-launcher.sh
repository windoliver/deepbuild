#!/bin/sh
# A stand-in for the login-service launcher (DEEP_HUB_LAUNCHER) that refuses, as #2200's suite has it: it appends its
# name and arguments to calls.log beside it, as #19's stand-ins do, and exits 1, so a command that wrongly runs setup
# starts no hub and no test waits for one.
here=$(cd "$(dirname "$0")" && pwd -P)
printf '%s %s\n' "$(basename "$0")" "$*" >> "$here/calls.log"
exit 1
