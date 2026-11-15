# #1335's Proof

The Proof has two halves: a fixture forge run, then this repo's rule and what it selected on the live issues.

## A fixture forge run

`tests/acceptance/1335/` was written first and blind. It runs a real hub, real starts, #1332's run, the gate's
checks and #1331's landing, against a played forge and played agents. `acceptance.txt` holds its run on this
change. Each of the five criteria is one test file, and each was run once: 5 passed.

## This repo's rule on the live issues

These are read-only readings of `windoliver/deepbuild` on 2026-11-14 at `a12be6c8c`. The open issues are listed as a
standing run lists them (`GET /repos/{repo}/issues?state=open`, a page of 100 at a time, pull requests left out). The
hub's own rule and readiness code (`packages/hub/src/work-rule.ts`) is applied to each issue, and design links are read
on `origin/main`. No session was started and nothing was written to the forge. Authors' logins are left out: an issue
by an outside author or an app is counted, never named.

| Rule | Open | Meet the rule's structure | Join | Stay out, with why |
| --- | --- | --- | --- | --- |
| `every issue under epic #1324` (`live-epic-1324.json`) | 1204 | 28 | 28 | 0 |
| `every issue labelled area:hub` (`live-area-hub.json`) | 1204 | 121 | 111 | 10: 9 have no design link, 1 has no acceptance criteria |

Each file lists the issues that joined, in the run's order: the earliest milestone first, then the lowest number.
This repo's milestones R1 to R6 have no due dates, so they order by number. Each file also lists the issues that stay
out, each with the reason the run's page gives.
