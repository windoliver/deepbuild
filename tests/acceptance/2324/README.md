# Acceptance tests for #2324: the sandbox's engine moves to a release that holds its published fixes

Written first, blind, from issue #2324 (its Scope, five acceptance criteria and Proof), the design sections it names and
base commit `e63447bea` ("Merge pull request #2348 …"), by a job that never saw an implementation; none existed, and no
other branch, worktree or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). The same job made the redraft of #238's version lines the
issue's Scope names (its own commit, `Blind redraft of #238's engine version lines for #2324`).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2324.e835c82a` | `ac1-lock.test.ts` (2): the lock; the planted lock at 49.0.4 |
| AC2 | `#2324.2b0e7ae9` | `ac2-kit.test.ts` (1): the kit on three hosts against #238's recording |
| AC3 | `#2324.c7dad014` | `ac3-fixtures.test.ts` (1): #531's fixtures on two machines against the old engine |
| AC4 | `#2324.adfd1cb3` | `ac4-seal.test.ts` (2): the runtime digest and the save; the planted engine build |
| AC5 | `#2324.ceee5c0f` | `ac5-pins.test.ts` (1): the metering table, the pins, fuel per step, repo-rules |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text as this job received it (starting `AC1:`
to `AC5:`); the live issue body wasn't read, so they aren't checked against it. Each test's name starts with its ID.

## What was read

- The issue as the brief quoted it, and the 17 advisories it counts, read by this job from the engine's project
  (`gh api '/repos/bytecodealliance/wasmtime/security-advisories?per_page=100&state=published'`, each advisory's
  `vulnerabilities[]` entries for the package `wasmtime`) and its releases from crates.io
  (`https://crates.io/api/v1/crates/wasmtime/versions`, every page), on 2026-11-12: `fixtures/advisories.json`.
- `docs/technical-design.md`: Sandbox and budgets; Logic bake and checks; Saves; Threats, and what stops each one;
  Dogfooding. `docs/canvas-primitives.md`: Logic: sandbox; Registry and seal: runtime digest; Logic: saves; Logic: saves
  across changes; Canvas module: interface and implementation; Golden. AGENTS.md.
- At the base: `tests/acceptance/238/` and `tests/acceptance/531/` (READMEs, helpers, programs, tests), `crates/deep-canvas-
  sandbox` (`module.rs`, the kit and `kit/kit.json`), `crates/deep-sandbox-wasmtime` (`service.rs`: `about`, `run`, `kit`,
  `kit_plan`, budgets), `crates/deep-logic` (`lib.rs`: `about`, `bake`, `bake_key`, `golden`, `golden_verify`,
  `runtime_digest`; `metering.json`; `keyframes.rs`), `crates/deep-canvas/src/registry/implementation.rs`
  (`runtime_digest`), deep-show's `schedule` call and `schedule/full.json`, `scripts/repo-rules.json` and `.mjs`.

What the base already does: everything this suite reads exists, on wasmtime 49.0.2. So AC2, AC3's hashes and AC4's
first test pass on the base by construction (the base *is* the old engine); they prove something on the work. What the
base doesn't have: an engine past the 17 advisories, and the planted engine build.

## Run them

```sh
npm ci && npm run build --workspaces                           # once
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once: Linux x86_64 (the channel rust-toolchain.toml names)
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"   # cargo of that channel, if not on PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run tests/acceptance/2324 --no-file-parallelism
npx tsc -p tests/acceptance/2324/tsconfig.json
```

