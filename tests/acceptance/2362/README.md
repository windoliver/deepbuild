# Acceptance tests for #2362: the canvas kit passes motion and core, the ledger records it, and a release deep-show seals

Written first, blind, from issue #2362 (its Motion and Core paragraphs, Scope, three acceptance criteria and Proof), the
design sections it names and base commit `a65192d39` ("Merge remote-tracking branch 'origin/main' into
fix/2362-kit-seal": main at `13b84360f` merged with the open work of #2085, which #2362 depends on), by a job that
never saw an implementation; none existed, and no other branch, worktree or PR was read, nor the live issue. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2362.57fbe409` | `kit.test.ts` (1): the kit call `scripts/canvas-kit.mjs` makes, in the build it makes, over core and motion, writing a copy of the ledger; the committed `kit-ledger.json` against it; the `catalog` and `fixtures` calls of the same process |
| AC2 | `#2362.9bb19ae2` | `seal.test.ts` (1): the release build of the full set, as #855's release-build case builds it, starts and answers; every fixture it lists is presented and evaluated clean at 0.5 s under hash@2 |
| AC3 | `#2362.c889f209` | `score.test.ts` (1): #154's two files that hold motion's score check through `deep_show` (`tests/acceptance/154/rules.test.ts`, `tests/acceptance/154-redraft/limits.test.ts`), run unchanged in a vitest of their own |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text as the brief quoted the issue (no `AC<n>:`
prefix; the live body wasn't read, so they aren't checked against it). Each test's name starts with its ID.

AC2's and AC3's proof, as the issue says, is the files they name run unchanged by the implementer before and after:
the release-build case of `tests/acceptance/855/hash.test.ts` ("equal documents get equal keys and result digests on
two machines: the debug build here, and the release build …") and #154's suite, both folders (`tests/acceptance/154/`
and `tests/acceptance/154-redraft/`). This suite doesn't spawn them whole (they take hours); it gives each criterion
its fastest faithful check through the surfaces they use. AC1's proof is `node scripts/canvas-kit.mjs` before and
after, which the implementer runs too.

## What was read

