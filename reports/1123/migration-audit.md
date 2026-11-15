# #1123 blind assessment — base 092754bb1

## Result and limits

**No audited small folder is cleared to move unchanged. No migration is proposed.**
This is a source audit, not a parallel-run PASS. No implementation, existing test,
helper, check, decision or lane list was changed. Inputs were the supplied issue,
AGENTS.md, the technical design's proof/Dogfooding rules, parallel-proof §§5/7/7a,
and this base archive. No other checkout, transcript, diff or history was read.

The issue's 125 entries / 85 folders / 557 s are historical readings, not this
archive's inventory. Loading this base's `scripts/lanes.mjs` counted **397 alone
entries, 322 ending in `/`, 165 timed entries**, and exclusive folders 16, 315, 236.
“Up to 29” is an upper bound on qualified moves, not permission to choose 29 or a
requirement to invent one. Zero moves is **not a speed improvement** or AC1 proof.
This focused inventory is not a certification of all 322 folder entries.

Paths below are relative to `tests/acceptance/` unless explicitly repo-relative.
`T` means the checkout's `target/`, or the helper's inherited `CARGO_TARGET_DIR`
where it supports that variable; `tmp` means a fresh test-owned temporary folder.

## Small candidates: actual calls, not import/grep classifications

| Folder / exact test files | Reached build or binary path | Assessment without a redraft |
|---|---|---|
| `374/{paint,steps,stroke}.test.ts` | `374/helpers.ts:useRenderBinary` builds `deep-canvas-render`; `batch` executes `target/debug/deep-canvas-render` directly | **Unsafe:** shared executable, no private copy or `DEEP_BIN_DIR` reader. |
| `376/{refusal,replica}.test.ts` | `376/helpers.ts:useShow`: cargo `deep-show`, `--no-default-features --features full`; `target/debug/deep-show` → `tmp/deep-show` | **Unsafe:** copy-after-build race (below), not a run-private build. |
| `497/{held,refusals,late-entries}.test.ts` | `497/helpers.ts:useBinary`; first two build `deep-show` with `full,test-held`; last builds `deep-motion`; `T/debug/<name>` → `tmp/<name>` | **Unsafe:** every file still builds through the shared path. Held-array tests use virtual time, not machine budgets; the blocker is the build, not their time vocabulary. |
| `490-oracle/{interval-itf1788,rate-functions-manim,tables-numpy-scipy}.test.ts` | `490-oracle/helpers.ts`: `deep-show` with `core`; rate-functions also `deep-motion`; `T/debug/<name>` → `tmp/<name>` | **Unsafe:** independent numeric oracles do not isolate the binary handoff. |
| `490-oracle-redraft/eases-bevy.test.ts` | Its own `beforeAll`: cargo `deep-show` with `core`; `T/debug/deep-show` → `tmp/deep-show` | **Unsafe:** the existing redraft is not a binary-tooling redraft. |
| `490-redraft-2/opening.test.ts` | Its `buildTo`: `deep-show` with `full` and `full,test-ease-renumbered` through `T/debug`; copied to distinct names. Base separately built in `target/acceptance-490-redraft-2-base/<sha12>/target/debug/deep-show` | **Unsafe:** distinct final names do not protect the candidate/plant build-to-copy interval; also preserves an intentional separate base build. |
| `492-gaps/{world-remap,corpus-join}.test.ts` | `492-gaps/helpers.ts:useBin`: cargo `deep-motion` / `deep-show`, executed directly from `T/debug` | **Unsafe:** shared readers and writers. |
| `493-redraft-ac7/defaults.test.ts`, `493-redraft-ac12/place.test.ts`, `493-redraft-ac18/match-cut.test.ts` | Each folder's `helpers.ts:useMotion`: cargo `deep-motion`; `T/debug/deep-motion` → `tmp/deep-motion` | **Unsafe:** all three still share the build path. Their unused show builders are not the reason. |
| `777/{app-budget,step-down}.test.ts` | `777/helpers.ts:useBuild`: cargo `deep-gpu --features test-meter`; `target/debug/deep-gpu` → `tmp/deep-gpu-test-meter`; `run --backend noop` | **Unsafe:** binary handoff. These are stub-meter/virtual-clock tests, **not** real GPU wall-time budgets despite the filename. |
| `1963/{code,formula}.test.ts` | `1963/helpers.ts:useRender`: cargo `deep-canvas-render`; `T/debug/deep-canvas-render` → `tmp/deep-canvas-render` | **Unsafe:** both files still build and copy without an inter-file lock. |
| `1957/dependencies.test.ts`, `1961/{orphan,versions}.test.ts` | Respective `helpers.ts:buildTo`: cargo `deep-show` with `r1`; `T/debug/deep-show` → test-owned copy | **Unsafe:** `r1` must not be replaced by another feature set; same handoff race. |
| `2015/faces.test.ts` | `2015/helpers.ts:useShow`: cargo `deep-show` with `full`; `T/debug/deep-show` → test-owned copy | **Unsafe:** same shared build/copy path; no environment reader. |
| `467-redraft-ac2/status.test.ts`, `1964/{subscript,refusal}.test.ts` | Both reach `467/helpers.ts:useBin('deep-canvas-render')`, directly or through `1964/helpers.ts`; cargo then copy from `T/debug` | **Unsafe:** no cargo in the test body does not mean no cargo in the test. CPU rendering does not fix the handoff. |
| `149-redraft-ac5/seek-equals-play.test.ts`, `149-redraft-ac10/target-bytes.test.ts` | `430/helpers.ts:useGpu`: cargo `deep-gpu`; `T/debug/deep-gpu` → copy; then real Metal | **Unsafe:** hidden shared build; platform/GPU requirements must also remain. |
| `268-redraft-ac4/movers.test.ts` | `268/helpers.ts:useGpu`: cargo `deep-gpu`, shared `T/debug` then copy | **Unsafe:** hidden build; the test itself measures no wall-time budget. |
| `1312/repro.test.ts` | `1312/helpers.ts:useGpu`: shared `T/debug/deep-gpu` then copy; Linux adds `-p deep-gpu-layer --features wgpu/vulkan` | **Unsafe:** platform-specific build variants and shared handoff; `1312/operator.rs` is a separate Rust target, not a Vitest migration. |
| `531-redraft-ac12/ac12-threads.test.ts` | `531/helpers.ts`: cargo `deep-logic` through `T/debug`; assembler at `T/acceptance-531-wat/debug/acceptance-531-wat` | **Unsafe:** both builds are shared with #531, despite this folder having no cargo call. |
| `545-redraft-ac3/ac03-linear-writes.test.ts`, `545-redraft-ac5/ac05-seek-blend.test.ts` | `545/helpers.ts:logicBin`, `assemble`: shared `T/debug/deep-logic` then copy; assembler at `T/acceptance-545-wat/debug/acceptance-545-wat` | **Unsafe:** hidden builds; a private logic copy alone would miss the assembler. |
| `1348/{fixture,plants}.test.ts` | `1348/helpers.ts:lane` executes the `plain words` commands in `scripts/lanes.mjs`: cargo `deep-plain-words` (`deep-replica`, `env-plants`), then `T/debug/deep-plain-words` | **Unsafe:** transitive cargo through a real lane, not a build-free test. |
| `1022/{compact,replay,slash}.test.ts` | `1022/helpers.ts:hook`: direct `target/debug/deep-hook`; built CLI at `packages/cli/dist/main.js` | **Unsafe:** no cargo call, but no immutable hook. `deliver` also has a load-dependent INCONCLUSIVE path; do not discard it. |
| `1507/reach.test.ts`, `1862/rounds.test.ts`, repo-relative `packages/github/test/github.test.ts` | `1507/helpers.ts`, `1862/helpers.ts` → `1537/helpers.ts` → `322/helpers.ts`, and `46/helpers.ts:CURRENT`, respectively: direct `target/debug/deep-hook` plus built CLI | **Unsafe:** prebuilt does not mean immutable; the helpers do not read `DEEP_BIN_DIR`. |
| `994/deadline-redraft/deadline.test.ts` | `994/helpers.ts:setUpWorld/openAsk` → `27/helpers.ts:setup/beginAsk`; setup resolves and probes a checkout hook, can build it if missing/outdated, and writes that path into hook entries | **Unsafe:** not build-free merely because it never calls `appBinary`. Uses stepped hub time, but has a real hook dependency. |
| `884/search.test.ts` | `26/helpers.ts:startHub`, `355/helpers.ts:makeWorld/withRecord/unboundMcp`; Node runs `packages/cli/dist/main.js` | **Not cleared:** its imported `355/buildHookBinary` → `316/buildDeepHook` is **never called**, but current hub startup itself reaches the checkout hook (chain below). |
| `1328/{job,dispute}.test.ts` | `1328/helpers.ts:Stage.open`: built CLI; own temp roots, fixture repos, fake drafting agent, guard subprocess; supervisor's `packages/supervisor/dist/helper` | **Not cleared:** no test-side cargo, but current hub startup reaches the same checkout hook; real sandbox-denial observations also need concurrency proof. Its base-failure file explicitly says NOT RUN. |
| `1143/{criteria,plants}.test.ts` | `1143/helpers.ts`: real repo-rules, nested events Vitest; criteria AC3 runs `cargo clippy --workspace --all-targets` into checkout `target/`; plants copy the checkout | **Not a qualified binary-only move:** it checks a real workspace build/lint, not a binary consumer replaceable by `DEEP_BIN_DIR`. No proof establishes its sole serialization reason; do not treat the two files as a tiny build-free suite. |

