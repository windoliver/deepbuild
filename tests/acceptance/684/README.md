# Acceptance tests for #684: the verdict table in Lean, the engine matched on generated claims, and two engine fixes

Written first, from issue #684 (its text as of 2026-10-23: Why, Scope, Decision on item 3, the eight acceptance
criteria, Proof, Size), its dependencies #28, #569 and #246, the design (`docs/technical-design.md`: How runs
become one of five verdicts in full, with One table, one reference, Pinned to a commit and Numeric contracts; How
we know version 0 works, the bullet "The verdict table, proved") and base commit `e9c601b`, by a job that never
saw an implementation. At the base it also read `packages/verdicts` (the engine and its public entry),
`tests/acceptance/28` (README, `reference.ts`, `generate.ts`, the tests), `scripts/lanes.mjs`, `scripts/checks.mjs`,
`scripts/preflight.mjs`, `scripts/preflight`, `scripts/repo-rules.json`, `vitest.config.ts` and the READMEs of
`tests/acceptance/246`, `670` and `389`. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job.

## Run them

With the repo's Node (`.node-version`, 24.22.0):

```sh
npm ci                                     # once, if node_modules is missing
npx vitest run --root tests/acceptance/684
node node_modules/typescript/bin/tsc -p tests/acceptance/684/tsconfig.json
```

With `--root` here, Vitest writes its cache under `tests/acceptance/684/node_modules/`; delete it, it isn't part of
the suite. Three files:

