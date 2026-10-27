#!/bin/sh
# A stand-in for a system tool these tests never let `deep` reach (launchctl, systemctl, and the login-service
# launcher named by DEEP_HUB_LAUNCHER): it appends its name and arguments to calls.log beside it and exits 0, so no
# test registers a login service on this machine.
here=$(cd "$(dirname "$0")" && pwd -P)
printf '%s %s\n' "$(basename "$0")" "$*" >> "$here/calls.log"
exit 0
