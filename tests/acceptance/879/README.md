# Acceptance tests for #879: package cards in the lint lane

These tests were drafted blind from issue #879 (its text as of October 31), `AGENTS.md`, `docs/technical-design.md` and the base commit `69013e61`, which has no implementation. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with:

```
node --test 'tests/acceptance/879/*.test.mjs'
```

The suite takes under a minute; most of it is one `node scripts/repo-rules.mjs` run over this checkout, which calls `cargo metadata` on every crate. On the base all 14 tests fail, each for the expected reason, as `BASE-FAILURE.txt` shows (local paths redacted). The scratch repositories with a planted crate need `cargo` on PATH, since the deps rule (#246) reads each `Cargo.toml` through `cargo metadata`; the lane test also needs `rustfmt` for the lane's `cargo fmt --check`.

## Surfaces

The tests reach the code only through what the issue and its dependency #246 name:

- `node scripts/repo-rules.mjs`, the lint lane's rules, run as a process. Each run happens in a scratch git repository under the system temporary folder, built with #246's `repo` helper (`tests/acceptance/246/helpers.mjs`): a copy of this checkout's `scripts/repo-rules.mjs`, a root `package.json` with no dependencies and a `scripts/repo-rules.json` that lists nothing, so only the card check can fail. Planted packages and crates are committed. Two tests run the script, or read files, read-only in this checkout.
- `scripts/lanes.mjs`'s exported `checks` and `runLanes`, for the lint lane's summary line.

Planted folders: `packages/tally` and `packages/count` (a `package.json` without dependencies and `src/index.ts`), `crates/tally-core` (a `Cargo.toml` without dependencies and `src/lib.rs`), and `packages/notes` (only `src/index.ts`). Nothing is written into this checkout, and nothing is committed here.

## Readings where the issue leaves a choice

1. **The four headings** are the issue's own words as level-2 Markdown headings: `## What it is for`, `## Where new code goes`, `## What it may import`, `## Deviations`. The planted cards use exactly these. The tests never plant another spelling, so a check may match them exactly or case-insensitively, at level 2 or deeper, with or without trailing words; the checkout test (AC1) accepts any heading level from 2 to 6, any case, and trailing text. A card that drops a heading says the heading's words in a plain paragraph instead (`Deviations: covered in the other sections.`), so only a real heading satisfies the check.
2. **A deviation** is a list item (`- `) under `## Deviations` whose first backticked span is a path relative to the package or crate folder, followed by the reason: ``- `src/legacy-order.ts`: keeps the old export order for callers pinned to it.`` A deviations heading with no list item, here the single line `None.`, is a card with no deviations and passes. Backticked text in other sections (`` `node:` `` under the import heading) is not a deviation and must not fail the card.
3. **The check's name** is `cards`: its lines read `PASS cards: …` or `FAIL cards: …`, with the `  Fix:` line #246's rules print. The tests pin only that prefix.
4. **"Fails, naming …"** means: the run exits 1, no `PASS cards:` line prints, and some `FAIL cards:` line holds the named thing. A package is named by its folder path (`packages/tally`), matched as itself and not as the prefix of a longer name, so `packages/tally/README.md` names it and `packages/tally-two` doesn't. A missing heading is named by its words, matched case-insensitively. "The deviation's line" is its 1-based line number in the card, written after `:` or `#`, or as `line N` or `LN` (as in `packages/tally/README.md:18: …`). The exact wording isn't pinned. The tests don't check whether other headings are also mentioned, or whether the missing file is named.
5. **"Each folder under `packages/` and `crates/`"** is each folder directly under either root that holds a file git lists (tracked, or new and not ignored), whether or not it has a `package.json` or `Cargo.toml`: `packages/notes`, with only `src/index.ts`, needs a card too. A folder holding only ignored files (a leftover `node_modules/`) isn't required by these tests either way.
6. **"Passes"** in a scratch repository means exit 0, a `PASS cards:` line, and no `FAIL`, `INVALID` or `BLOCKED` line from any check. Each passing scratch repository holds at least one carded package and one carded crate, so a check that reports an empty tree as `INVALID` still passes them.
7. **"The lint lane passes on the repo" (AC1).** On the base, `node scripts/repo-rules.mjs` already fails this checkout with five lines that aren't about cards: three `home path` findings in other issues' `BASE-FAILURE` files, and two unlisted dependencies (`@deepbuild/evidence` in `packages/extension-host`, `sha2` in `crates/deep-app`). They belong to other issues, so the test allows exactly those five lines, verbatim, and no other failing line. It requires a `PASS cards:` line, no failing `cards` line, exit 0 once no failing line remains, and `git status --porcelain` unchanged by the run. The clippy and later lint commands are not run here (see Not covered).
8. **The lint lane in AC2.** The lane test runs `checks`' lint lane through `runLanes`, in a scratch repository with a fixture root crate (#246's `CRATE`) so `cargo fmt --check` passes. It runs the lane's commands up to and including `scripts/repo-rules.mjs` and leaves out the ones after it: a lane's summary comes from its first failing command, so later commands can't change it, and clippy's build in a fresh scratch folder can wait minutes on a shared machine. The summary must read `FAIL lint: cards: …` naming `packages/tally`. The test also requires that the lint lane still runs `scripts/repo-rules.mjs`.
9. **"Which imports a package declares stays the dependency rule's, never the card's"** is read as: the card check never compares the import section with a manifest. A package that declares a listed dependency its card doesn't mention, beside a card that mentions one its package doesn't declare, passes both `deps` and `cards`.
10. **AC3's twin** is a second scratch repository identical to the first except that `src/legacy-order.ts` exists (committed). The planted card puts the missing file's deviation on line 18, three lines below `## Deviations` and below a first deviation naming a file that exists, so a check that reports the heading's line, or fails every deviation, fails the test. The crate repeats it with `src/legacy_order.rs`.

