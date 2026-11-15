#!/usr/bin/env bash
# Apache-2.0. Test-only recipe; builds real binaries. Do NOT run in the blind archive job.
# Usage: bash prove.sh <pristine-092754bb1-with-redraft-and-node_modules> <new-scratch-directory>
# Prerequisite: HOME, CARGO_HOME, RUSTUP_HOME are disposable, pre-provisioned (no installs).
set -euo pipefail
source_tree=$(cd "$1" && pwd)
mkdir "$2"
scratch=$(cd "$2" && pwd)
suite=tests/acceptance/375-binary-redraft
node=$(command -v node)
cargo=$(command -v cargo)
: "${HOME:?}" "${CARGO_HOME:?}" "${RUSTUP_HOME:?}"
test -f "$source_tree/node_modules/vitest/vitest.mjs"
export CARGO_NET_OFFLINE=true RUSTC_WRAPPER= CARGO_BUILD_RUSTC_WRAPPER=
unset DEEP_BIN_DIR CARGO_TARGET_DIR

# Never use the real home/toolchain caches for writes. The caller must provision these first.
# Copies retain source paths for the lifetime of their binaries; no target is relocated.
copy_tree() {
  mkdir "$scratch/$1"
  tar -C "$source_tree" --exclude=.git --exclude=node_modules --exclude=target -cf - . |
    tar -C "$scratch/$1" -xf -
  ln -s "$source_tree/node_modules" "$scratch/$1/node_modules"
}
build() {
  (cd "$scratch/$1" && "$cargo" build --offline --locked --target-dir "$scratch/$1-target" \
    --bin deep-layout --bin deep-text)
  mkdir "$scratch/$1-bin"
  cp "$scratch/$1-target/debug/deep-layout" "$scratch/$1-target/debug/deep-text" "$scratch/$1-bin/"
  chmod 555 "$scratch/$1-bin/"*
}
# Guard the external build tool, not any owned component: metadata still runs real cargo.
# Any per-file build records its attempt and fails; no counterfeit metadata or executable.
mkdir "$scratch/guard"
export CARGO_REAL="$cargo" CARGO_ATTEMPTS="$scratch/cargo-attempts"
: > "$CARGO_ATTEMPTS"
printf '%s\n' '#!/bin/sh' 'printf "%s\n" "$*" >> "$CARGO_ATTEMPTS"' \
  'if [ "$1" != metadata ]; then echo "BLOCKED: consumer attempted cargo build" >&2; exit 97; fi' \
  'exec "$CARGO_REAL" "$@"' > "$scratch/guard/cargo"
chmod 755 "$scratch/guard/cargo"
hash_bins() { shasum -a 256 "$1/deep-layout" "$1/deep-text"; }
run_tests() {
  local tree=$1 bins=$2 label=$3 status=0
  hash_bins "$bins" > "$scratch/$label.before" || exit 1
  (cd "$scratch/$tree" && PATH="$scratch/guard:$PATH" DEEP_BIN_DIR="$bins" \
    "$node" node_modules/vitest/vitest.mjs run "$suite/" --fileParallelism --maxWorkers=2 \
      --reporter=verbose) > "$scratch/$label.log" 2>&1 || status=$?
  hash_bins "$bins" > "$scratch/$label.after" || exit 1
  cmp "$scratch/$label.before" "$scratch/$label.after" || {
    echo 'INVALID: supplied binary bytes changed' >&2; exit 1;
  }
  if grep -v '^metadata ' "$CARGO_ATTEMPTS"; then
    echo 'BLOCKED: a consumer invoked cargo other than metadata' >&2; exit 1
  fi
  return "$status"
}
copy_tree clean
copy_tree wrong
"$node" "$source_tree/$suite/plant.mjs" "$scratch/wrong" all-files
build clean
build wrong
# RED first: all five files run side by side against one real, compiled wrong program.
if run_tests wrong "$scratch/wrong-bin" red-all; then
  echo 'INVALID: the wrong program survived' >&2; exit 1
fi
# RED on the clean source too: proves the four binary consumers use supplied wrong bytes,
# not a local rebuild. scope remains green here because it examines the clean source metadata.
if run_tests clean "$scratch/wrong-bin" red-selection; then
  echo 'INVALID: supplied wrong binaries were not observed' >&2; exit 1
fi
# GREEN: same tests and helpers, clean binaries, ordinary file-parallel Vitest.
run_tests clean "$scratch/clean-bin" green
# One directory containing the right program and another the wrong one, simultaneously.
# Wait only for our own two children; failure of one side never masks the other's status.
run_tests wrong "$scratch/wrong-bin" parallel-red &
red_pid=$!
run_tests clean "$scratch/clean-bin" parallel-green &
green_pid=$!
red_status=0; wait "$red_pid" || red_status=$?
green_status=0; wait "$green_pid" || green_status=$?
if [ "$red_status" -eq 0 ] || [ "$green_status" -ne 0 ]; then
  echo 'INVALID: parallel sides did not stay red/green' >&2; exit 1
fi

# Independently prove deep-text is selected from DEEP_BIN_DIR as well as deep-layout.
copy_tree wrong-text
"$node" "$source_tree/$suite/plant.mjs" "$scratch/wrong-text" text
build wrong-text
if run_tests clean "$scratch/wrong-text-bin" red-text; then
  echo 'INVALID: supplied wrong shaper survived' >&2; exit 1
fi

# Missing/empty/non-executable supplied binaries must fail before assertions, no fallback.
for case in absent partial nonexec empty; do
  value="$scratch/$case-bin"
  mkdir "$value"
  if [ "$case" = partial ] || [ "$case" = nonexec ]; then
    cp "$scratch/clean-bin/deep-layout" "$value/"
  fi
  if [ "$case" = nonexec ]; then
    cp "$scratch/clean-bin/deep-text" "$value/"
    chmod 444 "$value/deep-text"
  fi
  if [ "$case" = empty ]; then value=''; fi
  if (cd "$scratch/clean" && PATH="$scratch/guard:$PATH" DEEP_BIN_DIR="$value" \
    "$node" node_modules/vitest/vitest.mjs run "$suite/column.test.ts") \
      > "$scratch/$case.log" 2>&1; then
    echo 'INVALID: unavailable supplied binary passed' >&2; exit 1
  fi
done
if grep -v '^metadata ' "$CARGO_ATTEMPTS"; then exit 1; fi

# Hand-run fallback: no DEEP_BIN_DIR, inherited shared target is a decoy. Two consumers build
# concurrently into their own mkdtemp targets. No shared target/debug build-to-copy step.
mkdir "$scratch/decoy"
printf 'must survive\n' > "$scratch/decoy/sentinel"
(cd "$scratch/clean" && CARGO_TARGET_DIR="$scratch/decoy" \
  "$node" node_modules/vitest/vitest.mjs run "$suite/row.test.ts" "$suite/grid.test.ts" \
    --fileParallelism --maxWorkers=2) > "$scratch/private-build.log" 2>&1
[ "$(find "$scratch/decoy" -type f | wc -l | tr -d ' ')" = 1 ]
[ "$(<"$scratch/decoy/sentinel")" = 'must survive' ]
echo 'Inspect red-all/red-selection/red-text logs at the README-mapped assertions; exit status alone is not proof.'
echo 'Keep scratch through review; redact paths before attaching logs. No automatic verdict or lane migration.'
