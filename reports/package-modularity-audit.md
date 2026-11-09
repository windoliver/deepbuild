# Package audit: KISS, modularity and extensibility

Base: `c12a65bb`, plus the working tree present when this audit started. Existing edits were preserved; they are not attributed to this audit.

PR packaging: this work is submitted as a blocked draft, not a merge-ready change. The PR excludes the unrelated edits that preceded the audit, including the export removals in `checks-work/src/run.ts` and `supervisor/src/seatbelt.ts`. Reported checks ran on the composite working tree, not this isolated PR tree; the isolated tree needs verification. At packaging, the base was 762 commits behind the local `origin/main` reference, and it was not rebased. Historical “no commits” statements below describe their respective work sessions.

## Scope and limits

Inventory: 32 npm workspaces, 34 Rust workspace crates, and four independently installed channel packages. Reviewed manifests and package cards throughout, with focused implementation/caller/test review of the TypeScript coordination, process, capability and extension boundaries and Rust dependency/entry-point structure. This is **not** a line-by-line correctness or security certification of all 66 workspaces. Rust rendering behavior, platform parity and live integrations remain unverified.

Design anchors: technical-design.md sections Architecture, Building blocks, Composition, Socket roles and contract versions, and How we know version 0 works. Preserve the four invariants, independent checks, public package boundaries and the distinction between trusted modules and plug-ins.

## Fourth follow-up: environment ownership fixed; verification gaps narrowed

Test capacity became available, so the previously queued cases could finally run. New evidence supersedes the unrun status below for the doctor mappings and disable/start race.

| Requirement | Change | Failing-before → unchanged-after proof |
|---|---|---|
| Disabling a load cleans an environment whose startup finishes during removal | `host.ts` tracks each load's bounded starts and cleanup closures, retains that generation's handler and cleans a stale returned handle | `environment-late-start.test.ts` failed at the exact-handle cleanup assertion (`[]` instead of the started handle); passed unchanged after the fix |
| Active environments cannot outlive disable, and repeated caller cleanup is idempotent | Removal drains starts and runs the owning load's `down` closures before dropping its handlers; callers share the same cleanup promise | New `environment-handles.test.ts` failed at the same exact-handle assertion; passed unchanged, including refused later startup and closed health port |
| Published doctor codes are recognized | The earlier `job_failing` and `notifications_off` mappings | All three cases in `doctor-codes.test.ts` now passed; expected before failures were saved in the second follow-up |

The green focused run was **5 tests in 3 files**. Both lifecycle tests use the real host, record, supervisor, installed release package and kit reference; no internal host method is mocked. Logs are `/tmp/deep-audit-final-pass/baseline.log`, `handles-red.log`, and `lifecycle-green.log`. The existing `environment-runtime.test.ts` with its obsolete `.reference` fixture was not edited or bypassed. Its failure remains open.

### Timeout regression is not closed

The follow-up `environment-timeout.test.ts` first demonstrated that a timed-out provider stayed selectable after the initial lifecycle extraction. The catch path now unpublishes an overran load, preserving the earlier timeout behavior. Its next run passed the rejection/unpublish checks but failed the final handle comparison: the test's `stopped.json` still held an install-kit handle, and its existence wait returned before runtime cleanup wrote the runtime handle. This is a defect in this newly written regression, not proof that cleanup succeeded or failed. The failing test is preserved unchanged; fixing its fixture needs an approved test correction, not a production special case. Logs: `timeout-red.log`, `timeout-green.log`. The active/late-disable regressions still passed in that second run. Timeout cleanup remains **INCONCLUSIVE**, and the timeout correction is not claimed fully verified.

### Affected verification and missing prerequisite

`node scripts/affected.mjs` ran on the extension-host and conformance changes. Its workspace build completed without reported errors (before the subsequent one-line timeout correction). Hub tests then repeatedly failed before startup because **no deep-hook binary exists under this checkout's target/**. This is a specific missing build prerequisite, not an assertion weakened or a baseline failure waived. The run was stopped after preserving partial results: 368 Vitest passes, 104 unlisted failures, 1 known failure and 88 undecided results; Node reported 30 passes, 1 unlisted failure and 2 known failures. These are partial counts, not a finished affected verdict. The follow-up `cargo build --locked -p deep-hook` was attempted through the build throttle and ended **INCONCLUSIVE: no build grant came within 2 min**; nothing was built by that attempt.

