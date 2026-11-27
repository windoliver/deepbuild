# Acceptance tests for #3417: a row named pack in One word per idea, the section's ceiling, and the links into it

Written first, blind, from issue #3417 (its report, Scope, three acceptance criteria and Proof), the design sections
it names and base commit `c0a16dda6`, by a job that never saw an implementation. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Node's test runner
and built-ins only.

| AC | ID | Tests |
|---|---|---|
| AC1 | `#3417.bdaf7f22` | `ac1-pack-row.test.mjs` (four: the real list's one row named pack; a planted list with none; one with two; the check that fails them passes on the real list) |
| AC2 | `#3417.fad053d0` | `ac2-ceilings.test.mjs` (three: the doc ceilings check passes; no ceiling above the merge base's; a planted row past the ceiling) |
| AC3 | `#3417.33df4e7a` | `ac3-links.test.mjs` (one: the design links lane passes with the open issues read) |

IDs are the first 8 hex of the SHA-256 of each criterion's text after `- [ ] `, trimmed, whitespace collapsed (as
`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with its ID and its AC number.

Run, from the repo's root, under Node 24, with network and gh signed in (for AC3):

```
node --test --test-concurrency=1 'tests/acceptance/3417/*.test.mjs'
```

AC1 runs the lint lane's node commands three times at once (a control and two plants, four commands at a time each);
AC2 and AC3 run one command each. The checkout is never written; every copy is a temp folder removed after its test.

## What was read

`AGENTS.md`; the issue; `docs/technical-design.md` (The contract, States people see, Dogfooding);
`docs/canvas-primitives.md` (One word per idea); `scripts/lanes.mjs` (the `lint` and `design links and names`
entries of `checks`); `scripts/doc-ceilings.mjs` and `scripts/doc-ceilings.json`; `scripts/design-links.mjs` and
`scripts/open-issues.mjs`; `scripts/doc-links.mjs` (headings and their byte offsets); `scripts/proof-change.mjs`
(`criterionId`); and suite `tests/acceptance/3412/` for the house shape.

## The surfaces (my choice where the issue leaves it open)

- **The section.** From the line `## One word per idea` to the next heading of level 1 or 2, so a table split under
  `###` subheadings (Scope allows it) is still the section. Its rows are table lines under a header row that has
  `Means`, `Never call it` and `Why` columns; a row is named pack when its first cell, with backticks, `*` and `_`
  dropped, is `pack` (any case). `pack kind` and `pack program` are other rows.
- **The real row.** Exactly one row named pack; its Means and Why are not empty, and its Never call it is not empty and
  not `none` (the criterion asks for the words never to use for it). Which words is the docs change's to settle.
- **The lint lane.** The `lint` entry of the copy's own `scripts/lanes.mjs`, read at run time, so no check's script name
  is assumed. Only its node commands run (each one, whatever the others did, each stopped after 900 s); its cargo
  commands (fmt, clippy) are left out: they can't read Markdown and take many minutes.
- **A scratch copy.** As #3412's: the working tree (tracked files and untracked ones git doesn't ignore) in a temp
  folder, `git init`, the checkout's origin URL, everything committed as the base and `origin/main` pointed at it.
  Git runs with no `GIT_*` variable, global or system config; for the lint lane HOME, TMPDIR and the XDG folders are
  the sandbox's and GitHub tokens are dropped.
- **AC1's plants.** Made before the copy's base commit. No row: every row named pack removed. Two rows: the real row
  copied below itself, or, with none, two fixture rows named pack after the last row of the section's first table.
  Each plant then sets `scripts/doc-ceilings.json` for each heading whose size it changed as the check asks (the new
  size when over 16,384 bytes, no entry when not), so the doc ceilings check has nothing to say about the plant itself.
- **"Naming the list".** A line naming `One word per idea` or `one-word-per-idea`, printed by a lint command that exits
  non-zero, and not printed (digits aside) by the same command in a control run of the unplanted copy, so a failure
  the copy has anyway can't count. The check that fails the plants must exit 0 in the control.
- **The doc ceilings check.** The lint lane's command that runs `scripts/doc-ceilings.mjs`. On the real tree it runs in
  the checkout itself (it only reads), so its merge base is the real one; it must exit 0 with a `PASS doc-ceilings`
  line. Separately, every ceiling in `scripts/doc-ceilings.json` is at most the merge base's
  (`git merge-base HEAD origin/main`); a key the base lacks counts as the 16,384-byte limit.
- **The planted row past the ceiling.** One fixture row, `zorvanthic ledger`, after the last row under the heading that
  holds the pack row (or the section's own heading when there is none), padded so that heading's own text is exactly
  1,234 bytes over its ceiling (or over the limit, with no ceiling), committed on top of the copy's base. A line must
  name the heading (its anchor or its text) and the bytes over: `1234` or `1,234`, or both the new size and the ceiling.
- **The design links lane.** The `design links and names` entry's node commands in a copy, with the user's own HOME so
  gh is signed in, and `DEEP_OPEN_ISSUES` a file of the sandbox, so the issues are fetched afresh. If the open issues
  were not read (an `INCONCLUSIVE` line, or the lane's own "not read" words) the test is skipped, never passed; else
  every command must exit 0 and no line may name `one-word-per-idea`.

## At the base

`BASE-FAILURE.txt` has the run. The real list has no row named pack, and no lint command fails either plant naming the
list, so AC1's four tests fail. AC2's three pass at the base: the section sits at its ceiling of 40,707 and the doc
ceilings check already names the heading with its size and ceiling; they guard that the change keeps it so. AC3 fails
at the base, but not over One word per idea: four open issues (#3496 to #3499) link a heading
`docs/technical-design.md` doesn't have, and no line names `#one-word-per-idea`. The criterion asks for the lane to
pass, so the test stays red until those links land.
