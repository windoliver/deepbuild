# Acceptance tests for #305: canvas registry and seal, leave-out builds and module_missing

Written first, from issue #305 (its scope, its Canvas module and Registry and seal field lists, its six
acceptance criteria and its proof line), the design sections it names and those they lean on, and base
commit `7fc4f14a65d10cb6ad4a3102de7980563cdd8a58` ("Merge pull request #663 … claude/lucid-hamilton-d5da34"),
by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job. The issue's Oracle page
(`doneright/oracles/issues/305.md` in `DeepBuildAI/deepbuild`, branch `doneright`) was unreachable (404),
so the Oracle lane is BLOCKED (below).

What was read:

- `docs/technical-design.md`: Canvas modules (1049: the core and its modules; one manifest and one register
  call; registration in sorted name order, then the seal, "any second writer, unresolved read, read of a later
  phase, cycle or illegal place refuses startup with its reason"; optional and required dependencies; the
  closed phase lists; build sets core, r1, r2 and full; `module_missing`); Packs are data, not canvas modules
  (1078); the document envelope with `requires` ("A document declares the canvas modules its kinds need; one
  whose canvas module this build lacks is refused with `module_missing`, naming the module, and a check that
  needs it is BLOCKED", 1090); One canonical form before any hash (839: a `d1` digest is a SHA-256 over RFC
  8785 bytes); Criteria to tests, both ways (2485); Dogfooding (2508); the Canvas core's modules row (2684).
