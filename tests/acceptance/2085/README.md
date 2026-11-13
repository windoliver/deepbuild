# Acceptance tests for #2085: the `fixtures` call lists only fixtures that present, and the kit still proves #429's planted documents

Written first, blind, from issue #2085 (its Scope, three acceptance criteria and Proof), the design sections it names
and base commit `81a5a9b2f` ("Merge pull request #2349 …"), by a job that never saw an implementation; none existed,
and no other branch, worktree or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2085.a93c4567` | `fixtures.test.ts` (1): the `fixtures` call of `full`, then every fixture it lists shown by `deep_show` in that build |
| AC2 | `#2085.353d4030` | `kit.test.ts` (2): the kit over the effects module finds and proves #429's twelve planted documents; under the plant `trusts_write_index` it fails `scattered-write`'s exact-codes case |
| AC3 | `#2085.688e488c` | `fixtures.test.ts` (1): `scripts/known-failures.json` against the state AC1's test reads |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text as this job received it (starting `AC1:`
to `AC3:`); the live issue body wasn't read, so they aren't checked against it. Each test's name starts with its ID.

AC1's and AC2's proof, as the issue's Proof line says, is `tests/acceptance/387/perturb.test.ts`,
`tests/acceptance/855/hash.test.ts` and #429's suite, run unchanged by the implementer before and after. This suite
doesn't spawn them (they take hours); it gives each criterion its fastest faithful check through the surfaces those
suites and the issue name.

## What was read

- The issue as the brief quoted it.
- `docs/technical-design.md`: Dogfooding. `docs/canvas-primitives.md`: Registry and seal; Canvas module (`registers:
  {…, fixtures}`). AGENTS.md.
