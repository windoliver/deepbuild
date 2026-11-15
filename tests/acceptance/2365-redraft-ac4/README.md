# Acceptance test for #2365 AC4 (blind redraft)

Written by a fresh run of the blind acceptance job (design: Dogfooding), for criterion AC4 only. This job never saw an
implementation of #2365, an earlier test for it, a diff, the dispute or why the redraft was asked for. It read:

- issue #2365 (`ISSUE-2365.json`): its Scope, its criteria and its Proof
- `AGENTS.md` and `docs/technical-design.md` (Dogfooding; Evidence: retention keeps what a `transcript.archived` event
  links; the `archive` row of First-party extensions)
- the base commit `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`: `packages/archive`, the record's public entry
  (`transcript`, `resolve`, `read`, `raw`), the evidence store's (`connect`, `get`, `read`), and #20's acceptance
  helpers in `tests/acceptance/20/helpers.ts`, which this test imports and doesn't change

The implementing agent doesn't edit these files (AGENTS.md, Proof).

## The criterion

> A transcript whose first megabyte was rewritten after its last copy is copied again from its start, and the
> session's handles resolve through the new parts. A planted archive that appends the rewritten file's tail to the old
> parts fails, naming the first line that differs

Its ID, `#2365.<first 8 hex of the SHA-256 of the text above, trimmed, whitespace collapsed>`, is computed in
`helpers.ts` (`AC4`) and heads the `describe`.

## How to run

On macOS, with the repo's Node (24.22.0) and its `node_modules` installed (`npm ci` once, if missing). Nothing needs
building: the test reaches the archive, the record and the store through their `src` entries.

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2365-redraft-ac4
node node_modules/typescript/bin/tsc -p tests/acceptance/2365-redraft-ac4/tsconfig.json
```

Not run by this job (its instructions were to write, not run). There is no `BASE-FAILURE.txt`; see "At the base".

## The scenario

1. A Claude Code session's transcript, written where its facts say under a temp `HOME`: 480 lines, user and assistant
   turns alternating, each one message `m<n>` with 4,000 characters of generated words (about 2.2 MB). `pass()`.
2. An hour later its first megabyte is rewritten in place: every line from `m3` on that starts within the first MiB
   (1,048,576 bytes) gets its "final" text, of the same length; lines 1 and 2 and everything past the first megabyte
   keep their bytes. Then the session gains `m481`…`m500`. So the file is longer than its last copy, and its bytes past
   the old size are exactly the gained lines: an archive that only checks growth sees a clean tail.
3. An hour later, `pass()` again.

The fixture's shape is asserted before the second pass (`BLOCKED: …` messages): if it isn't as described, the test
proves nothing and fails as BLOCKED rather than passing.

## What passes

After the second pass (`copiedAgainFromStart` in `helpers.ts`):

- **The pass completes:** `pass()` doesn't reject.
- **Before the rewrite**, the record's reading of the session's archived transcript (`record.transcript(<letters>)`)
  is `m1`…`m480`, each the draft text the test wrote.
- **After it**, that reading is `m1`…`m500` in order: `m1`, `m2` and the lines past the first megabyte as drafted,
  `m3` through the last line starting in the first MiB with their final text, `m481`…`m500` final. Any other reading
  fails, its message naming the first line that differs as `line <n> (session:<id>#m<n>) differs`, with both texts.
- **Handles resolve through the new parts:** `record.resolve('session:<id>#m<n>')` gives the rewritten file's text for
  `m3` (rewritten), the last rewritten line, the first line past the rewrite, `m480` and `m500` (the last message).
- **Copied again from its start:** the evidence that the events the second pass appended link (any SHA-256 an event
  names in its `evidence` list or its data, in log order, that the store holds), taken in that order and each kept when
  it is the next piece, covers the rewritten file scrubbed (`scrubText`, which leaves this synthetic file unchanged)
  from its first byte to its last. Otherwise it fails naming the line the cover stops at.

## Readings

Where the issue leaves a choice, this job read:

- **The parts' representation is the implementer's** (Scope: "as a new version of `transcript.archived` or beside
  it"). The test doesn't read event kinds, versions or field names beyond "an event appended by the pass names the
  evidence by its SHA-256". One whole copy (as the base stores) and ordered parts both pass. A manifest or other
  evidence between the parts is passed over. A part reused by hash from an earlier pass passes when an event of this
  pass names it.
- **"Resolve through the new parts"** is the record's public reading of a session: `transcript(session)` and
  `resolve('session:<id>#<message>')` (design: Reading by reference). A message's handle is its `uuid`, `m<n>`, as in #20.
- **One line, one message.** Every fixture line is one message with text, so line *n* is the reading's *n*-th
  message, and "the first line that differs" is found by comparing the reading with the file message by message.
- **"First megabyte"** is the first 1,048,576 bytes; the rewritten lines are those that start in them.
- **Earlier copies** are not checked: how long they are kept is outside the task (Scope).

## The wrong program

| Twin | Where | What it does | How the test fails on it |
|---|---|---|---|
| `tailAppendArchive` | `wrong.ts` | Copies a new transcript whole. When it is longer than its last copy, it appends the scrubbed bytes past the old size to what it copied before, and links the result as one copy (`transcript.archived@2`, as the base links one) | The record reads the old `m3` (draft) where the file holds the final one. The check fails with `line 3 (session:<id>#m3) differs`; the test also asserts the twin kept 500 lines, old `m3` and `m480`, and the gained `m500` |

The twin is built only on the record's and the store's entries, which exist at the base. Its test runs the real
archive on the same scenario first, and that must pass. The twin links one whole copy because the test can't know the
implementer's parts shape. An implementation must go on reading a whole copy, as every copy the base made is one.

## At the base

The issue gives AC4 no merge-base clause. At the base, every changed transcript is copied whole again, which this
criterion accepts. So both tests are expected to pass there: the first because the base's whole copy is correct, the
second because the twin fails the check. The criterion's wrong program is the twin, not the base (AGENTS.md: "a
planted twin or a mutant for new code"). Not verified by a run.

## Files

- `helpers.ts`: the criterion and its ID, the generated transcript and its rewrite, the scenario (`rewriteAfterCopy`),
  the reads of what a run left, and the check (`copiedAgainFromStart`, `firstDifference`).
- `wrong.ts`: the twin.
- `rewritten.test.ts`: the two tests.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, as #20's.

Temp folders are the `/tmp/dh20-*` ones #20's helpers make and remove; its helpers also clear the agents' variables
and point `HOME` at a temp folder. All data is generated; there are no keys and no home data.