Selection, complete logs and partial classification: `/tmp/deep-audit-final-pass/affected.log`, `affected-status.txt`, `partial-results.json`; job logs under `deep-affected-zZOJsK` in the local temp area. Build-prerequisite attempt: `hook-build.log`. Only the affected process and its proven descendants were stopped by PID; a remaining audit descendant was checked against its recorded start time before being stopped. No other session's holder was stopped. No WIDE line was emitted; **55 timed files and 38 by-hand files** remain unrun and are listed in the selection log. The wider suite is still **BLOCKED**, and the timeout correction has not had a completed affected rerun.

This pass closes environment handle ownership on disable—not production warm-stack provider selection. Full capability ownership, probe/proof host@1 migration and warm-stack contract replacement remain open. No acceptance test, golden, contract, known-failure list or throttle limit was changed. Existing tracked changes outside host.ts were preserved byte-for-byte; host.ts retains the earlier shared result validator. No commits were made.

## Third follow-up: verification access is the current blocker

The next baseline (`doctor-codes.test.ts` and `environment-late-start.test.ts`) ran **no tests**: two unrelated Claude sessions still held both machine test slots after more than six minutes in the queue. Their holders were PID 6496 (over three hours) and PID 84028 (over one hour), neither started by this audit. The audit-owned waiting PID 97116 was cancelled, with no descendants, so nothing is left queued to start unexpectedly. Status: `/tmp/deep-audit-lifecycle/status.txt`. Those owning sessions must finish or stop their proof jobs before this machine can verify the next fix; no throttle setting or grant was bypassed.

While inspecting the unrun lifecycle regression, its fixture was corrected to import its conformance reference lazily at up/down rather than during sandbox registration. Its assertions, expected cleanup result and production implementation are unchanged. This test has not executed and is not proof. The lifecycle still needs to demonstrate rejection of stale handles **and** cleanup of the exact old generation's resources before disable completes. No production lifecycle change was made without its failing run.

The contract mismatch was also checked directly: environment@1's current up/down surface does not supply warm-stack keys, per-run cloning, resource ownership or the supervisor-backed served-tree facts. The real warm stack exposes those through `keysOf`, `WarmStack.open/serve/end/containers` and `Serving`. No cast or fallback was added to pretend that replacing one replaces the other. Existing failing tests and contracts remain intact.

## Second follow-up: sandbox root cause and blocked verification

The next pass investigated the blockers rather than treating them all as unrelated baseline noise.

- **Sandbox startup fixed on the current macOS/Node installation.** A new real Seatbelt regression reproduced Node's SIGABRT: dyld could not read `libnode`, and the packaged Node also links libuv/OpenSSL/ICU outside its own directory. `supervisor/src/seatbelt.ts` now permits exact already-loaded `.dylib` paths only when the existing grant permits the host's Node. No folder-wide Homebrew access, native-addon grant or new executable permission was added. When no `OPENSSL_CONF` was supplied, the granted Node runtime uses `/dev/null` rather than implicitly reading host-wide OpenSSL configuration; an explicit setting remains explicit. The same regression passes with both a binary-only and install-directory read grant, proves unrelated data stays unreadable, and proves an ungranted Node cannot execute.
- **Two prior extension-loading failures now pass unchanged:** safe-mode conformance and agent-built versus release-package placement. Together with the new confinement regression, the targeted run passed **3 tests**; **62 other tests in that file were filtered out**, not passed. Logs: `/tmp/deep-audit-closure/node-red.log`, `node-green.log` (intermediate OpenSSL failure), `node-corrected.log` (passed). This is evidence for those cases, not all sandbox backends or all installed Node variants.
- **Doctor mapping omission reproduced and fixed in code:** `job_failing` and `notifications_off` are already published and emitted by the hub, but `conformance/src/families.ts` treated them as unlisted/INVALID. Added their FAIL mappings; `conformance/src/doctor-codes.test.ts` failed on the expected assertions before the edit. Its post-fix check is still **INCONCLUSIVE** for lack of a test grant, so this is not yet a proven closure. No enum or expected result was changed.
- **Existing environment test has an independently identified fixture defect:** `extension-host/test/environment-runtime.test.ts` uses `slotKits().find(...).reference`, while both HEAD and the current implementation supply reference fills through `cleanFills(kit)`/`clean()`. The existing test was left unchanged; adding a production-only alias to appease it would hide the defect. A fresh regression, `environment-late-start.test.ts`, uses the supported public API to exercise a start racing with disable. Its first run received no test grant within 15 minutes and is unrun, so it proves nothing yet and the environment lifecycle implementation was not changed on its strength.
- **Another existing test has stale inputs:** `tests/agent-eval.test.mjs` supplies eight tool names while loading the current skill, which names additional tools. Its mismatch failure is legitimate for those inputs. Neither the scorer nor the test was weakened to claim a pass.

