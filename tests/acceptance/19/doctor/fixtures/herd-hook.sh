#!/bin/sh
# Another tool's hook (README: AC18): a terminal multiplexer's, which installs hook entries of its own into Claude
# Code's user settings beside DeepBuild's. It reads the hook's payload, appends its argument to herd.log beside it,
# prints nothing and exits 0, so it never changes what a hook decides.
here=$(cd "$(dirname "$0")" && pwd -P)
cat > /dev/null
printf '%s\n' "$*" >> "$here/herd.log"
exit 0
