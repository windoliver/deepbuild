#!/bin/sh
# The data check the first finished run left beside its report: the total on the report is the input's.
want=$(awk -F, 'NR > 1 { t += $3 } END { printf "%d", t }' input.csv)
grep -qx "Total: $want" report.md