### Second follow-up verification

`node scripts/affected.mjs` was invoked for the sandbox correction and the prior audit changes. The workspace build completed without reported errors. Its Node block then waited on nested timed-grant jobs for over four minutes; the Vitest block and lint jobs had not started. This audit's parent and its proven descendants were stopped by PID, and no other holder was stopped. Deep-app's run reported failures in three targets before the overall affected invocation was interrupted; they remain failures, not silently classified as known. The log is `/tmp/deep-audit-closure/affected.log`, with interruption stated in `affected-status.txt`; build/cargo details are under the `deep-affected-7B9qTJ` directory named by the local temp area. **No WIDE line** occurred; **64 timed files and 49 by-hand files remain unrun** for this expanded selection.

A focused follow-up and the new environment regression were each allowed up to 15 minutes to acquire a test grant. The machine's slots remained occupied by other sessions; no throttle table, limits, tests, contracts or known-failure baseline were changed. Both jobs ended **INCONCLUSIVE: no test grant came within 15 min**, recorded in `/tmp/deep-audit-closure/focused.log` and `late-red.log`. No unrun check counts as PASS. All audit-owned test processes have ended. Diff review passed; 59 pre-existing tracked-file diffs stayed byte-for-byte unchanged, and the earlier unexport of Seatbelt's internal profile was preserved in the one overlapping file.

Full capability ownership, host@1 migration for the probe/proof kinds, warm-stack environment replacement and larger Rust/coordinator refactors remain open as described below. The concrete sandbox dependency failure was closed rather than dismissed as an environmental excuse; further behavior edits still require executable failing-first proof.

## Follow-up: gap fixes and current delivery status

The follow-up request to close the findings authorized fixing the reported conformance ordering. **Not all gaps are closed.** Concrete regressions below were reproduced before edits, then the same tests passed unchanged. No existing test, acceptance fixture, golden, contract or known-failure baseline was weakened. New tests are regression tests, not independently drafted issue-acceptance proof.

| Finding | Change | Before → after evidence | Status |
|---|---|---|---|
| Mixed conformance verdicts | `conformance/src/runner.ts` now orders INVALID above BLOCKED, preserving FAIL first and empty-kit INCONCLUSIVE | `conformance/src/precedence.test.ts`: both case orders failed with BLOCKED before; all 4 cases passed after | Fixed; full conformance verification remains blocked below |
| Probe reports can throw without settling, or claim success without fields | Shared `conformance/src/result.ts` shape validator, reused by numbers, work and extension-host; probe parsers catch malformed JSON and return failed/non-assertion results | `tests/probe-report.test.ts`: 10 bad-report cases failed before, including two unsettled promises/uncaught parse errors; all 12 cases, including successful twins, passed after | Fixed; does not change process ownership |
| Workspace API follows an unnamed origin | Disable automatic redirects; the named endpoint and its existing 10-second timeout remain | `workspaces/test/api-origin.test.ts`: unapproved server received 1 call before, 0 after; direct repeated reads still return fresh state (2 tests passed) | Redirect gap fixed; full capability routing still open |
| Archive follows an unnamed origin and stores its own injected credential | Manual same-origin redirects, at most five; include the forge credential in evidence's existing value scrub | `archive/test/forge-boundary.test.ts`: off-origin call and secret-in-evidence assertions failed before; both passed after, with same-origin log redirects and ordinary output retained | Redirect/redaction gaps fixed; full capability routing still open |
| Archive's outside call can wait forever | One 10-second abort signal covers redirect chain and body consumption | `archive/test/forge-deadline.test.ts`: still pending at 12 seconds before; refused within the budget after; no ci.archived event | Fixed per-call deadline; not a whole-pass deadline |
| Stale package cards | Correct actual dependencies in deep-canvas-seams and deep-canvas-test-modules; name resolver-decisions' existing regression test | Manifest/import and diff review; no Rust code changed | The three named documentation gaps closed |
| Previous runner extraction lacked build verification | Included runner files in the affected invocation | `npm run build --workspaces` completed without reported errors; runner included | Build gap closed; broader runtime proof not clean |

