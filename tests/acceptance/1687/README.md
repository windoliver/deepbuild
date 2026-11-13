# #1687 — Claude settings watch installment

Independent acceptance map from issue #1687 and its seam comment, `docs/technical-design.md`
(architecture, Threats, Editing agent settings, Timing relations, Dogfooding/Wrong programs), and
base **`de304b9fffdb33ac8a76cae1b93f1649ed6b9f20`** only. No implementation checkout was read.

Scope: move the Claude settings watch out of `Core`, behind the existing entry, with its own
options. No intended behavior change. Other hub/Host/asks seams and the final hook-and-wiring-only,
100-line-method goal are **not this installment's gate**. This is **Part of #1687**, not closure.

## Requirement → existing proof

Existing behavioral coverage is sufficient for this move-only installment; no duplicate tests,
new production code, or file-name/class-shape assertions are added. This is a coverage map, **not
a passing result**. Paths below are relative to the repository root.

| Requirement | Existing tests / wrong program | Proof procedure |
|---|---|---|
| Public commands, hook protocol and health remain unchanged | The acceptance files below use `deep hub run`, `deep setup`, installed deep-hook commands, `events.read`, `hub.health`, and `deep doctor --json`, not private watcher methods. | Run unchanged before/after; review the public exports in `packages/hub/package.json` and `packages/hub/src/index.ts` for no API change. |
| Restore a removed entry between starts; both open sessions' next calls reach deep-hook; name the running call | `tests/acceptance/18/install/tamper.test.ts`, AC22 `#18.254d19bf`; embedded plant `restores-at-session-start-only` | Both normal and wrong-program cases must run. The latter must detect the second session's named call running unguarded, not an unknown plant or a startup error. |
| Session-start recheck restores an agent-written disable and installed entries, with attribution; the person's disable stays | `tests/acceptance/18/install/disable.test.ts`, AC8 `#18.afa67907` | Keep both cases: spooled Edit followed by hub restart/SessionStart removes the flag and names the Edit; the same flag written with no session stays through watch and SessionStart. These reject no restoration, missing attribution and unconditional restoration. No AC8 overlay is registered. |
| Preserve health/doctor readings and timing behavior across settings edits/restarts | `tests/acceptance/18/install/stophold.test.ts`, AC14 `#18.cfd217f8`; `tests/acceptance/18/install/waiter.test.ts`, AC15 `#18.72bbbbb5` | Stop timeout 60 s is broken/watch-only, 65 s permits a hold with 5 s margin; `holds-stop-anyway` must be detected. Waiter 300 s versus 20 minutes reads broken; the late answer reaches the next prompt; setup restores both Stop and StopFailure entries. |
| Preserve the doctor's precise boundary and settings visibility | `tests/acceptance/19/doctor/stophold.test.ts`, `#19.fbe84694`; `tests/acceptance/19/doctor/disabled.test.ts`, `#19.5800e7ab` | 60/64 s broken, 65 s OK; embedded `stop-hold-no-margin` and `stop-hold-entry-only` rejected. Repo disable and managed-only policy remain failed items, exit 1; embedded `hooks-disable-user-only` rejected. |
| Protect the destination module's existing callers | `packages/hub/test/relations.test.ts`; `packages/hub/test/hook-parent.test.ts` | Existing fast tests cover MCP timeout boundary values, either waiter's short timeout, and executable hook commands/parent identity plus doctor program discovery. They are supporting unit tests, not new acceptance surfaces. |
| Move only; retain lifecycle/ownership and fault detection | Tests above plus source-delta review against the base; twin inventory below | Preserve start, queued checks, filesystem watch plus polling fallback, running/recent-call attribution, recheck order, readings, and timer/watcher cleanup. Keep settings merging and user-owned values unchanged. Do not redesign restoration or plants in this PR. |
| No new cycle; core never imports an extension | Import-edge and public-entry review of the moved seam and wiring | Record every added import edge, including type-only edges; follow its dependencies to rule out a return path. Keep core→seam wiring without seam→core dependency or a new extension dependency. A successful build alone does not prove this. No dedicated TS import-cycle gate was identified in the inspected affected/lint configuration. |

Coverage limits are not new feature requests: `readingTexts` accepts health **or** non-hook record
readings, not both independently. The disable stand-in deliberately fires SessionStart despite the
flag; it does not prove a real Claude session starts hooks with that flag. The stop-hold test restarts
the hub after changing the timeout; it is not a separate live timing-recheck test. Cleanup helpers
can force-kill their own hubs, so lifecycle ownership also needs source review. Preserve these
existing checks and review the move; do not silently broaden or weaken their assertions.

## Baseline and after-move proof — implementing job, NOT completed here

With the pinned dependencies and fresh base/candidate workspace builds already available, run the
same exact selection on each revision, keeping per-test results, build identity, exit status and
logs. Test-path-only selection does **not** trigger affected.mjs's workspace build; stale `dist`
would test the wrong program. No dependency installation is authorized by this drafting task.

```sh
node scripts/affected.mjs \
  tests/acceptance/18/install/tamper.test.ts \
  tests/acceptance/18/install/disable.test.ts \
  tests/acceptance/18/install/stophold.test.ts \
  tests/acceptance/18/install/waiter.test.ts \
  tests/acceptance/19/doctor/stophold.test.ts \
  tests/acceptance/19/doctor/disabled.test.ts \
  packages/hub/test/relations.test.ts \
  packages/hub/test/hook-parent.test.ts
```

