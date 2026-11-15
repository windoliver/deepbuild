# #313 AC12 blind redraft, after #2551: `adapter.facts@1` lists the design's twelve adapter rules

#313's twelfth criterion puts the adapter rules in one numbered list in `adapter.facts@1`, and
`tests/acceptance/313/fakes.test.ts` holds that list to the ten phrases the design named then (`helpers.ts`,
`RULE_PHRASES`). #1296 later added two rules to the schema's `x-rules` without a change to the design's list, so the
frozen test fails, 12 against 10 (#2551). The design is amended at the base. Its sentence, in How we know version 0
works, Conformance tests, now reads: "The adapter rules are one numbered list in `adapter.facts@1`: who is calling,
order by `seq` with ties by ID, a clock stepped back, a late event in a stopped turn, unknown rather than finished,
threads across rotated IDs, one owner per session, allow only from `decision`, a stop that can't be parsed read as
unknown, delivery confirmed from the transcript, a block the model needs goes out only on an output the facts mark as
reaching the model, and a block the model needs never goes out as stderr on exit 0." The redraft keeps the test's
scenario, assertions and messages and holds the list to those twelve phrases, in that order.

Written from issue #2551 (open; read live with `gh issue view 2551`, `updatedAt` 2026-11-15T01:34:07Z: its text, the
two choices under Decision for the owner, its two criteria and Proof; no comments), issue #313 (closed; read live,
`updatedAt` 2026-10-21T08:23:29Z; only its twelfth criterion was read, found by a search for "adapter rules"), the
design (`docs/technical-design.md`, How we know version 0 works: the Conformance tests bullet, Wrong programs,
Dogfooding, and the summary lines Tests written first and Wrong programs), `AGENTS.md`, the frozen
`tests/acceptance/313/` (README.md, tsconfig.json, `helpers.ts` lines 1-27, 118-141 and 170-193, `fakes.test.ts` lines
1-36 and 105-160; its other files were not read), `tests/acceptance/139-redraft-1802/` for form (REDRAFT.md lines
1-80, tsconfig.json, the head of BASE-FAILURE.txt, `preview.test.ts` lines 1-60 and its titles), and base `c12a5f748`:
`packages/contracts/schemas/adapter.facts@1.json`, of which only `x-rules` was printed (the twelve ids and texts). I
never read an implementation change for #2551, any diff, branch, pull request or other worktree.

Three things to know about those inputs:

- **The owner's choice is not in the issue.** #2551 lists two choices and records neither. That the owner chose twelve
  (2026-11-14) came to this job in its instructions, and the base commit's design text agrees with it. The redraft
  follows the design.
- **#313's criterion still names ten.** Its text lists the ten phrases in parentheses and was not amended (the issue
  is closed). The redraft takes the list from the design's sentence, the later source, as the frozen suite's README
  says its own list is "the design's phrases".
- **Slips in the reading list.** None beyond it. Two reads were wider than they needed to be, both inside the list:
  the search of the design printed two neighbouring bullets in full (Criteria to tests both ways, The edit guard), and
  nothing here comes from them. No package source under `packages/conformance` or `packages/contracts/src` was opened;
  the surface is driven only through 313's `rules()`.

## What #2551 changes

| Original (path › describe title › it title) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `tests/acceptance/313/fakes.test.ts` › AC12 the adapter rules are one numbered list in adapter.facts@1, each with one broken fake that fails the runner with that rule's message › AC12 adapter.facts@1 lists the ten rules in the design's order, each with an id | #313 AC12 | It expects `x-rules` to hold as many rules as `RULE_PHRASES`, ten, the design's list on October 20. The design's sentence now names twelve, and a schema that holds the design's list holds twelve: `expected 12 to be 10`. Nothing else in the test is wrong: the first ten rules contain the ten phrases in order, and every id is in form and distinct | `tests/acceptance/313-redraft-2551/fakes.test.ts` › AC12 the adapter rules are one numbered list in adapter.facts@1, each with one broken fake that fails the runner with that rule's message › AC12 adapter.facts@1 lists the twelve rules in the design's order, each with an id (redraft 2551) |