- The issue as the brief quoted it.
- `docs/technical-design.md`: Dogfooding. `docs/canvas-primitives.md`: What holds a document to its rules ("a canvas
  module that can emit a code the catalog doesn't list fails its conformance kit"), Registry and seal, and Score's
  **As built (#154)** paragraph (the check warns `score.far_from_sample` when a sampled note sits more than 4
  semitones from its zone's root). AGENTS.md.
- At the base: `tests/acceptance/138/README.md` and `CATALOG-REDRAFT.md` (the `kit` call, its parts and cases, the
  catalog part, exact codes, `issue_code`, the ledger and the release seal), `tests/acceptance/855/` (README,
  `helpers.ts`, `hash.test.ts`), `tests/acceptance/2085/` (README, `helpers.ts`, `kit.test.ts`), `tests/acceptance/154/`
  and `154-redraft/` (READMEs, `rules.test.ts`, `limits.test.ts`, their `useShow`), `scripts/lanes.mjs` (#154's
  `alone` lines), `scripts/canvas-kit.mjs`, `scripts/proof-change.mjs` (`criterionId`), `crates/deep-show/kit-ledger.json`
  and `build.rs`, `crates/deep-show/src/kit/` (`mod.rs`: `kit`, `subjects`, the ledger write; `ledger.rs`: `admit`;
  `catalog.rs`: `rows`, `raised_with`, `exact`, the catalog part; `time_order.rs`: the part and its twin;
  `catalog.json`: the core's fixtures, `code-pack-missing` among them), `crates/deep-canvas-motion/src/{module.rs,score.rs}`
  (`register_score`, the rule, `sound_lock`, `mix_balance`), `crates/deep-show/src/score_plan.rs` (`library_rules`,
  `library_issues`) and `hub.rs` (where `deep_show` adds `library_issues`), `crates/deep-canvas/src/registry/mod.rs`
  (`Registrar::planted`, #2085), `crates/deep-show/src/frames.rs` (`fixtures_reply` leaves planted documents out).

## What the base does

Probed at the base with the builds the tests make (`BASE-FAILURE.txt` holds the suite's run):

- **`node scripts/canvas-kit.mjs`** (30 minutes here, beside other sessions' kit runs) exits 1 with three modules
  not PASS: `core` (`twin_passed` on `parity/framework/code-pack-missing.board#time_order`), `motion` (the catalog
  part's twelve `unproved` cases, `probe: "planted_fixture"`, `issue_code` naming each code, behind `failed_case`) and
  **`text`** (`failed_case` on `schedule:text`: the schedule part's snapshot `schedule/modules/text.json` mismatches,
  `{"code": "mismatch", "what": "key", "name": "schedule"}`). Every other part of core and motion passes. The ledger
  it writes is byte-for-byte the committed one, so the script leaves no change.
- **The committed `kit-ledger.json`** already records what the kit finds for core and motion: FAIL for both, at the
  digests the kit reports (`core` `f54a7b72…`, `time_order` FAIL; `motion` `ea5176c2…`, `catalog` FAIL). The issue's
  "still records core PASS at the same digest" held at `81a5a9b2f` (core and text PASS there); main's ledger
  commits since record core FAIL, and text FAIL (`schedule` FAIL), as here.
- **The release build of the full set** (`cargo build --locked --release --bin deep-show --no-default-features
  --features full`) refuses to start, exit 2: `{"ok": false, "code": "seal_refused", "reason": "kit_failed",
  "modules": ["motion", "text"], "interface": "motion@1", "implementations": ["motion", "text"], …}`. Core isn't a
  sealed module, so `admit` doesn't refuse it.
- **The `catalog` call** files all twelve codes under `motion`, each with `fixture: ""` (`score.check_unread` and
  `sound_lock.off_palette` under the `sound_lock` check, the rest under `document.validate`). **The `fixtures` call**
  of the full build lists 36 fixtures (#2085's planted documents left out); motion's only one is `slide`.
- **Five listed fixtures don't present** (probed in the debug build of the full set, each alone in a fresh process
  and evidence store, as #855's `evaluate` shows them; the release build can't be probed past its seal):
  `export/export-glow`, `export/export-spring` and `export/export-status` are refused with `unknown_field` at
  `layers` and `items/plate/layer` ("the layer and its writer come from the connection, never the payload"), and
  `logic/logic-determinism` and `logic/logic-budget` with `logic_refused` (the piece's program asset isn't in the
  store). #855's release-build case shows each listed fixture the same way and requires it presented, so it fails on
  these too once the seal admits the set. The other 31 present and evaluate clean at 0.5 s under hash@2.
- **#154's** `rules.test.ts` and `154-redraft/limits.test.ts` pass (4 tests).

So AC2 doesn't hold with the issue's Scope alone: past motion, the release seal refuses `text` (a stale schedule
snapshot the kit finds, which the ledger records), and #855's release-build case then meets the five refused
fixtures. AC2's test names each of these in turn; it was written from the criterion, not from the Scope.

## Run them

```sh
npm ci && npm run build --workspaces                  # once
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"   # cargo of the pinned channel, if not on PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 sh scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/2362 --no-file-parallelism --testTimeout=600000
rm -rf tests/acceptance/2362/node_modules/.vite         # the cache vitest leaves under --root
node node_modules/typescript/bin/tsc -p tests/acceptance/2362/tsconfig.json
```

- `kit.test.ts` builds `deep-show` as `scripts/canvas-kit.mjs` does (`cargo build --locked --bin deep-show`, the
  default feature set, `full`); `score.test.ts`'s two files build the same; `seal.test.ts` builds `cargo build
  --locked --release --bin deep-show --no-default-features --features full`, #855's release build, with
  `DEEP_KIT_LEDGER` left out of cargo's environment so it embeds the committed ledger. `CARGO_INCREMENTAL=0` and
  `CARGO_PROFILE_DEV_DEBUG=0` are set unless given; `CARGO_TARGET_DIR` is honored. Each binary is copied out to a
  temporary folder, and each test that uses one fails with cargo's error if it didn't build.
- Nothing touches the checkout but cargo's `target/`: the kit writes its ledger into a copy of
  `crates/deep-show/kit-ledger.json` in a temporary folder, and the committed file is only read. Every evidence
  store and report is a temporary folder, deleted after its test. Processes are started by `spawnSync` and stopped
  only by their own timeouts. Node built-ins and vitest only.
- `score.test.ts` starts a second vitest from the checkout's root (the root config, `VITEST*` variables left out) on
  #154's two files, with its JSON reporter writing to a temporary folder.
- `scripts/lanes.mjs` needs `'tests/acceptance/2362/'` in its `alone` list (the files build cargo binaries and run
  the kit, as #2085's and #855's do); this README is the instruction, and the implementer makes that edit.

With both builds already made (a cold release build took 22.5 minutes here, then the debug build 4.5), the suite
runs in about a minute: the kit over core and motion about 40 seconds, the release build's listing and fixtures a
few seconds, #154's two files about 18 seconds.

## Surface choices

The issue names the kit run, the ledger, the release seal and two suites, and no new surface. Two readings needed a
name the issue doesn't give; each is this job's choice, and the implementer builds exactly it or a dispute goes to a
blind redraft.

- **"The fixture's case says why it can't"** (Scope, Core): core's `time_order` case for `code-pack-missing.board`
  stays in the part and carries `reason`, a non-empty string, on the case or on its `twin` (`{"twin": {"verdict",
  "reason"}}`), saying why no planted twin of that document can fail. The other shape the Scope allows needs no new
  name: the case's `twin.verdict` is `FAIL`. Either way the case's verdict is PASS and the part has no `twin_passed`.
  A case dropped from the part with no word is neither shape and fails.
- **"Leaves motion's catalog for the surface that raises it"** (Scope, Motion): a code leaves motion's catalog when
  the `catalog` call no longer files it under `motion`. The ten of the twelve that motion's own checks raise at the
  base (the score rule: `score.bad_duration`, `score.bad_loop`, `score.bad_pitch`, `score.note_too_long`,
  `score.pad_too_low`, `score.time_unresolved`, `score.unknown_instrument`, `score.unknown_preset`,
  `score.unknown_source`; and `sound_lock`: `sound_lock.off_palette`) have motion as the surface that raises them, so
  they stay in its catalog and each needs its planted document. The two the issue names as unprovable by a planted
  document as the code stands, `score.far_from_sample` and `score.check_unread`, may stay (then they need one too) or
  leave; where they go after leaving isn't observable through these surfaces, and isn't asked.

## Readings where the issue leaves a choice

- **"`node scripts/canvas-kit.mjs` passes for motion and core"** (AC1): the kit call the script makes (`{"call":
  "kit", "ledger"}`, every part, the default backends, seed and sizes, which is what makes it write a ledger), in the
  build the script makes, answers PASS for `core` and for `motion`. The call names `modules: ["core", "motion"]`:
  the kit judges and records each module apart (at the base, this call wrote records for core and motion equal to
  the ones the script's run over every module wrote), and the other modules' verdicts aren't this criterion's. The
  script's own run is the implementer's proof.
- **"`kit-ledger.json` records PASS for both"** with the Scope's "the kit ledger records what the kit finds": the
  committed ledger's record of `core` and of `motion` is PASS and equals, field for field (version, digest,
  verdict, parts), the record this run writes; so a ledger edited to PASS that the kit doesn't find fails, and so
  does one left at an old digest.
- **"Proved by a planted document that raises exactly it"**: the kit's catalog case `code:<code>` for motion passes,
  names a fixture, and records `expected_codes` and `raised_codes` both exactly `[<code>]`. **"Registered planted, so
  the `fixtures` call leaves it out"**: no fixture the `fixtures` call lists for motion is that document (by its name,
  wherever the kit files it). How and where the documents are registered (`Registrar::planted`, the kit's
  `catalog.json`) and what they're called is the implementer's. The other codes of motion's catalog, which the base
  already proves, aren't held to one code each.
- **"Fails its planted twin on `code-pack-missing.board` again, or the fixture's case says why it can't"**: see
  Surface choices.
- **"A release `deep-show` with the full set seals"** (AC2): started with `run`, it answers the scenario (exit 0,
  `ok: true`) instead of the seal's one refusal line and exit 2. **"The release-build case … passes"**: before it
  compares keys, that case shows every fixture the full build lists and evaluates it clean at 0.5 s under hash@2 in
  the release build; this test does the same, in two processes rather than one per fixture (fixtures without a record
  in one, each to its own document; one with a record in its own, with the record), from the release build's own
  listing. The equality of keys across builds and machines is #855's, untouched here, and stays with the named case.
- **"#154's suite passes unchanged"** (AC3): of #154's suite, the files that read motion's score check through
  `deep_show` alone, its criterion 6 in the first draft and the redraft, run unchanged; every test in them passes and
  none is skipped. The suite's other files start hubs, install the score plug-in and render stems through the
  supervisor, which takes hours; they stay the implementer's to run whole.

## Base results

`BASE-FAILURE.txt` is the one run at the base: 3 tests, 2 fail and 1 passes.

- AC1 fails for the issue's reasons: core's and motion's kit verdicts are FAIL and the ledger records FAIL for both;
  each of the twelve codes has no planted document (`unproved`); core's `time_order` twin on
  `code-pack-missing.board` passes (`twin_passed`, the case INVALID) and the case says nothing of why.
- AC2 fails at the seal: `seal_refused`, `kit_failed`, naming `motion` and `text`.
- AC3 passes, as it must: #154's suite passes at the base, and the test guards it through the change.

## Not tested, because no criterion reaches it here

The two named suites themselves (AC2's and AC3's proof, the implementer's to run); `scripts/canvas-kit.mjs`'s run
over every module and its exit status, which other modules' verdicts decide; the verdicts of modules other than core
and motion, and their ledger records; the catalog of the surface a code leaves motion's catalog for; key equality
between the debug and the release build (#855's).
