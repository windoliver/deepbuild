# #806 AC1, blind redraft for #393's AC9 scenario

A blind redraft (design: Dogfooding) of the one AC1 test of #806 that plays #393's AC9 scenario, "5,000 unnamed
marks refused". It replaces nothing; the existing draft is `it('AC1 #393 AC9: …')` in
`tests/acceptance/806/replay393.test.ts`.

## What I was given

- Issue #806 (its scope and acceptance criteria), and nothing from any other issue or PR.
- The sections #806 links: Extension API (TypeScript, in-process) and The canvas core in `docs/technical-design.md`,
  Writer layer and Render-back in `docs/canvas-primitives.md`. `node scripts/design-section.mjs --issue 806` is
  BLOCKED at this base because #806 is closed, so I printed each anchor with `design-section.mjs <doc>#<anchor>`. The
  read-cap rule itself is in the canvas primitives' issues paragraph ("A reply that carries them … inlines them up to
  the tech design's read cap of 8,192 characters, errors first and then by code and ID, and when it cuts it adds
  `truncated: {shown, total, by_code}`").
- The base, `2f05ccb3e`: `tests/acceptance/806/` and `tests/acceptance/393/`, read only to learn the surfaces. #393's
  AC9 is taken from the criteria table in `tests/acceptance/393/README.md`, since #393 itself was not to be read.

## The criterion

#806 AC1, in full:

> #393's and #384's acceptance scenarios, played against the hub and the app instead of the `deep-show` stand-in, give the same replies field for field, with evidence hashes compared by content

#393 AC9, the scenario this test plays (as `tests/acceptance/393/README.md` quotes it):

> A test agent's document of 5,000 marks, none of them named, sent with `deep_show` is refused with 5,000 issues: the reply inlines issues up to 8,192 characters, errors first and then by code and ID, and adds `truncated` with `shown`, `total: 5000` and `by_code` counting each code, while the full list reads back from its evidence hash, issue for issue, and the refusal counts all 5,000. A reply that inlines every issue, or one that cuts with no `truncated`, fails this test, naming the reply's size or the missing field

## What the test checks, and why

`ac1-393-ac9.test.ts` has two tests, one for each way #393's AC9 sends the document: `deep_show` through a `deep mcp`
bound to the alpha session, and `deep show --check` run inside alpha's process tree. Each plays the scenario
(5,000 `rect@1` marks `m-1` … `m-5000`, no `name`, in a seeded shuffle) on the `deep-show` stand-in and on a real
hub with real agent stand-ins (`806/replay.ts`'s `replay`), and asserts:

1. **Field for field.** The hub's reply equals the stand-in's in every field (`differences` after `normalize`), and
   has the same field names. `issues_evidence` compares by content: each side's hash is read back from its own
   evidence store and the lists compared issue for issue. This is the criterion.
2. **The reply compared is AC9's.** On the hub's reply and the hub's own evidence store alone: refused; the list read
   back holds 5,000 errors, one per mark, naming it, errors first then by code and ID; the inline issues are that
   list's longest prefix within 8,192 characters; `truncated` has `shown`, `total: 5000` and `by_code`; and for
   `--check` the result is `FAIL`. Without this, a hub and a stand-in that both answered nothing, or both answered
   wrongly in the same way through the canvas core they share, would agree field for field.
3. **The comparison can fail.** Each top-level field of the hub's reply changed in turn is reported, naming the call
   and the field (`mutantProblems`); and #393's two wrong replies, from the stand-in's planted programs
   `inlines_every_issue` and `cuts_without_truncated`, differ from the hub's, naming `issues` and `truncated`.

## Readings where the criterion leaves a choice

- **"Against the hub and the app".** No call in this scenario is the user's, and a refused document is drawn
  nowhere, so the app has no part in its replies; the hub is played without the app, as the existing draft does.
  The app's drawing is #806's other criteria.
- **One scenario or two.** #393 sends the document by `deep_show` and by `deep show --check` in separate tests, each
  in a fresh world on `DOC.a`; this redraft does the same, so neither reply depends on the other call's revision.
  (The existing draft plays both calls in one world, on two docs.)
- **#393's failing-reply clauses.** The planted wrong replies are the stand-in's, not the hub's; #806 asks only that
  the hub's replies be the stand-in's, so they are used here to show the comparison catches exactly those failures.
- **Timing.** AC9 states no time bound, so the replay's call times are not asserted.

## Proof on the base

`BASE-RESULT.txt`: the first run on the loaded machine got `unavailable` from the hub for the `deep_show` call (it
did not answer in time) while the `--check` test passed; the one allowed rerun passed both. A wrong program, the hub's
reply with `truncated.total` set to `truncated.shown`, planted as one line in the hub's built `hub-canvas.js` and
restored after, fails both tests, naming `truncated` of call 1.
