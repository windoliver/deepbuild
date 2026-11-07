#!/bin/sh
# The outside provider, a boundary DeepBuild doesn't own: `fakecloud create <instance|number>` makes one resource and
# prints its name, as a cloud CLI does. A resource is a file in .cloud in the session's folder, the one place a check's
# sandbox can read it from. The test removes the file to stand for you deleting it at the provider.
[ "$1" = create ] || { echo "usage: fakecloud create <kind>" >&2; exit 2; }
key="$2-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
: > ".cloud/$key"
echo "created $key"
