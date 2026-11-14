#!/bin/sh
# Usage: sh run.sh  (on the Mac, from this folder). Writes result.txt.
set -u
{
  echo "== $(date -u) $(sw_vers -productVersion) $(uname -m) node=$(command -v node)"
  codesign -dv --entitlements - "$(command -v node)" 2>&1 | grep -E 'flags|dyld' || true
  cc -dynamiclib -o interpose.dylib interpose.c && cc -O2 -o baseline baseline.c
  echo "== C baseline"; ./baseline "${TMPDIR:-/tmp}/ffs-baseline"
  echo "== Node under the interposer"; DYLD_INSERT_LIBRARIES="$PWD/interpose.dylib" node probe.mjs 2>&1
} > result.txt 2>&1
cat result.txt