**Copy-after-build is insufficient:** these helpers release cargo's target lock when
cargo exits, then copy `target/debug/<bin>`. Another file can rebuild/rewrite that
path between those operations. The final copy is private; obtaining the correct
bytes is not protected. None of these helpers consumes `DEEP_BIN_DIR`. Cargo's
lock does not cover the later JavaScript copy. Changing those builders/consumers
requires the separate blind jobs; no such redraft is drafted here.

**Hidden hub dependency at this base:** `packages/hub/src/core.ts:init` awaits
`products.open()`; `packages/hub/src/products.ts:open/secure` calls its guard;
core's guard callback calls `deepHook()`; `packages/hub/src/paths.ts:deepHook`
selects the newest checkout `target/{release,debug}/deep-hook` (or an installed
optional platform package); `packages/hub/src/guards.ts:addGuards/matches`
executes it. The tests do not provide an immutable installed hook. A private
`DEEP_BIN_DIR` set only by lane tooling cannot redirect this reader. Do not infer
that #884 is safe from its older README's Node-only setup or from unused imports.

## Gates that binary tooling must not remove

- Keep `tests/acceptance/236/` exclusive, not just in a shard. Its `helpers.ts:bins`
  already compiles `probe`, `tree`, `devices` into a fresh `/tmp/dh236-bin-*`;
  `contain.test.ts` AC4 still waits for `sandbox.denied` naming its run/path via
  `world.ts`'s real supervisor. `packages/supervisor/src/supervisor.ts` reads the
  machine's `/usr/bin/log stream`. Private binaries do not isolate that resource.
