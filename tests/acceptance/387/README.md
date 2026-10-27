# Acceptance tests for #387: the canvas scheduler — closed phases, read sets, epochs and content keys

Written first, from issue #387 (its scope, its Phase, Operator and read set, Array and table, Dirty classes and
content key and Carried state field lists, its ten acceptance criteria and its proof line), its Oracle page, the
design sections it names and those they lean on, and base commit `a5aa0a3` ("Merge pull request #675 …
feat/305-shared-sealed"), by a job that never saw an implementation; none existed. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read:

- `docs/technical-design.md`: Rules every primitive follows (855: pure evaluation, "Low level, so it's fast"
  with "Each operator … is a pure function of its declared read set. Nothing reads what it didn't declare",
  seeded and replayable, "Universal rules are tested as properties"); The canvas core and Canvas modules
  (1041–1076: the scheduler, epochs and the content-key cache are the core's; the closed phase lists; simulate's
  step order derived from declared reads, "never from names"; "every operator declares its full read set; the
  core derives the order, the change test and every cache key from it"; "the scheduler's task lays R1's canvas
  code out as canvas modules"); Document (1084: `requires`); Dirty classes and content key (1483); the parity
  suite and Dogfooding (2508–2546).
- `docs/canvas-primitives.md`: Path and handle / ID (395–410: "Interned to `u32` handles with a generation per
  document session at load, so a stale handle is refused"); Document envelope (291: `seed`, `locale`,
  `transport.reduced_motion`); Scope and input classes (view inputs); Frame clock and scheduler (718: "never
  evaluate a hidden session"); Invalidation and damage (`changed_at`, `last_run`, "nothing is cleared per
  frame"); Canvas module (985), Registry and seal (1029: `plan`, `deep://schedule/<core version>`); Phase
  (1088); Operator and read set (1106: "Read-set perturbation changes, one at a time, every array, table, view
  input, look token, seed and asset a fixture session holds. A change outside an operator's read set leaves its
  key and result byte-identical. Equal keys always give byte-identical results"; test builds; `parallel`); Array
  and table (1122: `contributes_to`, epochs; "the owner's next operator reads every array registered for it");
  Carried state (1161); Mark set (2046); Content key (5049: the key's fields, "−0 as +0 … refuse a NaN or an
  infinity with `out_of_range`, naming the path", "the frame path never hashes an array's values to make a
  key", "include an epoch or any other change counter" it can never); Transport (5084: reduced motion "a text
  animator keeps only opacity"; "an export can render either" rendition); Text (1374), Text animator and
  counter (5839).
- At the base: AGENTS.md; `tests/acceptance/305/` (closest: the same binary, the build-per-feature-set
  helpers, the startup `--planted` argument, the reference-Mac gate and the judge), `393/`, `391/`, `375/`,
  `374/`, `96/` (its `fixtures/parity/kernel/*.scene.json` convention) and `14/` (fast-check);
  `crates/deep-show` (`deep-show run`: scenarios as JSON lines, `planted`, the `registry` call, `--planted`);
  `crates/deep-canvas/src/registry/` (the seal: `Registrar` with arrays, tables, operators and their read
  terms, `plan` as `module.operator`, cycle refusal); `crates/deep-canvas-test-modules`; `crates/deep-canvas`
  (`canon.rs`: −0 written as 0, a non-finite number or an `f32` overflow refused with the field's path);
  `crates/deep-canvas-marks` (`key.rs`: R1's 128-bit content keys; `dirty.rs`: R1's dirty classes; bound
  values and counters); `scripts/lanes.mjs`, `scripts/canvas-lint.mjs`, `scripts/parity.mjs` (a CLI parity
  check, not a corpus: there is no `parity/` tree at the base).

What the base already does and these tests don't credit: `deep_show` writes `-0.0` as `0` in the canonical
document (so its revision hash is the same as `+0`'s), refuses `1e39` at `at.pos` (an `f32` overflow) with
`out_of_range` naming `items/<id>/at/pos`, and R1's marks keep 128-bit content keys internally. It has no
scheduler over registered operators: no shipped canvas module (R1's canvas code is the core's own until this
issue), no per-operator content keys, epochs or step order on any surface, no `eval`, `frames`, `panel`,
`intern`, `resolve`, `batch` or `fixtures` call, and it answers a document holding `1e999` with `bad_input`
for the whole line. So these tests define the surface below.

## Run them

They build cargo binaries per feature set, like #305's, so they run with `--no-file-parallelism`.
`scripts/lanes.mjs` needs this folder added to both unit-lane lines: `--exclude tests/acceptance/387/**` on
the parallel vitest line, and `tests/acceptance/387/` on the one-at-a-time line beside
`tests/acceptance/305/`. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/387 --no-file-parallelism
npx tsc -p tests/acceptance/387/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds each feature set it uses, once, with `cargo build --locked --bin deep-show
--no-default-features --features <set>[,<test feature>…]` in the checkout, copies each binary out of
`target/debug` under its own name in a temporary folder, and fails each test that uses a build that failed (as
#305's suite does). Each test opens an evidence store root in a temporary folder and deletes it. The tests use
node built-ins, vitest and fast-check (a dev dependency at the base). A run with `--root
tests/acceptance/387` leaves Vitest's cache in `tests/acceptance/387/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base: all 34 tests fail there, because `deep-show run` answers
`bad_input` to a scenario holding any of the new calls (or a number past f64), its `registry` reply has no
`operators`, and none of this suite's `test-*` features exists, so those builds fail.

`budgets.test.ts` skips with an `INCONCLUSIVE` message off a reference Mac (Mac15,7 or Mac15,12 on mains, Low
Power Mode off, no thermal warning), as #305's does; it never passes by skipping. Everything runs headless on
the CPU (render-back snapshots through Vello CPU, as #393's); no GPU and no app.

Property tests (fast-check) record their seeds in the test files (`SEED`), so a failure replays; fast-check
shrinks a failure and prints its counterexample, which the implementer adds as a fixture beside these. Sizes
are set for minutes, not hours, of local time and stated per test below; the release preflight's 100,000 cases
are the preflight's to run with a larger `numRuns`, not this suite's.

## The surface under test

The issue names phases, read sets, epochs, content keys, test builds that log every access, interned
handles, test canvas modules and planted wrong programs, but no code API. These tests extend #305's
`deep-show` binary: its Cargo features select the build set and the test canvas modules, its `run` subcommand
answers scenarios of calls, and #393's and #305's conventions (JSON lines, `bad_input`, the scenario, the calls
and replies, the `core` and `set_digest` stamps, `--planted` at startup) hold unchanged. What follows is what
this issue adds.

Words used below: an **operator** is named `<module>.<operator>` as #305's `plan` names it, and the core's
own operators belong to the module `core`. A **node** is one operator's work for one item (`item` is the item's
ID), or for the whole document (`item: null`) when the operator is `per: document`. A **frame** is evaluated in
`deep-show run` only by an `eval` or `frames` call, or by a call with `include: ["pixels"]`; a `deep_show`
without pixels checks and presents the revision (the check phases) but evaluates no frame.

### The registry, extended

`{"call": "registry"}` keeps #305's fields and adds:

```json
{"versions": {canvas module → semver},
 "digests":  {canvas module → d1 digest (64 lowercase hex)},
 "operators": {operator → {"module": canvas module | "core", "phase": phase,
                           "reads": [read term], "writes": [array]}},
 "arrays": {array → {… #305's fields, "contributes_to": array | null}}}
```

`operators` lists every operator the seal kept, the core's own included, with its read set **as its module
registered it**: arrays by name, tables as `table:<name>`, and the closed terms (`self`, `parent`, `children`,
`siblings`, `refs`, `set(…)`, `view(camera | viewport | pixel_scale | match.me | locale | reduced_motion)`,
`t`, `input`, `reading`, `asset`), never widened by contributions. `plan` (#305) holds the same names. In the
shipped `full` build every operator of every shipped canvas module is listed; R1's canvas laid out as canvas
modules (the issue's scope) means `modules` names them, and `digests` and `versions` cover each.

### Fixtures: `{"call": "fixtures"}`

Each canvas module registers fixtures (Canvas module: `registers: {…, fixtures}`); the core has its own.

```json
{"fixtures": [{"module": canvas module | "core", "name": string, "document": Document,
               "record"?: {handle → {"session": null, "value"?: number, "as_of"?: ms, "state"?: string}}}]}
```

`record` is the scenario's #393 `record` shape (the readings a fixture's bound values read). Every fixture is
presented by `deep_show` in the build that lists it.

### `eval`: one frame of one document session

```json
{"call": "eval", "doc": doc ID, "t"?: time ("0.5s", default "0s"),
 "view"?: {"locale"?: BCP 47 (default: the document's locale), "reduced_motion"?: bool (default false)},
 "clean"?: bool, "perturb"?: target, "pixels"?: bool, "size"?: [w, h]}
```

evaluates the document's current revision in its session at `t` under `view`, through the frame phases, and
answers:

```json
{"outcome": "evaluated" | "not_presented" | "refused", "reason"?: "hidden",
 "rev": n, "t": flicks, "epoch": u32,
 "nodes":   [{"operator", "module", "phase", "item": ID | null,
              "key": 32 lowercase hex (128 bits), "result": 64 lowercase hex, "run": "ran" | "hit" | "kept"}],
 "targets": [{"target": string, "term": read term}],
 "steps":   [{"module", "t": flicks, "count": integer, "read": integer}],
 "hashes":  [{"of": string, "bytes": integer}],
 "access":  [{"operator", "item": ID | null, "read": read term}],
 "issues":  [Issue], "snapshots"?: [{"sha256", "w", "h"}]}
```

- `nodes` lists every node of the revision, each `(operator, item)` once: the check phases' nodes as the
  revision's check had them, then the frame phases' nodes for this frame, in the order the scheduler ran or
  visited them. `key` is the node's content key (Content key: `hash@1` of the operator and its canvas module's
  version, the kind, the canonical params, its read set's keys, the view inputs it reads, the look tokens it
  uses and the seed); `result` is the SHA-256 of the bytes the node wrote (its arrays' values for that item),
  computed for this reply only. `run` says how the node's result was had: `ran`, its operator ran; `hit`, an
  equal key's result was found in the content-key cache (from any session of the process); `kept`, nothing in
  its read set changed since its last run in this session (by epochs).
- `epoch` is the session's current epoch: `changed_at` and `last_run` are `u32`.
- `clean: true` evaluates afresh: every node runs (`run: "ran"`), and nothing is read from or written to the
  content-key cache or the session's epochs, so the next call sees the session as it was.
- `perturb` (only with `clean: true`) changes exactly one input the session holds, named by one of the
  `targets` this session's last `eval` listed, to another value of its type the core picks (deterministically),
  for this evaluation only. `targets` lists every perturbable input the session holds: `array:<name>` for
  every array a node of the revision writes, `table:<name>` for every table it reads, `view:<input>` for each
  of the six view inputs, `look:<token>` for each look token the session's look holds (the clean look's roles,
  `accent` among them), `seed`, and `asset:<id>` for every asset. `term` is the read term that declares that
  input in an operator's `reads`: the array's name, `table:<name>`, `view(<input>)`, the term the core uses for
  look tokens and for the seed (whatever the implementer chose, the same for every target of the kind), and
  `asset`.
- `steps` lists the simulate steps this frame ran (every step after the session's last frame, or from the
  timeline's start for its first frame, up to and including `t`), in the order they ran: the stepping module,
  the step's time in flicks, the count its module's count array holds after the step, and the other module's
  count it read.
- `hashes` lists every pass over values the evaluation made to compute a key (the counting hash): `of` names
  what it hashed (an array's name, or `<source>.<column>` for a source's column) and `bytes` how much. The
  reply's own `result` digests are not key work and are never listed.
- `access` appears in test builds only (any build with a `test-*` feature), listing every read every operator
  made through the core in this frame, by the read term it used. In a shipped build it is absent.
- An operator's error is an issue `{"code", "severity": "error", "ids": [item], "module", "operator", …}`
  naming its canvas module. An operator that asks the core for a read outside its declared set fails in a test
  build with the issue `{"code": "undeclared_read", "severity": "error", "ids": [item], "module", "operator",
  "read": read term}`.
- On a document whose panel is hidden, `eval` answers `outcome: "not_presented", reason: "hidden"` with no
  nodes: a hidden session isn't evaluated (Frame clock and scheduler).
- `pixels: true` adds one render-back snapshot of this frame (sha256 of the PNG in the evidence store, as
  #393's `snapshots`), at `size` (default the document's).

### The other new calls

- `{"call": "frames", "doc", "count": n, "from"?: time, "step"?: time}` evaluates `count` frames of the session
  at `from + k × step` (defaults `0s` and `1/60` s) and answers `{"frames": [{"t", "ran", "allocs",
  "scheduler_ms"}]}`: `ran` is the number of nodes whose operator ran in that frame, `allocs` the heap
  allocations made while the scheduler ran the frame's phases (operators included), counted by the binary, and
  `scheduler_ms` the scheduler's own CPU time in that frame (its change tests and dispatch, operator bodies
  excluded), measured by the binary.
- `{"call": "panel", "panel", "visible": bool}` shows or hides a panel from this call on, answering `{"panel",
  "visible"}`. A `deep_show` to a document in a hidden panel is checked but not presented (#393's
  `not_presented`, `hidden`).
- `{"call": "intern", "doc", "id"}` answers `{"handle": value}`, the item's interned handle in the session's
  current revision (any JSON value the core chooses: a `u32` index with its generation). `{"call": "resolve",
  "doc", "handle"}` answers `{"id": ID}`, or `{"code": "stale_handle"}` for a handle interned in another
  revision of the session.
- `{"call": "batch", "doc", "source": name, "columns": {name → {"dtype": "f64", "len": n, "data": base64}}}`
  delivers a new batch of outside data for the document's source `name` (a source's column, Dirty classes and
  content key) and answers `{"source", "rows", "hashes": [{"of", "bytes"}]}`, `hashes` being the passes over
  values made when it arrived.

### New scenario fields

- `planted` (as #393's and #305's) takes three more values, each a wrong program reachable only there:
  `key_without_locale` (content keys leave out the view's locale), `key_without_reduced_motion` (they leave out
  the view's reduced motion), `key_hashes_positions` (`test.scatter.draw`'s key hashes the values of
  `test.scatter.positions` instead of taking the key of what wrote it).
- `epoch_start: u32`: each document session's epoch counter starts here (a long run, without running it).
- `shuffle: u32`: a seed; the scheduler runs a legal order whose ties (between operators, between items of
  one operator, and between steps that read nothing of each other's at one time) are broken by a shuffle from
  this seed instead of by name, depth, order key and ID.

### The startup `--planted` argument

`deep-show run --planted orders_steps_by_name` runs the scheduler that orders simulate's steps at one time by
canvas-module name (the criterion's wrong program), reachable only through that argument, beside #305's
`treats_every_dependency_required`. An unknown name answers one `bad_input` line and exits 2 (#305).

### The test canvas modules (Cargo features of `deep-show`)

Each is in no shipped build. A document that uses one's kind declares it in `requires.modules`
(`{"test.up": "^1"}`). A kind "drawn as `rect@1`" draws its `box` filled, as #305's `test.a@1` does.

| Feature | Module(s) | Manifest and registration | For |
|---|---|---|---|
| `test-accent` | `test.accent` 1.0.0 | Kind `test.accent@1` {`box`}, drawn as `rect@1`. Arrays `test.accent.base`, `test.accent.tint` (item). Operators `test.accent.base` (reads `[self]`, writes `test.accent.base`) and `test.accent.tint` (reads `[self, test.accent.base]`, writes `test.accent.tint`), which **also reads the look's `accent` role from a static** (a mutable global the core leaves holding the evaluated look): the planted wrong program. The canvas lint refuses a static in a `deep-canvas*` crate, so this module may live in a crate outside the lint's scope | criterion 1 |
| `test-peek` | `test.peek` 1.0.0 | Kind `test.peek@1` {`box`}, drawn as `rect@1`. Array `test.peek.out`. Operator `test.peek.out` (items; reads `[self]`, writes `test.peek.out`) that asks the core for the view's locale, which it didn't declare | criterion 1 |
| `test-up-1-0`, `test-up-1-1` | `test.up` 1.0.0, `test.up` 1.1.0 (never both) | Registered the same, only the version differs. Kind `test.up@1` {`box`, `value: number = 0`}, drawn as `rect@1`. Arrays `test.up.value` (phase `items`) and `test.up.audit` (phase `check`). Operators `test.up.value` (items; reads `[self]`) and `test.up.audit` (check; reads `[self]`) | criterion 3 |
| `test-nudge` | `test.nudge` 1.0.0 | Kind `test.nudge@1` {`box`, `dx: number = 0`, `dy: number = 0`}, drawn as `rect@1`. Array `test.nudge.offset` (item) with `contributes_to` the array the build's transform is (whichever array the core composes `at` into). Operator `test.nudge.offset` (reads `[self]`, writes `test.nudge.offset`): its items move by `[dx, dy]` | criterion 5 |
| `test-step` | `test.step.a`, `test.step.b` 1.0.0 | Kinds `test.step.a@1`, `test.step.b@1` (no params; draw nothing). Each steps in simulate (a at 60 Hz, b at 120 Hz) at every multiple of its step length, adding 1 to its count array (`test.step.a.count`, `test.step.b.count`, domain document); b reads a's count at its own step's time, a reads b's count as earlier steps left it | criterion 6 |
| `test-step-renamed` | `test.step.y` (a's role, 60 Hz), `test.step.x` (b's role, 120 Hz) | The same two renamed so b's name sorts first; never combined with `test-step` | criterion 6 |
| `test-step-cycle` | `test.loop.p`, `test.loop.q` 1.0.0 | Both step at 60 Hz, each reading the other's count at its own step's time: refused at the seal, `cycle`, naming both modules | criterion 6 |
| `test-scatter` | `test.scatter` 1.0.0 | Kind `test.scatter@1` {`box`, `source`, `column`, `n`}: a mark set of `n` points drawn in `box`. Operators `test.scatter.layout` (reads the source's column `<source>.<column>`, writes `test.scatter.positions`: one position per row) and `test.scatter.draw` (reads `test.scatter.positions`, writes `test.scatter.drawn`, its draw list) | criterion 10 |

Builds the tests make: `full`, `core`, `full,test-accent`, `full,test-peek`, `core,test-up-1-0`,
`core,test-up-1-1`, `full,test-nudge`, `core,test-step`, `core,test-step-renamed`, `core,test-step-cycle`,
`full,test-scatter`.

## Fixtures

`fixtures/parity/kernel/` holds the two parity scenes the issue names, as JSON (the base has no `parity/`
tree; #96's suite kept its scenes in its own `fixtures/parity/kernel/` the same way, to be moved when the
corpus lands):

- `epoch-rebase.scene`: `epoch_start` 4,294,967,288 (eight epochs below the `u32` wrap), a board of five rects,
  a label and a clip that slides one rect over 2 s, and 23 steps: frames at rising times, revisions while
  visible, four revisions while the panel is hidden, the panel shown again, and revisions and frames past the
  wrap. Each `edit` is a revision: a map from a path in the document to its new value.
- `key-history.scene`: the final document at `t` 1 s, and two histories that reach it: `short`, two revisions
  from one start, and `long`, six revisions from another start, through an item created and then deleted, a
  rect moved away and back, and the label's text changed and changed back.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#305's command, with the issue's ten criterion lines on stdin). Each test's name
starts with its criterion's ID. Where a criterion names a wrong program, the test runs it through `planted`,
`--planted` or a test feature and asserts that it fails the way the criterion says, naming what it says.

"Outside its read set" is computed from the registry: an operator's read closure is its `reads`, every array a
contributor names in `contributes_to` toward one of them, and the closure of every operator that writes one of
those arrays; a target is outside a node when its `term` isn't in that closure. The writer of a perturbed array
is neither inside nor outside (what it wrote is what was changed) and is left out of the check.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| `#387.f46de50b` | For every shipped operator, a change to any one array, table, view input, look token, seed or asset outside its read set leaves its key and result byte-identical, and equal keys over the fuzzed sequences always give byte-identical results; a planted operator that reads the look's accent role from a static passes perturbation of its declared reads and fails this, naming the operator and the role, and a read outside the declared set fails a test build | `perturb.test.ts`, on `full`: every fixture is presented; every operator the registry lists has a node in some fixture; each fixture's targets cover the six view inputs, the seed, at least one look token (`look:accent` among them) and every array its nodes write; for every target, every node outside its read set has the same key and result under the clean perturbed evaluation as under the clean one, with at least one such pair per kind of target; a generated property (fast-check, `SEED` recorded, 40 sequences of up to 25 clean evaluations of a fixture under generated edits, views and times, about 1,000 evaluations) finds no two nodes with one key and two results, in one process and across the run. On `full,test-accent`: `test.accent.tint`'s key moves when `array:test.accent.base` (its declared read) is perturbed, and `look:accent` changes its result under the same key, a failure naming `test.accent.tint` and `accent`. On `full,test-peek`: the frame fails with `undeclared_read` naming `test.peek`, `test.peek.out` and `view(locale)`, the access log shows that read, and on every fixture every logged access is in its operator's declared reads. Wrong programs: the base (no `eval`); a key that leaves out a read (a result moves under one key); the static accent reader; an operator given more than its read set |
| `#387.18d0b377` | Changes made while a session was hidden all apply when it shows again, and a session re-checked after a long run rebases its epochs without missing one (parity/kernel/epoch-rebase.scene) | `epochs.test.ts`, on `full`: the scene from `epoch_start` 4,294,967,288: while hidden, `deep_show` is `not_presented` (`hidden`) and `eval` is not evaluated; at every visible frame each node's key and result equal the same frame evaluated clean; `epoch` stays a `u32` and falls back once (the rebase) while no change is missed; a generated property (`SEED` recorded, 30 runs) does the same for random hides, shows, revisions and frames from random starts within 24 epochs of the wrap. Wrong programs: a hidden session that drops what changed meanwhile; epochs compared across the wrap without a rebase (a change after the wrap is `kept` with a stale result) |
| `#387.a793f31b` | A canvas module upgrade reruns exactly the checks whose results its version keyed, and a stale interned handle from an earlier revision is refused | `upgrade.test.ts`: one document (a rect, a label and a `test.up@1` item) evaluated in `core,test-up-1-0` and `core,test-up-1-1`: the check-phase nodes whose key differs between the builds are exactly those of `test.up`'s operators and of operators whose read closure holds an array `test.up` owns (`test.up.audit` among them), and every other node has the same key and result; in `core`, a handle interned for an item in revision 1 is refused with `stale_handle` in revision 2, whether the item was deleted or kept, while a handle interned in revision 2 resolves. Wrong programs: keys without the module's version (nothing reruns); keys with the module-set digest (every check reruns); handles without a generation |
| `#387.15327229` | The same document reached through two different patch histories gets byte-identical content keys and cache hits, and no key contains an epoch or any other change counter (parity/kernel/key-history.scene) | `history.test.ts`, on `full`: the scene's two histories, on two documents in one process, each revision followed by a frame; both reach the same revision hash; their final frames have the same nodes with the same keys and results; the second's final frame runs no operator and finds at least one `hit`; a fresh process showing the final document once gets the same keys; a generated property (`SEED` recorded, 25 runs) gives two random detours of 0 to 6 revisions each to the same final document and finds the same keys. Wrong program: a key holding an epoch, a revision number or a count of revisions (another key in the longer history) |
| `#387.27c08b66` | A test canvas module that names the transform in contributes_to moves items when it's in the build, while the transform's own registration and every other canvas module's digest are byte-identical with and without it, and a build without it seals and draws the same document's other items unchanged | `contributes.test.ts`: in `full,test-nudge`, `test.nudge.offset` names an array T in `contributes_to`; T's registration and every operator that writes it are the same in `full`; every module of `full` has the same digest and version in both builds; a `test.nudge@1` item with `dx` 40 draws the same snapshot as one at a box 40 to the right with `dx` 0, and not the snapshot of the first box with `dx` 0; the same document without the nudge item is presented in `full` and draws the same snapshot there as in `full,test-nudge`. Wrong programs: a contribution the owner ignores (nothing moves); an owner that names its contributor (its registration or digest changes) |
| `#387.ade81ba6` | Two test canvas modules that step in simulate, a at 60 Hz and b at 120 Hz, each counting its own steps, b reading a's count at its own step's time and a reading b's count as earlier steps left it, run in time order with a first at a shared time: at 1 s, b's step reads a's count from a's step at 1 s and a's step reads b's count from b's step before 1 s; renaming them so b's name sorts first leaves that order, and a planted scheduler that orders steps at one time by name swaps it and fails, naming the step; two test modules that each read the other's count at their own step's time are refused at the seal as a cycle, naming both; and every hash is the same under 8 shuffled legal orders | `steps.test.ts`: in `core,test-step` a frame at 1 s logs both modules' steps in time order, each counting 1 up per step, 60 of a's and 120 of b's in (0, 1 s], a's step before b's at 1 s, b's read equal to a's count at 1 s, a's read equal to b's count at 1 − 1/120 s; the same in `core,test-step-renamed` (y and x); `--planted orders_steps_by_name` on the renamed build fails that check, the failure naming `test.step.x`'s step at 1 s; `core,test-step-cycle` refuses to start, `cycle`, naming `test.loop.p` and `test.loop.q`; under `shuffle` seeds 1 to 8 every node's key and result, the step log and the snapshot equal the unshuffled frame's, each order is legal (phases in order, a writer's node before its reader's on one item) and the eight orders are not all one. Wrong programs: steps ordered by name; a result that depends on tie order |
| `#387.5e573133` | Budgets, on the reference Mac in the local preflight, compared with the merge base: the scheduler allocates nothing per frame after warm-up and adds under 0.1 ms of CPU per frame for a 10,000-item document whose read sets didn't change; a frame with nothing changed runs no operator | `budgets.test.ts`, on `full`, a board of 10,000 rects: 70 frames at 60 Hz; after the first, no frame runs an operator; after 10 warm-up frames no frame allocates; each of five fresh processes' median `scheduler_ms` judged ≤ 0.1 ms by the design's rule (PASS all within; FAIL all over by more than the margin; else INCONCLUSIVE, a skip). Off a reference Mac both skip as INCONCLUSIVE. The merge-base comparison is the perf lane's, as #305's README says for its budget |
| `#387.f71bf834` | Flipping the view's locale, and separately its reduced motion, changes the content keys of every operator that formats numbers, shapes text or plays motion, and both reduced-motion renditions exported in one process give different text-animator frames; a planted key without the locale or reduced motion reuses the other's result and fails, naming the operator | `view.test.ts`, on `full`, a board with a counter of a reading (1,234,567.5), a label, a title with a text animator and a sliding rect, at 0.5 s: the operators whose clean result differs between `en` and `de` (formatting and shaping the number) change the key of every node they have, the label's shaping included; the same for reduced motion off and on (the animator); in one process the two renditions under each flip give different snapshots and results equal to fresh clean evaluations; `planted: "key_without_locale"` and `"key_without_reduced_motion"` reuse the first rendition's result, so the check fails, naming the operator. Wrong program: the two planted keys |
| `#387.a0eea545` | A revision whose param is −0 gets the same content key and canonical bytes as one with +0, and a NaN or an infinity in a param is refused with out_of_range, naming the path | `canonical.test.ts`, on `full`: a board with −0 (written `-0.0` in the scenario text) at six zeros (a rect's `box` y and `radius`, its `at.pos` x and z, a label's `at.pos` z, another rect's `box` x) has the revision hash and every node's key and result of the same board with +0, on two documents in one process and in a fresh process; a generated property (`SEED` recorded, 30 runs) puts −0 at a random subset of the six; a rect's `radius` of `1e999`, a rect's `box` width of `-1e999` and a label's `size` of `1e39` (past `f32`) are each refused with `out_of_range` naming a path under `items/<id>/params/<name>`, and no revision of them becomes current. Wrong programs: a key that hashes −0's bits; the base's `bad_input` for the whole line holding a JSON number past f64 |
| `#387.45eee1e5` | In a data view whose mark set of 100,000 points takes its positions from a layout operator, the draw operator's key takes the layout operator's key, and a counting hash sees no pass over the positions' values to make it; the source column the layout reads is hashed once when a new batch arrives, never per frame; and the document reached by two patch histories gets byte-identical keys. A planted key that hashes the positions array passes the history fixture and fails this test, naming the array | `positions.test.ts`, on `full,test-scatter`, a chart with one `test.scatter@1` of 100,000 points: each batch's reply lists exactly one pass over `pts.v`; the frames after it list none over `pts.v` or `test.scatter.positions`; a new batch with other values moves the layout's key and the draw's, one with the same values moves neither; two documents reached by two revision histories, each sent the same batch, get the same keys. `planted: "key_hashes_positions"` passes the history part and fails the counting hash, naming `test.scatter.positions`. Wrong programs: the planted key; a source column hashed per frame |

## Blind redrafts that replaced first drafts

Two first drafts couldn't pass on any implementation, so each went to a blind redraft of this job (design:
Dogfooding). On October 22 the owner approved each redraft in place of its first draft, and the first drafts were
removed. The criteria table above describes the first drafts; for these two tests, read the redraft.

| Criterion | First draft (removed) | Why it couldn't hold | Redraft | Notes |
|---|---|---|---|---|
| `#387.a0eea545` | `canonical.test.ts`, first test | compared the revision hash of the +0 board on `DOC.a` with the −0 board's on `DOC.b`; the canonical document holds its `id`, which `deep_show` stamps from the call's doc ID, so two doc IDs always hash apart | `canonical-redraft.test.ts` | `A9-REDRAFT.md` |
| `#387.15327229` | `history.test.ts`, first test | compared the short history's revision hash on `DOC.a` with the long one's on `DOC.b`, the same impossibility | `history-redraft.test.ts` | `A4-REDRAFT.md` |
| `#387.f71bf834` | `view.test.ts`, the reduced-motion flip test (removed October 26, owner's go-ahead on #371) | counted every operator whose result moved with the flip as one that plays motion; once a board holds still under reduced motion (#371 AC2), `core.world` moves on the slid rect only because its input did, and the test demanded its key change on nodes whose reads didn't | `view-reduced-motion-redraft.test.ts` | `RM-REDRAFT.md` |

## Readings where the issue and design leave a choice

- **One binary, more calls.** The scheduler is observed through `deep-show run`, the binary #305 left with the
  seal, its build sets and test features; the issue's test builds are Cargo feature sets of it.
- **A node's key and result** are the content key the core computes and a digest of what the node wrote; the
  tests never read a key's parts, only equality, so "keyed by an epoch" shows as two keys for one content.
- **Perturbation is clean.** A perturbed evaluation runs every node afresh, so a key that misses a read shows
  as a result that moved under one key; through the cache it would be hidden by a hit. Its baseline is a clean
  evaluation of the same session. "Outside its read set" is the transitive read closure the registry declares:
  a change to a declared read of a node's writer reaches the node legitimately.
- **"Every shipped operator"** is every operator `registry.operators` lists in `full`, each needing a node in
  some registered fixture; the fixtures are the modules' own (the design gives every canvas module fixtures for
  clean rebuilds, perturbation and shuffles).
- **The accent role.** The base's clean look (`crates/deep-canvas-marks/looks/clean.json`) has the roles
  `ground`, `ink` and `muted` only; the criterion names "the look's accent role" and the design defaults an
  emphasis to `role = accent` (`cues@1`), so the tests require the shipped look to hold a role `accent`, which
  every fixture session can perturb as `look:accent`.
- **Look tokens and the seed** are perturbed as targets of their own; their `term` is the implementer's (the
  design's read-term list names neither), and the planted accent reader pins down that the look's token is not
  covered by `self`.
- **"Fails a test build"** is the frame failing with an error issue naming the module, the operator and the
  read, in a build with a test feature, where every access is logged.
- **"Re-checked after a long run"** is a revision checked after the epoch counter neared the `u32` wrap; a long
  run is simulated by `epoch_start`. "Without missing one" is read on results: every frame equals a clean
  evaluation; "rebases" as the epoch falling back while nothing is missed.
- **"Reruns exactly the checks whose results its version keyed"** is read on the check phases' keys across the
  two builds: a result is reused exactly when its key is equal (Content key), so the changed keys are the
  reruns. No cache survives a process here; a check-result store kept across releases isn't on the surface.
- **"A stale interned handle from an earlier revision"** is any handle interned in another revision of the
  session, since the generation is per load and each revision is a load; a kept item's old handle is refused
  too.
- **"Patch histories"** are sequences of whole revisions through `deep_show`, R1's way of writing; the hub
  records each as its diff. "Cache hits" is the second document's final frame running no operator.
- **The transform** in criterion 5 is whatever array the build composes `at` into; the tests read its name from
  `test.nudge.offset`'s `contributes_to`. "Moves items" is the test module's own items, by their `dx` and `dy`.
- **Steps' times**: each module steps at every multiple of its step length; a frame at `t` runs every step
  after the session's last frame up to and including `t`. "Swaps it and fails, naming the step": the planted
  order fails the order check, the message naming the module and time of the step that ran out of order.
- **"Every hash … under 8 shuffled legal orders"** is every node's key and result, the step log and the
  frame's snapshot, under `shuffle` seeds 1 to 8, against the unshuffled frame.
- **"Formats numbers, shapes text or plays motion"**: the operators whose clean result moves with the locale
  (or with reduced motion) in the fixture are those operators; every node of each must change key, so the
  label's shaping must change key though its glyphs don't. Locale flips are checked against number formatting
  and shaping, reduced-motion flips against the animator, as the two flips' own effects. "Exported" is a
  render-back snapshot of each rendition in one process.
- **The text animator** is written on the text item as `params.animators: [{units, range: {from, to, falloff,
  offset}, shape, mode, props: {y, opacity}}]`, the Text animator fields, with a clip channel driving
  `range.offset`; under reduced motion (`transport.reduced_motion: hold`) it keeps only opacity (Transport).
- **NaN** has no JSON spelling, so the tests reach the infinity half of the rule: `1e999`, `-1e999` (numbers JSON
  allows, past f64's range) and `1e39` at an `f32` param (`text@1`'s `size`, which overflows `f32`). The path is
  read as a prefix: `items/<id>/params/<name>`, with or without the index below it.
- **The data view's layout operator** is the test module `test.scatter`'s: no shipped canvas module places a
  mark set's rows by a layout operator in R1 or R2, and the criterion is about the core's keying of what an
  operator wrote. The source's column arrives by the `batch` call, as outside data does.
- **The counting hash** is the binary's own count of passes over values made for keys, as #305's seal time is
  the binary's own clock.
- **Budgets.** `allocs` and `scheduler_ms` are the binary's own counts around the scheduler; "after warm-up" is
  after 10 frames; the merge-base comparison is the perf lane's.

Not tested, because no criterion asks or the surface can't reach it: a panic freezing only its session; the
published `deep://schedule/<core version>` and its committed snapshot; audio blocks; physics and logic steps
proper (the test modules stand in for stepping modules); `parallel: fixed_blocks`; carried state (R6); a NaN
in a param (no JSON spelling); tables and assets as perturbation targets beyond what the fixtures hold; the
access log's absence from shipped builds.

## Upstream tests (the Oracle lane)

The issue's Oracle page (`doneright/oracles/issues/387.md`) says 0 of the 10 criteria have an upstream test:
shuffled legal orders, read-set keys, epochs, leave-out invariance, stepping order and budgets are our own
scheduler rules (Bevy checks schedule ambiguity statically and has no such tests), the view inputs our keys
take and our canonical rule for params are ours, and a budget against the merge base measures our build. So
the Oracle lane has nothing to run for #387, and these tests are the local proof for all ten criteria.