- `docs/canvas-primitives.md`: Canvas module (987: fields, semantics, "Registration once at startup,
  O(parts); nothing per frame by itself"); Canvas module: interface and implementation (1013); Registry and
  seal (1030: fields `modules`, `arrays`, `plan`, `build_set`, `set_digest`, `state`; "Any failure refuses
  startup … there's no warning level and no accept list"; the build sets; cost "under 50 ms (estimate);
  nothing per frame"); Registry and seal: runtime digest (1052) and registries (1067); Phase (1082: the
  closed check, frame and audio lists; ties by canvas module name then operator name); Operator and read set
  (1095); Logic `logic@1` (6435: `program: asset ID`, a WebAssembly module by hash); Asset (7042: evidence
  stored by hash); Document envelope `requires` (291).
- At the base: AGENTS.md; the earlier blind suites `tests/acceptance/393/` (whose `deep-show` surface this one
  extends), `389/`, `607/` (the criterion-ID command), `62/` and `14/` (the reference-Mac gate and the judge
  for timing results); `crates/deep-show` (`deep-show run`: scenarios as JSON lines, the `planted` field, the
  deep_show and `deep show --check` replies with `outcome`, `issues`, `snapshots` and `result`);
  `crates/deep-canvas` (`document::check`: `requires` as a closed object with `modules: {canvas module →
  semver range}`; the `module_missing` issue a param another module evaluates already raises, with `what`
  naming the module; the `deep-canvas check` binary); `scripts/canvas-lint.mjs` (no `cfg(feature = …)` in
  any `deep-canvas*` crate, so leave-out builds are composed in a binary crate); `scripts/lanes.mjs` and
  `vitest.config.ts`. The base has no manifest, no register call, no seal, no build sets, no test canvas
  modules, no `core`/`set_digest` on any reply and no `registry` call, so these tests define the surface
  below.

## Run them

Like #393's suite they build a cargo binary, so they run with `--no-file-parallelism`. `scripts/lanes.mjs`
needs this folder added to both unit-lane lines: `--exclude tests/acceptance/305/**` on the parallel vitest
line, and `tests/acceptance/305/` on the one-at-a-time line beside `tests/acceptance/393/`. This README is
the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/305 --no-file-parallelism
npx tsc -p tests/acceptance/305/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds each build set it uses, once, with
`cargo build --locked --bin deep-show --no-default-features --features <set>[,<test feature>…]` in the
checkout, copies each binary out of `target/debug` under its own name in a temporary folder (so the next
feature set's build doesn't replace it), and fails each test that uses a build that failed. Cargo keeps one
artifact per feature set, so after the first build of each set the later files' builds are fingerprint
checks. Each test opens an evidence store root in a temporary folder and deletes it. The tests use only node
built-ins and vitest. A run with `--root tests/acceptance/305` leaves Vitest's cache in
`tests/acceptance/305/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base: every test
fails there because `deep-show` has no `core`, `r1`, `r2` or `full` feature, so every build fails.

`budgets.test.ts` skips with an `INCONCLUSIVE` message off a reference Mac (Mac15,7 or Mac15,12 on mains,
Low Power Mode off, no thermal warning); it never passes by skipping. `wasm.test.ts` plants a FIFO with
`mkfifo`, so on Windows its tests fail with an `INCONCLUSIVE` message. Everything runs headless on the CPU
(render-back snapshots through Vello CPU, as #393's); no GPU and no app.

## The surface under test

The issue names a manifest, a register call, the seal, leave-out builds as Cargo features, `requires.modules`,
`module_missing`, `core@version` and the module-set digest on every deep_show reply and document check
result, but no code API; the canvas lint forbids `cfg(feature = …)` in every `deep-canvas*` crate, so a
leave-out build is composed where features are allowed: a binary crate. These tests therefore extend #393's
`deep-show` binary (`crates/deep-show`, or wherever the implementer keeps the `deep-show` bin target): its
Cargo features select the build set and the test canvas modules, it registers and seals the module set at
startup, and its `run` subcommand answers deep_show and `deep show --check` with the stamped replies, plus one
new call, `registry`. #393's conventions (JSON lines, `bad_input`, the scenario, the calls and their replies)
hold unchanged; what follows is what this issue adds.

### Build sets and the test canvas modules (Cargo features of `deep-show`)

A build is selected by `--no-default-features --features <list>`:

- One build-set feature, required: `core`, `r1`, `r2` or `full` (Registry and seal: `build_set`). `full` is
  the default feature, so #393's plain `cargo build --bin deep-show` still builds the full set. Each build set
  is a list of the shipped canvas modules; the issue leaves R1's canvas as the core's own until #137, so the
  tests never name a shipped module and never require `core`, `r1`, `r2` and `full` to differ from one
  another. One Cargo feature per optional shipped canvas module is the issue's rule and the implementer's;
  the tests don't name them.
- Zero or more test canvas module features, each a Rust crate with one manifest and one register call,
  compiled in only under its feature and in no shipped build (the issue's "test build" and "test canvas
  module"). Their names, manifests and registrations are the contract, since the refusals name them:

| Feature | Module(s) it adds | Manifest and registration | Seal outcome in the `core` build |
|---|---|---|---|
| `test-a` | `test.a` 1.0.0 | Kind `test.a@1`, params `box` (as `rect@1`'s) and `value: number = 0`; array `test.a.value` (owner `test.a`, phase `items`); the item draws its `box` filled | Seals |
| `test-b` | `test.b` 1.0.0 | `depends_on: {test.a: {range: "^1", optional: true}}`; kind `test.b@1`, params `box` and `echo: number \| null = null`; array `test.b.echoed` (owner `test.b`); one operator `test.b.echo` (phase `items`) that reads `test.a.value` and writes `test.b.echoed`, and evaluates `echo`; the item draws its `box` filled (something visible: its snapshot differs from an empty board's) | Seals; without `test.a`, `test.b.echo` is left out of the plan and a document with `echo` set is `module_missing` naming `test.a` |
| `test-b-requires-a` | `test.b` 1.0.0, the same with `optional: false` | As `test-b`, dependency required (never combined with `test-b`) | Refused: `missing_dependency`, modules `test.a`, `test.b` |
| `test-two-writers` | `test.w1`, `test.w2` | Each registers the array `test.shared` | Refused: `two_writers`, modules `test.w1`, `test.w2`, arrays `test.shared` |
| `test-later-phase` | `test.late` | Array `test.late.after` written in the frame phase `render`; an operator in `items` reads it | Refused: `later_phase`, modules `test.late`, arrays `test.late.after` |
| `test-cycle` | `test.c1`, `test.c2` | In `items`: `test.c1` writes `test.c1.out` and reads `test.c2.out`; `test.c2` writes `test.c2.out` and reads `test.c1.out` | Refused: `cycle`, modules `test.c1`, `test.c2`, arrays `test.c1.out`, `test.c2.out` |
| `test-missing-dep` | `test.orphan` | `depends_on: {test.absent: {range: "^1"}}`, a module no build holds | Refused: `missing_dependency`, modules `test.absent`, `test.orphan` |

A document that uses a test module's kind declares it in `requires.modules` (`{"test.b": "^1"}`), as the
envelope says a document declares the canvas modules its kinds need. Combinations the tests build:
`core`, `r1`, `r2`, `full`, `core,test-a`, `full,test-a`, `core,test-b`, `core,test-a,test-b`,
`core,test-b-requires-a`, `full,test-a,test-b`, and `core` with each fault feature alone.

### Startup: the seal, and its refusal

`deep-show run` registers the build's canvas modules in sorted name order and seals before it reads its
first line. When the seal passes, it reads and answers scenarios as #393 says. When it fails, it writes
exactly one JSON line to stdout and exits with status 2 without reading a scenario:

```json
{"ok": false, "code": "seal_refused",
 "reason": "two_writers" | "later_phase" | "cycle" | "missing_dependency" | "unresolved_read" | "illegal_place",
 "modules": [canvas module name], "arrays": [array name]}
```

`modules` names every canvas module involved and `arrays` every array (the tests sort both before
comparing; `arrays` is `[]` for a missing dependency). The tests read the first four reasons; the others are
listed so the enum is closed. A build that leaves `text` or `look` out, a second implementation of one
interface and a registry whose kit admits its planted entry are refusals too, with reasons of the
implementer's choosing; no test reaches them.

`deep-show run --planted treats_every_dependency_required` runs the same binary with the planted seal that
reads every dependency as required, reachable only through that argument: in a build with `test-b` and no
`test-a` it refuses as `missing_dependency` naming `test.a` and `test.b`. An unknown `--planted` name answers
one `{"ok": false, "code": "bad_input"}` line and exits 2.

### The scenario: new `planted` values and the `registry` call

`planted` (on the scenario, as #393's) takes two more values, each a wrong program reachable only there:

- `reply_without_digest` (#305.21e03b37): replies leave out `set_digest`;
- `reads_wasm_bytes` (#305.c18cbd77): before refusing a document that needs the logic module, the check reads
  the named program's bytes from the evidence store by its hash.

`{"call": "registry"}` answers the sealed set as the build holds it:

```json
{"core": "core@<semver>", "set_digest": d1 digest, "build_set": "core" | "r1" | "r2" | "full",
 "state": "sealed" | "ready",
 "modules": [canvas module name],
 "arrays": {array name → {"owner": canvas module name, "phase": phase}},
 "plan": {phase → [operator name]},
 "seal": {"ms": number, "runs": number}}
```

`modules` is in sorted name order (Registry and seal: `modules: [canvas module] (sorted by name)`); `plan`
holds every operator the seal kept, by phase (the operators a missing optional dependency leaves out are
absent); `seal.ms` is the wall time of registration plus the seal, measured by the binary at startup, and
`seal.runs` how many times they have run in this process, 1 from the first call to the last whatever frames
ran between. `core` and `set_digest` are the two stamps below.

### Every reply's stamps

Every reply to a `deep_show` or `deep show` call, whatever its `outcome` and whether or not it has `check`,
carries two more fields:

- `core`: `core@<semver>`, the core's version (the string matches `^core@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`);
- `set_digest`: the module-set digest, a d1 digest written as 64 lowercase hex characters (a SHA-256 over
  the RFC 8785 bytes of the sealed set's registered shapes; the tests read only its form, its sameness within
  a build and its change between builds).

Both equal the `registry` reply's. The design names no JSON Schema file for a deep_show reply at the base,
so "the reply schema" is this suite's `replySchemaFailures` in `helpers.ts`: it fails a reply that lacks
either field or whose field has the wrong form, naming the field.

### `module_missing`

A document that needs a canvas module the build lacks is refused (`outcome: "refused"`, no snapshot, no
revision becomes current) with at least one issue `{code: "module_missing", severity: "error", …}` whose
`what` names the module (the module's name as a word: `test.a`, `logic`), in two forms:

- a module the document declares in `requires.modules` that the build lacks: `path:
  "requires/modules/<module>"`, `ids: []`;
- a field a left-out operator evaluates (a kind's param another module evaluates, as `deep-canvas` already
  reports for `camera@1`'s `dof`): `path: "items/<id>/params/<field>"`, `ids: [<id>]`, as
  `items/b-1/params/echo` naming `test.a`.

A `deep show --check` of such a document answers `result: "BLOCKED"` (not `FAIL`: a check that needs a
missing module is BLOCKED, Document envelope and Canvas module), with the same issues.

### The program whose bytes are never read

The logic item is `{kind: "logic@1", params: {program: <sha256>, step_rate: 60, writes: {score: {type:
"i32"}}}}` with `requires: {modules: {logic: "^1"}}`; `program` is an asset ID by hash, kept in the evidence
store as images are (`<root>/<2 hex>/<62 hex>`). The test puts a FIFO nobody writes at that path. The check
in a build without the logic module must refuse the document without opening it: a process that opens it
blocks and is killed at the test's timeout, which fails the honest test and is what the planted
`reads_wasm_bytes` must do.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and
the leading `- [ ] ` dropped, computed with #607's command with the issue's six criterion lines on stdin:

```
node -e 'for (const t of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) console.log(require("crypto").createHash("sha256").update(t.trim().replace(/\s+/g," ").replace(/^- \[ \] /,"")).digest("hex").slice(0,8))'
```

Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test runs it
through `planted` or `--planted` and the message at the assertion says what it must fail.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| `#305.ec48d743` | A test build with two writers of one array, a read of a later phase, a cycle or a missing dependency refuses to start, naming the canvas modules and arrays involved, and the shipped set seals clean (parity/framework/registry-seal.view) | `seal.test.ts`: each fault feature on the `core` build refuses to start: exit 2, one `seal_refused` line with the reason and exactly the modules and arrays of the table above, and no reply to the scenario it was fed; `core`, `r1`, `r2` and `full` each start, their registry `sealed` or `ready`, `build_set` the one built, modules sorted and unique, every array with an owner, `core` and `set_digest` well formed; two fresh `full` processes agree on digest, modules and plan. Wrong program: the base (no build sets: every build fails); a seal with a warning level or an accept list starts the fault builds and fails |
| `#305.4e03e5e7` | A document evaluated in the full build and in a test build without the canvas modules it doesn't use hashes the same, and a document that needs a missing canvas module is refused with module_missing (parity/determinism/leave-out-invariance.scene) | `leave-out.test.ts`: a core-only board shown with a snapshot in `full` and in `core`: the same revision hash and the same snapshot sha256; a board of `test.a@1` in `full,test-a` and `core,test-a`: the same; in `core` the `test.a` board is refused with `module_missing` naming `test.a` (at `requires/modules/test.a` or on the item), its `--check` BLOCKED, no current revision, and in `core,test-a` it is presented with a snapshot; the refusal is per document (a core-only board beside it is presented). Wrong program: the base, which has no build sets and reads `requires.modules` only for its shape; a build that evaluates differently without unused modules fails by hash |
| `#305.a15bd49b` | A test canvas module b whose manifest marks module a optional, with one operator that reads a's array, seals in a build without a, that operator left out of the plan; there a document that uses b's feature that reads a is refused with module_missing naming a, and its checks are BLOCKED, while a document that doesn't use it draws; the same b marking a required is refused at startup in that build, naming a and b; and a planted seal that treats every dependency as required refuses the first build and fails this | `optional.test.ts`, on `core,test-b`: the registry holds `test.b` and not `test.a`, the plan has no `test.b.echo` and no `test.a.value` array, while `core,test-a,test-b` holds both modules, the operator and the array, under another digest; a board with `echo: 3` is refused with `module_missing` naming `test.a` at `items/b-1/params/echo` with `ids: [b-1]`, nothing naming `test.b`, and its `--check` is BLOCKED; a board of `test.b@1` without `echo` is presented with a snapshot that isn't the empty board's and its check PASS; in `core,test-a,test-b` the `echo` board is presented; `core,test-b-requires-a` refuses to start as `missing_dependency` naming `test.a` and `test.b`; `--planted treats_every_dependency_required` on `core,test-b` refuses to start (the first test's "it starts" fails), naming `test.a` and `test.b`, while the same build without it starts |
| `#305.c18cbd77` | A document that names a WebAssembly program, in a build without the logic module, is refused with module_missing, naming the logic module, and the program's bytes are never read | `wasm.test.ts`, on `core`: with a FIFO at the program's store path, deep_show refuses the document with `module_missing` naming `logic`, no snapshot, and the process finishes (a read of the bytes would block it until the 30 s kill, which fails the test, naming the read); `--check` is BLOCKED; `planted: "reads_wasm_bytes"` on the FIFO never finishes and is killed at 10 s, so it fails; with an ordinary file in the FIFO's place the twin finishes with the same refusal, so the hang is the read |
| `#305.21e03b37` | Every deep_show reply and every document check result carries core@version and the module-set digest; the digest changes when a test canvas module joins the build and stays the same when only a document changes; and a planted reply without the digest fails the reply schema, naming the field | `digest.test.ts`: on `full`, a presented reply, a refused reply (an unnamed rect), a PASS check result and a FAIL check result each carry `core` and `set_digest`, all equal to the `registry` reply's; `full,test-a` carries another `set_digest` and the same `core`; three documents (one an edit of another) in one run and a fresh process carry one digest; `planted: "reply_without_digest"` is presented but `replySchemaFailures` fails it, the failure naming `set_digest` |
| `#305.66cabd55` | Budgets, on the reference Mac in the local preflight, compared with the merge base: registration and the seal take under 50 ms at startup, and nothing runs per frame | `budgets.test.ts`, on `full,test-a,test-b` (a set with work in it: the registry must list `test.a` and `test.b`): `registry.seal.ms` from five fresh processes after a warm-up, judged ≤ 50 ms by the design's rule (PASS all within; FAIL all over by more than the margin; else INCONCLUSIVE, a skip); after six frames at six times `seal.runs` is still 1 and `seal.ms` unchanged. Off a reference Mac (or on battery, Low Power Mode, a thermal warning) both skip as INCONCLUSIVE. Wrong program: the base (no `registry` call); a seal over 50 ms fails by its number; a registry that re-registers per frame fails by `runs`. The merge-base comparison the criterion names is the perf lane's, run at preflight against the merge base's numbers, not this test's |

