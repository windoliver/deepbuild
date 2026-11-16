#!/bin/sh
# Runs the 1875 tests on a planted wrong program: twins/<name>.patch applied to this checkout's scripts/affected.mjs in
# a throwaway copy whose own commit (its origin/main, so its merge base) holds the unpatched scripts.
#   sh tests/acceptance/1875/twins/run.sh <name or patch path> [test name pattern]
set -eu
here=$(cd "$(dirname "$0")/../../../.." && pwd)
patch=$1; [ -f "$patch" ] || patch="$here/tests/acceptance/1875/twins/$1.patch"
patch=$(cd "$(dirname "$patch")" && pwd)/$(basename "$patch")
copy=$(mktemp -d "${TMPDIR:-/tmp}/deep-1875-twin-XXXXXX")
trap 'rm -rf "$copy"' EXIT
mkdir -p "$copy/tests/acceptance"
cp -R "$here/scripts" "$copy/scripts"
cp -R "$here/tests/acceptance/1875" "$copy/tests/acceptance/1875"
cp "$here/vitest.config.ts" "$copy/vitest.config.ts"
cp "$here/tests/vitest-setup.ts" "$copy/tests/vitest-setup.ts"
ln -s "$here/node_modules" "$copy/node_modules"
cd "$copy"
printf 'node_modules\n' > .gitignore
git init -q -b main
git add -A
git -c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -qm base
git update-ref refs/remotes/origin/main HEAD
git apply "$patch"
if [ $# -gt 1 ]; then node --test --test-name-pattern="$2" 'tests/acceptance/1875/*.test.mjs'
else node --test 'tests/acceptance/1875/*.test.mjs'; fi
