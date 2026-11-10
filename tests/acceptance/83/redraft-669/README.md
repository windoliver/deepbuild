# Blind redraft of #83 AC11 for the test count of #669

AC11 `#83.15ee3b42`: "golden lines for says done, sent back, PASS, BLOCKED and checks running fit the set width; a fixture
with a long cause keeps "not verified" and the outcome, and shortens the cause first". A fresh run of the blind
acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for this criterion, at base `d259c232` (test(#1460, #83): swap
the frozen cases for their blind redrafts), written beside `../redraft-1460/`, the newest draft of AC11, which it redrafts.
It never saw an implementation. It edits no test outside this folder; `../helpers.ts` and `../redraft-1460/` are inputs it
imports from or copies and doesn't change.

## The dispute

#83's goldens predate #669. #669's first two criteria put the count of tests run on the verdict line: the first stop "reads
FAIL with the failing test's file and line and the count of tests run", and the next "reads PASS with its test count". The
design's verdict in the chat gives the form: "PASS 4/4 · 12 tests · …" and "sent back 1/3: receipt shows $18.00 ·
total.ts:42 · 12 tests"; "the count is the tests the claim's checks ran, as their reports counted them". A line that
follows #669 fails every redraft-1460 golden whose state has a finished run. This redraft keeps each AC11 test's id, title,
steps and record state as redraft-1460 has them and adds only the count, read this way (this job's reading, in the style
of #83's README, Defined here 4):

- **The part.** `<n> tests` (`1 test` for one; no golden here has one), where `<n>` is the sum of the tests the claim's
  finished runs report. `test.verdict` writes `tests_run: 1` on the `run.finished` of each `ran` entry, so `<n>` is the
  number of `ran` entries.
- **Its place.** Its own part, after the cause (with its file and line) and before the next step's owner. Both design
  examples hold: the count follows the outcome's count where there is no cause (PASS) and follows `total.ts:42` where there
  is one (sent back). #83's order puts the owner after the cause and says nothing of a count; keeping the count beside what
  it counts, ahead of the owner, is this job's reading. In a checks-running line `checks running` and `about` belong to the
  outcome part (#83's README, Defined here 4.2), so the count comes after them.
- **No run finished.** The part is left out, as #83 leaves out every empty part. `0 tests` would read as #669's third
  criterion, a check that ran zero tests (INVALID), which a stop with no verdict yet isn't.

Each golden:

- **PASS** (4 runs): `PASS 4/4 · 4 tests · next: you · session/{session8}/{claim}`, 76 columns with a UUID and a ULID
  filled in. The address still fits, so it stays.
- **BLOCKED** (3 runs): `not verified: R1 · BLOCKED 3/4: secret STRIPE_KEY missing · 3 tests · next: you`, 79 columns. The
  cause stays whole: the line fits without the address, which gives way as in redraft-1460.
- **sent back** (3 runs): `sent back 1/3: receipt shows $18.00 · total.ts:42 · 3 tests · next: agent`, 73 columns; the cause
  stays whole, the address gives way as before.
- **checks running** (2 runs): `says done 2/4 · 2 checks running · about 4 min · 2 tests · next: DeepBuild`, 74 columns.
- **says done** (no run finished): unchanged, `says done · 3 checks running · about 4 min · next: DeepBuild`.
- **long cause** (2 runs): `2 tests` joins `keeps`. With it, every kept part (`not verified: R2 · sent back 2/3: `, `… ·
  total.ts:42 · 2 tests · next: agent`) takes 73 columns, so the cause keeps at most 7 before its `…`: its first word,
  `receipt`. The check that the cause's first words stay reads those 7 characters, not 12, and reads them right after
  `sent back 2/3: `, so the bare word `receipt` elsewhere on the line can't pass it. The count is part of the outcome (#669:
  PASS "with its test count") and the owner is a criterion of #83 (AC5), so neither gives way for the cause; the cause
  shortens, as AC11 asks.
- **(wrong program)**: the two planted strings carry ` · 2 tests` before the owner, so they stay lines a #669 program could
  print; what they test is unchanged.

`diff -r ../redraft-1460/goldens goldens` shows the five one-line changes above and nothing else; `says-done.json` is the
same file.

## What it read

- AGENTS.md; issue #83 (Scope, AC5, AC10, AC11) and issue #669 (Scope, criteria, its closing comment).
- `docs/technical-design.md`: An agent says it's done, the verdict in the chat.
- `packages/hub/src/core.ts`, `test.verdict` only, for what each planted `ran` entry's run reports (`tests_run: 1`).
- `../README.md` (Defined here 4, the open questions), `../helpers.ts`, `../goldens/`, and `../redraft-1460/` (README,
  BASE-FAILURE.txt, goldens.test.ts, goldens/, tsconfig.json). redraft-1460's BASE-FAILURE.txt quotes lines a build of the
  time printed; no expected value here is taken from them.

## How to run

Node 24 first on `PATH`, macOS, the workspaces built (`npm ci --ignore-scripts && npm run build --workspaces`) and `deep-hook`
built (`cargo build -p deep-hook --bin deep-hook`), as #83's suite needs:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/83/redraft-669 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/83/redraft-669/tsconfig.json
```

Eight tests, no model and no network, under a minute. Each golden starts a real `deep hub run` under a fresh `/tmp/dh83-*`
home with #83's Claude Code stand-in (nothing touches `~/.deepbuild` or `~/.claude`), and stops only the processes it started,
by PID.

## Files

- `goldens.test.ts`: `../redraft-1460/goldens.test.ts` with the long-cause check of the cause's first word and the two
  wrong-program strings following the count.
- `goldens/`: redraft-1460's six goldens, five with the count's change.
- `tsconfig.json`. `BASE-FAILURE.txt` is written by the session that runs this suite against a wrong program.
