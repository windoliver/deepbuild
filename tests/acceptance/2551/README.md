# #2551 acceptance tests: the design's adapter rules and `adapter.facts@1`'s `x-rules` agree, and suite 313's fakes pass

Written blind, before any fix, from issue #2551's body and its two criteria, `AGENTS.md`, `docs/technical-design.md`
(How we know version 0 works: Conformance tests, Criteria to tests both ways, Wrong programs, The edit guard,
Dogfooding) and base `98347e837` files used as surfaces: `packages/contracts/schemas/adapter.facts@1.json`,
`tests/acceptance/313/fakes.test.ts`, `tests/acceptance/313/helpers.ts` (`RULE_PHRASES`), `tests/acceptance/313/tsconfig.json`,
`tests/acceptance/313-redraft-2551/REDRAFT.md` and `tsconfig.json`, `scripts/known-failures.json`,
`scripts/known-failures-check.mjs`, `vitest.config.ts` and `tests/vitest-setup.ts`. No implementation, diff, branch or
pull request for #2551 was read, nor `packages/conformance/src` or `packages/contracts/src`.

The owner's decision (2026-11-22, given to this job in its instructions, not in the issue): the design names every
rule `x-rules` holds. These tests don't depend on that choice; they hold the criteria whichever side changes.

## What the base shows

The issue's text is stale against this base. The design's sentence now names **12** rules (the ten plus the two #1296
added), and `x-rules` holds **13**: a later rule, `reads-count-as-read` ("A tool the hub serves that changes nothing,
such as deep_query, maps to read…"), is in the schema and not in the design. `scripts/known-failures.json` already
retires 313's AC12 ten-rules test (a `skips` entry, "retired by #2551 … 313-redraft-2551/fakes.test.ts is AC12's
test"), and that redraft, written for twelve, now fails too: `expected 13 to be 12`.

## Tests

| Test | Criterion | Holds | Base |
|---|---|---|---|
| `rules.test.ts` › `#2551.89179774 every rule in adapter.facts@1's x-rules is named in the design's numbered adapter rules, and every rule the design names is in x-rules` | 1 | Each `x-rules` entry's text contains one of the design's phrases, and each phrase is in some entry | FAIL: `x-rules the design's list does not name: expected [ Array(1) ] to deeply equal []` (`reads-count-as-read`) |
| `rules.test.ts` › `#2551.89179774 the design's numbered adapter rules and adapter.facts@1's x-rules hold the same rules in the same order: rule i of x-rules is the design's rule i` | 1 | Same count, and entry i's text contains the design's phrase i | FAIL: `x-rules holds as many rules as the design names (…): expected 13 to be 12` |
| `fakes-313.test.ts` › `#2551.7d1ea751 tests/acceptance/313/fakes.test.ts passes on main: every test vitest runs in it passes, and one known-failures.json retires is replaced by a named suite whose every test passes` | 2 | Runs the file through the repo's vitest, reads each result row; see below | FAIL: the retired AC12 test's replacement, `313-redraft-2551/fakes.test.ts`, fails 7 tests, its main one `expected 13 to be 12` |

### How criterion 1 is read

The design's list is the phrases after "The adapter rules are one numbered list in `adapter.facts@1`:" in the
Conformance tests item, split on commas and the final "and" (as the base writes it), or, if the colon ends its line,
the numbered Markdown lines that follow. A design phrase matches an `x-rules` entry when the entry's `rule` text,
lower case with backticks dropped, contains the phrase so normalised: the same test 313's AC12 uses. "Same rules in
the same order" is then: as many entries as phrases, and entry i matches phrase i. The set test adds the names of what
is missing on either side.

### How criterion 2 is read

Read literally ("every test in the file passes"), criterion 2 can never pass under the owner's decision: 313's AC12
test compares `x-rules` with `RULE_PHRASES`, ten frozen phrases, and an acceptance test is never edited. The issue's
own "make it twelve" option says so: AC12 is redrafted by the blind job, not edited. The repo's approved way to
replace a frozen test is a retirement in `scripts/known-failures.json` `skips` (guarded by the edit guard and the
owner's signature), naming the replacement suite. So the test holds "passes" as:

- every row vitest reports for `tests/acceptance/313/fakes.test.ts` is `passed`;
- a `failed` row passes only if a `skips` entry with exactly its ID (`<file> › <describe> › <it>`) has a reason
  starting "retired by", and every test of each suite file that reason names (`313-redraft-2551/fakes.test.ts`, read
  under `tests/acceptance/`, or a path from the root) passes, read the same way, following further retirements;
- a skipped, todo or unreported row, a retirement naming no suite or a missing one, or a run that reports no tests,
  fails. Nothing unrun passes.

The test fails on the base for the issue's reason: the retired test's replacement holds the design's list (12) against
`x-rules` (13). It passes once the design and `x-rules` agree and AC12's test, through its retirement chain, holds the
agreed list. If a reader rejects this reading and takes the criterion literally, it cannot pass without the "keep ten"
choice the owner did not take; that should go to the owner, not be bent here.

### Load

At load 60–75 the nested run once also failed 313's `AC14 for any set of codes a fake could name … (1,000 cases)` on
vitest's default 5 s (`Test timed out in 5000ms`, BASE-FAILURE.txt), while the two suites ran side by side. Run alone
moments later the file had only the AC12 failure (21 of 22 passed). That timeout is main's, not #2551's; the test does
not set it apart, since a failing test there is a failure of the criterion. Rerun the file alone before reading it as
a regression.

## Wrong programs

Both criteria describe a fix, so the merge base is the wrong program, and every tagged test fails on it at an
`expect` in its body (no `toThrow`-style assertion).

## Run

```sh
npx vitest run tests/acceptance/2551/
npx tsc --noEmit -p tests/acceptance/2551/tsconfig.json
```

The criterion-2 test runs vitest on other suites itself and has a 600 s limit. BASE-FAILURE.txt holds the base run.