`affected.mjs` follows imports/public exports and named file/process paths; it distinguishes farther
process consumers as WIDE, runs its lint scripts too, and classifies failures using
`scripts/known-failures.json`. Exact file arguments are change seeds, not an absolute runner filter:
inspect its `--list` output before execution if the selection changes. For the actual production
paths, also inventory selection with `--list` before/after; that inventory is not a test result.
Do not run whole neighboring suites or `--wide` for this drafting task. Report all WIDE,
INCONCLUSIVE, BLOCKED, skipped and known/new-failure lines; an unchanged failure is not PASS, and a
new failure inside an already failing file is still a regression. Never retry merely for green.

The fast tamper file contains its own wrong-program assertion. `affected.mjs` does **not** itself
lay over `twins.json` programs: those are separate proof runs (`scripts/proof-runs.mjs`). Any
applicable overlay must build and run and fail its named criterion, on base and candidate; a
missing export, type error or failure to start is **not fault detection**. Preserve evidence for
inherited blockers rather than editing checks/manifests/twins to make this installment green.

`tests/acceptance/18/install/tamper.live.test.ts` is the existing real-agent counterpart, by hand
(and excluded by affected). It was not run and is not required anew for this no-behavior move;
no real-agent compatibility claim is made from the stand-in.

## Plants, overlays, and inherited proof debt

- `restores-at-session-start-only` is accepted by `packages/hub/src/plant.ts` and used in base
  `Core` to disable the watch and select start-only restoration. Preserve both effects when moving
  the seam. **`tests/acceptance/18/twins.json` maps neither AC22 nor AC14**, despite the install
  README requesting those mappings. It maps only `adapter-decides` and `unbound-reads-all`.
  Embedded plants are therefore not evidence that the manifest overlay lane covers this seam.
- `tests/acceptance/19/twins.json` maps `#19.fbe84694` to `always-stop-hold-entry-only`,
  `always-stop-hold-wide-margin`, `plants-ignored`; and `#19.5800e7ab` to
  `always-hooks-disable-user-only`, `plants-ignored`. These replace `packages/hub/src/plant.ts`.
  They are statically stale: their files export only `Plant`, `plantOf`, `activePlant`, while the
  base server/core import newer exports such as `plantedStart`, `plantedStop`, `plantedReload`,
  `plantedSessionEnd`, `piAcceptsReplaced`. No overlay build or behavioral result was obtained here.
- Eight whole-core overlays incidentally include all three settings methods. They are not eight
  watcher-specific faults. Inventory them when deciding which overlays the move reaches; do not
  treat these old copies as current passing fault proof:

| Folder under `tests/acceptance/` (each contains `packages/hub/src/core.ts`) | Manifest criterion → existing test |
|---|---|
| `18/twins/unbound-reads-all` | `#18.7f5b2ce8` → `18/binding/binding.test.ts` |
| `21/twins/plant-ignored` | `#21.9a5768d4` → `21/replay.test.ts` |
| `39/twins/takes-first-stamp` | `#39.de9f23ce` → `39/session.test.ts` |
| `39-redraft/twins/job-hooks-as-session` | `#39.edfd0196` → `39-redraft/job.test.ts` |
| `83/twins/stop-without-line` | `#83.8a03aacc` → `83/line.test.ts` |
| `83/twins/answers-any-origin`, `83/twins/plant-ignored` | `#83.4b0836ba` → `83/status.test.ts` |
| `332/twins/clone-record-under-plant` | `#332.92539e14` → `332/seed.test.ts` |

For concrete static drift, the #18 overlay's constructor takes two arguments, #21/#83's three,
while base `server.ts`/`core-worker.ts` call `Core` with five. The #332/#39/#39-redraft callbacks
also predate the base's four-list asking callback. These are inherited stale overlays, not a
failure caused by this proposed move. Their runtime/build outcomes remain unmeasured. If an
overlay actually replaces moved behavior, the issue requires its migration and criterion proof
in that PR; this drafting job changes none and authorizes no repair or waiver.

## What this drafting job actually ran

- `git rev-parse HEAD` returned the base above; initial `git status --short` was empty.
- Node reported `v24.22.2`; filesystem checks found **no** `node_modules`, `packages/hub/dist`, or
  `packages/cli/dist` in this checkout.
- The exact eight-path affected command above was attempted once. It exited **1 before selecting
  or running checks**, with:

  ```text
  Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typescript' imported from <checkout>/scripts/affected.mjs
  ```

  Result: **BLOCKED environment; zero test/plant/overlay results obtained**, not a behavioral FAIL
  or PASS. No WIDE or INCONCLUSIVE lines were emitted because runner initialization failed; their
  absence is not proof that nothing was omitted. No install, build, wide suite or retry followed.
- Static inspection of `scripts/known-failures.json` found no entries for the eight selected files.
  It does contain unrelated known test/lint failures; selection includes lints. Historical
  acceptance `BASE-FAILURE.txt` files concern earlier bases, not a measurement of this base.

Open for delivery: actual before/after results, fault detections/overlay viability, and the
candidate's move-only/API/import-edge review. Inherited proof debt must be disclosed and handled
by the approved process, not relabeled PASS. No unrelated seam completion is demanded here.
