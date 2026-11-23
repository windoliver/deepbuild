#!/bin/sh
# The script the first finished run of the monthly report left (#1527 README: The contract): it does the whole job
# with no model. $1: the input as this fire read it. It exits 3, saying so, when the columns are not the ones it knows.
set -e
[ "$(head -n 1 "$1")" = 'month,region,amount' ] || { echo "the columns changed: $(head -n 1 "$1")" >&2; exit 3; }
cp "$1" input.csv
awk -F, 'NR > 1 { t += $3 } END { printf "# Monthly report\n\nTotal: %d\n", t }' input.csv > report.md
