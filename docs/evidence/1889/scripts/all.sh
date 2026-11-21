#!/bin/bash
# Every #1889 e2e case in turn, against the stand-in Gmail only. Node's experimental type-stripping notice, printed
# by the plug-in's own process as it loads index.ts, is dropped from the view.
E=/private/tmp/claude-501/-Users-sophiawj-private-deepbuild-core--claude-worktrees-chore-1904-one-github-client-4c5f2d/9d7232b9-0ccb-4d6b-a078-1a804e88eb12/scratchpad/e2e
REPO=${1:-/Users/sophiawj/private/deepbuild-core/.claude/worktrees/chore-1904-one-github-client-4c5f2d}
FAILED=0
for CASE in read-503 read-timeout marker-missing marker-present read-404; do
  bash "$E/one.sh" "$REPO" "$CASE" 2>&1 | grep -v -e 'ExperimentalWarning: stripTypeScriptTypes' -e 'trace-warnings'
  [ "${PIPESTATUS[0]}" = 0 ] || FAILED=1
  echo
done
[ $FAILED = 0 ] && echo "ALL 5 CASES: exactly one reply each, delivery sent" || echo "SOME CASE FAILED"
