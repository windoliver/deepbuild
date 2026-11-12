# #1687 — closure record (2026-11-12)

**Closes #1687 on the owner's decision.** The owner chose to close with the
items under "Not proven" unrun, which sets aside the rule that a PR says
`Closes` only when every criterion is proven. They are tracked in #2345. Older
reports in this folder are history.

Head `39bee16ae` plus this record. Merge base with main: `afadc469d`.

## Changed since the last record

- `9e8912fd4` — merged main. Only `core.ts` conflicted. What main added to
  `Core` (the row flags of #2019, `setup.report` of #1100, missing packs of
  #1958) went into owners: a new `session-flags.ts` under its own options, and
  small ports into `transcript-reader.ts`, `session-state.ts`, `hub-control.ts`,
  `hub-canvas.ts`, `stop-judging.ts` and `transcripts.ts`.
- `e4f24691b` — #18's `holds()` reports through `expect(...).toEqual([])` in
  place of `throw Error`, same condition and message, on the owner's approval.
- `39bee16ae` — the loader review's three whole-file digests re-recorded after
  the merge, on the owner's approval, by this change's author.
- Earlier: `bf29301f8` (size lane), `0f3aba98d` (the #39 twin's lost fault line).

## Requirement → change → proof

| Criterion | Proof on this head |
| --- | --- |
| AC2, hook path and wiring only, no method over 100 lines | 29 of 29 structural and oracle cases; largest `Core` body 95 lines |
| AC3, no new cycle, core imports no extension | The same 29 cases; `loader-boundary.test.ts` 3 of 3 |
| AC1, every twin over a moved method still fails its criterion | 16 of 18 twin groups fail at a framework assertion, the clean snapshot passing the same cases; the two others are below |
| AC1, tests pass as on the merge base | The moved seams' 51 behavioral files match the base's rows; main's own tests for the ported code pass. The full selection is not run |

## What ran

**Build.** `npm ci` and `npm run build --workspaces` exit 0 on `9e8912fd4`; the
two commits after it change one test line, one JSON file and one note.

**Structure.** The four #1687 files: 29 pass, 0 fail, 0 skip on `39bee16ae`.
With the old digests the completeness case named `core.ts`, `plant.ts` and
`server.ts` and nothing else; no loader site or provider call had changed.

**Twins**, on `39bee16ae` (`reports/issue-1687-twin-proof.json`). Killed at an
assertion with the clean cases passing: the seven of `349/`, the three of
`351/`, `332/clone-record-under-plant`, `39-redraft/job-hooks-as-session`, the
three of `83/`, and `18/unbound-reads-all`, which the approved assertion form
makes a framework failure.

- `39/takes-first-stamp`: in five runs the twin failed its criterion case at its
  assertion once and passed four times. Its two fault lines equal the base
  twin's. The case sends its two asks at once, and the twin binds wrongly only
  when stamps and calls arrive in different orders.
- `21/plant-ignored`: its test is on the timed list. Outside a timed grant the
  clean case passes and the twin fails at its assertion; the lane reads that
  INCONCLUSIVE.

**Behavior.** The 51 non-timed files of the moved seams ran on `9e8912fd4`, one
at a time, and were set against the rows `db8d9ed76` gave on its own clean
build: 160 rows the same. Six rows in four files differed in a run at load 117
to 146 (`315/spool`, `82/answers`, `82/pending`, `83/line`); those files pass
in full when run again at load 17. That leaves 146 passing on both and 20
failing on both with the same message, none of them in
`scripts/known-failures.json`. Main's tests for the code this merge ported,
`tests/acceptance/2019`, `1100` and `1958`: 12 files, 43 rows, all pass.

**Lints.** `size-ratchet.mjs`: no finding in a file this PR touches.
`repo-rules.mjs`: no FAIL line that its run before the merge lacked.

## Not proven

1. The full `affected.mjs` selection, about 1,300 test files, has not finished
   on any head. Its one full attempt began with no `deep-hook` built in its
   shards and was stopped for the merge.
2. The timed files (80 in that selection, `21/replay.test.ts` among them) have
   not run under a timed grant, which needs the machine's load under 18.
3. The new merge base `afadc469d` was not built or run; the behavior rows above
   are set against `db8d9ed76`.
4. `39/takes-first-stamp` fails its criterion in one run of five.
5. `proof.mjs guard` was not run again. Before the merge it failed with four
   findings in `acc5121c5`; `e4f24691b` and `39bee16ae` edit guarded tests too.
   Main holds no `.deepbuild/approvers`, so no signed approval can be read.
6. The loader review's refresh was not made by an independent reviewer.