## Readings where the issue and design leave a choice

- **Leave-out builds are Cargo features of the binary.** The issue says "one Cargo feature per optional
  canvas module, build sets core, r1, r2 and full"; the canvas lint allows no `cfg(feature = …)` inside a
  `deep-canvas*` crate, so the binary crate composes the set. A test build is a feature set, never a
  scenario field: the digest must change "when a test canvas module joins the build", so a module joins by
  building, and the test modules' crates exist only under their features.
- **"Refuses to start"** is read on the process: one `seal_refused` line and exit 2 before any scenario is
  read. The design says the seal "refuses startup with its reason" and "fails the build's tests"; the reason
  is a closed word so a test can name the fault it planted. The planted seal (criterion 3) must act at
  startup too, before any scenario, so it is a command-line argument rather than a scenario field.
- **The test canvas modules' names, kinds, arrays and operators** are fixed above because the criteria read
  them: "naming the canvas modules and arrays involved" needs expected names. Their kinds draw a filled box
  so "draws" is a snapshot that isn't the empty board's; their pixels aren't read.
- **"Uses b's feature that reads a"** is a field of b's kind (`echo`) that the left-out operator evaluates,
  the form `deep-canvas` already reports as `module_missing` at the field's path; "doesn't use it" leaves
  `echo` unset.