The test keeps the original's scenario: the list is read with 313's `rules()` (the published schema through
`getSchema('adapter.facts@1')['x-rules']`), and the four expectations are the original's word for word: the count
equals the phrase list's, rule i's text in lower case contains phrase i in lower case with its backticks dropped
(message `rule <i> is <phrase>`), each id matches `^[a-z][a-z0-9_-]*$`, and the ids are distinct. Two things differ:

- **The phrase list**, defined locally as `DESIGN_RULE_PHRASES`: 313's `RULE_PHRASES`, imported unchanged, then the
  design's two new phrases as the sentence has them, without its joining "and": `a block the model needs goes out only
  on an output the facts mark as reaching the model` and `a block the model needs never goes out as stderr on exit 0`.
- **The four expectations sit in one local function**, `expectDesignRules(list)`, so the wrong-program tests below
  can hand the same assertion a wrong list. On the published list it does what the original's body does.

The `describe` title is the original's word for word. The `it` title is the original's with "ten" made "twelve" and
"(redraft 2551)" at the end; it already starts with its criterion's label, AC12, as the frozen suite names it (the
suite predates `#<issue>.<h8>` tags, and this job did not compute one).

## Wrong programs it fails

AGENTS.md: a test "must fail on a wrong program as its criterion names". The base is the right program here (the
schema already holds twelve; BASE-FAILURE.txt), so the proof is seven planted twins, each a copy of the published list
with one fault, made in memory by `planted()` and fed to `expectDesignRules`. Each test is headed `(wrong program)`
and expects the assertion to throw what it should:

| Planted list | The assertion throws |
|---|---|
| The first ten rules only: the list #2551's other choice would have left, and the one the frozen test wants | `expected 10 to be 12` |
| Rule 3 removed | `expected 11 to be 12` |
| A thirteenth rule the design doesn't name, at the end and before rule 11 | `expected 13 to be 12` |
| Rules 11 and 12 swapped | `rule 11 is a block the model needs goes out only on an output the facts mark as reaching the model` |
| Rules 3 and 4 swapped | `rule 3 is a clock stepped back` |
| Rule 12 reworded to say the block may go out as stderr on exit 0 | `rule 12 is a block the model needs never goes out as stderr on exit 0` |
| Rule 12 given rule 11's id; rule 12 given the id `No Block On Stderr` | `expected 11 to be 12` (distinct ids); `to match` (the id's form) |

No repo file is edited by any of them.

## Kept as they are

The other three tests of the same `describe`, and every other test of `tests/acceptance/313/fakes.test.ts`. None is
copied here.

- AC12 each rule has exactly one broken fake, which fails the runner with its own message. It walks `rules()`, however
  many there are, and names no count or phrase. With twelve rules it asks for twelve fakes, which is what the design
  says ("Each rule has one broken fake").
- AC12 the five named fakes are among the rule fakes where the design places them. It finds four rules by a phrase
  (`ties by id`, `stopped turn`, `one owner`, `transcript`), and neither new rule's text holds any of the four.
- AC12 with the fake for a clock stepped back removed, the preflight's kit check fails, naming the rule. It finds one
  rule by `clock stepped back`, which neither new rule holds.

All three pass on the base (BASE-FAILURE.txt: 21 of the file's 22 tests pass, and the one that fails is the one
redrafted). The frozen suite's README still says "ten" in three places (the `x-rules` paragraph, The adapter rules'
home, and the AC12 row); it is frozen with the suite and this file is what corrects it.

## Run

```sh
npx vitest run tests/acceptance/313-redraft-2551/
npx tsc -p tests/acceptance/313-redraft-2551/tsconfig.json
```

8 tests in 1 file: 1 redrafted test and 7 wrong-program twins. On the base all 8 pass and the type-check is clean
(BASE-FAILURE.txt).
