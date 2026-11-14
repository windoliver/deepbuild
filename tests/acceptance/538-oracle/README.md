# Acceptance tests for #538, Oracle lane: the upstream plural-rules file's English and French samples, run on our copy

Written first, blind, from four sources:

- issue #538;
- its Oracle page, `doneright/oracles/issues/538.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the one upstream file that page pins, read from the vendor copy on that branch;
- the #538 suite's surface (`tests/acceptance/538/README.md`, written by the same job) and the base commit `53c0e72a3`.

The job never saw an implementation of #538; none existed, and no other worktree, branch or pull request was read.
#136's rule applies: a linked test counts only when run against our output, so the case here builds our document and
asserts on what `deep-show`'s `eval` draws. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

The page links an upstream source to criterion 2 of 9. The other eight have none (the page's "No upstream test" table)
and stay with `tests/acceptance/538/`.

## Sources

| Criterion | Upstream, pinned | File | Use | Here |
|---|---|---|---|---|
| 2 `#538.04486d9f` | the upstream plural-rules file (CLDR's), commit `11299982335beb974c1c63c45265184e759c0f41` | `common/supplemental/plurals.xml`, lines 30 to 33 (the rules whose `locales` hold `en`) and 118 to 122 (`fr`), SHA-256 `d701d8b461afd2ba5eb21f9c1d645c8a661de225596afcf0f492ee36c69d727d` | data, run on our code (the page's use) | `plural-samples.test.ts` (1 test) |

**The samples, re-expressed.** No upstream code is copied or run, and nothing of the file is copied into this folder: the
test writes out the integer samples itself and checks them against the pinned file, read in place. Each rule's
`@integer` list, its ranges (`2~16`) written out, its "…" and its compact forms (`1c6`, `2c3`) left out:

- en: one 1; other 0, 2 to 16, 100, 1000, 10000, 100000, 1000000;
- fr: one 0 and 1; many 1000000; other 2 to 17, 100, 1000, 10000, 100000.

The `@decimal` samples are left out: a count here is a logic program's i32, which shows no fraction digits. The file
carries its own notice and license line and stays where it is.

## Where the lane reads the file, and how a fresh checkout gets it

The lane reads `<oracles>/vendor/cldr-1129998233/common/supplemental/plurals.xml`, where `<oracles>` is the folder
`doneright/oracles/` of branch `doneright` of DeepBuildAI/deepbuild: `$DEEP_ORACLES` when set, else
`../deep-oracles/doneright/oracles` beside this checkout (as #1965's lane reads its files). A fresh checkout gets it with:

```sh
git fetch origin doneright && git worktree add ../deep-oracles origin/doneright   # or: DEEP_ORACLES=/path/to/doneright/oracles
```

If the file is missing the test fails with a line starting `BLOCKED:` and that one unblock line; a file whose SHA-256
isn't the pin fails. It never passes and is never skipped, and the lane makes no network call.

## Run

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
DEEP_ORACLES=<path> PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  npx vitest run tests/acceptance/538-oracle/plural-samples.test.ts --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/538-oracle
```

`helpers.ts` re-exports the #538 suite's helpers (`../538/helpers.ts`), its program writer and its caption fixtures, so
both lanes build and ask the same binary the same way: `cargo build --locked --bin deep-show` once, and #544's
assembler. **`scripts/lanes.mjs` needs `'tests/acceptance/538-oracle/'` in its `alone` list**; the #538 README gives the
line, and the implementer makes that edit.

## The surface under test

The #538 suite's (its README: The surface under test), with nothing added: `deep_show` of a copy document, and `eval` at
a step with the view's locale, its snapshot's pixel hash against the caption with a string written out.

## Criterion to test

| ID | Test | Upstream | Ours |
|---|---|---|---|
| `#538.04486d9f` | `plural-samples.test.ts` | each sample integer falls in the category its rule lists it under | below |

What ours does:

- The table `cat`'s key 1 is a plural entry whose every form shows its own category's name: en `{one: "one", other:
  "other"}`, fr `{one: "one", many: "many", other: "other"}`. The caption `{copy: "cat[rules.item]", args: [{path:
  "rules.count", widest: "9999999"}]}` reads it, as criterion 2's does.
- A logic program (`../538/programs.ts` `countsProgram`) writes rules.item 1 and, at step k, the k-th of the 23 sample
  counts in ascending order (0, 1, 2 to 17, 100, 1000, 10000, 100000, 1000000).
- At each step `eval` draws the caption in en and in fr; each frame must hash as the caption reading the category's name
  that upstream gives that count in that locale: 46 frames.

## The judge, and the sets it must fail

The test first runs its judge on categories the model itself gives, so a judge that passes everything can't pass the
file:

- upstream's own categories pass;
- English's rule applied to French (fr 0 → other) fails, naming fr and 0;
- French with no `many` (fr 1000000 → other) fails;
- English's one covering 0 fails.

Then the pinned file is read and its en and fr samples must be the re-expressed ones. Then our code runs. The #538
suite's planted `plural_en_rule_for_fr` is run there (criterion 2's second test), not here.

## Readings where the port leaves a choice

- **A category's string** is the category's own name, with no placeholder, so a frame tells the category alone and no
  number's formatting enters; criterion 2's own test reads the placeholders.
- **"Run on our code"**: the copy document through `deep-show`, the frame `eval` draws.

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs`. Nothing else.
