# Acceptance tests for #1940: effects.audit is the effects module's, and the loop module seals without it

Written first, from issue #1940 ("effects.audit: the effects module registers its audit, and the loop module seals
without it": its scope, its Fields, its one acceptance criterion and its proof line, "The loop module sealed without the
effects module, the effects.audit input BLOCKED there, and the planted loop module refused at the seal, with the issues
as data"), the design sections it names and base commit `c56fe5407` ("Merge pull request #2462 …"), by a job that never
saw an implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
one test per clause of the criterion, nothing beyond it.

## What was read

- The issue's text as handed to this job, and its criterion line with `gh issue view 1940 --json body` (for the
  criterion ID's exact text).
- `docs/technical-design.md`: Document check (the loop's checks, effect budgets among them); Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Check input: loop kinds (its Fields, `effects.audit {count_peak: u32, bounds: box
  (analytic), overdraw: {max: f32 = 8}, gpu_ms: measured against declared}`, and its Semantics: "effects.audit is the
  effects module's, beside its shipped effects, so the loop module depends only on scene3d and look").
- At the base, read only for the surfaces these tests extend: `crates/deep-show` (`Cargo.toml`'s test features,
  `main.rs`: `modules`, `test-leave-out-effects`, `sandbox_needs_logic`, the seal and its refusal line; `verdict.rs`:
  a requirement whose kind no module registers); `crates/deep-canvas/src/registry/mod.rs` (`module_of_check`, the
  seal's `missing_dependency`); `crates/deep-canvas-loop` (its manifest); `crates/deep-canvas-effects/src/module.rs`;
  `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs` (`alone`); and the suites `tests/acceptance/238/`
  (a planted module refused at seal), `403/` (a check input BLOCKED with module_missing naming a module), `490/` and
  `485/` (builds that leave a module out), `1919/` (layout).

## What the base already does, which these tests don't credit

The loop module (`deep-canvas-loop`, #453) registers one check kind, `geometry.shading`, and its manifest requires
scene3d and look only. The effects module registers no check kind, and nothing registers `effects.audit`. deep-show
already has `test-leave-out-effects` (#200), which leaves the effects module out of the full set's list. A requirement
whose check kind no module registers is BLOCKED with `module_missing`, naming the kind and, where the kind's family is
a design-named module the build lacks, that module (#403). So the first two clauses already hold at the base, where
`effects.audit` is no one's (BASE-FAILURE.txt); the planted build, `test-effects-audit-in-loop`, isn't a feature there.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1940 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1940/tsconfig.json
```

The file builds two `deep-show` binaries once, in `beforeAll` (an hour a build is allowed), with `cargo build --locked
--bin deep-show --no-default-features --features <set>`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set and Homebrew's rustup put on PATH when present, and copies each into a temporary
folder, deleted after the file. Every test passes an explicit timeout of 30 minutes. Each test's evidence store is a
temporary folder, deleted after it. No process is started but `cargo` and the copied `deep-show`, each waited for, none
stopped by name or port. Nothing needs a GPU, the network or a reference Mac.

`scripts/lanes.mjs` needs `alone.push('tests/acceptance/1940/');` beside the other `alone.push` lines, since the file
builds deep-show twice; this README is the instruction, the implementer makes that edit.

## Test builds: Cargo features on `deep-show`

| Build (`--features`) | What it is |
|---|---|
| `full,test-leave-out-effects` | #200's feature, as at the base: the full set's list without the effects module. The test build of clauses 1 and 2 |
| `full,test-leave-out-effects,test-effects-audit-in-loop` | The same, with the planted loop module of clause 3 |

**`test-effects-audit-in-loop`** is this suite's one new feature, which the implementer adds to
`crates/deep-show/Cargo.toml` (never in a shipped build): it seals, in the loop module's place, a planted loop module
that registers the `effects.audit` check kind itself and so declares the effects module (`^1`, not optional) among its
required dependencies, as `test-sandbox-needs-logic` plants a sandbox module that requires logic. Built with
`test-leave-out-effects`, the seal refuses it before any scenario is read, naming effects. The feature changes nothing
else; with the effects module in the build it is not used here.

