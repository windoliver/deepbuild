# Dispute: the first draft's waits fail the wait ratchet

This redraft exists because of this dispute. The first draft is `tests/acceptance/3587/` (commit ff87abe0e on this
branch, written blind as 7c2bc0351 at base b48a47db7). This file is the work's, not the blind job's. The job wrote the
other files of this folder and never saw this one.

## What fails

The lint lane's wait ratchet (`scripts/wait-ratchet.mjs`, #1604) judges a suite's own files from zero in the change
that adds them, and no `scripts/wait-ceilings.json` entry can lift that: an unlisted file is bounded at 0
(`wait-ratchet.mjs:262`). The first draft has seven fixed waits, so the lint lane fails on it whichever draft runs:

```
FAIL waits: tests/acceptance/3587/helpers.mjs:12:52: a timer is a fixed wait unless it only bounds one, marked // deadline: <why>
FAIL waits: tests/acceptance/3587/helpers.mjs:87:17: a timer is a fixed wait unless it only bounds one, marked // deadline: <why>
FAIL waits: tests/acceptance/3587/helpers.mjs:128:11: sleep(…) is a fixed wait
FAIL waits: tests/acceptance/3587/helpers.mjs:146:36: sleep(…) is a fixed wait
FAIL waits: tests/acceptance/3587/hung.test.mjs:25:9: sleep(…) is a fixed wait
FAIL waits: tests/acceptance/3587/interrupt.test.mjs:15:9: sleep(…) is a fixed wait
FAIL waits: tests/acceptance/3587/supervisor.test.mjs:39:9: sleep(…) is a fixed wait
```

The work can't change them (AGENTS.md: agents can't change checks or blind tests).

## How the redraft was made

A fresh, isolated run of the suite's blind job: an empty folder holding only b48a47db7, fetched by SHA. Its inputs
were issue #3587's body, the design at the base, the seven criterion IDs, and the wait ratchet's header as a rule
(`REDRAFT.md`). It never saw this branch, the first draft, the findings or this dispute. An earlier attempt was stopped
before it wrote anything, because it had been given the first draft and the findings.

It wrote `waits.test.mjs` and `helpers.mjs`: one file with all seven criteria, the same IDs and expected values. Its one
timer bounds a wait and carries its `// deadline:` marker. Its fixture holds a build grant on the suite's private
throttle table, so preflight's timed grant is nested and no load gate applies. Its harness criterion adds a stub
`scripts/agent-harness.mjs` and a harness budget, so the harness lane is reachable. Its never-ending child ignores
TERM, INT and HUP.

The job flagged three ambiguities in the issue:
- whether the allowance clock starts at the warm-up builds or at `checks.mjs` (its budgets allow either);
- which "work child" the plant for `#3587.62b7650e` means;
- whether "its release" may be a later holder-gone sweep (it accepts any release entry plus an empty table).

## Results

| Criterion | First draft, base | First draft, work | Redraft, base | Redraft, work |
|---|---|---|---|---|
| `#3587.f9f3205c` hung checks stopped at the allowance | FAIL | PASS | FAIL | PASS |
| `#3587.ba427c00` one budget FAIL line, BLOCKED perf | FAIL | PASS | FAIL | PASS |
| `#3587.1c61ab9b` timed granted and released | FAIL | PASS | FAIL | PASS |
| `#3587.4d67f808` within the allowance, not stopped | PASS | PASS | PASS | PASS |
| `#3587.62b7650e` SIGINT ends it with 130, nothing alive | PASS | PASS | FAIL | PASS |
| `#3587.c4fdbceb` no perf after the supervisor's SIGKILL | FAIL | PASS | FAIL | PASS |
| `#3587.4323e662` fractional allowance runs and times | PASS | PASS | PASS | PASS |
| wait ratchet | 7 FAIL lines | 7 FAIL lines | none | none |

Sources:
- First draft: base `BASE-FAILURE.txt` in `tests/acceptance/3587/`; work on the Mac at 136bf9252 (try10, 7 of 7).
- Redraft: base its `BASE-FAILURE.txt`; work on the Spark at 9d224f734 (7 of 7, load 26).

## Ruling asked for

One of:

1. **The redraft runs** (recommended). The first draft is kept byte for byte as evidence under
   `docs/evidence/3587/draft-7c2bc0351/`, its code files renamed `.txt` so nothing runs or lints them, as #321's was.
   `scripts/lanes-lists.mjs` runs `tests/acceptance/3587-redraft-waits/` alone, for the first draft's reason (timing:
   each criterion times a preflight against a budget of seconds and a 30 s stop bound). That commit takes the owner's
   signed tag.
2. **The first draft runs.** Then the lint lane fails on its seven waits until the wait ratchet's rule changes.