## Criteria and tests

| Acceptance criterion | Tests (file: name) |
|---|---|
| AC1: every package and crate has a card with the four headings | checkout: *AC1: every folder under packages/ and crates/ has a README.md card with the four headings* |
| AC1: the lint lane passes on the repo | checkout: *AC1: the lint rules pass the card check on this checkout, add no failure the base lacks, and leave git status unchanged* |
| AC2: a planted package without a card fails the lint lane, naming it | cards: *AC2: a planted package without a card fails the lint rules, naming it, and its carded neighbours are not named*; *AC2: a planted crate without a card fails the lint rules, naming it*; *AC2: a folder under packages/ with no package.json still needs a card*; lane: *AC2: a planted package without a card makes the lint lane FAIL, its summary naming the card check and the package* |
| AC2: a card without its deviations heading fails, naming the heading; an exists-only lane passes it and fails this test | cards: *AC2: a card without its deviations heading fails, naming the heading, and the same card with it passes (an exists-only check cannot do both)*; *AC2: a crate's card without its deviations heading fails, naming the crate and the heading* |
| Scope: a card missing any one of the four headings fails | cards: *scope: a card without "## What it is for" / "## Where new code goes" / "## What it may import" fails, naming the package and the heading* (3 tests) |
| AC3: a deviation naming the missing `src/legacy-order.ts` fails, naming the package and the line; the same deviation naming an existing file passes | cards: *AC3: a deviation naming src/legacy-order.ts, which the package doesn't have, fails naming the package and the deviation's line; once the file exists it passes*; *AC3: a crate's deviation naming a file the crate doesn't have fails naming the crate and the line; once the file exists it passes* |
| Scope: which imports a package declares stays the dependency rule's, never the card's | cards: *scope: a card's import section is never checked against what the package declares; the deps rule alone reads that* |

Each test fails on a wrong program as its criterion names. Beyond the base, this was checked in a scratch copy against a sketch card check (all 12 scratch tests pass) and three wrong ones: an exists-only check (the AC2 twin, the heading tests and AC3 fail), a check that finds heading words anywhere in the text (the 5 heading tests fail), and one that reports the deviations heading's line (both AC3 tests fail).

## Not covered here

- The full lint lane on this checkout (`cargo clippy --workspace` and the lint commands after `scripts/repo-rules.mjs`). AC1 is proven through the rules the issue adds to; the rest of the lane is other issues' and runs in preflight.
- The Proof's pasted lint-lane output on the repo and on each planted package. The issue asks for that as evidence in the PR, not as a test.
- That a deviation gives a reason, or that a card's prose is accurate. The issue lints only the card, its headings and its deviations' files.
- Generating cards, or any doc built from them: out of the issue's scope.