- **"Hashes the same"** is both the revision hash (the canonical document) and the render-back snapshot's
  sha256 at the same `t` and size (the evaluated frame), since the first alone would hold for a build that
  evaluates nothing.
- **"Names a WebAssembly program"** is a `logic@1` item with `program` by hash and `requires.modules` naming
  `logic`, the way the envelope says a document declares the modules its kinds need; the kind is R6's, so at
  the base it is unknown, and only the declaration tells the build which module it lacks. "Never read" is
  proved by a FIFO: nothing can read it without blocking.
- **"Every document check result"** is `deep show --check`'s reply, the document check surface the design and
  #393 give the binary; `deep-canvas check`, a library binary under the canvas lint with no features, isn't
  held to the stamps.
- **The module-set digest's form** is a d1 digest, 64 lowercase hex, since a d1 digest is a SHA-256 over RFC
  8785 bytes; what it covers is the design's (the registered shapes) and is read only through sameness and
  change.
- **The budget's clock** is the binary's own (`seal.ms`), since the seal runs inside process start-up, which
  also loads fonts and the look; an outside clock couldn't separate them. "Nothing per frame" is read as the
  registration-and-seal count staying 1 across frames. The criterion's "compared with the merge base" names
  the perf lane's comparison; the test holds the absolute budget.

