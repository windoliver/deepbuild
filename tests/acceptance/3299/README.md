# #3299 acceptance tests: gitignored panel files leave deep-show's next build fresh and its source digest unchanged

Written blind at the base `a288ae247` (main, "Merge pull request #3176 …"), from issue #3299, the design and that base.
The job saw no fix: it read no pull request, no other branch, worktree or commit after the base, and no notes or
evidence folder (not `docs/evidence/1119/`, which the issue cites). The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #3299: `crates/deep-show/build.rs` prints `cargo:rerun-if-changed=<folder>` for every crate folder
  deep-show depends on, `crates/deep-app` among them, and its source digest (#1901) reads every file in them but hidden
  ones, `target` and `node_modules`; gpui-shell writes the gitignored `gpui-kit.d.ts` and `jsconfig.json` into
  `crates/deep-app/panels/*/` and DeepBuild writes `@deepbuild/` beside them, so a check that loads a panel reruns
  deep-show's build script and recompiles deep-show, and changes the digest. Its three criteria and its Proof line
  (cargo's fingerprint reasons for each criterion's builds, on the Mac and on the Spark).
- **The design**, `docs/technical-design.md` (Dogfooding, "Tests written first") and `docs/parallel-proof.md` (the
  lanes, twins, the at-assertion rule, `lane.json`). **AGENTS.md.**
- **The base, for surfaces only**: `crates/deep-show/build.rs` (`source_digest`, `walk`, `path_dependencies`, the
  `cargo:rustc-env=DEEP_SOURCE_DIGEST=` line) and `crates/deep-show/Cargo.toml` (its path dependencies:
  `deep-canvas-loop`, and `deep-app` through `deep-images` and `deep-replica`); `.gitignore` (lines 16-17 and 27);
  `crates/deep-app/src/panel_module.rs` (`serve` writes `@deepbuild/panel.js` under a panel's folder) and the panel
  folders `crates/deep-app/panels/*/`; `scripts/proof-binaries.mjs` (#2820: the run builds a test's own literal
  `cargo build --locked -p deep-show` first, in place), `scripts/proof-runs.mjs` (`atAssertion`, `twinsOf`, one node file
  at a time under a 20-minute cap), `scripts/lanes.mjs` and `scripts/lanes-lists.mjs` (`lane.json`, alone reasons); the
  suites `tests/acceptance/1901/` (deep-show built, its digest) and `tests/acceptance/3171/` (house form, twins).

## Run

```sh
node --test --test-concurrency=1 tests/acceptance/3299/ac1-panel-files.test.mjs tests/acceptance/3299/ac2-source-change.test.mjs tests/acceptance/3299/ac3-planted-watch.test.mjs
```

Node 24 and a Rust toolchain (`cargo` on PATH or in `~/.cargo/bin`). Each file first runs `cargo build --locked -p
deep-show` (`warm` in `helpers.mjs`), the build the run makes first in each checkout (#2820), so a cold `target/` is
built outside the files' cap; a build that fails fails the test before any assertion. Every later build is `cargo build
--locked -p deep-show --message-format=json-render-diagnostics` with `CARGO_LOG=cargo::compiler::fingerprint=info`
(and the older module name, `cargo::core::compiler::fingerprint`), in the checkout's own target (or `CARGO_TARGET_DIR`
as the run sets it). Each such build is read as:

- **compiled units**: cargo's `compiler-artifact` messages with `fresh: false`;
- **the build script ran**: cargo's fingerprint log says `fingerprint dirty for deep-show … /RunCustomBuild/`, or the
  build script's `output` file (beside the `out_dir` of cargo's `build-script-executed` message for deep-show) was
  written again (its modification time moved), or it is another file;
- **cargo's reasons**: each fingerprint `stale: …` and `dirty: …` line, with the unit it is about, the checkout's path
  written `.`;
- **the source digest**: the `cargo:rustc-env=DEEP_SOURCE_DIGEST=<hex>` line of that `output`, which is what the binary
  is compiled with (`env!`).

**Files read and changed in the checkout** (each put back byte for byte, in a `finally` and on SIGINT, SIGTERM or
SIGHUP; `git status` is as found after a run):

- in every folder of `crates/deep-app/panels/`: `gpui-kit.d.ts`, `jsconfig.json` and `@deepbuild/panel.js` (the files
  the issue names, with short contents of their kind), written and deleted; any already there (a checkout where
  gpui-shell ran) are kept and put back after;
- `crates/deep-app/panels/claude-code/main.js`, a committed file of `crates/deep-app` that no crate compiles in: its
  modification time is moved to now (bytes unchanged) to make the build script run, and AC2 appends a comment line;
- `crates/deep-canvas-loop/src/lib.rs`, one canvas module's `src/lib.rs` (deep-show depends on it; only deep-player
  besides): AC2 appends a comment line;
- `crates/deep-show/build.rs`: AC3 plants one line in it.

Content changes are put back but modification times are not, so the next build after a run runs the build script
again and never keeps a digest of changed bytes. On this Mac each rebuild of deep-show after its build script ran took
minutes at a load near 100; the files are split so each stays under the lanes' 20-minute cap.

**Lane needs.** `lane.json` puts this folder in the alone block (`shared:` the checkout's target and crates sources):
its files build deep-show in the checkout's own target and write files under `crates/`, and read cargo's fingerprint
reasons, which any other build of deep-show or edit under its path dependencies in the same checkout changes (for
example `tests/acceptance/1901/`, which edits a canvas module's source and builds deep-show). The proof runs run one
node file at a time; the unit lane's alone block may still run another alone folder beside this one, which the
`exclusive` list in `scripts/lanes-lists.mjs` would prevent; that list is the owner's to change.

## Criteria to tests

IDs are `criterionId` in `scripts/proof-change.mjs` (the first 8 hex digits of SHA-256 of each criterion's text,
trimmed, white space collapsed), checked against the issue body. Each test's name starts with `AC<n> #3299.<id>` from a
const string in its own file.

| ID | Criterion | Tests, and what each asserts | Wrong programs it fails on |
|---|---|---|---|
| AC1 `#3299.44ab2e7a` | Writing or deleting gpui-shell's gitignored files in a panel folder of `crates/deep-app` leaves the next build fresh (no build script of deep-show run, no unit compiled), and `DEEP_SOURCE_DIGEST` is the same with and without them | `ac1-panel-files.test.mjs`, three tests over one sequence (`firstCriterion` in `helpers.mjs`): (1) after writing the files into every panel folder, the next build ran no deep-show build script and compiled nothing; (2) after deleting them, the same; (3) the digest read with the files there equals the digest read without | The base: all three |
| AC2 `#3299.57c89932` | A change to a committed source file of a digested crate (one canvas module's `src/lib.rs`, one file of `crates/deep-app`) reruns deep-show's build script and gives another digest | `ac2-source-change.test.mjs`, two tests: a build, a comment line appended to `crates/deep-canvas-loop/src/lib.rs` (or to `crates/deep-app/panels/claude-code/main.js`), a build: the build script ran, and the digest differs | The twin `digest-lock-only` (passes on the base) |
| AC3 `#3299.acbee1fc` | A planted build script that watches the whole `crates/deep-app` folder, as main does, fails the first criterion, naming the rerun cargo gives | `ac3-planted-watch.test.mjs`, one test: the checkout's `crates/deep-show/build.rs` with one line planted first in `main`, `println!("cargo:rerun-if-changed=<crates>/deep-app")`; AC1's sequence run under it fails, and its writing part's failure carries cargo's `stale: changed "…/crates/deep-app"` | The twin `plant-misses-main` (passes on the base) |

### How each criterion is read

**AC1.** The sequence, from a checkout with none of the panel files: a touch of `main.js` and a build (the build
script runs; the digest without the files); the files written into every panel folder and a build (must be fresh); a
touch of `main.js` and a build (the build script runs again; the digest with the files there); the files deleted and a
build (must be fresh). "Fresh" is cargo's: no `compiler-artifact` with `fresh: false`, and deep-show's build script
not run (neither cargo's fingerprint calls its RunCustomBuild unit dirty, nor its `output` written again). The digest
is compared from two runs of the build script, one with and one without the files, so a script that stops rerunning
but still digests the files fails; the touch is the plainest committed change cargo reruns a build script for (a
modification time), and it moves no byte, so the digest must not move either. A touch that runs no build script is
itself a failure of the digest part: no digest with the files was read. Every panel folder gets the files, so no one
panel's exception passes. `@deepbuild/panel` is written as `serve` writes it, `@deepbuild/panel.js`.

**AC2.** "A crate it digests" is read from the base's `build.rs`: deep-show and its path dependencies, transitively.
The canvas module is `deep-canvas-loop`, the one module only deep-show (and deep-player, which deep-show doesn't
build) depends on, so its change recompiles the least. The `crates/deep-app` file is a panel's committed `main.js`, in
a folder where the gitignored files go, which no crate compiles in: a fix that drops panel folders from the watch or
the digest fails it. Each test reads its own build before the change, so the second test's base is the first's put
back.

**AC3.** The plant is the checkout's own build script with the base's folder watch added, not a copy of main's script,
so it compiles with whatever the change does to deep-show's build dependencies. "Naming the rerun cargo gives for it"
is cargo's fingerprint line for deep-show's build script, `stale: changed "<checkout>/crates/deep-app"` (the line the
issue quotes from #1119's run), which must be in AC1's writing failure. The test fails before any assertion if
`build.rs` has no `fn main() {`.

## Twins (`twins.json`, `twins/<name>/…`)

AC1 fails on the base, so it needs none. AC2 and AC3 pass on the base and each has one, marked by a `#3299's planted
wrong program` comment; both compile at the base.

- **`digest-lock-only`** (AC2): `crates/deep-show/build.rs` whose digest reads only `Cargo.lock` and which watches only
  it (and the base's ledger and player files): no committed source change reruns it. AC2's tests fail at their first
  assertion (the build script did not run).
- **`plant-misses-main`** (AC3): `crates/deep-show/build.rs` whose first `fn main() {` is a function cargo never runs
  (`mod unrun { pub fn main() {} }`, before the real `main`), so the test's planted watch lands where it watches
  nothing; the `main` cargo runs is the base's, but watching each file it digests rather than each folder, and digesting
  no `gpui-kit.d.ts`, `jsconfig.json` or `@deepbuild`. Under it AC1's sequence holds, so AC3 fails at its assertion that
  the first criterion fails.

No twin replaces a manifest or `Cargo.lock`: twins are laid over the change, whose manifests may differ from the
base's, and a stale manifest would fail `--locked` at a build error, not at an assertion.

Results at the base are in `BASE-FAILURE.txt`.
