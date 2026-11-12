# #1687 — closure proof (2026-11-12)

**Part of #1687** until the open items at the end are settled. This replaces the
2026-11-11 status in this file; the older reports stay as history.

Head `0f3aba98d`. Merge base with `origin/main` (`331b68be1`): `db8d9ed76`.
Every run below is on clean builds of both, made in this update: `npm ci` from
the unchanged lock and `npm run build --workspaces` exit 0 on each side, and
`cargo build --locked -p deep-hook` once (crates, `Cargo.*`, `vendor/`, `.cargo`
and the lock are byte-identical on both sides).

## Changed in this update

- `bf29301f8` — the size lane. The merges from main left `core.ts` and its three
  twin copies 31 lines over the ceiling this branch set, and `stop-judging.ts`,
  new here, at 1,505 lines. The ceilings now name the files' sizes (2,626, under
  the base's 8,263) and `stop-judging.ts` holds 1,482.
- `0f3aba98d` — the `39/twins/takes-first-stamp` twin. Its move to
  `mcp-operations.ts` had kept one of the base twin's two fault lines, so it
  passed its criterion. The second line is back; it fails again (below).

## Requirement → change → proof

| Criterion | Proof on this head | Open |
| --- | --- | --- |
| AC1, tests pass as on the merge base | 51 behavioral files of the moved seams, 166 test rows, on both sides: 146 pass on both, 20 fail on both with the same message. Full `affected.mjs` run: see below. | The full run's second pass and its base rows; the timed files |
| AC1, every twin over a moved method still fails its criterion | 17 of 18 twin groups fail their criterion at a framework assertion, the clean snapshot passing the same cases | #18's, #21's grant |
| AC2, hook path and wiring only, no method over 100 lines | 29 of 29 structural and oracle cases pass; largest `Core` body 95 lines | |
| AC3, no new cycle, core imports no extension | Same 29 cases: the cycle, type-edge and loader checks pass; `loader-boundary.test.ts` 3 of 3 | |

## What ran

**Lints.** The 16 node scripts of the lint lane ran on both sides. Fourteen
print the same findings. `repo-rules.mjs` differs only in its `NOTE size` line.
`size-ratchet.mjs` has 35 findings on the base and 32 here, each among the
base's; the three that go are the files this issue splits. `cargo fmt`, clippy,
`canvas-lint` and `vendor-rebase` read only paths the change leaves unchanged
and were not run. Of the 168 "new" lint findings the last report listed, five
were this branch's (the size lane, now fixed); the rest are main's.

**Structure.** `node --test` on the four #1687 files: 29 pass, 0 fail, 0 skip.
The blind file as first committed (`2caed7085`), run unmodified on this head,
passes 13 of 15, both tagged cases (`#1687.f156a5ac`, `#1687.2e07fefc`) among
them. Its two failures are untagged name-surface cases that match a local
variable, not a policy: `const judged = [...]` at `core.ts:2125` and
`const runs: KitRun[] = []` at `host.ts:1181`. `acc5121c5` replaced that section
with the blind redraft's oracle, on the owner's approval in conversation.

**Twins.** `reports/issue-1687-twin-proof.json` holds each case. Every overlay
builds. Killed at an assertion: `349/` refusals-unrecorded,
applied-but-never-handed, plants-ignored (both files), passed-without-results,
routes-by-name, kit-skipped-at-install, both-adapters-deliver; `351/`
admits-everything, plants-ignored, replaced-kind-kept; `332/`
clone-record-under-plant; `39/` takes-first-stamp; `39-redraft/`
job-hooks-as-session; `83/` stop-without-line, answers-any-origin,
plant-ignored. The fault lines of the eleven hub and asks twins equal those of
the base twins, read against the monolith each base twin was last copied from.

- `18/unbound-reads-all`: its criterion case fails on the twin, naming the
  leaked open item, through the test's own `throw Error`, which is not a
  framework assertion. With the one-line form in
  `issue-1687-binding-assertion-proposal.md`, tried in snapshot copies only,
  the clean cases pass 2 of 2 and the twin fails at an `AssertionError` in
  `holds()`. The repository test is unchanged.
- `21/plant-ignored`: its test is on the timed list. Outside a timed grant the
  criterion case passes on the clean snapshot and fails on the twin at its
  assertion (`/in the record 2 times/`). No timed grant was held, so the lane
  reads this INCONCLUSIVE.

The earlier map recorded a kill for `39/takes-first-stamp` that did not hold:
on a quiet machine the twin passed, which is how the lost line was found.

**Behavior.** The 53 files of the reused inventory
(`tests/acceptance/1687/full/README.md`), `822/hub.test.ts`, and the two hub
unit tests this branch edits, one file at a time as `proof-runs.mjs` runs vitest,
on the candidate and then on the base. The 20 rows that fail on both are in
`16/hotpath-ac18-redraft`, `25/routes/held`, `25/routes/one-route`, `26/ask`,
`26/binding`, `26/errors`, `26/tools`, `27/repeat`, `27/waits`, `567/fast` and
`822/hub`; none is in `scripts/known-failures.json`. One row differed:
`315/cut.test.ts` AC11 failed on the candidate at load 323 (199 of 200 hooks
spooled, hub stopped) and passed 4 of 4 when run again at load 20, as on the
base. Not run on either side: the five timed files of that inventory.

**Affected.** `node scripts/affected.mjs --slow --timed` on the candidate selects 456
parallel and 709 alone vitest files, 21 node files, 36 slow and 80 timed, and
`deep-app`. Its first full run began 2026-11-12T02:01Z and had not ended when
this was written. Its shards began with no `deep-hook` built, so several hundred
of its early rows read BLOCKED for that alone; a second pass over those files,
and the merge base over the files that still fail, are queued behind it. Until
their rows are set side by side, the full selection is INCONCLUSIVE.

**Guard.** `node scripts/proof.mjs guard`: FAIL, four findings, all in
`acc5121c5` on `tests/acceptance/1687/full/structure.test.mjs` (the oracle swap
above). The merge base holds no `.deepbuild/approvers`, so no signed approval
can be read for any change today.

## Open before `Closes #1687`

1. The full affected run's rows on both sides, as above.
2. The owner's yes or no on the #18 one-line assertion form. Its proof is above.
3. The timed files (80 in the affected selection, `21/replay.test.ts` among
   them) under a timed grant, which needs the machine's load under its 18 cores.
4. The guard's four findings need the maintainer's signed tag once main holds an
   approvers list; until then they stand as FAIL.