Not tested, because no criterion asks: the manifest's `license`, `digest`, `implements` and `implementation`
fields, interfaces and their kits (#185), registries and the closure rule (#200), the runtime digest (#97),
`deep://schedule/<core version>` and its committed snapshot, the `unresolved_read` and `illegal_place`
refusals and check machine classes, a build without `text` or `look`, `requires.modules` on packs (#306),
the shipped modules each build set holds (#137), and `test-b` combined with `test-b-requires-a`.

## Redrafts (#388)

#388 lays R1's canvas out as canvas modules, so the `core` build set holds text and look alone and draws
neither `rect@1` nor `text@1` (marks2d's kinds). Three first drafts read `core` as a build that still draws them,
and went to a blind redraft of this job from the same inputs (issue #305, the design, base `7fc4f14`); its notes
are in `REDRAFT-388.md`. On the owner's go-ahead the redrafts replace them:

| First draft (removed) | Redraft |
|---|---|
| `leave-out.test.ts`: a document of core kinds alone, full and core builds | `leave-out-redraft.test.ts`: a rect-and-text board, full and r1 |
| `leave-out.test.ts`: a document that uses test.a, full and core builds with test.a | `leave-out-redraft.test.ts`: full and r1 with test.a, against a twin without the item |
| `optional.test.ts`: core,test-b, a board with and without echo | `optional-redraft.test.ts`: the same build, each board on its own doc ID |

## Upstream tests (the Oracle lane)

The issue's Oracle page, `doneright/oracles/issues/305.md` in `DeepBuildAI/deepbuild` (branch `doneright`),
says one of the six criteria has an upstream test, but the page answered 404 when this job read it, so which
criterion and which test are unknown. The lane is BLOCKED, with one unblock ask: publish or restore the page
(or give its content) so the linked test can be pinned by commit and run against our output (#136). Until
then these tests are the local proof for all six criteria and claim nothing for the Oracle lane.