The shared validator is one small shape check with three current callers, extracted from the extension host's existing check. It computes no verdict and adds no dependency. The host loads it lazily, preserving its startup import boundary. Separate test oracles remain separate.

### Verification and blockers for this follow-up

- Focused red/green: **21 tests passed in 5 files** after expected assertion failures were saved. Test throttle granted execution; the lease wrapper reported no configured hub and ran unleased.
- Workspace build: completed through `scripts/affected.mjs`, including TypeScript compilation and native helper build steps. This does not typecheck every repository test file.
- Combined affected selection: 258 parallel Vitest files, 7 Node files, 454 alone Vitest files, 58 timed files and deep-app. **No WIDE line** for this combined selection: changing conformance's public entry reaches the hub broadly. The earlier WIDE 557 count below belongs only to the prior runner-only invocation.
- **BLOCKED delivery / incomplete affected run:** stopped after unlisted failures rather than continuing to refactor or retrying until green. Partial machine reports contained 65 Vitest passes, 81 failures not listed in the baseline and 7 undecided results; Node reported 30 passes, 1 unlisted failure and 2 known failures. These partial counts are not a completed suite verdict.
- Examples: sandboxed extensions exited with SIGABRT before registration; `tests/agent-eval.test.mjs`'s skill-version check failed; conformance lint reported `notifications_off` without a verdict mapping and environment probes failing on lsof; repo rules reported pre-existing personal-path/dependency-list findings outside these changes. Existing known failures were classified separately using `scripts/known-failures.json`, which was not edited. Unlisted does not establish that this patch caused a failure; causality is unproven.
- Completed lint outputs contained 38 unlisted repo-rule findings and 10 unlisted conformance findings (plus 2 known conformance findings). Other lint jobs, the alone block and deep-app's test execution did not complete. **58 timed files and 46 by-hand files are unrun.** No full preflight was attempted.
- Only this audit's affected process and descendants proven by the process table were stopped, by PID. No other session's build/test holder was stopped. All selected tests and checks remain present and enabled.
- Evidence is local under `/tmp/deep-audit-gaps/`: `precedence-red.log`, `api-red.log`, `forge-red.log`, `deadline-red.log`, `probe-red.log`, `fixes-green.log`, `affected.log`, `affected-status.txt`, and `partial-results.json`. The status sidecar explicitly records interruption; it is not a fabricated completed affected verdict.

### Still open—not silently replaced with a weaker goal

1. **Full capability ownership:** archive/workspace calls still do not share account quotas, secret handles or refusal-event accounting with the extension host. The current polled-source API only produces numeric/series readings; routing arbitrary forge JSON/logs through it with a fabricated numeric reading would be incorrect. A raw-response capability boundary needs a separately reviewed contract and tests for both existing consumers. The fixes above mitigate concrete bugs but do not close this architectural finding. Off-origin forge download redirects now fail closed; deployments needing a separate download origin need an explicit grant, not an implicit exception.
2. **host@1 probe/checker execution:** CheckContext's public surface contains checkout, deadline and clock, but no host; sandboxed packages cannot receive callable host objects across JSON-RPC. Preserve the standalone check tests and establish the intended installed process boundary before changing it. No fallback to unsupervised execution is presented as a solution.
3. **Environment replacement:** environment@1's up/down handle does not supply the warm-stack lifecycle needed by the hub. No unsafe cast, new unapproved contract, or default that silently falls back to env-local was added.
4. **Remaining coordinator extractions and Rust cohesion:** stopped while required broader regressions are failing. The runner extraction and shared result shape are the applied modularity improvements; large-file line counts are still recommendations, not proof of defects fixed.
5. **Verification failures:** resolve the reported sandbox/environment and repository checks before claiming the whole change passes. Do not bless them as new known failures or change assertions to finish.

The sections below retain the original audit and its first-pass evidence; their recommendations are historical where the follow-up table supersedes them.

## Main findings, in priority order

