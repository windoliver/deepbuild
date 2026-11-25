# Acceptance tests for #3108: both AC3 tests of #1720's suite fail on main

Written first, blind, from issue #3108 (its text, Scope and two acceptance criteria), AGENTS.md, the design's Dogfooding
section and the issue's linked Pack section, and base commit `0a875355b2c19e7705b1b248c9a20b85e24cbbcd`, by a job that never saw
an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding). They read and import `tests/acceptance/1720/` and `scripts/install-prefix.mjs`; they edit neither.

## Criteria

| ID | Criterion | File | Test |
|---|---|---|---|
| `#3108.20c3092c` | Both AC3 tests of `tests/acceptance/1720/` pass on main | `ac1-hub-listing.test.ts` | `#3108.20c3092c hub.test.ts AC3: each first-party pack is listed by deep_kinds list on a live hub, and the test passes` |
| `#3108.20c3092c` | (same) | `ac1-planted.test.ts` | `#3108.20c3092c planted.test.ts AC3: the planted pack is refused by the installed tree's hub and named by deep doctor, and the test passes` |
| `#3108.6d9cc561` | A hub started from `scripts/install-prefix.mjs`'s tree starts, and `deep doctor` answers | `ac2-installed-hub.test.ts` | `#3108.6d9cc561 the installed tree's deep hub run starts, and its deep doctor --json answers with doctor items` |

## What each test asserts, and through which surface

- **`#3108.20c3092c`, two files, one AC3 test each.** Each runs one file of `tests/acceptance/1720/` as it stands
  (`hub.test.ts`, then `planted.test.ts`) in a child Vitest from the checkout's root with the root config, as the unit lane
  runs it, filtered by `--testNamePattern` to the one AC3 test by its exact name, with the JSON reporter writing to a temp
  file. Passing means: the report exists, the file ran, the named test is in it with status `passed` (not skipped, not
  missing), and the child exited 0. A failure quotes the #1720 test's own failure message. The two runs are separate files
  because each may take most of a file's 20 minutes (hub.test.ts's `beforeAll` alone allows 15 minutes); the child is
  killed (`spawn`'s own `timeout`) after 18 minutes, which reads as a failure, never a hang.
- **`#3108.6d9cc561`.** `node scripts/install-prefix.mjs --prefix <temp>` lays out the installed tree (#1720's helpers,
  `install()`, which puts the checkout's built deep-hook where the tree's hub looks, as npm's optional platform package
  would). The tree's own `<prefix>/bin/deep hub run`, in a temporary HOME, starts: its first stdout line is JSON with
  `ready: true` (#1720's `startHub`). With that hub running, the tree's own `deep doctor --json` in the same HOME answers: it
  ends by itself (not killed at its limit) and its stdout is one or more lines, each a JSON object with a string `item` and
  `level`. Every failure is gathered and asserted at once. The hub is stopped by its PID (#1720's `cleanup`).

## Running

Needs `npm ci`, `npm run build --workspaces`, and `deep-show` and `deep-hook` built under the checkout's `target/` (the #1720
suite runs `cargo build --locked --bin deep-show` and `--bin deep-hook` itself). macOS or Linux; `lane.json` keeps the suite
alone (binary: it starts cargo and hubs through #1720's files).

    npx vitest run --no-file-parallelism tests/acceptance/3108/

## On the base

Every test fails at its own assertion for the reason the issue names; see `BASE-FAILURE.txt`.
