# Blind redraft: the criterion-1 replays of #384 (`replay384.test.ts`)

From criterion 1: "#393's and #384's acceptance scenarios, played against the hub and the app instead of the `deep-show` stand-in, give
the same replies field for field, with evidence hashes compared by content". Redrafted: the three tests "AC1 #384 AC1", "AC1 #384 AC2"
and "AC1 #384 AC3" (their names and `replay384.test.ts` are unchanged; what they run is `expectReplayed` on `ENTRIES_384`, so the change
is in `scenarios.ts` (`compare384` and its `compare` on each #384 entry), `replay.ts` and `ac1.ts`). Not touched: `replay393.test.ts`,
the #393 entries (they have no `compare`, so their comparison is the old one, line for line), `helpers.ts`, and the tests of criteria 2 to 4.

I ran the stand-in on every #384 scenario, with its `clock` and `at` and without them, and read each field against what the hub is given.

## What was wrong in the first draft, and the change

1. **The hub was asked for the stand-in's virtual-clock readings.** A patch reply of the stand-in carries `arrived`, `checked` and
   `current` (for the first patch, 141120000, 141472800, 145588800), because the scenario runs on the display clock. The hub runs on real time
   and is never given `clock` or `at`, so no correct hub could equal them, and every #384 replay failed on call 1. Now both sides drop these
   three, and only these three; a hub that carries any must carry all three with `arrived` ≤ `checked` ≤ `current`, else its reply
   has a `clock_order` field and the comparison names it. Shown to fail by `clockProblems` (a copy of the hub's replies with readings out of order).
2. **Dropping the clock from the stand-in would have been wrong too.** Without `clock`, the stand-in's replies for the same calls say
   `doc_rev: 0` (not 14) in every ask, and after the delete the caption's handle resolves `live` (not `detached`): patches never become
   current at a latch. Those are the values #384's AC1 to AC3 are about, so the stand-in keeps its clock and the hub gets the same meaning
   from call order (the replay `sync`s the app before each user call, so the panel shows revision 14, and the delete, revision 15, is
   current when the session reads). `doc_rev`, `state`, `removed.rev`, `removed.writer` and the playhead's `t` compare exactly. Checked on a
   scratch model: the no-clock replies differ from the clocked ones in `ask` and `messages` for the board scenarios, and the comparison reports it.
3. **`render_back` sent `t` as a number.** deep_show's `t` is text in the #393 replays (`"1s"`), and each field has one JSON type (#26), so a
   number would be refused by the tool's schema. The replay now sends the grammar's text (`"4.2s"` for 2,963,520,000 flicks, `"0s"` for 0;
   `secondsText` refuses a value with no exact text). `rev` stays a number (it appears only here).
4. **The stand-in's `t` in a render-back reply.** The reply is #393's, which has no `t`. The first draft required it. Now it may be absent
   from the hub's reply; if present, as flicks or as `"4.2s"`, it must equal the stand-in's. Which `t` was drawn is in the pixels
   (the 0 s frame differs from the 4.2 s one). This is the one field of "field for field" the replay doesn't require; the README says so.
5. **The `ask` call carried the scenario's session ID.** `sess-alpha` was sent to the app as it was, and the hub knows only the real
   session. The replay now maps it (`agent.real`) in every user call that has a `session`; `messages` already did. Threads and claim
   handles were mapped already, on calls and replies. The ask-task handle (`task:sess-alpha-6`) is the stand-in's own and is never sent, so
   it compares by first appearance, as before.
6. **Doc handles' case.** A ULID is case-insensitive (#384's `sameHandle`), and a correct hub may print the doc ID in lower case, so a
   doc handle's doc ID now compares case-folded; the item ID after `#` exact.
7. **The comparison was shown to fail only on top-level fields**, none of them what #384 asserts. Each #384 entry now lists the nested fields
   it is about (`doc_rev`, `t`, `handles`, `precision`, `quote`, `region`, `task.open`, a resolved handle's `state`, `name`, `removed.rev`,
   `removed.writer.id`, `context`; a render-back's `rev`, `t` and the snapshot's pixel hash), and `mutantProblems` changes each in the hub's
   replies; it must be reported naming the call and the field. A listed path the stand-in's replies don't have is itself a failure.

## Per test

- **AC1 (selection)**: the two clicks, the typed request and the session's read. What changed: the clock readings (1), the session ID in
  `ask` (5), doc-handle case (6), and the mutants on `doc_rev`, `t`, `handles`, `precision`, `task.open`, `context` and the `resolved` rows (7).
- **AC2 (caption, note, screenshot, page)**: pointing at the caption, an instruction-like caption, inside a screenshot, inside an HTML page.
  The same (1, 5, 6), and mutants on `quote`, `words`, `region` and `precision`. The page has no document, patch or revision, so it has no clock
  readings and no `t`.
- **AC3 (detached)**: the delete, the session's read and the three render-backs. The same, with (3) and (4) for render-back's `t`, and
  mutants on `state: detached`, `removed.rev`, `removed.writer.id`, `task.open`, and the render-back's `rev`, `t` and pixel hash.

## What each still fails on

A hub whose reply differs from the stand-in's in any field these compare: a handle live when the item is gone, `doc_rev` 0, a missing or
wrong `t` on the message, a closed ask-task, a wrong region, a render-back of another revision or time (another pixel hash), a different
`quote`, patch readings out of order. Not compared: the three clock readings' values, a render-back's `t` when absent, doc-ID case.

## Run at the base

All three fail on the missing surface (`deep-replica-canvas`), in `BASE-FAILURE.txt`. The new comparison code itself was run, since no hub
exists, in a scratch test (removed): the stand-in's own replies, as a correct hub would give them (no clock readings, or real ones; `t`
absent or as text; lower-case doc IDs), gave no difference and no unreported mutant for the six scenarios; the no-clock replies and a wrong
`t` were reported. `npx tsc -p tests/acceptance/806/tsconfig.json` passes.