1. **Capability ownership is inconsistent.** `packages/archive/src/index.ts`'s `forgeRuns` calls `fetch` with an environment token; `packages/workspaces/src/index.ts`'s API source calls `fetch` directly. Neither call site goes through the extension host's source/quota/secret machinery. The archive call also has no explicit timeout. This is a design-boundary finding, not a demonstrated exploit. Next: route these two outside readers through the existing capability owner; prove refused hosts, deadlines, quota accounting and secret redaction before replacing either path. Do not add a second HTTP abstraction.
2. **Process lifecycle is duplicated outside host@1.** `checks-numbers/src/run.ts` and `checks-work/src/run.ts` independently spawn probes, accumulate output, enforce deadlines and kill their process groups; `proof/src/run.ts` spawns checkers synchronously. Compare with `checks-command`, which receives host@1. The two probe runners also parse their final JSON inside a `close` callback without handling malformed JSON. Next: first prove the actual installed execution boundary and failure behavior, then use the existing host where the contract allows it. Merely factoring their duplicate code into a utility would preserve the ownership problem.
3. **Environment replaceability stops short of production wiring.** `hub/src/stacks.ts` accepts `StackEnvironment`, and `extension-host/src/host.ts` exposes an installed environment. But `hub/src/core.ts` still constructs the stack lifecycle from env-local, including `WarmStack`; it opens the extension host with `release: []`. The README already discloses this limitation. The installed environment contract does not itself supply the full warm-stack interface: do not cast one into the other. Next: establish the required lifecycle contract and prove a replacement through the real hub command, including cleanup and stale-generation refusal.
4. **Verdict ordering has drifted between implementations.** `conformance/src/runner.ts` orders `FAIL > BLOCKED > INVALID > INCONCLUSIVE > PASS`; `verdicts/src/engine.ts` and `gate/src/scheduler.ts` put INVALID above BLOCKED, as the design does. The slot runner also calls conformance's `worst`. Do not silently change a conformance check in a cleanup. Resolve the intended kit semantics with an approved criterion and a failing mixed-outcome case first; then centralize only the ordering that really is shared. Keep the independent test/Lean reference independent.
5. **Large coordinators hide several ownership boundaries.** The largest immediate candidates are `hub/src/core.ts` (7,001 lines), `extension-host/src/host.ts` (3,809), `asks/src/index.ts` (2,545), and, in Rust, `deep-scene3d-render/src/lib.rs` (6,814) and `deep-canvas-marks/src/scene.rs` (5,399). These are physical line counts, including comments/tests, not complexity scores. Extract a concern with a narrow data interface and its own lifetime, not arbitrary chunks or a generic service container.
6. **Package cards have drifted.** Examples: deep-canvas-seams says serde_json only but declares deep-canvas; deep-canvas-test-modules says it never imports another module but declares deep-canvas-sandbox; resolver-decisions says it has no test directory but has `test/resolver.test.ts`. These are documentation findings, not grounds to remove needed dependencies or tests.

## First hill-climb applied

`packages/runner/src/agents.ts` now owns the existing launch-policy table and its version, account, sign-in, confinement, window and refusal readers. `runner.ts` keeps job orchestration, budgets, snapshots and process ownership.

- `runner.ts`: **1,342 → 1,136 lines**; the extracted module is 218 lines. Total code grows slightly from the import boundary and local shape guards; this is an ownership improvement, not a claimed LOC reduction.
- The extracted module has no runtime workspace dependencies and starts no process. Dependency direction is runner → agent policy → type declarations; no back-import of the runner.
- No new package, dependency, option, configuration key, registry framework or public package export.
- Existing internal helper imports remain supported by re-exports, so tests are unchanged. The public `src/index.ts` is unchanged.
- Result-stream parsing still branches by agent in `runner.ts`; this change does **not** claim complete adapter extensibility. A later extraction must be justified by a real additional parser/caller and preserve transcript-derived state.
- `packages/runner/README.md` names the new boundary.

Why not an extension? This is an internal separation of the trusted runner's existing confinement policies, not a new feature in the kernel. Allowing a plug-in to choose its own sandbox policy would weaken the existing ownership boundary.

## TypeScript package-by-package disposition

“Keep” means no structural change justified by this review, not a behavior PASS. Paths in this table are under `packages/`.

