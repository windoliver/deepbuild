# Dispute: #1886's first draft proves none of its criteria in the proof lanes

**The first draft can't prove any of #1886's criteria through `before` and `trace`.** `tests/acceptance/1886/route.test.ts`
has two tests, both tagged AC1. AC2 and AC3 point at #87's suites, which carry no #1886 tag. The proof lanes at
#3111's `e3601d483` (merge base `914bd5f29`) read:

```
FAIL before: tests/acceptance/1886/route.test.ts › AC1 #1886.33628f8b … opens PR 21; its review on the real hub is uncounted, "model unknown: proxied route", the claim isn't PASS, and the record never holds the URL: failed on the base before its assertion (Error: AC1 #1886.33628f8b claim:… was made in a session started with ANTHROPIC_BASE_URL set, so its review must be uncounted, "model unknown: proxied route"; the transcript's model was trusted instead: … review passed ["same-family review (claude-sonnet-5-5)"]. …)
FAIL before: tests/acceptance/1886/route.test.ts › AC1 #1886.33628f8b … the same session with ANTHROPIC_BASE_URL unset is on the agent's own route: its transcript's model stands, and the review counts: passed on the merge base
FAIL trace: Closes #1886 refused: this change is Part of #1886; open: #1886.33628f8b, #1886.209d6f6c, #1886.ece183af
```

- **AC1's test** fails on the merge base for the right reason (the transcript's model is trusted), but it throws its
  own `Error` instead of failing at an `expect`. So `before` reads it as failing "before its assertion".
- **AC1's twin** (own route) passes on the merge base as it should. It is tagged AC1, though, and has no planted wrong
  program, so it proves nothing.
- **AC2 and AC3** have no test tagged with their #1886 IDs. The first draft's README sends them to
  `tests/acceptance/87/models` as is.

The implementation isn't at fault. The first draft passes on #3111's code: 2 of 2 at `a18fdc11e`, whose implementation's diff is the same.

## The redraft

A fresh run of the blind job wrote this folder (`redraft/`), plus `twins.json` and `twins/` one level up, where the
lanes' `twinsOf` reads them. Its inputs were the issue with its comments, the design and the base checkout at
`914bd5f29`. It never saw #3111's diff, branch or transcript. Its tests:

| ID | Test | Proven by |
|---|---|---|
| AC1 `#1886.33628f8b` | `proxied-hub.test.ts` | fails on the merge base at its first `expect`: the review counted ("same-family review") and the claim was PASS |
| AC2 `#1886.209d6f6c` | `own-route-hub.test.ts`; the first test of `model-suites.test.ts` | pass on the merge base; fail at their `expect`s on the twin `own-route-unknown` (every route read as proxied) |
| AC3 `#1886.ece183af` | the second test of `model-suites.test.ts` | passes on the merge base; fails at its status `expect` on the twin `plant-ignored` (the plant guard dropped) |

- On the merge base: `BASE-RUNS.txt`, 1 failed and 3 passed. Each twin was laid on a copy of the base, where its tests
  failed at their assertions.
- On the work at `3330b8358` (#3111 merged with main `4c81c192f`): one run, `Tests 4 passed (4)`. The first draft
  passes there too, 2 of 2.
  - An earlier run in the same worktree failed AC2's byte-for-byte check. The two extra files were a gitignored vitest
    cache under `tests/acceptance/87/models/node_modules/.vite/`, left by an earlier `vitest --root
    tests/acceptance/87/models` run in that worktree on 2026-11-24.
  - The redraft's own child run doesn't create that cache, and a fresh checkout has none. The cache was removed and
    the folder rerun.

## Deviations from a fully blind redraft

1. **The twins' `find` lines were redrafted with #3111's `packages/checks-review/src/models.ts` in view.** That is
   one file of the work, and nothing else from it.
   - Why: both twins first replaced the base's `const proxied = …` line, and #3111 changes that line
     (`change.route[k]` to `change.route?.[k]`). So neither twin applied to the change: the lanes read it as stale
     (`STALE_FIX` in `scripts/proof-runs.mjs`: "write the twin's lines.json again against the file as the change
     holds it").
   - What it changed: only the two `find` strings and the matching `?.` in each `wrong` line. The wrong programs are
     the same: every route read as proxied, and the plant guard dropped.
   - What it didn't change: the tests, helpers, README and the base runs were drafted from the base, blind, before
     the job saw that file.
2. **The redraft brief stated the proof lanes' house rules.** It said a test for new behavior fails on the merge base
   at an `expect`, not by throwing, and that a test for behavior that must not change is proven through a planted
   wrong program in `twins.json`. Those rules come from the design ("Proven on the base") and
   `scripts/proof-runs.mjs`. They are also exactly where the first draft fell short, so the brief wasn't blind to the
   dispute's substance. It quoted no failing output, though, and didn't name the first draft.

## Your call, once

- **Swap in the redraft** (recommended): it runs in the first draft's place. `scripts/lanes-lists.mjs` maps
  `tests/acceptance/1886/route.test.ts` to `tests/acceptance/1886/redraft/` and moves the first draft to `byHand`
  (commits `5f17dc6e4`, `786f6d7e4`); those two commits' signed approval tags are owed with this ruling.
- **A third draft**: name the reading to change, and a blind job writes the criteria's tests again on that ruling.

Neither draft was edited after it was written.
