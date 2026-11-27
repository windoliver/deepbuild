# Acceptance tests for #3414: the core, not the kernel, one list of what the core holds, and its text checks

Written first, blind, from issue #3414 (its report, Scope, five acceptance criteria and Proof), the design sections it
links and base commit `c13122f6a`, by a job that never saw an implementation. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Node's test runner
and built-ins only. The `.mjs` files hold no comments (docs/adr/0001-code-carries-no-comments.md); what they would say
is here.

| AC | ID | Tests |
|---|---|---|
| AC1 | `#3414.9c056d2c` | `ac1-kernel-prose.test.mjs` (four: a planted layer line in each of the three docs; a planted ninth of another kind; the docs as they are; the merge base with its count) |
| AC2 | `#3414.7a98bd4d` | `ac2-core-parts.test.mjs` (four: the scope section, Building blocks, the diagram, each edited alone; the three as they are) |
| AC3 | `#3414.36aa633e` | `ac3-guide.test.mjs` (one: `guide.mjs --check` and kernel only as the manifest's field) |
| AC4 | `#3414.242e5035` | `ac4-links.test.mjs` (one: headings renamed with old anchors kept, then the design links lane with the open issues read) |
| AC5 | `#3414.2b712213` | `ac5-call.test.mjs` (one: the person's recorded call, else INCONCLUSIVE) |

IDs are the first 8 hex of the SHA-256 of each criterion's text after `- [ ] `, trimmed, whitespace collapsed (as
`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with its ID and its AC number.

Run, from the repo's root, under Node 24:

```
node --test --test-concurrency=1 'tests/acceptance/3414/*.test.mjs'
```

AC4 needs the network and `gh` signed in; the rest run offline. AC1 and AC2 each run the lint lane's node commands in
full once (more where no command reads the plants, as on the base), and only the check's own commands after that.

## What was read

`AGENTS.md`; the issue; `docs/technical-design.md` (What version 0 builds, the diagram and components table,
Building blocks, The contract (kernel), Dogfooding); `docs/canvas-primitives.md` (What the kernel holds);
`docs/parallel-proof.md`; `docs/extension-guide.md` and `scripts/guide.mjs`; `GLOSSARY.md`; `scripts/lanes.mjs` (the
`lint` and `design links and names` entries); `scripts/glossary-lint.mjs`, `scripts/doc-links.mjs`,
`scripts/design-links.mjs`, `scripts/open-issues.mjs`; suite `tests/acceptance/3412/` for the house shape, and
`tests/acceptance/1352-redraft-3402/` and `tests/acceptance/1003/` for how a person's recorded call is read.

## The surfaces (my choice where the issue leaves it open)

- **A scratch copy.** As in `tests/acceptance/3412/`: the checkout's working tree (tracked files and untracked ones git
  doesn't ignore, never `.git`) in a temp folder, a fresh `git init`, the checkout's origin URL, everything committed as
  the base and `origin/main` pointed at it; a plant is one more commit. Git runs with no `GIT_*` variable, global or
  system config. For the lint lane, HOME, TMPDIR and the XDG folders are the sandbox's and GitHub tokens are dropped.
  The checkout is never written. AC3 and AC5 only read the checkout.
- **"The check" is found, not named.** The issue puts the kernel check in the lint lane's text check (#3412's) and the
  parts check in "a text check", without naming a script. So each file first runs every node command of the copy's own
  `lint` entry of `scripts/lanes.mjs` `checks`, read at run time, six at a time, each stopped after 300 s (its cargo
  commands, fmt and clippy, can't read Markdown and are left out). The check is then the command(s) that exit non-zero
  printing a line that names a plant. Later runs in that file run only those commands: the lint lane takes minutes per
  full run (55 minutes for #3412's base run), and a command that doesn't name the plant can't be the check the criterion
  speaks of. Where no command names the first plant (the base), AC2's next edits run the full lane again, so each edit
  is judged on its own.
- **Judging around unrelated failures.** Lint commands may fail in a copy (no `node_modules`, no built files) on the base
  and the change alike, so no test reads the lane's overall exit. A plant counts only through a failing line naming it:
  `<file>:<line>` for AC1's plants, and for AC2 the invented part `zorvanthic ledger`, which nothing else holds.

### AC1

- **The planted layer line** is the criterion's own sentence, `The kernel keeps the record.`, as a paragraph of its own
  after a one-line paragraph of each doc's prose (outside fenced code, below its first `##` heading). All three, and the
  ninth, go in one copy and one lane run; each must be named by a failing line holding `docs/<doc>.md:<line>`.
- **The planted ninth** is another kind of kernel, an operating system's, that no reason in the check can hold:
  `On Linux the kernel's out-of-memory killer picks the largest process to stop.`, in `docs/technical-design.md`.
  Which 8 places the check lists, and how, is the implementer's; the tests judge them only through what the check prints.
- **The docs as they are pass**: each command found to be the check exits 0 on an unchanged copy. And the three docs'
  prose still says kernel on at least 8 lines, not counting `<a id>` anchors, link targets, URLs and code spans, so the
  "8 listed places pass" is not passed by deleting them.
- **The merge base.** "On the merge base it fails, and that run is shown with its count": the copy gets the three docs
  as `c13122f6a` holds them (`git show` from the checkout; a checkout that can't read the commit makes the test fail
  with `BLOCKED`), and the check runs on them. It must fail, name each of six lines there that plainly call the core the
  kernel (found by their words: "Everything beyond the kernel and the trusted ring", "The kernel is only a contract",
  "The kernel owns only the contract group", "The only state the kernel keeps", "The kernel holds the document
  contract", and canvas-primitives' "The kernel holds only this contract"), and print its count: some failing line that
  names no `file:line` holds, as a whole number, the number of distinct doc lines its findings name, or the number of
  finding lines. The issue counts 17 such places in the design, but which lines are the layer's is the change's call, so
  only the six are pinned. The saved run of that test, after the change, is the shown run.

### AC2

- **The three places** in `docs/technical-design.md`: the scope section is the `## What version 0 builds` section's
  `- **The core**` line (else its first line naming the core and the record); Building blocks is the first prose line of
  `### Building blocks` naming the record; the diagram is the first line of a `mermaid` fence with a node label naming
  the record. Each, at the base and after the drafted list, names the record, so these find them on both.
- **Edited alone**: `, zorvanthic ledger` is added after the place's first `record`, in that place only. A failing line
  must name `zorvanthic` and a place: the edited line's `file:line`, or any of the three places' names (scope / What
  version 0 builds; Building blocks / blocks; diagram / mermaid / flowchart). Any place is accepted since a check with
  Building blocks as its one list may name the other two as the ones that differ.
- **As they are**: each place is found, and the check's commands exit 0.

### AC3

`node scripts/guide.mjs --check` exits 0 in the checkout, and every `kernel` in `docs/extension-guide.md` is the
manifest's field, written `` `kernel` `` (or `"kernel":` in a JSON example). Any other kernel fails, naming
`file:line`. One test, since the guide's check already passes on the base.

### AC4

One test, its assertions in this order: no heading in the three docs says kernel (the base's "The contract (kernel)"
and "What the kernel holds" call the core the kernel, which AC1's rule renames); every anchor holding `kernel` that the
merge base had (`prim-kernel`, `the-contract-kernel`, canvas-primitives' `kernel` and `what-the-kernel-holds`) is still
a heading slug or an `<a id>`; then the copy's `design links and names` lane, read from `scripts/lanes.mjs`, runs with
the real environment (for `gh`) and `DEEP_OPEN_ISSUES` in the sandbox. It must print no INCONCLUSIVE or
"not read" line, no failing link into a kernel anchor, exit 0, and its pass line must name more than 0 open issues.

Found on the base, unrelated to this issue: the lane fails on `c13122f6a` with 4 links from #3496–#3499 into
`docs/technical-design.md#what-a-person-reads-on-a-plain-surface`, a heading main doesn't have yet. Until that lands or
those links change, this test's last assertions can't pass whatever this change does; that would be `BLOCKED`.

### AC5

"Your call, recorded" is read as the house reads a taste call (`1352-redraft-3402`, `1003`): a record a person writes
after seeing what was shown, bound by SHA-256 to exactly what they saw. The record is `docs/evidence/3414/call.json`:

```json
{
  "criterion": "#3414.2b712213",
  "who": "<the person>",
  "when": "<ISO 8601>",
  "call": "right | wrong",
  "shown": { "docs/evidence/3414/<file>": "<sha256>", "...": "..." },
  "text": {
    "docs/technical-design.md": "<sha256>",
    "docs/canvas-primitives.md": "<sha256>",
    "docs/parallel-proof.md": "<sha256>",
    "docs/extension-guide.md": "<sha256>"
  }
}
```

`shown` is what the person saw (each changed line beside the line it replaced, and the list), kept in
`docs/evidence/3414/`; together those files must hold Building blocks' list line as the design has it now. `text` binds
the call to the four docs as they are, so any later edit voids it. No record, a field missing or a hash that differs is
`INCONCLUSIVE`; a call of `wrong` is `FAIL`; only `right` on exactly this text is `PASS`. The test fails unless PASS,
its message starting with the verdict, so it is never PASS without the call. Whether the shown diff is each changed
line against the right merge base is the person's to see; code can't judge whether a sentence says what it said.

## On the base

`BASE-FAILURE.txt` holds the run at `c13122f6a`, with Node's version, the load and the counts. Each test fails for the
expected reason: no lint command names a planted line or part; so no check is found for the real docs and the base run;
the guide says kernel twice in prose; the headings still say kernel; and no call is recorded.

Not run: the proof lanes (before lane, twins). No twins are given: every test fails on the merge base itself.
