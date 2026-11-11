# #1687 — one-PR extraction, proof and open gates

**Part of #1687. Status: BLOCKED for closure.** The owner requested one PR for the
whole issue, overriding the earlier seam-per-PR packaging. No acceptance criterion
was waived. Base: `c52f1c66d22886c336189d41237265e82843c34a`.

## Requirement → change → proof

| Requirement | Change | Evidence / limit |
|---|---|---|
| Hub seams own their state/options | Transcript reading/backfill, answer delivery, stop judging/reply, MCP, canvas, session state/memory and control operations extracted. Existing spool, log, holds, stacks, questions and kinds reused. | Core is 2,573 lines versus 8,329 at base. Independent ownership checks accept the moved hub responsibilities. No extracted class receives or imports Core. Domain ports and lazy services retain initialization order. Complete semantic ownership remains a review obligation, not a line-count claim. |
| Core hook/wiring methods ≤100 lines | Ordered constructor/startup and hook/reply phases. | Frozen structural check passes; reviewed AST maximum is 95 source lines. The blind ownership redraft also passes its complete callable-length assertion. |
| Host service seams | Source operations in sources.ts; schedule dispatch/history in schedules.ts; sends/notices in sends.ts; model/tool jobs in jobs.ts; action schema and adapter routing have their own modules. | Host is 3,225 lines versus 4,299. Independent ownership redraft passes selected Host responsibilities. |
| asks gate/show rules/decision keys | ResolverGate, Showing and DecisionKeys with 5/6/4 inputs; shared model and duration leaf modules; same public reexports. | Index is 2,059 lines versus 2,557. Blind ownership redraft initially caught batches() left behind; it moved unchanged into Showing and that affected assertion then passed. |
| Public behavior unchanged | Production method moves, inward wiring, unchanged package exports. | Focused base/candidate runs have identical 109 case outcomes: 108 pass and one platform skip. Compiler diagnostics match after source-location normalization: three inherited errors, no remaining extraction-specific errors. Neither result is a full PASS. |
| Twins follow moved faults | All 19 legacy monolith overlays (8 hub, 8 Host, 3 asks) retargeted/refreshed; original test assertions and twins.json files unchanged. | Static fault mapping completed. Behavioral execution of every migrated twin is **UNRUN**; migration alone is not criterion proof. Three faults remain in hook stages and still overlay Core. |
| No new import cycles | Shared leaf types/capabilities avoid domain back-imports. | Independent recursive checks pass both runtime and type-inclusive comparisons: runtime cyclic edges 2→2; type-inclusive 17→15. Existing cycles are not declared gone. |
| Core never imports an extension | **Still open.** | Both independent drafts reject the absolute boundary. Existing composition and helper imports remain, including concrete checks, resolver and environment providers; the stricter redraft reports 21 edges versus 20 at base. Computed import targets also remain BLOCKED pending review. No exemption or hidden loader was added. |

This is larger than 400 handwritten lines because the person requested the whole
cross-package extraction and fault-overlay migration in one PR. It adds no runtime
dependency/configuration switch and no new product feature. New production files
stay below 1,500 lines; affected existing ceilings only decrease or disappear when
the file moved/deleted. The prior settings-only evidence is retained separately as
history, not substituted for this base's proof.

## Tests first and check integrity

The base-only drafting job produced `tests/acceptance/1687/full/`; committed before
these broader moves as `2caed7085`. Initial base run: 11 named failures/3 passes;
author's pre-delivery callback-oracle correction has its own affected red log. All
frozen files remain byte-identical. Existing behavioral tests were reused.

One independent blind redraft per disputed area is kept separately, not substituted:

- `ownership-redraft/`: actual implementations rather than any local declaration
  with a selected name. It passes the hub/Host moves and exposed the batches move.
  The original draft still falsely matches local `const judged`/`const runs`; it
  was not edited and these local variables were not renamed to game it. If this
  difference needs adjudication, both drafts and outputs are available.
- `ac3-redraft/`: agrees that the absolute core boundary fails; therefore the
  requirement stands. It separately reports unresolved computed module targets
  rather than guessing a complete graph. It is not permission to drop dynamic
  plug-in loading or to waive the dependency rule.