What a run builds (debug, `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set):

- `deep-sandbox` and `deep-logic` for this Mac, and deep-show with `--no-default-features --features full`,
  `full,test-sandbox-alt` and `full,plant-engine-differs`, through #238's and #531's helpers (`cargo build --locked`).
- `deep-sandbox` and `deep-logic` for Linux x86_64 in one `docker run --platform linux/amd64` of
  `rust:<channel>-slim-bookworm`, the checkout mounted read-only, target and cargo caches under
  `target/acceptance-2324-linux/`, with `CARGO_BUILD_JOBS=2` (four rustc processes under emulation outgrew this Mac's
  6 GiB Docker VM, exit 137). Nothing is pulled; a cold build took 10 minutes here.
- Headless Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (or `CHROME_BIN`), through #238's
  `inChrome`.

A missing host fails `BLOCKED:`, naming it (no Docker or no amd64 image: "Linux x86_64: …"; no Chrome: "no headless
Chrome …"), never passes. Every test that builds or runs a binary passes an explicit timeout of 90 minutes (AC1's two
read files only). Node built-ins and vitest only.
`scripts/lanes.mjs` needs `'tests/acceptance/2324/'` in its `alone` list (the files build cargo binaries and start
Docker and Chrome); this README is the instruction, and the implementer makes that edit, as #238's and #531's did.

This suite doesn't run #238's or #531's assemblers or #531's Rust program: at this base their private lockfiles
(`tests/acceptance/{238,531}/wat/Cargo.lock`, `531/rules/Cargo.lock`) list the `[[patch.unused]]` entries
`.cargo/config.toml` had when they were written, and `cargo build --locked` refuses to add the two it has gained since
(`accesskit_macos`, `gpui-pre-macos`), so both suites fail before their first test here. #238's `onLinux` also reads
the image's architecture without `--platform`, which Docker 29's containerd store answers `arm64` for this multi-platform
tag, so it reports BLOCKED here. Both are main's, not this issue's; this suite records the programs' bytes instead
(below) and builds its own Linux runners.

## The merge base's readings

"As #238 recorded", "on the old engine" and "the merge base's digest" are values only the base gives. They were read
once, on the base `e63447bea`, by `record.spec.ts`:

```sh
DEEP_2324_RECORD=1 NO_COLOR=1 npx vitest run --root tests/acceptance/2324 record.spec.ts   # at the merge base, cargo of the channel on PATH
rm -rf tests/acceptance/2324/node_modules/.vite                                            # vitest's cache under --root
```

It is a vitest file outside the repository's test pattern (`*.test.ts`), so no lane runs it, and it does nothing without
`DEEP_2324_RECORD=1`. Because #531's assembler and Rust program don't build in place (above), it builds copies of those
two crates outside the checkout (same sources, same exact versions, no `--locked`) and puts them behind #531's
`assemble` and `rulesProgram`. It wrote:

- `fixtures/base-kit.json`: sandbox@1's kit on this Mac (`deep-sandbox kit`, PASS): each of the 33 cases' verdict,
  rewritten hash, refusals, trap, result and reads; and for each of the 17 fixtures that run and end (all but
  `fuel.loop`, which never ends) its program as given (base64), its budget and its **fuel count**: the least fuel
  budget under which `deep-sandbox run` doesn't trap `fuel`, found by halving.
- `fixtures/base-bake.json`: the piece of #531's fixtures (below) with its programs' bytes, its track and its 60 steps,
  and per fixture what `deep-logic bake` gave: the program's and the rewritten program's sha256, the bake key, each
  step's hash and fuel, each checkpoint's full-state hash, and its trap.
- `fixtures/base-golden.json`: the save (below): the golden `deep-logic golden` recorded, with the bake it records.
- `fixtures/base-seal.json`: deep-show `full`'s `schedule.runtime_digest`.

The suite's run on the base (`BASE-FAILURE.txt`) confirmed that Linux x86_64, the app's kit and headless Chrome give the
same readings as this Mac did.

## Surface choices

The issue names no command line. Every name below that the issue doesn't give is this job's choice; the implementer
builds exactly these, or a dispute goes to a blind redraft.

**The one new seam: the planted engine build `plant-engine-differs`.** A cargo feature of that name on
`deep-sandbox-wasmtime` (the crate that drives the engine), in no shipped build, forwarded by a deep-show feature of the
same name (`plant-engine-differs = ["deep-sandbox-wasmtime/plant-engine-differs"]`), as `plant-*` features elsewhere
name a wrong program. Under it the engine gives another result for the kit fixture **`pass.subset`** (its `result` or its
`reads`; the rewrite and so its hash unchanged) and #238's recorded result for every other fixture. The test builds
`deep-show --no-default-features --features full,plant-engine-differs`, sends `schedule` and `kit` (`modules:
["sandbox"], parts: ["sandbox"]`), and requires: the kit differs from `base-kit.json` on `pass.subset` alone;
`schedule.runtime_digest` differs from `base-seal.json`'s; and `sealFailures`, the check AC4's first test runs on the
shipped build, fails naming `pass.subset`. How the digest comes to move (the seal reading the kit, the build declaring
itself `measured`, …) is the implementer's.

No other call or field is new. The tests read: `deep-sandbox` `about`, `kit`, `kit_plan`, `run` and `web_runner` (#238);
`deep-logic` `about`, `bake` (its `keys`, `steps`, `checkpoints`, `traps`), `golden` and `golden_verify` (#531, #532);
deep-show `run` with `schedule` and `kit`; `Cargo.lock`, `crates/deep-logic/metering.json` (`engines.app`),
`crates/deep-show/schedule/full.json`, `scripts/repo-rules.json` and the output of `scripts/repo-rules.mjs`.

**The save (AC4).** Saves are #534, unbuilt. The smallest state the base writes on the old engine that a later run
reads back is a **golden** (`deep-logic golden`, read back by `golden_verify`): it carries the runtime digest of the
logic and sandbox modules' seal, every step hash and every checkpoint's full-state hash. The save is the golden of
#531's `table_copy` (memory and mutable globals, call_indirect through a table, memory.copy) over 120 steps with four
nudges, checkpoints every 30. It *opens* when its runtime digest is the one the new engine's seal gives (a golden
recorded under another digest is recorded again: Golden), and *plays on to the same full-state hash* when the same bake
on the new engine gives its checkpoint and step hashes and `golden_verify` of it names no first differing step. The
test doesn't read `golden_verify`'s verdict: the golden binds the bake key, which names the engine (below).

**#531's fixtures (AC3, AC5).** Every program of #531's `programs.ts` that its check admits, plus its Rust program, each
as the item #531's tests build it (`spin`, `tally`, `recurse` at a 64 KiB stack, `quiz`, `nine_fills` at 10,000,000
fuel and 16 MiB, `table_copy`, `lookup`, `start_forever`, `touch_pages`, `quiet_pages`, `src` (`levels`), `aim` (reads
`c1` and `src.level`), `work` at 5,000,000 fuel, `rules`), in one piece of seed 2324 at 60 Hz, checkpoints every 20,
over 60 steps of one track (nudges, a `c1`, a `start` at 20, a `go` at 45, a `boom` of 0 at 50). So the run holds four
traps (spin's fuel at 45, recurse's stack at 0, start_forever's fuel before step 0, rules' divide at 50) and 40
full-state hashes. `write_past_memory` and `logic_import` are refused at check and reach no state, so they aren't in it.
A fixture differs when a step hash, a checkpoint's full-state hash or its trap differs; the failure names the fixture and
its first differing step. "A second machine" is Linux x86_64, as in #531's suite.

**The title's "a bake made on the old engine is never reused".** A bake is keyed by "the versions" (Logic bake and
checks) and can never be reused under another key; the base's `bake_key` names the engine. AC3's test requires each
fixture's bake key on the work to differ from the base's, after its hashes are judged.

**The fuel count (AC2).** sandbox@1's kit reports no fuel figure, so the count is read through `run`: a fixture is charged
its recorded count N when its run under a budget of N fuel traps no `fuel` and under N − 1 traps `fuel`. That is two runs
per fixture per host: `deep-sandbox run` on macOS arm64 and Linux x86_64, and `kit_plan`'s request with its budget's fuel
set to N and N − 1 through the web runner in headless Chrome.

**Linux x86_64.** One build of both runners (`target/acceptance-2324-linux/`, above), run per batch of calls as #238's
and #531's suites run theirs.

## Readings where the issue leaves a choice

- **"At or past the first fixed version of each of the 17 advisories"** (AC1): Cargo.lock's one wasmtime version is an
  exact release, inside no `wasmtime` range of any of the 17 (read as the project writes them: bounds low to high, each
  `>=` opening an interval and each `<` closing it), and not below any one's first fixed 49.0 release. The 17 are every
  advisory published since 49.0.2's release (2026-10-02) whose ranges hold 49.0.2: twelve fixed in 49.0.3, two in
  49.0.4 (GHSA-mghf-wjfp-p5xm, GHSA-9pvw-hwfg-92h5), three in 49.0.5 (GHSA-3982-jqvv-277m, GHSA-6fr9-xmw9-5352,
  GHSA-qw58-7h65-crq2). Older advisories with open or reversed ranges (GHSA-vc8c-j3xm-xj73's `>= 29.0.0`, fixed in
  41.0.1) predate 49.0.0 and aren't counted. The test prints each ID beside its first fixed version and the lock's.
  "Listed in the PR" is the PR's, not a test's.
- **"Another patch than the shipped one … also one with the fixes"** (Scope): 49.0.5 is the only 49.0 release outside
  all 17, so sandbox.alt can't pin another 49.0 patch with the fixes. Read as: sandbox.alt pins an exact, published
  release of the engine other than the one Cargo.lock holds, inside none of the 17 advisories' ranges (today `=50.0.1`
  or `=48.0.8`, for example). AC5's test asserts it on deep-show `full,test-sandbox-alt`'s seal; #238's redraft lets its
  own suite accept it (that commit's body).
- **"The kit's three reports … as #238 recorded"**: each host's kit against the base's recording, case by case (verdict,
  rewritten hash, refusals, trap, result, reads); Chrome against the recorded trap, result and reads of every fixture
  that runs, as #238's suite compares it. A golden the implementer moves changes a case here, and fails it.
- **"With the kit's hashes equal on the three hosts, the seal's runtime digest equals the merge base's"** (AC4): AC2
  runs the three hosts; AC4 reads the kit of the same deep-show build whose digest it reads, so its check holds the
  digest beside the kit that build gives.
- **"The fuel a fixture program is charged per step is unchanged"** (AC5): each #531 fixture's `fuel` in every step
  record of the bake, against the base's.
- **"`scripts/repo-rules.mjs` passes with the three rows moved"** (AC5): the rows for `wasmtime` in
  `crates/deep-sandbox-wasmtime/Cargo.toml`, `crates/deep-logic/Cargo.toml` and `spikes/245/Cargo.toml` read
  `=<Cargo.lock's version>`, and the script prints no FAIL, INVALID or BLOCKED line naming `wasmtime` or those manifests.
  It exits 1 on main already, for lines that aren't this issue's (unlisted dependencies, a home path in another suite's
  BASE-FAILURE.txt, two cards); the test counts them and doesn't judge them.
- **"The metering table and sandbox@1's pins name the new version"** (AC5): `engines.app` in `metering.json` is
  `wasmtime <version>`; `deep-sandbox about` names the engine `<version>` and pins `=<version>`; `deep-logic about`
  names it; deep-show `full`'s seal and `schedule/full.json` pin `=<version>`.

## Base results

`BASE-FAILURE.txt` is the one run at the base (its first lines say why each test passed or failed): 7 tests, 4 fail
and 3 pass, nothing BLOCKED. AC1 fails naming all 17 advisories; AC3's hashes hold on both machines and it fails at
the bake keys, still the old engine's; AC4's planted build fails as an unknown feature; AC5 fails on the lock still at
49.0.2 and sandbox.alt's `=49.0.1`, inside all 17. AC1's planted lock, AC2 and AC4's first test pass, as they must on
the old engine itself.

## Not tested, because no criterion reaches it here

The PR's list of advisory IDs; `spikes/245`'s own lock; "a golden moves only by your decision" (a decision, not a
program); #531's fixtures in headless Chrome (AC3 names a second machine); the fixes themselves (the advisories concern
parts the subset turns off or the app doesn't build); #2298, #2325, #2326.
