#!/bin/bash
# #2033 hand e2e: AC4's 16 m wall scene under a spot and a point light, drawn by a base deep-gpu and by this branch's.
# Usage: bash docs/evidence/2033/e2e.sh <base deep-gpu> <fix deep-gpu> <out dir>
# The base binary is `cargo build --bin deep-gpu` in a checkout of 1b4929ae7; the fix binary the same at this branch.
set -u
WT=$(/usr/bin/git -C "$(dirname "$0")" rev-parse --show-toplevel)
BASE=$1 FIX=$2 OUT=$3
case "$(node -v 2>/dev/null)" in v24.*) ;; *) echo "e2e.sh needs Node 24 as node on PATH" >&2; exit 2;; esac
cd "$WT" || exit 2
echo "#2033 e2e: head $(/usr/bin/git rev-parse --short HEAD), last code commit $(/usr/bin/git log -1 --format=%h -- crates)"
echo "machine $(sysctl -n hw.model), $(date '+%Y-%m-%d %H:%M %Z'), load $(sysctl -n vm.loadavg)"
echo
for side in base fix; do
  bin=$FIX; [ $side = base ] && bin=$BASE
  for kind in spot point; do
    line=$(DEEP_GPU_BIN=$bin E2E_OUT=$OUT/$side node --no-warnings --experimental-transform-types docs/evidence/2033/e2e.ts $kind 2>&1 | grep '^behind')
    set -- $line
    printf '%-4s  %-5s light at 16 m: %5s plane px behind the wall, %4s reached by the light\n' $side $kind $2 $4
    sips -s format png $OUT/$side/$kind-leaks.ppm --out $OUT/$side-$kind-16m.png > /dev/null 2>&1
  done
done
echo
echo "frames written (leaked px in magenta): base-spot-16m.png base-point-16m.png fix-spot-16m.png fix-point-16m.png"
echo "e2e run finished"