| Package | Disposition / next smallest useful step |
|---|---|
| adapters | Keep registry/types/shipped-policy separation. Repo-level facts-engine imports are documented packaging debt; move them only with a packaging consumer and corpus parity proof. |
| archive | Keep transcript traversal facts-driven. Separate forge transport through capabilities before expanding its providers; retain record-backed deduplication. |
| asks | Extract settings/parser ownership before further growth, preserving `AskRefused` identity and the public entry without a back-import cycle. Keep authorization and resolver validation in the core. Existing `errorTurnHook` injection is preferable to another agent-name switch; its shipped fallback still creates a second registry for standalone callers. |
| budget | Keep one ledger and its shared per-record decision queue. Do not split reservation/charge state or replace exact micro-dollar arithmetic in a style refactor. |
| buying | Keep the injected processor and existing ledger. No payment SDK or second authorization path is warranted. |
| checks-command | Keep host-owned execution and reporter separation. New test frameworks extend reporter/listing behavior, not gate semantics. |
| checks-numbers | Review probe execution ownership with checks-work; keep numeric and timing semantics distinct. No generic check-runner framework yet. |
| checks-review | Keep diff extraction, model independence and outcome filtering separate. Do not turn reviewer prose into a verdict. |
| checks-work | Keep kinds as slot fills. Address the probe lifecycle/final-report boundary before sharing runner code with numbers. |
| cli | Keep thin dispatch and lazy imports. Command policy belongs in its owning package, not more branches here. |
| config-eval | Keep archive, replay recording and launcher distinct. The replay sandbox has different permissions from ordinary jobs; do not merge launchers just because both spawn agents. |
| conformance | Keep kits per slot and the central runner. Resolve the ordering discrepancy by approved proof; do not import fills into the runner or unify independent oracles with production code. |
| contracts | Keep generated types out of handwritten complexity counts. Runtime entry also exposes code generation/schema tooling; add a smaller runtime entry only with measured startup cost and real consumers. |
| env-local | Keep cold/warm stack ownership here, never in the scheduler. Replacement requires the hub wiring described above, not merely an interface rename. |
| evidence | Keep store, intake and scrub separated and dependency-free. Preserve ported license notices and independent redaction tests. |
| extension-host | Next extraction candidate: HTTP ingress framing/body limits, while the host retains trust checks, active-generation checks and unload ownership. Sources, sends, series and terminals already have useful boundaries. |
| gate | Keep scheduling pure and execution separate. The scheduler's closed `Agent` union is further capability-driven design debt; change it only with adapter-neutral scheduling tests. Preserve snapshot ownership. |
| hub | Highest coordination debt. Extract one cohesive lifecycle at a time (spool replay or evidence attachment are candidates), passing narrow callbacks/data rather than the entire Core. Preserve init/restart ordering. |
| leases | Keep one table and data-declared resource kinds; resource-specific behavior must not become new branches in the kernel. |
| otlp | Keep wire decoding separate from event mapping. Optional receiver is not production-wired according to its card; do not call it replaceable merely because its API exists. |
| paseo | Keep independently installable, socket-only runtime. Its real implementation is in `server/`, not just the six-line entry; preserve ordering and owner-gated delivery. |
| pi | Keep independently installable and socket-only. `tools.mjs` reaches the hub's build output at build time, a documented exception—not a runtime core dependency. No harness changes made. |
| proof | Keep Lean/Kani reporting separate. Review process ownership and working-copy cleanup before extending toolchains; never consolidate proof oracles with the implementation they judge. |
| reading | Keep handle resolution and quote validation separate from jobs. The runner is a dependency, never a reverse caller. |
| readings | Keep pure event/transcript folds with no runtime workspace dependencies. Its index/impl seam is used by blind twins; it is not a redundant barrel to delete. |
| record | Keep append, projections, lifecycle, learning and trust distinct. Preserve the database-free IDs entry and event-only projection rebuilds. |
| resolver-decisions | Keep proposal generation outside the asks gate. Numerical standing-rule judgment is already isolated; update the stale test-directory card separately. |
| runner | **Applied:** launch policies extracted with no public API change. Next possible step is result decoding, not a generic provider framework. |
| supervisor | Keep one process owner and platform backends behind its seam. CA generation and request mediation share `egress.ts`; extract only if it reduces boundary coupling, not merely line count. |
| verdicts | Keep pure selection/judgment separate from persistence and display. Deduplicate production ordering only after the conformance semantics are settled; never reuse engine logic in its reference oracle. |
| wiki | Keep pages as the source and indexes replaceable. Preserve provenance and learned-layer authorization; avoid a second store for index state. |
| workspaces | Git, state sources and kit fixtures share a small file; size alone does not justify a package split. Outside API calls need capability ownership; preserve source-specific compare/undo behavior. |

### Independently installed channels (not npm workspaces)

