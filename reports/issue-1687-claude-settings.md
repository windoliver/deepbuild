# #1687: Claude settings seam — partial proof

**Part of #1687, not closure.** Base: `de304b9fffdb33ac8a76cae1b93f1649ed6b9f20`.
The independent acceptance map is `tests/acceptance/1687/README.md`; it is unchanged.
No acceptance test, twin, manifest, golden, runner or known-failure entry was edited.

## Requirement → change → result

| Requirement | Change | Proof and limit |
|---|---|---|
| One seam with its own options | `ClaudeSettings` in `packages/hub/src/claude-settings.ts` owns the watch, restoration, session-start recheck and readings. Six inputs supply its state root, plant, record reads, queue, running calls and reading append. | The three method bodies match the base after explicit wiring substitutions. The record query, grace period, restoration order, error handling and reading text are unchanged. |
| Keep lifecycle and public entry | Core still registers, unrefs and clears the poll timer; the seam closes the filesystem watcher at the same stop point. Package exports and `src/index.ts` are unchanged. | Source comparison and independent review. Existing behavioral checks below, not source review alone, establish the measured behavior. |
| Avoid duplicate helpers and cycles | `statKey` moves unchanged to `agent-files.ts`, used by Core and the watch. | The only added module edge is Core → agent-files; neither agent-files nor claude-settings reaches Core. No new package or extension dependency. |
| Preserve behavior and wrong-program detection | Existing tests only. | Both revisions report the same 15 test IDs/outcomes: 14 pass, one inherited waiter failure. The watch's embedded wrong program is detected on both. This is not a passing whole-change verdict. |
| Full issue closure | Not implemented by this installment. | Core remains 8,198 lines; its constructor, init, handleHook, buildReply and dispatch exceed 100 lines. The remaining hub, Host and asks seams and twin migration/proof remain open. |

## Completed runs

`cargo build --locked -p deep-hook` completed successfully in each revision's own
checkout. No target directory or binary was shared between revisions.

The same command ran once on base and candidate after that prerequisite was available:

```sh
DEEP_SHARDS=1 node scripts/affected.mjs \
  tests/acceptance/18/install/tamper.test.ts \
  tests/acceptance/18/install/disable.test.ts \
  tests/acceptance/18/install/stophold.test.ts \
  tests/acceptance/18/install/waiter.test.ts \
  tests/acceptance/19/doctor/stophold.test.ts \
  tests/acceptance/19/doctor/disabled.test.ts
```

| File | Base | Candidate |
|---|---:|---:|
| `18/install/tamper.test.ts` | 2 pass, including wrong-program detection | Same |
| `18/install/disable.test.ts` | 2 pass | Same |
| `18/install/stophold.test.ts` | 2 pass, including wrong-program detection | Same |
| `18/install/waiter.test.ts` | 1 fail | Same assertion fails |
| `19/doctor/stophold.test.ts` | 5 pass, including wrong-program detection | Same |
| `19/doctor/disabled.test.ts` | 3 pass, including wrong-program detection | Same |

The waiter failure is AC15 `#18.72bbbbb5`: the ask does not say why its answer may
arrive at the next prompt, naming the waiter's 300 seconds. It fails on unchanged
base as well as candidate. No retry or test edit followed.

The runner also runs repository lints. Both commands exit 1: base reports **91 new,
11 already failing on main, 14 passed**; candidate reports **90 new, 11 already
failing on main, 14 passed**. Here “new” is the runner's comparison with its committed
known-failures list, not a claim that this refactor introduced a failure. Findings
include dependency/card, conformance/slot, canvas and record-reader lints. The
canvas-closure output differs between runs, so full runner-result equality is not
proven. The recorded loads were 480 and 614; these runs prove no performance budget.

These focused runs emitted no WIDE or INCONCLUSIVE lines. Both listed the same
by-hand skip, `tests/acceptance/70/redraft-ac1/e2e.live.test.ts`, which was not run.
Earlier fast runs through affected reported the same seven passes in
`packages/hub/test/relations.test.ts` and `packages/hub/test/hook-parent.test.ts`.

## Still blocked / unrun

- Full production-path affected proof: the earlier base run was interrupted after
  inherited failures; the candidate broad tests did not run. Their selections
  matched, with no WIDE entries, but 53 timed files, 28 slow files and 58 by-hand or
  own-lane files remained unrun. Matching selections are not matching results.
- The full-copy twins listed in the independent map are stale. No overlay was
  repaired, migrated, run or waived; an embedded plant is not proof of an overlay.
- The rest of #1687 needs separate move-only seams. Its audit comment rejects some
  original broad moves and links the transcript-state split to #1894; neither that
  comment nor this report silently removes the issue's original criteria.
- `origin/main` advanced after the pinned base, including #1432's size ratchet.
  Rebase and affected proof against the eventual merge base are still required.

**Delivery status: BLOCKED for a closing PR.** The settings watch/recheck behavior
and its embedded fault detection are measured; broader equivalence, twin proof and
all remaining extraction criteria are not.
