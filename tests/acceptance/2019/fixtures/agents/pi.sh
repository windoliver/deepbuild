#!/bin/sh
# A stand-in for pi in a test home (#2019's acceptance suite): its version, the one its facts cover.
case "$1" in
  --version|-v) echo "1.4.0" ;;
esac
exit 0