- At the base: `tests/acceptance/387/` (README: Fixtures, `{"call": "fixtures"}`; `helpers.ts`; `perturb.test.ts`),
  `tests/acceptance/855/` (README; `helpers.ts`; `hash.test.ts`), `tests/acceptance/429/README.md` (its planted
  programs, `trusts_write_index` among them), `tests/acceptance/138/README.md` (the `kit` call, its parts and cases,
  exact codes, the catalog part, scenario `planted`), `tests/acceptance/2324/README.md` (this README's shape).
- `crates/deep-show`: `frames.rs` (`fixtures_reply`), `kit/` (`mod.rs`, `manifest.rs`, `fixtures.rs`: the `#codes`
  case, `catalog.rs`: `exact`, `rows`, `fixture_issues`), `main.rs` (how a scenario's `planted` is read: a module's
  `PLANTED` list, as media's, or one of the hub's own; an unknown name is `bad_input`), `hub.rs` (`Planted`).
  `crates/deep-canvas/src/registry/mod.rs` (`Fixture`, `Registrar::fixture`, `sidecar`, `parity`).
  `crates/deep-canvas-effects/src/module.rs` (the twelve planted documents and `shadowed-box`) and `check.rs`
  (`CheckOptions`, the check's planted programs). `crates/deep-gpu-layer/src/effects.rs` (`operator_plants`).
  `crates/deep-canvas-{cells,vector,scene3d}/src/module.rs` (their fixtures, below). `scripts/canvas-kit.mjs`,
  `scripts/known-failures.json`, `scripts/affected.mjs` (`classify`, `--record`), `scripts/lanes.mjs` (`named`,
  `alone`), `scripts/proof-vitest-reporter.mjs` (how a case is named).

## What the base does

`fixtures_reply` lists every fixture each module registers, by module, name, document and record, without its
sidecar. The full build lists 44. `deep_show` refuses 16 of them, so a suite that presents each listed fixture fails
on the first it reaches:

- `cells/grid` (sidecar `codes: []`): `unknown_asset` at `items/term/params/play/asset`. The grid has no `play`; the
  cells kind probes `play/asset` (#1967, `1bf94dde4`, after the issue's 7dd8cf19). It is the first in the listing.
- #429's twelve, each with the code its sidecar names: `effects/same-machine-check` (`not_exact` at
  `checks/total_ok/probe`, the issue's error), `composed-in-core-view`, `live-only-material`, `scattered-write` and
  the eight `tint-*`.
- `scene3d/rest-no-support` (sidecar `codes: ["no_support"]`, #2013, also after 7dd8cf19) and `vector/formula` and
  `vector/paint` (sidecar `codes: ["asset_missing", "unknown_kind"]`, #1162). These come after effects in the listing,
  so the issue's run never reached them.

So at this base, `perturb.test.ts` and `hash.test.ts` fail first at `cells/grid`, not at `effects/same-machine-check`.
AC1 ("pass on main") and the Scope's first bullet ("Every fixture the `fixtures` call lists presents") hold only when
all 16 present or leave the listing; leaving out every fixture whose sidecar names codes covers 15 of them, and
`cells/grid` (whose sidecar names none) needs its own change or issue. AC1's test names all 16.

The kit (`{"call": "kit"}`, #138) builds its manifest from the same registered fixtures, sidecars included, and over
the effects module runs a `#codes` case per planted document in its `fixtures` part and a `code:<code>` case per code
in its `catalog` part: all pass at the base (`crates/deep-show/kit-ledger.json` records effects PASS). No plant in
deep-show makes the effects check stop raising a code: the check's own planted programs (`CheckOptions`) are reachable
only through deep-gpu's `--planted`.

## Run them

```sh
npm ci && npm run build --workspaces                  # once
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"   # cargo of the pinned channel, if not on PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run tests/acceptance/2085 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/2085/tsconfig.json
```

Each file builds `deep-show` once with `cargo build --locked --bin deep-show --no-default-features --features full`
(`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies it out of `target/debug` to a temporary
folder, and fails each test that uses it if the build failed. Each test writes its evidence store into a temporary
folder and deletes it. Nothing touches the checkout but cargo's `target/`. Node built-ins and vitest only.

A cold build took 3.5 minutes on this Mac; with the binary built, the suite runs in about 7 seconds (four processes:
the listing, the 42 fixtures without a record in one, and one each for `text/counter` and `text/status` with their
records; one kit run per kit test).

`scripts/lanes.mjs` needs `'tests/acceptance/2085/'` in its `alone` list (the files build a cargo binary, as #387's and
#855's do); this README is the instruction, and the implementer makes that edit.

## Surface choices

The issue names no new surface but the plant AC2's wrong program needs. Every name below the issue doesn't give is
this job's choice; the implementer builds exactly it, or a dispute goes to a blind redraft.

### The plant

**The one new seam: the scenario plant `trusts_write_index`.** A value of `deep-show run`'s scenario field `planted`
(#138's field, which already takes the kit's twins and modules' plants), in no shipped path. Under it, the effects
module's operator check, wherever deep-show runs it (a `deep_show`, the kit's `fixtures` and `catalog` parts), trusts a
compute write's index, as deep-gpu's `--planted trusts_write_index` does (#429's twin for `#429.8c4a173e`,
`CheckOptions.trusts_index`); nothing else changes. So `scattered-write`, the planted compute write at `hash(i) % 64`,
stops raising `operator_kind_rule`. The test runs `{"call": "kit", "modules": ["effects"], "parts": ["fixtures",
"catalog"]}` under it and requires: the kit still runs `scattered-write`'s exact-codes case; its `raised_codes` lacks
`operator_kind_rule`; the case is FAIL with `unexpected_codes`, `missing: ["operator_kind_rule"]`, naming the fixture;
the effects module's verdict is FAIL; and the other eleven planted documents' cases still pass. How the value reaches
the check (a `PLANTED` list on the effects module, as media's; a flag the hub passes) is the implementer's. At the
base the value is unknown and the scenario is `bad_input`.

Everything else the tests read exists at the base: `deep-show run` with `fixtures`, `deep_show` and `kit`; the kit's
cases (`case`, `verdict`, `fixture`, `expected_codes`, `raised_codes`, `failure`); `scripts/known-failures.json`.

## Readings where the issue leaves a choice

- **"Presents"** (AC1, Scope): a `deep_show` of the fixture's document, issues asked for and no pixels, to a document
  of its own in a visible panel, answers `outcome: "presented"`, as #387's `perturbed` and #855's `evaluate` show each
  listed fixture. Fixtures without a record are shown in one process, each to its own document; a fixture with a
  record in a process with that record as the scenario's, as both suites pass it. The listing comes from the same
  binary.
- **What may leave the listing** (AC1, Scope's first bullet): fixtures whose sidecar names codes, or the planted
  documents moved where the call doesn't list them. The effects module's own fixture `shadowed-box`, whose sidecar
  names no code (`codes: []`), is not a planted document: the test requires it still listed and presented, so a fix
  that drops the module's fixtures wholesale (or every fixture with a sidecar) fails. A listing that is empty fails.
- **"The effects kit still runs each planted document"** (AC2, Scope's second bullet): the kit over the effects module
  has, for each of the twelve planted documents the base registers (`helpers.ts`: `PLANTED`, name and the one code its
  sidecar names), a `fixtures`-part case `<kit name>#codes` whose fixture is that document wherever it is filed (the
  kit name ends in `/<name>.<profile>`), passing, with `expected_codes` and `raised_codes` exactly `[<code>]`; and a
  `catalog`-part case `code:<code>` proved by that document, passing. A fix that drops the documents or their codes
  fails it. It passes on the base by construction (the base's kit finds all twelve); it proves something on the work.
- **"Fails a check that stops raising its code"** (AC2): the plant above, on `scattered-write`, the planted document
  #429's own twin of the check reaches.
- **"Until then the seven cases are listed … with this issue"** (AC3): the seven are the five of `perturb.test.ts`'s
  seven tests that read the fixtures and the two of `hash.test.ts`'s four that do, named as `scripts/affected.mjs`
  names a case (`<file> › <describe> › <test>`, as `vitest list` gives them at the base, with the files' template values
  filled in: `SEED` 3870001 and `ID` `#855.6df0cf9c`). A test can only hold the list against the state of the commit it runs
  on, which AC1's test reads: while a fixture the full build lists isn't presented, each of the seven is in
  `failures` and its message names `#2085`; once every listed fixture presents, nothing of the two files is listed
  (a case that passes and stays listed hides its next failure; `affected.mjs` prints `NOTE … passes; remove it`).
  So it fails at the base (16 not presented, none listed) and on a fix that leaves the entries behind.

## Base results

`BASE-FAILURE.txt` is the one run at the base: 4 tests, 3 fail and 1 passes. AC1 fails listing the 16 fixtures
`deep_show` refuses, `effects/same-machine-check` with `not_exact` at `checks/total_ok/probe` among them (the issue's
reason), behind `cells/grid`. AC3 fails: none of the seven is listed. AC2's plant test fails: the base answers
`bad_input` to `planted: "trusts_write_index"`. AC2's first test passes, as it must on the base.

## Not tested, because no criterion reaches it here

The two named files and #429's suite themselves (AC1's and AC2's proof, the implementer's to run); the fixtures with
codes in other modules' kits (`scene3d/rest-no-support`, `vector/formula`, `vector/paint`), which AC2 doesn't name;
`scripts/canvas-kit.mjs`'s full run (every part over every module); the pixels of any fixture.
