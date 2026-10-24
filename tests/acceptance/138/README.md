# Acceptance tests for #138: the canvas conformance kit — every canvas module proved alone, headless, in the local preflight

Written first, from issue #138 (its scope, its 29 acceptance criteria and its proof line), its Oracle page
(`doneright/oracles/issues/138.md`: only criteria 24 and 25 have upstream tests, Skia Gold's fuzzy and
sample-area matchers and its positive, negative and untriaged pass-fail; their files aren't in this repo, so the
behavior is taken from the page's description), the design sections the issue names, and base commit `e9c601b`
("Merge pull request #692 … feat/670-checkpoint-figure"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job.

What was read:

- `docs/technical-design.md`: Rules every primitive follows (863: data not code, checks read only the lowered
  form, pure evaluation and carried state, "Every failure comes back as data: the check, the IDs, the time and a
  fix", seeded and replayable, universal rules as properties); How we know version 0 works (2476): Conformance
  tests (declared coverage never reached is INVALID, a probe the backend can't make is BLOCKED naming it, never a
  pass), Kit hygiene, Generated edges and exact issues (every planted entry and clean twin names its exact codes,
  empty for a twin; a fix as patch ops is proven by a second check), Wrong programs, the edit guard (a
  re-recorded golden lands untriaged; a tolerance only tightens), the Canvas modules bullet, the parity-suite
  paragraphs (2538–2542: planted-mismatch twins, no may-fail fixture, goldens blessed only by your decision, a
  golden's first blessing names a fixture set outside the implementation or is `regression_only`, the GPU
  golden's first blessing after the analytic and CPU-reference criteria on the same commit, a driver update
  blessed by re-rendering the recorded commit, a ceiling and a window bound beside every share of pixels, and
  positive, negative and untriaged digests with one alternative per backend fingerprint), Independent first
  oracles and golden triage (2556), Decisions (2655: the parity suite's fixtures are our own documents using
  existing check kinds, the named oracles stay reviewed test code, local preflight only).
- `docs/canvas-primitives.md`: Patch (451: rebase by the IDs a patch touches; the kit's patch fuzzer and its five
  laws), Migration (515: the corpus, "a difference fails the release, naming the kind, the item, the field and the
  first time that differs", 1,000 seeded param sets per migrated kind), Canvas module (985), Canvas module:
  interface and implementation (1010: a release build refuses an implementation that hasn't passed its kit;
  `regression_only`), Registry and seal (1029), Operator and read set (1106), Array and table (1122:
  `contributes_to`), Carried state (1161) and its cache manifest (1178), Check input (8164: the core's check kinds
  read only the core's arrays, glyph boxes among them, which canvas modules fill through `contributes_to`), What
  holds a document to its rules (8160: issues as data, the check catalog, a fix is patch ops only where the kit
  applied it), Net: rollback (6902: a late entry, the default `window` of 8 steps, what replaced steps made is
  dropped).
- At the base: AGENTS.md; `tests/acceptance/387/` (closest: the same binary, per-feature builds, `planted`, the
  reference-Mac gate and the judge), `96/` (patches, writers, the process table and the peer check), `305/`,
  `670/`; `crates/deep-show` (`deep-show run`, `planted`, the `registry`, `fixtures` and `eval` calls, `shuffle`,
  `--planted`); `crates/deep-canvas/src/registry/`, `schedule/`, `document/` (issues carry `fix` as text, and
  notices such as `migrated`); `crates/deep-canvas-test-modules`; `crates/deep-canvas-marks/src/modules.rs` and
  `crates/deep-canvas-motion/src/module.rs` (the shipped canvas modules: `text`, `look`, `marks2d`, `motion`);
  `scripts/lanes.mjs` (the quick lanes), `scripts/parity.mjs` (a CLI parity check; there is no `parity/` tree),
  `scripts/benchmark.mjs` and `benchmarks/budgets.json` (the perf lane).

What the base already does and these tests don't credit: modules register fixtures (`fixtures` call), the
scheduler evaluates clean and perturbed frames and shuffles legal orders (`eval`, `shuffle`), and #96's hub
rebases a stale patch by the IDs it touches. It has no kit: no `kit`, `manifest`, `catalog`, `golden`, `record`,
`goldens`, `decide`, `corpus_record` or `compare_images` call, no check catalog, no fix as patch ops, no golden
store, no category list or sidecars, no carried state, no late entries, no ledger and no `test-kit-*` feature.

**The base does not build.** At `e9c601b`, `cargo build` fails in `deep-canvas`
(`crates/deep-canvas/src/document/rows.rs:256: cannot find function cell`): #690 removed the helper `cell` that
#670 still calls, and the two merged without a rebuild. So every test fails at the base on cargo's error before
it reaches its surface. `BASE-FAILURE.txt` holds that run, and a second run against a scratch copy of the base with
only #690's `cell` put back (outside this repo), where the tests fail on the missing surface instead.

## Run them

They build cargo binaries per feature set, like #387's, so they run with `--no-file-parallelism`.
`scripts/lanes.mjs` needs this folder added to both unit-lane lines (`--exclude tests/acceptance/138/**` on the
parallel line, `tests/acceptance/138/` on the one-at-a-time line); this README is the instruction and the
implementer makes that edit.

```sh
npm ci && npm run build --workspaces   # once
npx vitest run --root tests/acceptance/138 --no-file-parallelism
npx tsc -p tests/acceptance/138/tsconfig.json
```

Every file builds each feature set it uses once (`cargo build --locked --bin deep-show --no-default-features
--features <set>[,<test feature>…]`), copies the binary out under its own name, and fails each test that uses a
build that failed. `release.test.ts` also makes two release builds (`--release`). Each test opens an evidence
store root in a temporary folder and deletes it; the golden stores, corpora and ledgers the tests use are
temporary folders too. Node built-ins and vitest only.

Gates:

- `budgets.test.ts` (criterion 18) runs only on a reference Mac (Mac15,7 or Mac15,12) on mains power with Low
  Power Mode off and no thermal warning (#387's `environmentProblem`); anywhere else it skips with an
  INCONCLUSIVE message, and a reading between the limit and the margin also skips as INCONCLUSIVE. It never
  passes by skipping. Its merge-base comparison is the perf lane's.
- `gpu.test.ts`'s GPU halves (criteria 16, 19's GPU half, 23 and 26) render on the `gpu` backend, so they run
  only on a reference Mac (`gpuProblem`: the model, chip and memory, not the power state); elsewhere they skip as
  INCONCLUSIVE after their GPU-free preconditions ran. The kit takes the GPU lease itself and says so
  (`lease.gpu`); the tests check it did. Criterion 19's noop half runs everywhere.
- Everything else runs headless on Vello CPU and the `noop` backend, with no GPU and no app.

Sizes are the issue's: 10,000 sequences per shipped canvas module, 8 shuffled orders, 100 seeded times, 1,000
param sets per migrated kind. Tests of a planted test module ask for fewer sequences (stated per test) only to
find a planted fault; the kit's own default stays 10,000, which `shipped.test.ts` runs.

## The surface under test

The issue names a kit, its parts, fixtures with sidecars, a manifest, a category list, goldens, decisions and a
release gate, but no command. These tests extend `deep-show run` (#393's scenario binary, which #305, #387 and
#96 extended): its Cargo features select the build set and the test canvas modules, and new calls carry the kit.
Everything #393's, #96's and #387's READMEs define stays as it is (JSON lines, `bad_input`, sessions, the process
table and the peer check, panels, docs, `evidence`, patches and their replies, `eval`, `fixtures`, `registry`,
`shuffle`). What follows is added.

Words: **you** are a `deep show` call (`peer`) whose process runs in no agent's tree; an **agent** is a
`deep_show` call (`session`) or a `deep show` call from inside an agent's tree (#96's peer check). The **R2
canvas modules** are the canvas modules the shipped `full` build holds (`registry.modules`; at the base `look`,
`marks2d`, `motion` and `text`). A **fixture name** is `parity/<category>/<name>.<profile>`, `<profile>` being its
document's `profile` (`board`, `film`, …) or `scene` for a scenario of calls.

### Scenario fields added

```json
{"planted"?: #387's values | the kit's twins below,
 "goldens"?: dir,                       // the golden store; without it, the repo's committed store
 "environment"?: {"os"?: string, "driver"?: string},  // what every backend reports as its OS and driver for this run
 "commit"?: string,                     // the commit this run renders at (default: the checkout's HEAD)
 …}
```

`environment` stands in for an OS or driver update; it enters each backend's environment digest and fingerprint.
`planted` takes these values, each a wrong program reachable only there:

| Value | The wrong program | Criterion |
|---|---|---|
| `key_without_params` | content keys leave out an item's canonical params | 1 |
| `refusal_without_code` | the core refuses some invalid patches with no code | 2 |
| `refused_patch_writes` | a refused patch still changes the canonical bytes | 2, 20 (law 2) |
| `dry_run_skips_recheck` | a dry run returns before the incremental re-check | 20 (law 1) |
| `undo_reorder_mints_key` | the undo of a reorder mints a new order key | 20 (law 3) |
| `apply_time_order_keys` | order keys are drawn when a patch applies, not from its base | 20 (law 4) |
| `incremental_check_skips_referrers` | the incremental check after a patch skips items that refer to what it touched | 20 (law 5) |
| `rebase_by_path` | a stale patch rebases when no *path* it writes changed since its base | 3 |
| `fuzzer_runs_none` | `patch_fuzz` runs no sequence and exits 0 | 9 |
| `part_runs_half` | `clean_rebuild` runs half its declared sequences and exits 0 | 9 |
| `exit_zero_with_failed_case` | `schedule` exits 0 with a failed case in its results | 9 |
| `counts_declared_as_reached` | the kit counts a case's declared coverage as reached | 11 |
| `skips_snapshot_comparison` | the kit passes a snapshot case without comparing its pixels | 12 |
| `checks_expected_code_only` | a case passes when its expected codes are among those raised | 28 |
| `accepts_agent_decisions` | a decision is taken from an agent as from you | 17 |
| `every_digest_positive` | the golden store reads every recorded digest as positive | 25 |
| `checks_share_only` | `compare_images` checks only the share of pixels off | 24 |

### The kit: `{"call": "kit", …}`

```json
{"call": "kit",
 "modules"?: [canvas module],   // default: every canvas module the build holds
 "parts"?: [part],              // default: every part
 "backends"?: [backend],        // "vello_cpu" | "noop" | "gpu"; default ["vello_cpu", "noop"]
 "seed"?: u64,                  // default 138; every seeded draw derives from it and the reply records it
 "sequences"?: u32,             // fuzzed patch sequences per module for clean_rebuild and patch_fuzz; default 10000
 "param_sets"?: u32,            // seeded param sets per migrated kind; default 1000
 "patch_seed"?: u64,            // patch_fuzz only: draw and check exactly the one patch with this seed
 "replay"?: path,               // replay one crash-corpus file the kit wrote
 "corpus"?: dir,                // the migration corpus to load (criterion 6)
 "ledger"?: file}               // write each module's result to this ledger (criterion 5)
```

runs the kit over each module in name order and answers as below. The core's own fixtures (the kit's
framework scenes among them, such as `parity/framework/agent-decision.scene`, which tries an agent's bless, loosen
and waive and passes only when each is refused) run as the module `core`, which `modules` may name.

```json
{"verdict": "PASS" | "FAIL" | "INVALID" | "BLOCKED", "seed": u64, "backends": [backend],
 "lease": {"gpu": bool},        // whether the kit took the GPU lease
 "modules": [{"module", "version", "digest", "verdict",
              "parts": [{"part", "verdict", "declared": n, "ran": n, "exit": int,
                         "seeds"?: [u64], "stats"?: {…}, "cases": [Case], "failures": [Failure]}],
              "failures": [Failure], "interface"?: {"truth": bool, "missing": [kind | check kind]}}],
 "corpus": [path],              // crash-corpus files this run wrote
 "criteria": {criterion ID → "proved" | "open"}}   // from the fixtures' sidecars
```

- A **module's verdict** comes from its parts' verdicts, each **part's verdict** from its own cases' verdicts,
  never from an exit code (`exit` is the part's own status, 0 when it returned normally). A part lists every case
  it ran (`cases.length == ran`), and must run every case it declares, at least one: `ran < declared`, or
  `declared` 0, fails the module with `short_run {part, declared, ran}`; a part that exits 0 with a failed case
  fails it with `failed_case {part, case}`. A part a module has nothing for (carried state for a module with
  none) isn't listed. FAIL ranks above INVALID above BLOCKED above PASS.
- A **Case**: `{"case": string, "verdict", "fixture"?: name, "backend"?: backend, "seed"?: u64, "declares"?:
  Coverage, "reached"?: Coverage, "probe"?: string, "expected_codes"?: [code], "raised_codes"?: [code],
  "twin"?: {"verdict"}, "failure"?: Failure, …}`. Coverage is `{"kinds": [kind], "fields": ["<kind>/params/<name>"],
  "modules": [module]}`. `reached` is what the kit really saw the case reach (an item of the kind evaluated, the
  field set or read by an operator, the module's operators run); a declared kind, field or module it never reached
  makes the case INVALID with `unreached {kind | field | module}`. A probe the backend can't make (pixels from
  `noop`; a GPU pass's pixels from `vello_cpu` or `noop`) makes the case BLOCKED on that backend with `probe`
  named, never a pass; a case BLOCKED on every backend run fails the module with `unproved {case, probe}`.
- **Every comparison of two outputs** (clean rebuild against incremental, reftest, golden, seek against play,
  warm against cold, migrated against recorded) runs its planted-mismatch twin, the change its sidecar's `twin`
  names or one the part plants, and records `twin: {verdict}`; a comparison whose twin passes is INVALID,
  `twin_passed {case}`. A snapshot comparison also records `compared: {"expected": sha256, "actual": sha256}`,
  the two renders' digests, so a case that compared nothing can't pass unseen.
- **Exact codes**: every planted fault, clean twin and code fixture names the exact set of codes it raises
  (`codes` in its sidecar, empty for a clean twin); the case records `expected_codes` and `raised_codes` (issue
  and notice codes) and fails, `unexpected_codes {case, fixture, extra: [code], missing: [code]}`, when they
  differ.
- **Case fields per part**: `repair_loop` cases carry `fault: {path, code, fix}` and `steps` (the apply case's
  are `["fault", "issue", "apply", "rerun", "pass"]`); `late_entry` cases `entry: {step, arrived}`; `time_order`
  cases `times`; `contribution` cases `kind`; `catalog` cases are either a code's planted fixture, `{code,
  fixture, expected_codes, raised_codes, issue: {code, what, fix}}`, or an ops fix applied, `{fix_of: code,
  fixture, second_check: [code]}`; `migration` cases are a corpus document's (`case` is its name, with `compared:
  {times: [flicks], values: n, snapshots: n}`) or one param set's (`kind`, `seed`). Failures are listed in the
  order the kit met them.
- **Failure codes** (closed list; each also carries `module` and `part`): `crash {seed, corpus}`, `panic {seed}`,
  `mismatch {what: "array" | "cache" | "key" | "snapshot", name, seed}`, `refusal_without_code {seed}`, `law {law:
  1..5, seed}`, `roundtrip {seed}`, `undeclared_read {operator, array}`, `order {operator, seed}`, `step_hash {step}`,
  `late_entry {step}`, `time_order {t, during: "straight" | "back" | "shuffled"}` (one per case, at the first time
  in play order where the warm instance differs), `contribution {kind, array}`, `uncatalogued {code}`, `unexpected_codes`,
  `ops_fix {code, added: [code], missing: [code]}`, `unproved_fix {code}`, `unreached`, `unproved`, `twin_passed`,
  `short_run`, `failed_case`, `migration {kind, item, field, t}`, `migration_range {kind, seed, param}`,
  `tolerance {fixture, missing: ["ceiling" | "window" | "reason"]}`, `formula {fixture, path}`, `check_kind
  {fixture, kind}`, `oracle {fixture, oracle}`, `repair {case}`. Times are flicks; steps are integers.

### The kit's parts

| Part | Cases | What it holds the module to |
|---|---|---|
| `fixtures` | one per fixture per backend, plus each fixture's sidecar checks | each fixture is presented and passes its sidecar's checks against their named oracles; sidecars hold only existing check kinds, oracles from the closed list, and no formula or code; every tolerance class with a share has a ceiling, a window and a reason; snapshot cases per backend; goldens; coverage; exact codes |
| `clean_rebuild` | one per fuzzed sequence (`sequences`) | after each seeded sequence of patches, every array, cache, content key and the snapshot at the fixture's fixed times equal a clean rebuild of the same revision (the shadow); `stats.compared` counts `{arrays, caches, keys, snapshots}`; a crash writes a corpus file under `<evidence>/corpus/` holding `{module, part, seed, document, patches}` |
| `patch_fuzz` | one per fuzzed sequence | random valid and invalid patches over every kind and op, replayable from the seed: no panic, every refusal carries a code, a refused patch leaves the canonical bytes unchanged, an accepted one round-trips (its revision written canonically and read back gives the same bytes), and Patch's five laws on every patch drawn. `stats: {drawn, accepted, refused, refused_without_code, refused_changed, roundtrip_failed, panics, ops: {op → n}, kinds: [kind], laws: {"1".."5" → {checked, failed}}, digest}`, `digest` a SHA-256 of the drawn sequences |
| `read_set` | one per perturbation target per node | #387's read-set perturbation and access log over the module's fixtures |
| `order` | 8 shuffled legal orders per fixture | `seeds` lists the 8 shuffle seeds (#387's `shuffle`); every key and result equal the unshuffled order's |
| `schedule` | one | the module's slice of the published schedule equals its committed snapshot |
| `repair_loop` | `apply`, `stale_rebase`, `stale_same_item`, `conflicting`, `dry_run_refused` | each planted fault, carrying `fault: {path, code, fix}`, runs fault, issue, apply, rerun and PASS (`steps`); a stale fix rebases when no ID it touches changed (`stale_rebase`), a fix after another writer changed another path of the same item is a conflict naming both writers (`stale_same_item`), the second of two fixes is refused naming both writers (`conflicting`), a fix whose dry run fails is refused with its refusal code (`dry_run_refused`) |
| `carried_state` | one per checkpoint per fixture | seeks from each checkpoint and plays on; every step hash equals a straight run's, from the restored checkpoint's own step on |
| `late_entry` | one per declared input entry per lag 1..8 | modules with carried state but media: the entry arrives up to the default rollback window (8 steps) after its step; every checkpoint at the nearest checkpoint step at or before it is restored and stepped forward, as a match does; step hashes, checkpoints and occurrences must equal the on-time run's. A case records `entry: {step, arrived}` |
| `time_order` | one per fixture | one warm instance plays the fixture's times straight, then steps back one frame at a time, then 100 seeded times in shuffled order, against a cold instance at each time, in every evaluated array and key outside declared carried state; the case records `times: {straight, back, shuffled}` in flicks |
| `contribution` | one per kind the module registers that draws glyphs, strokes or solids or places shots, cuts and holds | the kind contributes to the core's glyph-box, stroke, true-shape or timeline array through `contributes_to` |
| `catalog` | one per code the module can emit, plus one per ops fix applied | every code a module emits is in the catalog; every catalog code has a planted fixture that raises it with its meaning and fix; every fix given as `fix_ops` is applied on each kit fixture that raises its code and the second check returns that fixture's other codes and nothing else |
| `migration` | one per corpus document in `corpus`, plus `param_sets` per migrated kind (one per param set) | corpus documents migrate at load and give their recorded values and Vello CPU snapshots at every sampled time; 1,000 seeded param sets per migrated kind (each param at min, max, default, absent and inside its range) pass the new schema, keep every ID and give identical bytes twice |

Every module runs `fixtures`, `clean_rebuild`, `patch_fuzz`, `read_set`, `order`, `schedule`, `repair_loop` and
`time_order`; the others where the module has what they test.

### A release build refuses what failed the kit

`kit` with `ledger: file` writes the file as `{module → {"version", "digest", "verdict", "parts": {part →
verdict}}}` for every module it ran. A release build (`cargo build --release`) embeds the ledger named by the
build-time variable `DEEP_KIT_LEDGER` (default: the implementer's committed ledger), and its seal refuses at
startup every canvas module, shipped or test, whose ledger record is missing, has another digest or isn't PASS:
one line `{"ok": false, "code": "seal_refused", "reason": "kit_failed", "modules": [module], …}` and exit 2, as
#305's refusals.

### Calls added

- **`{"call": "manifest"}`** → `{"categories": [21 names], "oracles": [name], "check_kinds": [kind], "kinds":
  [kind], "fixtures": [{"name": fixture name, "module": canvas module | "core", "category", "profile",
  "document": Document, "sidecar": Sidecar}]}`. One category list and one naming scheme; `oracles` is the runner's
  closed list of named oracles (reviewed test code, `analytic`, `cpu_reference`, `golden` and `reftest` among
  them); `check_kinds` the document check registry's kinds; `kinds` every item kind the build registers. The
  manifest lists the issue's three scenes, `parity/kernel/clean-rebuild-fuzz.scene`,
  `parity/kernel/patch-fuzz.scene` and `parity/framework/repair-loop.scene`, the kit's
  `parity/framework/agent-decision.scene`, and every fixture each module registers (the `fixtures` call's,
  with the same document).
  A **Sidecar** is data only, with these keys and no others: `checks` (Check inputs: `{kind, probe, at_times,
  expect, tolerance, except, render, sweeps, declared_cuts}`, `kind` from `check_kinds`), `oracles` (from
  `oracles`), `covers` (Coverage), `codes` (the exact codes it raises), `twin` (`{path, value}`: its comparison's
  planted mismatch), `expected_from` (`analytic | upstream | issue | second_implementation`, when its expected
  value was set outside the implementation), `criteria` (criterion IDs it proves), `inputs` (input entries
  `{step, kind, value}`), `at_times`. A **tolerance** is `{"within": N code values, "on": P percent of pixels,
  "ceiling": code values no pixel may pass, "window": {"size": px, "off": max pixels off in any size × size
  window}, "reason": string}`.
- **`{"call": "catalog"}`** → `{"codes": [{"code", "module": canvas module | "core", "meaning", "fix": string,
  "fix_ops": bool, "fixture": fixture name}]}`: the check catalog. An issue gains `fix_ops?: [op]` beside its text
  `fix` when its code's fix is patch ops.
- **`{"call": "golden", "fixture", "backend"}`** renders the fixture's snapshot on the backend and judges it
  against the store: `{"verdict", "digest": sha256 | null, "environment": digest, "fingerprint": string, "commit",
  "match": {"digest", "state": "positive" | "negative" | "untriaged", "bug"?} | null, "reason"?, "criterion"?,
  "probe"?, "ask": {"kind": "bless", "fixture", "digest"} | null}`. Only a match to a positive passes; a negative
  fails, `reason: "negative"`, naming its `bug` in `match`; an untriaged digest reads BLOCKED, `reason:
  "untriaged"`; a GPU golden compares only under an equal environment digest (BLOCKED, `environment_changed`,
  under another), and a digest no entry holds under an unchanged environment digest is a FAIL,
  `pixels_changed`. A fixture with no golden yet reads BLOCKED, `no_golden`, and raises the first-blessing `ask`
  only once its sidecar's analytic and CPU-reference criteria pass on this commit; otherwise `ask` is null and
  `reason: "criterion_failed"`, `criterion` naming it. A probe the backend can't make reads BLOCKED with `probe`.
- **`{"call": "record", "session"? | "peer"?, "fixture", "backend"}`** renders the fixture and records its digest in
  the store as `untriaged`, by whoever calls: `{"outcome": "recorded", "digest", "state": "untriaged"}`. Recording
  decides nothing.
- **`{"call": "goldens", "fixture"}`** → `{"digests": [{"digest", "state", "bug"?, "backend", "fingerprint",
  "environment", "commit", "recorded_by": writer, "decision"?}], "first_oracle": fixture name | null, "standing":
  "truth" | "regression_only"}`. At most one positive per backend fingerprint.
- **`{"call": "decide", "session"? | "peer"?, "decision": D}`** takes one decision, only from you; from an agent it
  answers `{"outcome": "refused", "code": "not_your_decision", "writer": {kind, id}}`. D is one of `{"bless":
  {fixture, digest, backend}}`, `{"negative": {fixture, digest, backend, bug}}`, `{"loosen": {fixture, tolerance,
  reason}}`, `{"waive": {fixture, reason}}`, `{"rebless": {cause, backend}}` and `{"accept_corpus": {corpus, name,
  cause}}`. It answers `{"outcome": "decided", "decision": ID, "fixtures": [fixture name], "first_oracle"?:
  fixture name | null, "standing"?: "truth" | "regression_only"}`. `rebless` re-renders, at this run's `commit`,
  every golden of that backend whose environment digest the cause changed, and blesses them all as one decision;
  it is refused, `{"outcome": "refused", "code": "wrong_commit", "commit": this run's, "recorded": [commit]}`, when
  any of them was recorded at another commit. `bless` answers `first_oracle` (the fixture with `expected_from`
  whose check passed for the golden's kind) or null with `standing: "regression_only"`.
- **`{"call": "corpus_record", "corpus": dir, "name", "document", "times": [time]}`** writes `<corpus>/<name>.json`:
  the document as this build saves it, the module versions that saved it, and its evaluated values and Vello CPU
  snapshots at each time → `{"file": path}`. The kit's `migration` part loads every such file in `corpus` in a
  later build; `accept_corpus` blesses that build's new result for that cause.
- **`{"call": "compare_images", "expected": png, "actual": png, "tolerance": tolerance}`** (8-bit RGBA PNGs) →
  `{"verdict": "PASS" | "FAIL", "off": n, "allowed": n, "first_past_ceiling": {"x", "y", "delta"} | null,
  "window": {"x", "y", "size", "off"} | null}`. A pixel is off when any channel differs by more than `within`;
  `allowed` is the floor of (100 − `on`)% of the pixels. It fails when `off > allowed`, when any channel differs by
  more than `ceiling` (`first_past_ceiling`: the first such pixel in row-major order), or when any `size` × `size`
  window holds more than `window.off` pixels off (`window`: the first such window, its origin and its count).

### The quick lane and the perf lane

- `scripts/canvas-kit.mjs`: runs the default `kit` call (every part, Vello CPU and noop, no GPU) over the shipped
  `full` build through `deep-show run`, prints one line per module that isn't PASS, and exits 0 only when the
  kit's verdict is PASS. A check in `scripts/lanes.mjs`'s `checks` runs it (after a cargo build), so it runs in the
  local preflight's quick lanes, never on push or pull request.
- `benchmarks/budgets.json` gains the task `canvas-kit`, command `["node", "benchmarks/canvas.mjs", "kit"]`, with
  an `initialReason` naming #138, valid by `scripts/benchmark.mjs`'s `validateBudgets` against the merge base's
  budgets; the command exits 0.

### The test canvas modules (Cargo features of `deep-show`)

In no shipped build. A document that uses one's kind declares it in `requires.modules`. "Drawn as `rect@1`"
draws its `box` filled with the `ink` role, as #305's `test.a@1` does. A planted twin is the same module with
the one difference named, never built beside its clean twin.

| Feature(s) | Module | What it registers and does | For |
|---|---|---|---|
| `test-kit-crash` | `test.kit.crash` 1.0.0 | Kind `test.kit.crash@1` {`box`, `n: number = 0` (0..100)}, drawn as `rect@1`; operator `test.kit.crash.out` (items; reads `[self]`; writes `test.kit.crash.out`) **panics when `n` > 90** | 1, 2 |
| `test-kit-blind` / `-blind-fixed` | `test.kit.blind` 1.0.0 | Kind `test.kit.blind@1` {`box`, `shade: number = 0` (0..1)}, drawn as `rect@1` (shade draws nothing). Fixture `parity/kernel/blind-reftest.board`: a reftest (oracle `reftest`) of item `b1` against a `rect@1` of the same box; its twin is `{path: items/b1/params/shade, value: 1}`, which changes no pixel, so its twin passes. `-blind-fixed`: the twin is `{path: items/b1/params/box, value: the box 1 px wider}` | 4 |
| `test-kit-noisy` / `-noisy-fixed` | `test.kit.noisy` 1.0.0 | Kind `test.kit.noisy@1` {`box`, `bad: bool = false`, `weight: number = 0` (0..1e9), `hint: bool = false`}, drawn as `rect@1`; its check raises `test.kit.noisy.bad` (error) on `bad`, the notice `test.kit.noisy.hint` on `hint`; `weight` is CPU ms per frame in its cost term. Fixtures: `parity/kernel/noisy-fault.board` (sidecar `codes: [test.kit.noisy.bad]`; its item is `bad` and weighs 1e6, so it also raises `over_budget`) and `parity/kernel/noisy-twin.board` (`codes: []`; its item has `hint`). `-noisy-fixed`: the fault's item weighs 0 and the twin's has no hint | 28 |
| `test-kit-fixer`, `-fixer-dangles`, `-fixer-unproved` | `test.kit.fixer` 1.0.0 | Kind `test.kit.fixer@1` {`box`, `x: number = 0` (0..1000), `y: number = 0` (0..1000), `link: ID \| null = null` (a reference)}, drawn as `rect@1`. Its check raises `test.kit.fixer.y_over` (error) on `y` > 100 at `items/<id>/params/y`, fix text and `fix_ops: [{op: set, id, path: items/<id>/params/y, value: 100}]`, and `test.kit.fixer.x_odd` (warning) on an odd `x`, a text fix only. Fixtures `parity/framework/fixer-y-over.board` (`codes: [test.kit.fixer.y_over]`), `parity/framework/fixer-x-odd.board` (`[test.kit.fixer.x_odd]`), `parity/framework/fixer-clean.board` (`[]`). `-dangles`: `y_over`'s ops also set `items/<id>/params/link` to `ghost`, an ID no item has. `-unproved`: also registers `test.kit.fixer.y_under` (error on `y` < 0, which the range never lets through) with `fix_ops`, and no fixture raises it | 3, 7, 29 |
| `test-kit-rogue` / `-rogue-listed` | `test.kit.rogue` 1.0.0 | Kind `test.kit.rogue@1` {`box`, `odd: bool = false`}; its check raises `test.kit.rogue.unlisted` on `odd`, a code it never registered in the catalog; fixture `parity/kernel/rogue.board` (`codes: [test.kit.rogue.unlisted]`). `-listed`: the code is registered with its meaning and fix | 7 |
| `test-kit-carry` / `-carry-drops-hits` | `test.kit.carry` 1.0.0 | Kind `test.kit.carry@1` {} (draws nothing); steps in simulate at 60 Hz (step k at k/60 s, k = 1, 2, …) with carried state `{count, hits}`: each step adds 1 to `count`, and 1 to `hits` when `count` is then a multiple of 3; checkpoints at steps 10, 20, 30, 40, 50, each the state before that step runs; a step's hash is the hash of the state after it. Fixture `parity/kernel/carry.board`, 1 s. `-drops-hits`: its checkpoint leaves out `hits` (restored as 0), so a seek from step 10's checkpoint first differs from a straight run at step 10 | 5, 8 |
| `test-kit-tally`, `-tally-keeps-occurrence`, `-tally-skips-restored` | `test.kit.tally` 1.0.0 | Kind `test.kit.tally@1` {}; steps at 60 Hz with carried state `{count, bumps}` and checkpoints as `test.kit.carry`'s; at each step it adds the values of the input entries `{kind: "bump", value}` stamped at that step to `bumps`, adds 1 to `count`, and makes the occurrence `test.kit.tally.even {step}` when `count + bumps` is even. Fixture `parity/kernel/tally.board`, 1 s, sidecar `inputs: [{step: 20, kind: "bump", value: 1}]` (on a checkpoint step). `-keeps-occurrence`: on a rollback it keeps the occurrences the replaced steps made. `-skips-restored`: on a rollback it restores its whole state but skips an entry stamped at the restored checkpoint's own step. Neither differs on a seek | 10 |
| `test-kit-cover` / `-cover-fixed` | `test.kit.cover` 1.0.0 | Kind `test.kit.cover@1` {`box`, `w: number = 10` (0..100), `ghost: number = 0` (0..1)}, drawn as `rect@1` `w` wide; no operator reads `ghost`. Fixture `parity/kernel/cover.board` (an item with `w` 20), whose case declares `covers: {kinds: [test.kit.cover@1], fields: [test.kit.cover@1/params/w, test.kit.cover@1/params/ghost], modules: [test.kit.cover]}`. `-fixed`: it declares only `w` | 11 |
| `test-kit-snap` / `-snap-off` | `test.kit.snap` 1.0.0 | Kind `test.kit.snap@1` {`box`}, drawn as `rect@1`. Fixtures `parity/kernel/snap-reftest.board` (a reftest of `s1` against a `rect@1` of the same box; a snapshot case) and `parity/kernel/snap-golden.board` (a snapshot against a golden). `-snap-off`: its fill is one code value off in red | 12, 17, 25 |
| `test-kit-glyphs` / `-glyphs-no-box` | `test.kit.glyphs` 1.0.0 | Kind `test.kit.glyphs@1` {`box`, `text: string`}, drawing its text from the core's glyph atlas; its array `test.kit.glyphs.boxes` contributes to the core's glyph-box array. `-no-box`: no contribution | 13 |
| `test-kit-keys` / `-keys-kept-index` | `test.kit.keys` 1.0.0 | Kind `test.kit.keys@1` {`box`, `keys: [[seconds, value]]`}; operator `test.kit.keys.value` (items; reads `[self, t]`) writes the value at t, linear between keys, held outside them. Fixture `parity/kernel/keys.board`: keys `[[0, 0], [0.5, 10], [1, 20]]`, sidecar `at_times` 0 to 1 s every 1/60 s (61 times). `-kept-index`: the operator keeps its last key index between evaluations and searches only forward from it, so the first step back from 1 s (59/60 s) reads 20 where a cold instance reads 19.67 | 14 |
| `test-kit-formula` | `test.kit.formula` 1.0.0 | Kind `test.kit.formula@1` {`box`}; fixtures `parity/kernel/formula-expect.board` (a check whose `expect` is `"box.w * 2 + 1"`), `parity/kernel/formula-kind.board` (a check of kind `test.kit.formula.made_up`, in no registry), `parity/kernel/formula-oracle.board` (oracle `eyeball`, not in the list) | 15 |
| `test-kit-gpu-pass`, `-gpu-pass-shifted`, `-gpu-pass-cpu-ref-fails` | `test.kit.gpu` 1.0.0 | Kind `test.kit.gpu@1` {`box`}, filled by a GPU pass the module registers (`registers.passes`), with a Vello CPU path for its CPU reference. Fixtures `parity/scene/gpu-pass-a.board` and `parity/scene/gpu-pass-b.board`, each with an analytic criterion (its bounds) and a CPU-reference criterion (oracle `cpu_reference`), and a snapshot case: a reftest against a `rect@1` of the same box, exact. `-shifted`: the pass's output is one code value off in red. `-cpu-ref-fails`: its CPU path draws the box 4 px narrower, so the CPU-reference criterion fails | 16, 19, 23, 26 |
| `test-kit-sneak` | `test.kit.sneak` 1.0.0 | Kind `test.kit.sneak@1` {`box`}; operator `test.kit.sneak.src` (reads `[self]`) writes `test.kit.sneak.src` and leaves it in a static; `test.kit.sneak.out` (reads `[self]` only) reads that static | 21 |
| `test-kit-order` | `test.kit.order` 1.0.0 | Kind `test.kit.order@1` {`box`}; operators `test.kit.order.a` and `test.kit.order.b` (items; each reads `[self]` only): `a` writes its item's ID and leaves it in a static, `b` writes the static's value, so `b`'s result depends on the order the two run in | 21 |
| `test-kit-mig-1`, `-mig-2`, `-mig-2-moves`, `-mig-2-overflow` | `test.kit.mig` 1.0.0 / 2.0.0 | 1.0.0: kind `test.kit.mig@1` {`box`, `w: number = 10` (0..100)}, drawn as `rect@1` `w` wide. 2.0.0: kind `test.kit.mig@2` {`box`, `width: number = 20` (0..200)}, drawn `width / 2` wide, with the migration from major 1 `width = 2 × w`, so a migrated document draws the same. `-moves`: the migration gives `2 × w + 1`. `-overflow`: it gives `3 × w`, so the old max (100) maps out of range (300). A document saved by 1.0.0 requires `test.kit.mig` `^1`; that requirement migrates with the kind at load | 6, 22 |
| `test-kit-loose` | `test.kit.loose` 1.0.0 | Kind `test.kit.loose@1` {`box`}; fixtures `parity/kernel/loose-no-ceiling.board`, `parity/kernel/loose-no-window.board`, `parity/kernel/loose-no-reason.board`, each a snapshot within 1 code value on 99.9% missing the one thing its name says | 24 |
| `test-kit-selfish` / `-selfish-analytic` | `test.kit.selfish` 1.0.0 | Kind `test.kit.selfish@1` {`box`}; fixture `parity/kernel/selfish.board`, a snapshot against a golden (its own first render), sidecar `criteria: ["#999.0badc0de"]`. `-analytic`: also `parity/kernel/selfish-analytic.board`, whose check's expected bounds are written in its sidecar (`expected_from: analytic`) and whose `criteria` hold the same ID | 27 |

## Fixtures

- `fixtures/parity/framework/repair-loop.scene.json`: the issue's repair-loop scene as #96's scenario calls on
  a shared board: item `a` (`test.kit.fixer@1`, `y` 150) in alpha's layer and `b` (`rect@1`) in yours, and five
  acts (`apply`, `stale_rebase`, `stale_same_item`, `conflicting`, `dry_run_refused`), each its own scenario from
  revision 0, with who sends what written as `you`, `alpha` and `bravo`. The base has no `parity/` tree, so it is
  kept here, as #96's and #387's scenes were, to move when the corpus lands.

## Criteria to tests

IDs are `#138.<h8>`, the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace
collapsed and the leading `- [ ] ` dropped (#305's rule). Each test's name starts with its criterion's ID.

| # | ID | Tests (file: what each asserts, and the wrong program it fails on) |
|---|---|---|
| 1 | `#138.a5815177` | `shipped.test.ts`: the default kit over the R2 modules: each module's `clean_rebuild` declares and runs 10,000 sequences, PASS, comparing arrays, caches, keys and snapshots. `fuzz.test.ts`: `test.kit.crash` crashes, the failure names the seed and a corpus file the report lists, which exists and holds the seed, and replaying it crashes again; `key_without_params` fails `clean_rebuild` with `mismatch`. Wrong programs: the planted key; a crash that leaves no file |
| 2 | `#138.b4f429ff` | `shipped.test.ts`: `patch_fuzz` stats: no panic, no refusal without a code, no refused patch that changed bytes, no failed round-trip, every op and every kind drawn, valid and invalid; one seed gives one digest twice, another seed another. `fuzz.test.ts`: `test.kit.crash` is a `panic` naming the seed; `refusal_without_code` and `refused_patch_writes` fail, naming the seed |
| 3 | `#138.0770a3f0` | `repair.test.ts`: the kit's five repair-loop cases pass for the fixer and the R2 modules, each fault carrying `{path, code, fix}`; the scene through `deep-show run`: fault, issue (with `fix_ops`), apply, rerun, PASS; a stale fix to another item rebases; a fix to `items/a/params/y` after you changed `items/a/params/x` is a conflict naming alpha and you; two fixes, the second refused naming bravo and alpha; a fix whose dry run fails is refused with a catalogued code. `rebase_by_path` applies the stale fix, failing both the scene check and the kit's case |
| 4 | `#138.028c56e3` | `shipped.test.ts`: every comparison case has a twin that failed. `twins.test.ts`: `test.kit.blind`'s reftest reads INVALID, `twin_passed`; `-blind-fixed` passes |
| 5 | `#138.68b285c9` | `release.test.ts`: a ledger from the kit over `full,test-kit-carry-drops-hits` records `test.kit.carry` FAIL; the release build embedding it refuses to start, `kit_failed`, naming `test.kit.carry` and no shipped module; `full,test-kit-carry` with its own ledger starts and seals the module |
| 6 | `#138.7447bce1` | `migration.test.ts`: a corpus document recorded in `full,test-kit-mig-1` loads in `full,test-kit-mig-2` with a `migrated` notice and passes; in `-mig-2-moves` it fails naming `test.kit.mig`, item `m1`, a `width` field and the first sampled time; an agent's `accept_corpus` is refused and yours makes the next run pass |
| 7 | `#138.9e9940d1` | `catalog.test.ts`: `test.kit.rogue` fails `catalog`, `uncatalogued`, naming `test.kit.rogue.unlisted`; `-listed` passes; in the fixer build every catalog code has a module, meaning, fix and a fixture whose case raises exactly it, with the issue's fix equal to the catalog's |
| 8 | `#138.bf59b612` | `carried.test.ts`: `-carry-drops-hits` fails `carried_state`, `step_hash`, naming `test.kit.carry` and step 10; `test-kit-carry` passes |
| 9 | `#138.5aef0e9f` | `shipped.test.ts`: every part ran every case it declared, at least one. `twins.test.ts`: `fuzzer_runs_none` fails the module, `short_run` naming `patch_fuzz` and ran 0; `part_runs_half` names `clean_rebuild` and its count; `exit_zero_with_failed_case` fails it with the part's exit 0 |
| 10 | `#138.bd29bce3` | `carried.test.ts`: `-keeps-occurrence` and `-skips-restored` each fail `late_entry` naming `test.kit.tally` and step 20 while passing `carried_state`; `test-kit-tally` passes both, its late cases covering lags 1 to 8 |
| 11 | `#138.554b09da` | `coverage.test.ts`: the cover case reads INVALID naming `test.kit.cover@1/params/ghost`, with `w` reached and `ghost` not; `-fixed` passes; `counts_declared_as_reached` passes it, which the test's check rejects |
| 12 | `#138.97027c5b` | `coverage.test.ts`: the snap reftest is BLOCKED on noop naming its probe and passes on Vello CPU; with `backends: ["noop"]` the module fails, `unproved`; `-snap-off` fails on Vello CPU (the comparison ran); `skips_snapshot_comparison` passes `-snap-off`, which the check rejects. `shipped.test.ts`: every R2 snapshot case is BLOCKED on noop and PASS on Vello CPU |
| 13 | `#138.93adf6d7` | `coverage.test.ts`: `-glyphs-no-box` fails `contribution` naming `test.kit.glyphs@1`; `test-kit-glyphs` passes |
| 14 | `#138.b658e38b` | `time-order.test.ts`: `-keys-kept-index` passes the straight times and fails `time_order` naming `test.kit.keys` and 59/60 s, the first time stepped back; `test-kit-keys` passes; the times are 61 straight, 60 back and 100 distinct shuffled |
| 15 | `#138.230a6b92` | `manifest.test.ts`: 21 categories; every fixture named `parity/<category>/<name>.<profile>`, a document, a sidecar of existing check kinds and listed oracles, no formula, no may-fail; `test.kit.formula`'s three fixtures fail, `formula`, `check_kind`, `oracle` |
| 16 | `#138.da9f7979` | `gpu.test.ts` (reference Mac): two GPU goldens blessed under one driver pass; `-shifted` under it fails `pixels_changed`; under a new driver they read BLOCKED `environment_changed`; one `rebless` decision names both and they pass |
| 17 | `#138.8ef25182` | `goldens.test.ts`: an agent's bless, loosen and waive (MCP and from its tree) are refused, `not_your_decision`; yours are decided; the kit's fixture that tries (`parity/framework/agent-decision.scene`) passes, and under `accepts_agent_decisions` fails |
| 18 | `#138.4c95cab8` | `budgets.test.ts` (reference Mac): a quick lane runs `scripts/canvas-kit.mjs`; it passes over the R2 modules on Vello CPU and noop, no GPU lease, under 5 minutes in five runs judged by the design's rule; the perf lane's `canvas-kit` task is a #138 first measurement valid against the merge base's budgets; a shipped frame runs no operator after the first and allocates nothing after warm-up |
| 19 | `#138.19c7c27a` | `gpu.test.ts`: on noop and Vello CPU the GPU-pass snapshot case is BLOCKED naming its probe and the module fails `unproved`; on the reference Mac's GPU it passes under the lease, and `-shifted` fails naming the case |
| 20 | `#138.ca6ad34d` | `shipped.test.ts`: each law checked on patches with none failed. `fuzz.test.ts`: the four planted twins each fail `law` naming its law and a seed, and `patch_seed` with that seed fails it again, while the clean build passes that seed |
| 21 | `#138.417c9663` | `readset.test.ts`: `test.kit.sneak` fails `read_set`, `undeclared_read`, naming `test.kit.sneak.out` and `test.kit.sneak.src`; `test.kit.order` fails `order` naming one of its 8 seeds, and `eval` under that `shuffle` gives `test.kit.order.b` another result. `shipped.test.ts`: 8 distinct seeds per R2 module, PASS |
| 22 | `#138.1df954fa` | `migration.test.ts`: in `-mig-2` the kind's case runs 1,000 param sets, PASS; `-mig-2-overflow` fails `migration_range` naming a seed and `width` |
| 23 | `#138.d03b76eb` | `gpu.test.ts` (reference Mac): after a driver change, a `rebless` at a later commit is refused `wrong_commit` naming that commit; at the recorded commit it is decided |
| 24 | `#138.11bef137` | `tolerance.test.ts`: on 1920 × 1080 held to 1 code value on 99.9%, a 40 × 40 block 64 code values off fails, naming (1000, 500) and a window holding more than its bound; the bounds walk one below, at and one above (Skia's tests' shape); `checks_share_only` passes the block, which the check rejects; `test.kit.loose`'s three fixtures fail `tolerance` naming each fixture and what it lacks. `shipped.test.ts`: every share tolerance has both bounds and a reason |
| 25 | `#138.51f71c50` | `goldens.test.ts`: an untriaged digest reads BLOCKED; your positive passes; your negative fails naming its bug; an agent's re-record arrives untriaged and the fixture reads BLOCKED; at most one positive per fingerprint; `every_digest_positive` reads PASS after the re-record, which the check rejects |
| 26 | `#138.026a0dff` | `gpu.test.ts` (reference Mac): `test.kit.gpu`'s first golden raises a bless ask; `-cpu-ref-fails` raises none and reads BLOCKED naming `cpu_reference` |
| 27 | `#138.61aacaf4` | `goldens.test.ts`: `test.kit.selfish`'s blessed golden is `regression_only` with no first oracle, its interface not yet truth, and `#999.0badc0de` stays open; `-selfish-analytic` names `parity/kernel/selfish-analytic.board`, is truth and proves the criterion |
| 28 | `#138.0b7b2ee5` | `twins.test.ts`: `-noisy`'s fault fails naming `over_budget` and its twin fails naming `test.kit.noisy.hint`; `-noisy-fixed` passes; `checks_expected_code_only` passes the fault, which the check rejects. `shipped.test.ts`: every case with expected codes raised exactly them |
| 29 | `#138.c7f79e24` | `catalog.test.ts`: the fixer's ops fix applies on its fixture and the second check returns nothing else, PASS; `-dangles` fails `ops_fix` naming `test.kit.fixer.y_over` and `ref_unresolved`; `-unproved` fails `unproved_fix` naming `test.kit.fixer.y_under`; the text fix `x_odd` needs no application |

## Readings where the issue and design leave a choice

- **One binary, more calls.** The kit is a call in `deep-show run`, the binary the scheduler's and documents'
  tests use, so test canvas modules join as Cargo features and the kit sees the same seal, scheduler and hub.
- **Wrong programs** are reached through the scenario's `planted` field or a test feature, as #387's are. Where a
  criterion says "a kit (store, comparator) that does X passes it and fails this test", the test runs that X
  through a planted value and shows that its own check rejects what comes back.
- **"Fails the release"** (criterion 6) is the kit's verdict FAIL over a corpus; "blesses … once per cause" is one
  `accept_corpus` decision, after which the same corpus passes.
- **Crash corpus files** go under the run's `evidence` root, so a test never writes into the checkout; the
  implementer's preflight may copy them to the repo's corpus.
- **"The first step whose hash differs"** counts from the restored checkpoint's own step, so with
  `test.kit.carry`'s checkpoints (the state before steps 10, 20, …) the planted twin first differs at step 10.
  **The late entry** is the fixture's declared entry (step 20, value 1) arriving 1 to 8 steps late; both planted
  `test.kit.tally` twins first differ at step 20.
- **"The first time it is stepped back"** is `times.back[0]`: the straight play ends at 1 s, so it is 59/60 s.
- **Field coverage** is named `<kind>/params/<name>`. "Never sets or reads" is the item's param absent from the
  fixture and read by no operator.
- **A GPU golden's environment** is the backend's environment digest; `environment` in the scenario stands in for
  a driver or OS update. A rebless "at the commit it was recorded at" is read on the run's `commit`.
- **Criterion 18's "adds nothing at run time"** is read two ways: the perf lane's tasks compare the shipped build
  with the merge base, and a shipped frame still runs no operator after the first and allocates nothing after
  warm-up (#387's numbers) once the kit's fixtures and sidecars are registered.
- **The 21 categories** aren't named in the issue or design; the tests require 21 distinct names, `kernel`,
  `framework` and `scene` among them, since the issue and design name fixtures in those three.

Not tested, because no criterion asks or the surface can't reach it: the cache manifest's restart part
(`clean_rebuild` "for what it keeps on disk"; no shipped module keeps anything on disk), builds with each optional
canvas module left out, the export module's two laws, kit hygiene's expected failures and frozen requirement sets,
and the oracle lanes themselves (#136).

## Upstream tests (the Oracle lane)

Criteria 24 and 25 have upstream tests in skia-buildbot `3453607cf0` (fuzzy and sample-area matchers;
positive, negative and untriaged pass-fail). Their Go files aren't vendored in this checkout, so no runner can
feed them our output: that lane is BLOCKED with one unblock ask (vendor the files and a runner). The behavior
they check is ported here as our own tests (`tolerance.test.ts` walks each bound one below, at and one above;
`goldens.test.ts` checks positive, negative and untriaged), which count as this suite's proof, not as the
upstream test's.