- Keep #16/#315 exclusive socket/deadline tests; keep all existing timed routing.
  Concrete small counterexamples: `881/latency.test.ts` measures a 1 ms p95
  addition after 1,000,000 events; `896/{dirty,settled}.test.ts` judge perf readings;
  `1486/grid.test.ts` judges first-screen/UI-thread timings; `1515/budgets.test.ts`
  calls `environmentProblem`/`judge`. Do not move a whole mixed folder for its
  untimed sibling, nor infer eligibility from absence in the current timed list.
- `1901/build-digest.test.ts` deliberately changes
  `crates/deep-canvas-loop/src/lib.rs` during three builds. Immutable final copies
  do not isolate the source mutation. Keep it serialized. Other fixed ports,
  real windows, GPU exclusivity and shared VMs remain independent blockers.
- §7a shards isolate folders in separate fixed-path workspaces, files serial
  inside each. That is **not** AC1's parallel block. Preserve exclusive-after-
  shards ordering, slow/by-hand rules, and INCONCLUSIVE for anything unrun.

## Already documented wrong-program leads (not newly executed proof)

All commands below use the existing installed Vitest entry: prefix with
`node node_modules/vitest/vitest.mjs run`. No install is implied. These are
historical replay leads, **not proof of failure in the parallel block**.

