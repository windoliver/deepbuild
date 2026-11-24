#!/bin/bash
# The two wrong programs no DEEP_HUB_PLANT reaches (README: Wrong programs), each laid over an APFS clone of a built
# checkout, and criteria.test.ts run there. Nothing in the checkout itself changes.
#   bash mutants.sh <built checkout> <scratch folder> <inbox-drops-session | scope-all>
# Its log is <scratch folder>/<mutant>.log; the clone is <scratch folder>/<mutant>/ (remove it when done).
set -u
SRC=$1; OUT=$2; MUTANT=$3
CLONE=$OUT/$MUTANT
rm -rf "$CLONE"
cp -cR "$SRC" "$CLONE" || exit 9
case $MUTANT in
  # AC1's: `deep inbox` that lists each ask without the session that raised it.
  inbox-drops-session)
    FILE=$CLONE/packages/hub/dist/inbox.js
    /usr/bin/sed -i '' "s/\${a.project ?? 'no repo'}  \${a.session}\${age}/\${a.project ?? 'no repo'}\${age}/" "$FILE" ;;
  # AC2's: your answer saved as a decision for all your repos, a scope its card never showed.
  scope-all)
    FILE=$CLONE/packages/asks/dist/decision-keys.js
    /usr/bin/sed -i '' "s/return project ? \`repo:\${project}\` : ask.session ? \`session:\${letters(ask.session)}\` : null;/return 'all';/" "$FILE" ;;
  *) echo "unknown mutant $MUTANT"; exit 2 ;;
esac
# The mutant must have changed the file, or the run would prove nothing.
if /usr/bin/cmp -s "$FILE" "$SRC/${FILE#$CLONE/}"; then echo "BLOCKED: $MUTANT left $FILE unchanged"; exit 3; fi
/usr/bin/diff "$SRC/${FILE#$CLONE/}" "$FILE" > "$OUT/$MUTANT.diff"
cd "$CLONE" || exit 9
echo "mutant $MUTANT at $(date), load $(sysctl -n vm.loadavg)" > "$OUT/$MUTANT.log"
npx vitest run tests/acceptance/667/redraft-3178/criteria.test.ts --reporter=verbose --testTimeout=600000 --silent=false >> "$OUT/$MUTANT.log" 2>&1
echo "exit $? at $(date), load $(sysctl -n vm.loadavg)" >> "$OUT/$MUTANT.log"