| Folder under `packages/channels/` | Disposition |
|---|---|
| chat | Keep transport-only; hub owns rendering, credentials and answer proof. |
| email | Keep transport-only and independently installable. |
| paseo | Keep transport and signed answer payload separate from authority verification. |
| text | Keep transport-only; delivery/acknowledgement must remain explicit. |

The small repeated protocol is deliberate: each directory is copied alone at install. A relative shared helper would break that boundary; generating or bundling one is unjustified without a concrete maintenance need.

## Rust crate-by-crate disposition

Structural review only: Cargo metadata, cards and selected public roots/hotspot structure. No Rust source was changed and no Rust behavior, GPU or platform test was run for this refactor. Paths are under `crates/`.

| Crate | Disposition / next boundary to protect |
|---|---|
| deep-contracts | Keep generated contracts and small runtime; the 61k-line generated file is not a refactor target. |
| deep-canvas | Keep dependency-free of workspace modules. Review registry/document submodule cohesion before adding more core concepts; new behavior normally belongs in a registered module/pack. |
| deep-canvas-seams | Keep interfaces/backend identity separate from platform implementations; reconcile the card with its actual deep-canvas dependency. |
| deep-canvas-cells | Keep pure emulator separate from PTY/process I/O. |
| deep-canvas-effects | Keep graph/check/emitter/interpreter separate from GPU execution. Do not share oracle code merely to remove duplication. |
| deep-canvas-graph | Keep layout/routing/labels pure; rendering stays outside. |
| deep-canvas-loop | Keep defect checks independent of repair/remeshing and GPU output. |
| deep-canvas-marks | `scene.rs` is a cohesion hotspot: consider draw-list traversal versus paint/layout evaluation, preserving allocation/content-key behavior. |
| deep-canvas-motion | Keep compilation versus evaluation explicit; split parsing families only with unchanged timing/canonical-output tests. |
| deep-canvas-record | Keep salience/zoom as data transforms; no hub or database coupling. |
| deep-canvas-sandbox | Keep validation/rewrite separate from the runtime engine and host services. |
| deep-canvas-scene3d | Keep CPU evaluation distinct from renderer; scene/builders are next internal cohesion candidates. |
| deep-canvas-sheet | Keep candidate comparison and sheet geometry separate from the trusted question card. |
| deep-canvas-test-modules | Preserve planted faults and feature gates. Reconcile its sandbox dependency with the outdated card; never delete fixtures as dead code. |
| deep-canvas-vector | `svg.rs` is a parsing hotspot; isolate CSS/reference resolution only while preserving diagnostics and unsupported-feature refusals. |
| deep-codecs | Platform backend boundary exists. Consider helper protocol versus media parsing/muxing before expanding `lib.rs`; preserve sandbox entry order. |
| deep-hook | Keep shell parsing separate from guard matching and spool transport. Regex consolidation without adversarial corpus proof is unsafe. |
| deep-app | Keep trusted card/input/capture in the shell; view implementations must not become additional authority paths. |
| deep-effects-render | Keep GPU compilation/cache/execution separate from effect definitions and reference calculations. |
| deep-gpu | Keep device, surfaces/fences, cache, upload and encode ownership explicit. No app or renderer back-dependency. |
| deep-gpu-layer | Top-level proof binary legitimately composes many crates. Do not push test/scenario dispatch into runtime libraries to reduce its size. |
| deep-marks-gpui | Keep thin adapter; geometry stays in marks. |
| deep-marks-render | Keep proof/render hosting at the top; shared Vello drawing already has an owner. |
| deep-marks-vello | Keep draw-list translation shared by the two CPU renderers; do not pull text shaping into it. |
| deep-motion | Keep proof CLI thin; motion evaluation stays in its module crate. |
| deep-panel-host | Keep process isolation and JIT-off bootstrap; sharing UI code must not share authority. |
| deep-relay | Keep protocol, relay service and platform network backend distinct; transport must not learn game state. |
| deep-replica | Keep app driving/observation separate from app state. Test-support dependency direction is intentional. |
| deep-sandbox-wasmtime | Keep engine-specific execution behind sandbox@1; rewritten-program semantics belong to the sandbox module. |
| deep-scene3d-render | Strongest Rust extraction candidate: `lib.rs` holds batch/cache resources and a large renderer implementation. Split by resource/pass lifetime with existing pixel and planted-fault tests, not a new render framework. |
| deep-show | Large composition/proof host. Keep module build-set registration explicit and test features gated; extract cohesive command families internally, not a new crate per subcommand. |
| deep-text | Keep bundled-font shaping/atlas/cache independent of GPUI and system fonts. |
| deep-text-gpui | Keep thin drawing adapter; no duplicate shaping/cache ownership. |
| deep-text-render | Keep proof binary at the top, not a dependency of the shaper. |