| File(s) | Documented base / wrong program and command arguments | Source / limitation |
|---|---|---|
| `884/search.test.ts` | `0f7fb686`; `tests/acceptance/884 --reporter=verbose` | `884/BASE-FAILURE.txt`: Chinese-word and punctuation-message assertions failed; the other two passed. |
| `1022/{compact,replay,slash}.test.ts` | `da22dbe4`; `tests/acceptance/1022 --no-file-parallelism --testTimeout=600000` | `1022/BASE-FAILURE.txt`: all three failed at assertions. |
| `1862/rounds.test.ts` | `35df4523`; `tests/acceptance/1862 --testTimeout=600000 --no-file-parallelism` | `1862/BASE-FAILURE.txt`: repeated finding and missing outcomes failed. |
| `374/{paint,steps,stroke}.test.ts` | `7222b16`; `--root tests/acceptance/374 --no-file-parallelism` | `374/BASE-FAILURE.txt`: 10/11 failed, not every test. |
| `376/{replica,refusal}.test.ts` | `a8e5480`; `--root tests/acceptance/376 --no-file-parallelism --reporter=verbose` | `376/BASE-FAILURE.txt`: missing `see`, and unnamed-control refusal. |
| `490-oracle-redraft/eases-bevy.test.ts` | `db09e652`; `--root tests/acceptance/490-oracle-redraft --no-file-parallelism` | Its `BASE-FAILURE.txt`: build ran, missing `fn` caused failures. |
| `497/late-entries.test.ts` | `c469fe2e`; `--root tests/acceptance/497 --no-file-parallelism late-entries` | `497/BASE-FAILURE.txt`: arrival assertion failed. Held/refusal files were unrun, lacking a build feature: not proof. Existing arrival/fork plants are named in the test. |
| `777/{app-budget,step-down}.test.ts` | `7b39aa0d`; `--root tests/acceptance/777 --no-file-parallelism` | README + `BASE-FAILURE.txt`: both failed. Existing plants: `budgets_each_window`, `steps_main_window`, `tells_first_step_only`. |
| `1963/{code,formula}.test.ts` | `4004257c`; `--root tests/acceptance/1963 --no-file-parallelism --testTimeout=600000` | README + `BASE-FAILURE.txt`: formula one-byte assertion failed; **code file passed**, so this base does not prove both files for AC1. |
| `1964/{subscript,refusal}.test.ts` | `64b4bf56`; `--root tests/acceptance/1964 --no-file-parallelism --testTimeout=600000` | Its `BASE-FAILURE.txt`: five failures; status-role clause alone already passed. |
| `1328/{job,dispute}.test.ts` | Candidate `ed83819d`; `tests/acceptance/1328 --testTimeout=600000` | README proposes this; `BASE-FAILURE.txt` says **not run**. No observed proof. |
| `1957/dependencies.test.ts`, `1961/{orphan,versions}.test.ts`, `2015/faces.test.ts` | Bases `04f44a4ba`, `07b638444`, `75f3eed4f`, respectively | Each folder's README gives its Vitest command; first two `BASE-FAILURE.txt` records describe runs, #2015 explicitly says **not run**. No parallel-block proof. |
| `1143/{criteria,plants}.test.ts` | `69803b946abf4881f818485c5898865949a2a871`; `tests/acceptance/1143 --testTimeout=6000000` | README + `BASE-FAILURE.txt`: criteria failed; home-path plant already passed. Not a qualifying binary-only folder. |

Other inspected READMEs/BASE-FAILURE records include unrun predictions. They are
not converted into proof by their filenames. Missing features, unavailable GPUs,
missing tools and setup errors are never wrong-program assertion evidence.

## AC1 / AC4: missing proof, not a fabricated acceptance test

