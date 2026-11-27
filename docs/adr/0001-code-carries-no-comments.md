# 0001: Code carries no comments

Status: accepted (#3454). One question is open, under Open below.

## The rule

Hand-written code says what it does through its names, and a decision about it is recorded here, in `docs/adr/`, where it is reviewed. A comment is neither: nothing checks it against the code beside it, and nobody reviews a decision kept in one.

The lint lane holds the rule with a ratchet, `scripts/comment-ratchet.mjs`. `scripts/comment-ceilings.json` lists each hand-written `.ts`, `.mts`, `.cts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.rs` and `.wgsl` file that still holds comments, with its count of comment lines. A line counts when any part of a comment is on it.

- A count may drop, and its ceiling drops with it in the same change: `node scripts/comment-ratchet.mjs --write` lowers the ceilings and drops the entry of a file with none left.
- A count never rises above its ceiling, and a ceiling never rises above the merge base's with `origin/main`, by hand or by `--write`. Until the merge base holds a ceilings file, as on the change that lands the ratchet, there is nothing to compare with and `--write` writes the counts as they are.
- A file the merge base doesn't list starts at zero, so new code is written without comments.

Comments are found by token: the TypeScript parser for scripts, `scripts/rust-source.mjs` for Rust, and WGSL's two comment forms. A `//` or `/*` inside a string, a regular expression or a template is none.

## What is not counted

- A marker another lint reads, with its reason, in a file that lint reads: `// deadline:` in a test file, `// cache:` with a bound (`entries` or `bytes`) in a crate's Rust, `// copy-exception:`, `// size-literal-exception:` and `// blocking call:` in the Rust of `crates/deep-app/src`, and `// color-literal-exception:` there and in the panel scripts of `crates/deep-app/panels`. The marker without a reason counts, and so does the marker anywhere else. Each is read in the form its lint reads: the two literal exceptions only where they end a line of code. The ratchet doesn't ask whether the lint finds something beside the marker; that stays the lint's.
- A license notice: a comment that holds `Copyright` and its holder or year, `Licensed under the`, or `SPDX-License-Identifier:` (AGENTS.md: ported code keeps its notice in the receiving file).
- With either, the comment-only lines next to it.

Out of scope: generated files (a `@generated`, "auto-generated" or "do not edit" marker in their first five lines), `vendor/`, a file under a `twins/` folder in `tests/acceptance/`, which copies our own code at a base, and a suite's file the merge base holds, which no change may edit (#3455). A new suite's own file is judged in the change that adds it, from zero like any new file, and never gets a ceiling, so a drafted suite holds no comments.

## Where a comment's content goes

A pass over a folder reads each comment against the code it sits on:

| The comment | What happens |
|---|---|
| repeats what the code beside it says | deleted |
| is stale | deleted |
| explains why the code does less than an open criterion asks | deleted; the criterion's issue holds the gap |
| records a decision the design or the package's README card already states | deleted |
| records a decision written nowhere else | moved to a page here, then deleted |
| says only what a name means: a unit, a default, an invariant | stays for now, and is counted |

`scripts/comment-only.mjs <path>` says whether the files changed under a path hold the code their merge base does, comments and white space aside, so a pass can show it removed nothing else. The steps of a pass are the skill `.claude/skills/comment-pass/SKILL.md`.

## Pages

One page per module topic. Each decision names the file and the symbol it governs, so a reader of the code finds it by searching `docs/adr/` for the symbol, and a change to the symbol changes the page in the same pull request.

- [0002](0002-gate-git-store-and-snapshots.md): the gate's git, its object store and a claim's snapshot
- [0003](0003-gate-checkouts-and-base-runs.md): the gate's temporary checkouts and base runs
- [0004](0004-gate-lanes-holds-and-slots.md): the gate's lanes, holds and slots
- [0005](0005-gate-floor-verdict-and-measures.md): the gate's floor, a claim's verdict record, price and size
- [0006](0006-web-export-set-ceilings.md): the web-export task's set ceilings
- [0007](0007-kept-pack-checks.md): a pack check's result kept in the store, what a taken row gives a core, and its counts

## Open

- **A comment that says only what a name means (#3456).** Whether it stays, moves into the name or a type, or moves to a page is not decided. Until it is, such a comment stays where it is and is counted, so its file keeps a ceiling above zero.
