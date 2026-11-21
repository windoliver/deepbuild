#!/bin/bash
# #2484 contrast: the same warning lsof against the kit without -w (the base's reading, twin warning-reads-unreadable),
# built into dist, then main's program restored and rebuilt. The file is restored and rebuilt on any exit.
E=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$E/../../.." && pwd)
F=packages/conformance/src/slots/environment.ts
export PATH=$E/bin:$PATH
cd "$R" || exit 9
if ! /usr/bin/git diff --quiet HEAD -- "$F"; then echo "$F has local edits; commit or set them aside first"; exit 2; fi
B=$(mktemp)
cp "$F" "$B"
restore() { cp "$B" "$F"; rm -f "$B"; npm run build -w @deepbuild/conformance >/dev/null 2>&1 || { echo "rebuild of main's program failed: dist may still hold the twin"; return 1; }; }
trap restore EXIT
echo "== contrast: the kit with no -w (the base's reading), same warning lsof"
cp "tests/acceptance/2484/twins/warning-reads-unreadable/$F" "$F"
grep -n -e "tool('lsof'" "$F"
npm run build -w @deepbuild/conformance >/dev/null 2>&1 || { echo "build failed: nothing was tested"; exit 1; }
node scripts/slots-check.mjs; echo "   exit=$?"
trap - EXIT
restore || exit 1
echo "== main's program restored and rebuilt:"
grep -n -e "tool('lsof'" "$F"
node scripts/slots-check.mjs; echo "   exit=$?"
