# Dispute: #3234 AC6's first draft adds an `ask.*` kind, which #606.9092f0b3 forbids

This redraft exists because of this dispute. The first draft is the AC6 test of `tests/acceptance/3234/card.test.ts`.
AC6 runs as this redraft on the owner's ruling ("Redraft #3234", Nov 23, 2026). The first draft's `card.test.ts` is
kept by hand (`scripts/lanes-lists.mjs`), with its AC1 and AC2 tests in the same file.

## What fails

The first draft's AC6 feeds `{kind: "ask.moved", writer: "core", subject: <the ask>, data: {pinned_to: …}}` to a
running replica (`card.test.ts`, line 169), so a program passing it records a new `ask.*` kind. The design closes the
`ask.*` kinds to an ask's steps and its outcomes (canvas-primitives.md, The event catalogue; technical-design.md, An
ask and your answer getting back). `tests/acceptance/606/outcomes.test.ts` refuses any other kind, so no program passes
both. On main at 78d73a747, after 63c381b60 added `ask.moved@1`:

```
#606.9092f0b3 an ask outcome outside the design's closed set is refused, naming where it sits and the value
  AssertionError: ask.moved is an ask ending outside the design's outcomes (answered, decided_for_you, escalated,
  defaulted, unanswerable, cancelled, superseded, moot, unanswered): expected false to be true
  ❯ tests/acceptance/606/outcomes.test.ts:88
```

Issue #3234 names no kind for the event; the first draft chose `ask.moved`.

## How the redraft was made

A blind job wrote it. It saw only issue #3234, the design, AGENTS.md, the base `f8c6cff82` in a checkout of its own,
the first draft's README, helpers and `card.test.ts`, the criterion `#3234.23f156f5`, and the base fact above. It never
saw the work or its diff. It keeps the first draft's surfaces, numbers and expected values (the option not armed, 1 of
4 left). It pins the taste ask to a document revision, `doc:<id>@<rev>`, and replaces a picture as that document's next
revision, `doc.patched@2`, a kind already in the catalogue (its README, The event).

## On the work

The work removes `ask.moved@1` and has the card and the asks core read a document pin's pictures from the document's
newest `doc.patched`. Both suites need macOS to draw, so on Linux they're BLOCKED; their run on the reference Mac is in
the pull request.