- `engine.test.ts` (AC5, AC6, AC7's engine side) needs only the engine and takes well under a second.
- `lanes.test.ts` (AC8) builds scratch git repositories and a scratch copy of this checkout. It takes a few seconds
  and needs no Lean.
- `lean.test.ts` (AC1–AC4, AC7's model side) needs the pinned toolchain. It runs the lane once in this checkout,
  generates 10,000 vectors, and runs the lane in six scratch copies (one control and five plants). Each scratch copy
  starts from a copy of the checkout's model build, so only what a plant changes rebuilds. Its tests run one at a
  time, in one file, so no two Lean builds overlap. Test limits are an hour each.

**Without the toolchain**, every test in `lean.test.ts` skips with the lane's `BLOCKED toolchain: …` line as its
note. It is BLOCKED, never a pass. The lane's `BLOCKED` line is the only thing that turns a failure into a skip.
A missing script, a failed build or bad output fails the test.

**The seed.** `lean.test.ts` draws the agreement seed in each run, from `crypto.randomInt(0, 2^31)`. It prints the
seed as `#684 agreement seed <n> (replay with AC684_SEED=<n>)`, along with each row's count and each twin's first
difference. `AC684_SEED=<n>` replays a run.

**In the preflight.** Like every `*.test.ts` under `tests/`, these files fall inside the unit lane's globs.
`lean.test.ts` costs minutes of Lean builds. It skips where the toolchain is missing, so the implementer may keep it
out of the unit lane and run it as a command of the proof lane, gated as that lane is. The lane script must never
run this suite itself (see the script below), or the plants would recurse.

`BASE-FAILURE.txt` is the run at the base, with local paths redacted. All 25 tests fail. AC5, AC6 and AC7's engine
tests fail at their assertions on the base engine. The AC8 gating tests fail because `scripts/lanes.mjs` has no
lane named `verdict proofs`. The rest fail because `lean-toolchain`, the lane script and the model don't exist yet.

## The surface under test

Every name, path, command, line and field below is something the tests rely on. Anything not listed is the
implementer's choice.

### Files and folders

| Path | What |
|---|---|
| `lean-toolchain` | The pin, one line, `leanprover/lean4:v<major>.<minor>.<patch>` (a release, never `stable` or a nightly). |
| `.lean/` | Where the pinned toolchain is installed. It is gitignored (`git check-ignore .lean/toolchains` succeeds). The lane uses only the toolchain under here, never one on `PATH` or under `~`. Its layout is the implementer's, for example `ELAN_HOME=.lean`. |
| `packages/verdicts/model/` | The model's root. Every `.lean` file under it, outside `.lake/`, is the model. It's core Lean only: a Lake package with no `require`, or plain files. A build cache under `packages/verdicts/model/.lake/` is copied into scratch copies when it exists. |
| `scripts/verdict-proofs.mjs` | The lane script. It resolves everything from its own location (`new URL('../', import.meta.url)`), as `lanes.mjs` does, so it works the same in a scratch copy. |

### `node scripts/verdict-proofs.mjs`: the lane

The script is run from the root of a checkout or a scratch copy. It checks the toolchain, builds the model and
prints the axioms of six theorems. It exits 0 only when all of that passes. It prints one line per finding to
stdout, with build logs on stderr or after the finding lines:

- `BLOCKED toolchain: <the pin, verbatim from lean-toolchain> …`, when the pinned toolchain isn't installed under
  `.lean/`. The script then exits 1 and prints no `PASS` or `AXIOMS` line. A following `  Fix: …` line, saying how
  to install the toolchain, is expected by convention but not tested.
- `AXIOMS <full theorem name>: <axioms>`, exactly once for each theorem below, whenever the model builds. The
  `<axioms>` are what `#print axioms` lists, comma-separated, or `none`. A `sorry` shows as `sorryAx`.
- `FAIL …`, for each failure. A theorem whose axioms go beyond `propext`, `Quot.sound` and `Classical.choice`
  fails on a line that names the theorem and each such axiom, for example
  `FAIL axioms: Verdicts.verdict_closed depends on sorryAx`. A build error fails on a line that names the theorem
  (or lemma) it occurs in, for example `FAIL build: Verdicts.verdict_never_pass (Model/Props.lean:120): …`.
  Building with only warnings isn't a pass: the axioms decide.
- On the right model, no line starts with `FAIL`, `INVALID`, `BLOCKED` or `INCONCLUSIVE`, and the exit status is 0.

The script reads nothing under `tests/acceptance/684/` and never runs this suite.

### `node scripts/verdict-proofs.mjs vectors --seed <n> --count <k>`: the generator

The generator is in the model, and it builds the model first. It reads nothing under `packages/verdicts/src/`: a
copy without the engine's source prints the same bytes. The seed is a whole number in [0, 2^31). The same seed and
count print the same bytes, and another seed prints other vectors. On success it exits 0, and stdout holds only
JSON lines:

```jsonc
{"seed": 123, "count": 10000, "rows": ["ran_nothing", "missing", ...]}     // header: every row of the model
{"claim": <ClaimInput>, "verdict": "<Result>",
 "checks": [{"check": "<id>", "outcome": "<Result>"}],
 "requirements": [{"req": "<handle>", "outcome": "<Result>"}],
 "rows": ["<row>", ...]}                                                   // one line per vector, `count` of them
```

- `claim` is a `ClaimInput` of `@deepbuild/verdicts`, which the tests pass to `verdict()` as is.
- `checks` and `requirements` give one outcome for each of the claim's checks and requirements, keyed by ID.
- `rows` lists the rows that applied, by their `Row` constructor names.
- The header's `rows` equals the constructors of the model's `inductive Row`.

On failure the generator prints the same `BLOCKED toolchain:` or `FAIL` line as the lane and exits 1.

### Names in the model (namespace `Verdicts`)

| Name | Shape the tests rely on |
|---|---|
| `Verdicts.verdict_closed` | Theorem: the verdict is one of the five or pending. |
| `Verdicts.verdict_highest` | Theorem: the verdict is the highest row that applies, by the precedence line. |
| `Verdicts.verdict_never_pass` | Theorem: it is never PASS while a check is pending, ran nothing or can't fail, or a requirement lacks a counted check at its depth or is covered only by the agent's own. |
| `Verdicts.verdict_set_only` | Theorem: it depends only on the set of records. |
| `Verdicts.verdict_rises` | Theorem: it only rises as pending results land, with the check's inputs fixed. |
| `Verdicts.late_read_stale` | Theorem: a late run whose reads withdraw a carried result marks that check stale, with no counted run. |
| `Verdicts.Result` | `inductive` with the constructors `PASS`, `FAIL`, `INVALID`, `BLOCKED`, `INCONCLUSIVE` and `pending`. |
| `Verdicts.rank` | `def rank : Result → Nat`, the precedence. Every comparison of results reads it. |
| `Verdicts.Row` | `inductive`, one argument-free constructor per row of the rules table, among them `ran_nothing`. |
| `Verdicts.Row.result` | `def Row.result : Row → Result`, the outcome each row sets. |
| `Verdicts.Run` | `structure` with a field `id` whose type has `BEq`. Two records with one `id` are one run. |
| `Verdicts.Claim` | `structure` with a field `runs : List Run`: the claim's run records as they arrived, in order, duplicates included. |
| `Verdicts.verdict` | `def verdict : Claim → …`, with exactly one explicit argument, the claim. The theorems are about it. |

### Anchors (the text the plants edit)

The plants run only in scratch copies, never in this checkout. Each one finds a single declaration of
`theorem <name>` (or `def`/`abbrev <name>`) in the model's files:

- It starts at column 0.
- It may be written `<name>` inside `namespace Verdicts`, or as `Verdicts.<name>`.
- It may follow `@[…]` attributes and the modifiers `private`, `protected`, `noncomputable`, `partial` or `nonrec`
  on the same line.
- It isn't inside a `mutual` block.

The plant renames that declaration to `<name>_684orig`. It inserts the planted text right where the declaration
ends: at the first later non-blank line that starts at column 0 and doesn't start with `|`, `where`,
`termination_by`, `decreasing_by` or `deriving`. A doc comment, a comment, another declaration or `end` all end it.
So the model keeps Lean's usual layout: top-level declarations at column 0, with their continuation lines indented.
Match arms and those four keywords may sit at column 0. No other declaration may refer to the six theorems.

`inductive Row` is read the same way. Its constructors are the `| name` entries between its line and its end.

| Test | Anchor | Planted text (`<orig>` is `Verdicts.<name>_684orig`) |
|---|---|---|
| AC1 sorry | `theorem verdict_closed` | `theorem verdict_closed : type_of% @<orig> := sorry` |
| AC1 axiom | `theorem verdict_rises` | `axiom planted_axiom_684 : False` and `theorem verdict_rises : type_of% @<orig> := Verdicts.planted_axiom_684.elim` |
| AC2 pending below PASS | `def rank` | `def rank : type_of% @<orig> := fun r => match r with \| .pending => 0 \| .PASS => 1 \| r => <orig> r` |
| AC2 ran nothing raises PASS | `def Row.result` | `def Row.result : type_of% @<orig> := fun w => match w with \| .ran_nothing => .PASS \| w => <orig> w` |
| AC2 first record only | `def verdict` | `def firstRecords684` (keeps the first record of each `id`, by `List.foldl`) and `def verdict : type_of% @<orig> := fun cl => <orig> { cl with runs := Verdicts.firstRecords684 cl.runs }` |

Where the anchor is spelled `Verdicts.<name>`, the planted declarations are spelled that way too.

### The engine (`packages/verdicts/src/index.ts`, its public entry)

- `verdict` and `selectReruns` work as at the base, plus the two fixes:
  - Two run records with one `run` and different `outcome`s make their check INVALID, in either order, and the
    verdict's `reasons` name the run handle. The same record sent twice still changes nothing.
  - A run whose `contract.outcome` is `'INVALID'` makes its check INVALID even when `contract.reasons` is empty, and
    the verdict's `reasons` name the check.
- Item 3: `CheckResult` gains `stale: string | null`. When a run's recorded reads withdraw the result carried to
  the claim, the field is a text naming each such file (`src/x.ts`), and otherwise null. Such a check counts none of
  the withdrawn runs, is `pending` until its runs on the claim's commit land, and is in `selectReruns(claim).rerun`.
  The tests read `stale` only on the withdrawn check, as a string that contains the file.
- The precedence anchor: the engine's source under `packages/verdicts/src/` holds the precedence exactly once, as
  the object literal `{ PASS: 0, pending: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 4, FAIL: 5 }` (any spacing),
  as `engine.ts` does at the base. Every precedence comparison reads it. A rank-swap twin is a copy of
  `packages/verdicts/src/` with two adjacent values swapped, imported through the copy's `index.ts`, with
  `node_modules` linked to the checkout's.

### `scripts/lanes.mjs` and the preflight

- `checks` holds a lane named `verdict proofs`. It runs `scripts/verdict-proofs.mjs` (and whatever else the
  implementer adds) and declares its gating on its own entry, for example
  `paths: ['packages/verdicts/src/**', 'packages/verdicts/model/**']`. The tests run `runLanes([{ ...lane, commands }])`,
  so the gating must travel with the lane object, and `runLanes` applies it.
- `runLanes` reads the release preflight from `process.env.DEEP_PREFLIGHT === 'release'`. In it, a gated lane always
  runs.
- In the local preflight, a gated lane runs when the change touches one of its paths. The change is every path
  that differs between `git merge-base HEAD origin/main` and the working tree (committed or not), plus new files git
  doesn't ignore, all in the `cwd` the lanes run in. Otherwise the lane prints `SKIP verdict proofs: <why>`, runs
  nothing, and counts as neither a pass nor a failure. When the change can't be worked out (no git repository, no
  `origin/main`), the lane runs. That case isn't tested.
- A lane that runs and passes prints `PASS verdict proofs (<s> s)`, as today. Without the toolchain its summary
  reads `BLOCKED verdict proofs: …`, naming the pin, and `runLanes` returns 1.
- `package.json`'s `release:check` is `DEEP_PREFLIGHT=release scripts/preflight`.

### Scratch copies

Scratch copies go under the OS temp folder and are removed after each file. A copy holds:

- every file `git ls-files --cached --others --exclude-standard` lists (read-only git) that sits at the root, under
  `scripts/`, under `packages/verdicts/`, or under `tests/acceptance/684/`, skipping `.vite/`, `node_modules/` and
  `.lake/`;
- `node_modules` linked to the checkout's.

For the Lean runs, it also links `.lean` to the checkout's and copies `packages/verdicts/model/.lake/`. The AC8
toolchain test leaves both out, puts only node's folder, `/usr/bin` and `/bin` on `PATH`, uses a home of its own,
and unsets `ELAN_HOME`, `ELAN_TOOLCHAIN`, `LEAN_PATH`, `LEAN_SYSROOT`, `LAKE_HOME` and `LAKE`. The gating tests use
scratch git repositories holding a copy of `scripts/` and stand-in files. Their git runs with hooks off and signing
off. Nothing runs git against this checkout except `ls-files` and `check-ignore`.

## Readings where the issue leaves a choice

1. **The agreement test is this suite's.** #28's suite wrote its reference and its agreement test itself, and this
   suite does the same against the model's vectors. The implementer's lane may run `lean.test.ts` as a command of
   its own to "require the engine to equal the model" (design), as long as `scripts/verdict-proofs.mjs` doesn't.
2. **What "equal" compares:** the claim's verdict, and each check's and each requirement's outcome, keyed by ID,
   with no extra or missing IDs on either side. Counted runs and `stale` aren't compared.
3. **Every row applies:** each constructor of `inductive Row` must appear in some vector's `rows`. Beyond that, the
   vectors must hold the five claims Why item 4 says the reference misses, and the two the engine fixes (items 1 and
   2), recognized from the claim alone (`SHAPES` in `helpers.ts`). The issue says "the model's vectors include all
   five".
4. **"The test fails if a row applies in no vector"** is shown by running the same row check on the vectors minus
   every vector where the rarest row applied. It must name that row and the seed.
5. **The rank swaps** are the five adjacent pairs of PASS < pending < INCONCLUSIVE < BLOCKED < INVALID < FAIL. Each
   twin is compared over the same 10,000 vectors, after the real engine is shown to agree, and its first difference
   is named `seed <n>, vector <i> (<claim>): …`.
6. **The planted engine row (AC4)** is added around `verdict` in the test, not in a copy: a check whose counted runs
   hold exactly one passed run is raised to INVALID ("one clean run is too few"), with no model edit. A copy would
   need an anchor inside the engine's row code, and a row is a row wherever it's added.
7. **Which proofs the plants hit.** The sorry goes in `verdict_closed` and the axiom in `verdict_rises`. Lean builds
   the sorry with a warning, so the test also requires an `AXIOMS Verdicts.verdict_closed: … sorryAx …` line. That
   shows the lane read the axioms rather than failing the build. Each planted wrong model makes a property the issue
   states false: never PASS while pending, never PASS after a run that ran nothing, and only the set of records
   matters. So the lane must fail at a FAIL line that names a theorem or lemma declared in the planted model.
8. **"A count that reads only the first run record"** is read as the engine's item-1 bug in the model: of the
   records with one run ID, only the first is read.
9. **A control for the plants.** An unplanted scratch copy must pass the lane before any plant counts, so a broken
   scratch copy can't make a plant fail by accident.
10. **The generator comes from the model:** a copy with no `packages/verdicts/src/` prints the same vectors, so the
    model's verdicts can't come from the engine.
11. **AC7's counterexample, built.** Check `k` declares `lib/**` and needs 2 runs. Check `s` declares `src/**` and
    passes on D. The claim is on D, and its change from C touches only `src/x.ts`. A `missing` run of `k` on C
    carries, so the claim is BLOCKED. Then a run of `k` on C that passed and read `lib/k.ts` and `src/x.ts` lands.
    After it, `k` must be stale naming `src/x.ts`, count no run, be pending, and be the only check in
    `selectReruns(...).rerun`, and the claim must not be PASS. Once two runs of `k` on D pass, it counts exactly
    those, and the claim passes. A carried PASS withdrawn the same way must not stay PASS. The model's side is
    `late_read_stale` and `verdict_rises`, each printed with standard axioms. Their statements are the
    implementer's, held to the issue's words, and only the plants test them.
12. **AC5 and AC6 clean twins** sit inside the fix tests, so each test fails on the base: one record sent twice
    stays PASS (or FAIL), and a contract report that counts stays PASS.
13. **AC8's "change"** includes committed, uncommitted and untracked files, as #246's size check counts them. The
    local skip is tested with all three outside the engine and the model. The run is tested with a committed engine
    edit, an uncommitted model edit and a new untracked model file.

## Criteria to tests

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 | The lane builds the model and prints each property theorem's axioms; a planted sorry and a planted axiom each fail it, naming the theorem and the axiom | `lean.test.ts`: AC1 on the model…; AC1 a planted sorry…; AC1 a planted axiom… |
| AC2 | Three planted wrong models each fail at a named theorem or lemma | `lean.test.ts`: AC2 ×3 |
| AC3 | ≥10,000 vectors from a drawn, recorded seed; every row applies; five rank swaps disagree, naming the seed | `lean.test.ts`: AC3 on 10,000 vectors…; AC3 the agreement test fails, naming the row…; AC3 the vectors are seeded…; AC3 swap ×5 |
| AC4 | A planted engine row fails the agreement, naming a vector | `lean.test.ts`: AC4 |
| AC5 | One run ID, two outcomes: INVALID in both orders, naming the run | `engine.test.ts`: AC5 |
| AC6 | A contract INVALID with empty reasons makes the check INVALID, naming it | `engine.test.ts`: AC6 |
| AC7 | `verdict_rises` with inputs fixed and `late_read_stale`; the counterexample marks `k` stale, reruns it, never passes | `lean.test.ts`: AC7; `engine.test.ts`: AC7 ×2 |
| AC8 | Local gating on the engine's source and the model; release always; BLOCKED without the toolchain | `lanes.test.ts`: AC8 ×5 |

## Not covered here

- Scope bullets with no criterion: the model listing its assumptions; no Mathlib or other Lake packages; the
  repo-rules dependency check (#246) listing the toolchain; the design text update; the lane sitting next to #569's
  replay, which isn't built yet.
- The Proof's pasted outputs, beyond what these tests print (the seed, row counts, each twin's first difference).
- The content of the theorem statements, which a test can't read. Only the plants and the axioms check them.
