# Acceptance tests for #2146: the conformance lint passes on main

Written first, blind, from the live issue #2146, the design and base commit `72fe11a1` (origin/main), by a job that
never saw a fix; no other branch, worktree or pull request was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2146.9d5eea71` | `lint.test.ts` (2): the real `node scripts/conformance-lint.mjs`: no `maps to no verdict` line and `PASS code mappings`; and plain exit 0 with every line a PASS |
| AC2 | `#2146.bd46e9b3` | `unmapped.test.ts` (1 + one per list that holds PASS, 13 at the base): a code added to the doctor family's enum, or to a state list, with no mapping is named by `unmappedCodes` |
| AC3 | `#2146.9b146cf0` | `digests.test.ts` (1): each published schema's entry in `packages/contracts/digests.json` equals its `d1Digest`; `frozenDrift` is empty |

IDs are the first eight hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs` computes
them. Run: `npx vitest run tests/acceptance/2146` after `npm run build --workspaces` (the lint reads `dist`).
`BASE-FAILURE.txt` holds the run on the base.

## Readings where the issue leaves a choice

- **"exits 0" on a machine whose ports can't be read (AC1).** The lint also runs slot kits, and `environment@1`
  reads listening ports with lsof; where that fails its planted proof reads BLOCKED and the lint exits 1 with a line
  that names no code mapping. The first AC1 test allows FAIL lines of exactly that shape (one regular expression, in
  `lint.test.ts`) and no other, and demands exit 1 with them and 0 without. The second is the criterion as written:
  exit 0, every line a PASS. On a machine with that reading the second test fails after a correct fix; that is a
  reading of the machine, not of the fix, and no test reads it as a pass.
- **A stale build (AC1).** The lint runs over `packages/*/dist`. The first test also demands that the source's
  `unmappedCodes()` is empty, so a passing lint over an old build can't stand in for the source.
- **"A code added to a schema" (AC2).** The lint reads the published files only, and its `code mappings` lines are
  `unmappedCodes()`'s entries, so the tests pass widened schemas to `unmappedCodes`, as #313's do. For the doctor
  family the entry must be `{family: 'doctor', code}`, found through `codeFamilies()` so a move to `doctor.item@2` is
  followed. For a state list only the code is demanded, under whatever family the lint files it, and nothing else may
  be newly named.
- **Which state lists (AC2).** Every published enum that lists PASS, found at run time: the issue's `verdict queued`
  lines come from one (row.set's word), and the lint reads each of them as a verdict list at the base. A fix that
  exempts one of these lists whole, so a word added to it is never named, fails its test.
- **"with the contract's version moved if its shape changed" (Scope, not a criterion)** has no test here.

## What AC2's tests fail on

They pass at the base. Each fails on a lint that makes AC1 pass by no longer naming what is added: one whose doctor
mapping has a default, one that drops the doctor family or the walk over lists that hold PASS, one that skips a
schema or a list by name, or one whose `unmappedCodes` returns nothing.

## Not repeated here

`tests/acceptance/313/codes.test.ts` (every listed code judges to a verdict; verdict, refusal and exit enums widened)
and `tests/acceptance/311/d1.test.ts` (a reshaped or unfrozen schema drifts, naming it) already cover those.