## The surfaces under test

All are the base's, as #305's, #238's and #403's READMEs define them; this suite adds none.

- **The startup.** `deep-show run` seals before reading its first line. A sealed build answers each scenario line with
  one line `{ok: true, replies}` and exits 0; a refused one writes one line `{ok: false, code: "seal_refused", reason,
  modules, …, what}` and exits 2, answering no scenario. `modules` names the modules the refusal involves.
- **`{call: "registry"}`**: its `modules`, the canvas modules the build sealed.
- **A claim with requirements** (scenario field `claims`, #403): `{session, deliverables: [doc ID], requirements: [{id,
  check: CheckInput}]}`, judged by `{call: "verdict", claim}`, whose reply is `{result, key, requirements: [{id, kind,
  result, blocked?: [{code, kind, module?, ids}], issues}]}`. The deliverable is a board stored in `docs[…].document`
  (revision 0, current) with one `rect@1`.

## Criteria to tests

The ID is the first 8 hex digits of the SHA-256 of the criterion's text, trimmed and whitespace collapsed, the leading
`- [ ] ` dropped (`scripts/proof-change.mjs: criterionId`). Each test's name starts with it.

| ID | Criterion | Tests, in `effects-audit.test.ts` |
|---|---|---|
| `#1940.44d6026c` | The loop module seals in a test build without the effects module, and a check input naming effects.audit there is BLOCKED with module_missing, naming the effects module, never PASS; a planted loop module that registers effects.audit itself, and so depends on effects, is refused at that build's seal, naming effects | 3. (1) `full,test-leave-out-effects` starts (exit 0, `ok: true`), and its `registry` lists `loop` and not `effects`. (2) There, alpha's claim on the board with one requirement `{kind: "effects.audit", overdraw: {max: 8}}`: the requirement has a row, BLOCKED, whose `blocked` holds `{code: "module_missing", kind: "effects.audit", module: "effects"}`, and neither the row nor the claim is PASS (`auditFailures`). (3) The planted build's startup exits 2 with one line, `{ok: false, code: "seal_refused"}`, whose `modules` hold `loop` and `effects` |

Wrong programs these catch: a loop module that requires effects, or registers effects.audit and so needs it (clause 1
fails on the planted build's seal, the refusal clause 3 reads); a seal that takes the planted module, or refuses it
naming something else (clause 3); effects.audit run, skipped, left INCONCLUSIVE or passed in a build without effects,
or BLOCKED naming no module or another one (clause 2).

## Readings where the issue and design leave a choice

- **"A check input naming effects.audit there"** is a scenario claim's requirement holding that check input, judged by
  `verdict`, as #403 read "a brief whose check input names logic.determinism". Its fields are the issue's: the one
  with a default, `overdraw: {max: 8}`; `count_peak`, `bounds` and `gpu_ms` read as what the audit reports, not as
  inputs. The board holds no effects item, so the requirement is BLOCKED by the missing check kind alone and not by a
  `module_missing` the document raises.
- **"Naming the effects module"** is a `blocked` row with `code: module_missing`, `kind: effects.audit` and `module:
  effects`. **"Never PASS"** is read on the requirement (exactly BLOCKED) and on the claim (not PASS).
- **"Refused at that build's seal, naming effects"** is the startup's refusal line with `modules` holding `effects`,
  and `loop`, the module refused. The reason code isn't read: a missing dependency is the plainest, but the criterion
  names none.
- **"The loop module seals"** is the startup of the test build being accepted with `loop` among its modules.

Not tested, because the criterion doesn't ask: the effects module registering effects.audit in a build that holds it,
what effects.audit measures (`count_peak`, `bounds`, `overdraw`, `gpu_ms`) or its codes, the other loop kinds, and
effect timing being INCONCLUSIVE on another machine.
