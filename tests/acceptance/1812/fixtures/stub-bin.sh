#!/bin/sh
# A stand-in for a service manager these tests never let DeepBuild reach (launchctl, systemctl) and for a login
# service that refuses (refusing-launcher): it appends its name and arguments to calls.log beside it, loads nothing
# and exits 1, as a service manager that couldn't load the job does.
here=$(cd "$(dirname "$0")" && pwd)
printf '%s %s\n' "$(basename "$0")" "$*" >> "$here/calls.log"
exit 1