No new executable test is drafted. AC1 names no mandatory folder, and there is
no qualified moved set here: a count assertion accepting zero, list snapshot, or
fake no-op runner would not prove its wrong-program condition. AC4 requires real
before/after readings, not a new JSON schema, helper export, output sentence or
speed threshold. Existing `tests/affected.test.mjs` and #1114/#1115 tests already
cover routing/skip machinery; duplicating them would not fill these gaps.

**Future measurement/proof recipe (not run here):**

1. On each requested host (Spark and Mac), prepare the **same source/test commit**
   for before and after; record that SHA and the exact approved tooling overlays.
   Only binary tooling/scheduling differs. Use fixed own build paths per side,
   no inherited `CARGO_TARGET_DIR` or `DEEP_BIN_DIR`, no binary links across sides.
   Record tool versions, cache state, load, platform and available cores. Missing
   prerequisites are BLOCKED; no installs/builds are authorized by this audit.
2. Run each prepared side once through the current unit entry (not full preflight):

   ```sh
   node scripts/throttle.mjs timed -- /usr/bin/time -p node --input-type=module -e '
     import { checks, runLanes } from "./scripts/lanes.mjs";
     process.exitCode = runLanes(checks.filter(lane => lane.name === "unit"));
   '
   ```

   The outer timed grant keeps the measurement off competing work; `/usr/bin/time`
   starts after grant acquisition. Save exit status and complete redacted output.
   Identify the actual `vitest run --no-file-parallelism ...alone` command from
   that side's `checks` and retain its existing Vitest `Duration` as **runner wall
   time**, including its setup/builds, not the sum of test durations. Record the
   parallel block's Duration and total `real` separately so moving cost outside
   alone is not advertised as a total speedup. If routing splits alone into more
   invocations, retain each wall interval and their definition; do not silently
   compare a different scope. Missing readings remain INCONCLUSIVE. No speed limit
   or assertion that “after < before” is added; the historical 557 s is not a side.
3. Before any approved removal from `alone`, run every candidate's unchanged file
   on its documented runnable wrong source/twin, beside real untimed peers, with
   the normal repo Vitest configuration and file parallelism. For example, the
   existing command form is `node scripts/throttle.mjs test -- scripts/lease node
   node_modules/vitest/vitest.mjs run <candidate-files> <peer-files>
   --reporter=verbose` (placeholders must be actual audited paths). Do not use
   `--root` or `--no-file-parallelism` for this proof. Keep the exact composite
   source/test/tooling recipe, commands, per-file assertion failures and statuses;
   verify actual overlap, and that no candidate fell into a shard/timed/by-hand
   path. Then run the correct program unchanged. A failure elsewhere is no kill.
   After an authorized list change, confirm actual selection with the existing
   `node scripts/affected.mjs --list <moved-test-paths>`; this selection alone
   proves no execution and cannot replace the concurrent wrong-program run.
4. Reconcile planned/run/failed/skipped files and known failures on both sides;
   preserve the timed/exclusive sets. Record moved folders and their file-level
   proofs, never just a count. Zero qualified folders leaves migration/speed
   claims open. AC2/AC3 also remain open: this audit does not prove before-side
   binary separation, shell-env rejection or `childEnv` merge order. At this base
   `childEnv` does not filter `DEEP_BIN_DIR` at all (the issue's line reference is
   stale); the required behavior, not that line number, is the obligation.

## Delivery checks / blockers

Requirement → audit: AC1 → candidate table + unchanged wrong-program recipe;
AC4 → same-commit wall-reading recipe; scope safety → gates above. All are
assessment/recipes, **not executed acceptance proof**. Diff/content review only:
this is a docs-only addition. No unit/preflight, builds, installs, commits, twins
or timings were run. `node scripts/affected.mjs` was not run: this archive has no
`.git`, `node_modules` or `target`, and imports TypeScript before selection.
There are no WIDE/INCONCLUSIVE output lines to report; affected verification is
**BLOCKED/unrun**, not PASS. Needed next: separate blind redrafts where indicated,
a qualified moved set, real parallel wrong-program results, and both host readings.