Review found an extraction timing regression: stopAt received a captured stepped
clock before awaited work. The callback now reads that offset at the original
computation point. A new Core field initializer that used constructor options too
early and the evidence-read delegate were corrected from compiler diagnostics.
These restore base behavior rather than change an expected value or weaken a test.

## Completed comparisons

### Typecheck/build

Each side ran its own `tsc -p packages/hub/tsconfig.json`, then workspace build.
Both exit 2 with the same three diagnostics at the same run-record wiring, apart
from line/column: CommandRun permits exit cause `limit`, while RecordedRun does
not, and its narrowed return type lacks CommandRun fields. These source definitions
are unchanged by this PR. No cast, suppression or check edit hides the problem.
All other extraction compiler findings were corrected. Workspace builds emitted
artifacts, but their nonzero status is **not PASS**. `cargo build --locked -p
deep-hook` completed with exit 0 independently in each checkout.

### Focused affected run

Both sides ran, with their own built artifacts and `DEEP_SHARDS=1`:

```sh
node scripts/affected.mjs \
  packages/asks/test/asks.test.ts packages/asks/test/timing.test.ts \
  packages/extension-host/test/schedules.test.ts \
  packages/extension-host/test/sources.test.ts packages/extension-host/test/slots.test.ts \
  packages/hub/test/answers.test.ts packages/hub/test/gate-stop.test.ts \
  tests/acceptance/18/install/tamper.test.ts tests/acceptance/18/install/disable.test.ts
```

The reporter's test IDs/outcomes compare equal: **108 passed, one skipped**. This
includes real asks/record, Host routing/source/schedule, hub answer/stop paths and
the watch/recheck acceptance with embedded wrong-program detection.

- Base: `FAIL affected: 94 new, 11 already failing on main, 1 inconclusive or blocked,
  0 listed skips, 108 passed`.
- Candidate: `FAIL affected: 91 new, 11 already failing on main, 1 inconclusive or blocked,
  0 listed skips, 108 passed`.
- “New” is relative to the committed known-failure table, not attribution to this
  change. Both include inherited repository lint findings; overall equality of all
  lint output is not claimed.
- No WIDE line in this focused selection. Both emit the same INCONCLUSIVE line for
  the Secret Service source test skipped without a note. Both list the by-hand
  `tests/acceptance/70/redraft-ac1/e2e.live.test.ts`; it did not run.
- Earlier focused attempts ran no tests because config-eval/conformance artifacts
  were absent. They remain BLOCKED evidence; the later attempts followed building
  those prerequisites, not retries of a behavioral failure.

### Structural checks

Original frozen check: 12 pass/3 fail (two local-name false positives, absolute
extension boundary). Blind redrafts: 17 pass/3 fail, followed by the one affected
asks ownership assertion passing after its missing batch move. No new runtime or
type-only cycles found. A graph assertion is not runtime behavior proof.

`git diff --check` passes. Size ratchet reports only unchanged base `server.ts`,
1,524 lines with no ceiling; no ceiling was added to allow it. New files have no
size exemptions. A proof-guard attempt timed out at 180 seconds without a verdict;
it is **UNRUN/INCONCLUSIVE**, never approval of twin/check changes.

## Open before a closing PR

1. Absolute core/extension boundary and computed-import review, preserving the
   unchanged direct-Core acceptance surface and all public behavior.
2. Full affected before/after proof. Selection spans 421 parallel Vitest files,
   18 node files, 656 alone files, 73 timed Vitest files plus one timed node file,
   36 slow files and deep-app. There are 62 by-hand/own-lane skips; no WIDE entries
   in the complete-path selection. The broad run never started after its native
   prerequisite's build-grant timeout. No full-suite pass is claimed.
3. Every migrated twin's criterion failure, plus guarded-check migration approval
   if the proof guard requires it. No signature or approval was fabricated.
4. Inherited compiler/lint blockers and validation at the eventual merge base.

All validation/delegate processes started for this work ended. Nothing belonging
to another session was stopped. No CI workflow was added. **A single draft PR can
hold this work; it must not say Closes #1687 yet.**
