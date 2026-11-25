# Dispute: #96's first draft pins every `doc.patched` event to `@1`, which can't carry the revision hash #1412 needs

This redraft exists because of this dispute. The first draft's tests are those of `tests/acceptance/96/` for AC6
(`commit.test.ts`), AC9 (`undo.test.ts`), AC14 (`commit.test.ts`, its test and its planted twin) and the Proof
(`proof.test.ts`). It needs the owner's ruling: until then the first draft stands and the work fails it.

## What fails

The first draft checks each recorded event with `expectValidPatched` (`tests/acceptance/96/helpers.ts:174`), which
validates it as `doc.patched@1`. `@1`'s `data` is closed: `{doc, rev, patch, writer, achieved}`. The design's Revision
paragraph (`docs/canvas-primitives.md`) says "The `doc.patched` event carries the revision's hash", and #1412's
scope and its blind suite (`tests/acceptance/1412/`, AC3 and AC4, through `data.hash`) need it. The published
contract that carries it is `doc.patched@2` ("@2 adds the revision's hash and the writer layer it went into (#806)"),
which the live hub already records (`packages/hub/src/canvas.ts`). An event can't be both: no program passes the
first draft and #1412's suite. On the work (this branch, after merging origin/main at 2c79d71eb), load 11:

```
AssertionError: record line 1 is a valid doc.patched@1 event: [{"code":"const",…,"path":"/v","actual":"2",…},
  {"code":"unlisted_field",…,"path":"/data/hash",…}, …]
  ❯ commit.test.ts:31   (AC6)        ❯ commit.test.ts:47 (AC14, both tests, through crash())
  ❯ proof.test.ts:72    (Proof)      ❯ undo.test.ts:69   (AC9)
Tests  6 failed | 25 passed (31)   (budgets.test.ts left out; the sixth is schedule.test.ts's AC13, a timeout, below)
```

## How the redraft was made

A blind job wrote it. It saw only issue #96 (its text, criteria and proof line), the design, AGENTS.md, the base
`118ec119f` in a GitHub clone of its own, and the first draft's README, helpers and tests. It never saw the work, its
diff or this dispute. It keeps the first draft's surfaces, numbers and expected values, validates each event against
the version it names, and adds one test the design's Revision text asks for: the event carries its revision's hash,
equal to the restarted read's. Its README lists every departure with the design text behind it.

## On the base and on the work

- Base `118ec119f`: 7 of 8 pass; AC14's new hash test fails (`BASE-RUN.txt`), since the base writes `@1` with no hash.
- The work: 8 of 8 pass.

The redraft passes on the work, so under the design's Dogfooding rule the dispute comes to the owner once: rule that
AC6, AC9, AC14 and the Proof run as this redraft, with the first draft's tests for them kept by hand
(`scripts/lanes-lists.mjs`, which this branch does not edit), or that the first draft stands.

## AC13

`schedule.test.ts`'s first AC13 test took 5.3 s against vitest's 5 s limit in the run above. Its scenario has no state
folder, so no line this change adds runs on its path (the hash and envelope file are written only with a state
folder, and restore runs only with one). Alone, it timed out again at load 100 (10.9 s, the file's first test); with
`--testTimeout=60000` at load 190 all three of the file's tests pass. That is load, not the work.