## Requirement → change → proof

| Requirement | Change or review | Evidence / limit |
|---|---|---|
| Package-by-package audit | Inventory and dispositions above | Manifests/cards reviewed; source depth is explicitly limited, especially for Rust. |
| KISS | Reused the existing agent-policy table, no new framework or package | Diff review; public entry unchanged; no new runtime dependency. |
| Better modularity | Separate runner launch policy from job lifecycle | 18 moved declarations and the pi policy compared exactly to HEAD, ignoring export modifiers/comments; every remaining lifecycle statement compared unchanged. |
| Preserve behavior | Existing tests kept unchanged | Focused `packages/runner/test/codex-versions.test.ts`: **16/16 passed**, including confinement's certificate-read case. This is regression evidence, not a complete runner acceptance result. |
| Preserve others' work | Edited only runner files and added this report | All 49 pre-existing tracked-file diffs compared byte-for-byte unchanged against the saved initial patch. Existing untracked files were not edited. |
| Verify relevant impact | `node scripts/affected.mjs packages/runner/src/runner.ts packages/runner/src/agents.ts` | See verification status below. |

## Verification status

- Initial focused baseline attempt: **INCONCLUSIVE**, no test grant within one minute; no tests ran.
- Post-refactor focused test: 1 file, 16 tests passed. The test throttle granted execution; `scripts/lease` reported the hub was not set up, so the run was **unleased**.
- Existing `tests/package-deps.test.mjs`: **2/2 passed**, checking declared workspace imports and no relative cross-package imports in `src/`. Its scope does not cover pi's build script or paseo's non-src layout. This run also held a test throttle grant but was unleased because the hub was not set up.
- Static checks: TypeScript parser reported no syntax diagnostics for either module; `git diff --check` passed for the runner change. These are not a typecheck or behavioral proof. The report inventory was checked to include all 32 npm workspaces and 34 Rust crates.
- Ad-hoc runtime import scan: 302 pre-change JS/TS/MTS/MJS files under packages, excluding dist/node_modules/test/kit directories and test files; no multi-file or cross-package cycles found. The scan left the documented repo facts-engine imports and pi build-time tools import unresolved. It is not a new repository gate or proof of all dynamic imports.
- Cargo offline metadata: 34 workspace crates, no cycles in normal local dependencies (dev-dependencies excluded). No Rust compilation performed.
- Affected selection reports **WIDE 557** additional suites reachable through another package's process, and **8 timed files**. Neither group is included in the normal run; live/by-hand cases are also unrun. No full preflight or release check was requested.
- **INCONCLUSIVE affected verification:** cancelled after more than five minutes waiting for its workspace-build grant. Only this audit's affected process and its waiting child were stopped, by PID. No affected build, test or lint job completed; the focused runs above are separate evidence. Full typecheck, broader regressions, timed/live checks and WIDE suites remain unrun. No all-green or release-readiness claim is made.
- Local logs (outside the repository): `/tmp/deep-modularity-audit/runner-before.log`, `runner-after.log`, `package-deps.log`, `affected.log` and `affected-status.txt`. The affected log contains the full WIDE selection; cancellation status is recorded in the sidecar, not represented as a completed runner verdict.

## Next hill-climb order

1. Finish affected verification of this extraction; retain it only with its limitations visible.
2. Resolve the conformance-order discrepancy under an approved test proposal; it changes a check, not just layout.
3. Put the two outside readers under existing capabilities, one issue at a time, starting with refusal/deadline tests.
4. Establish the real environment replacement contract and prove it through the hub.
5. Extract one extension-host ingress concern, then one hub lifecycle concern; require unchanged real-component regressions and measured dependency reduction each time.
6. Address Rust renderer/scene cohesion only when GPU/CPU parity and resource-lifetime checks can run. Stop splitting when a change only moves lines or requires a bag of callbacks exposing the old owner's entire state.

In the original audit pass, no acceptance test, golden, contract, decision, check implementation or known-failure list was changed. The follow-up above changes conformance aggregation and probe report validation under the request to close those findings, with new failing-first regressions; existing checks/tests and their expectations remain intact. No commits were made. Remaining recommendations and verification blockers are explicit above.
