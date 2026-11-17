# Acceptance test for #155, criterion 9 (blind redraft): every foley@1 preset passes synth's pack check

Written first, from issue #155 (its body as of Nov 15, 2026: Scope, Fields, the nine acceptance criteria and its Proof
line), its Oracle page, the design rows it links and those they lean on, and the base commit `0e5572731` ("Merge pull
request #2529 from windoliver/fix/2362-kit-seal"), by a job that never saw an implementation; none of #155 exists
there, and no other worktree, branch, PR or session was read. This is a redraft of criterion 9 alone (design:
Dogfooding). The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- The issue body (`gh issue view 155`, no comments) and its Oracle page (`doneright/oracles/issues/155.md` in
  DeepBuildAI/deepbuild, branch `doneright`): no upstream test for criterion 9 ("Foley presets as synth.preset@1
  entries and the closed node list at pack check are our pack rules").
- `docs/technical-design.md`: Score and foley; Dogfooding; Criteria to tests, both ways; Wrong programs.
- `docs/canvas-primitives.md`: Synth `synth@1` and its As built (#204) (presets in a pack, the eleven nodes, the pack
  check refusing at `presets/<name>@<major>`, naming the node); Foley `foley.render@1`; Pack (`presets: {name@major →
  synth preset}`); Registry and seal, and Registry and seal: registries.
- At the base: AGENTS.md; `crates/deep-show/src/packs.rs` (`install_pack`), `registries.rs` (`registries_reply`);
  `crates/deep-canvas-media/src/module.rs` and `synth/mod.rs` (media declares `synth.preset@1`; a manifest's `presets`
  checked, each refusal at the preset's key); `scripts/proof-change.mjs` (`criterionId`); the suites
  `tests/acceptance/204/` (`pack-check.test.ts`, `helpers.ts`) and `204-gaps/registry.test.ts` (how `registries` lists
  a pack's presets), and how other suites install first-party packs from `packs/<name>-<version>/`.

## What the base has

Synth's pack check (#204) is built: a pack's `presets` are checked at `install_pack`, and an installed pack's presets
are listed under `synth.preset@1` by `registries`. There is no `packs/foley-1.0.0/`, so both tests fail at the base on
the missing pack (`BASE-FAILURE.txt`). The base would already refuse a node outside the list in any pack; that half is
what holds the first-party pack to the same check, and it runs on the pack itself.

To show the tests can pass, they were run once against a throwaway stand-in pack written only for that run and then
deleted (90 presets, each white noise through a gain shaped by an envelope): both passed, the planted copy refused
at `presets/metal.scrape@1` and its twin installed. The stand-in is not committed and is no proof of foley@1.

## Run it

```sh
npm ci
npm run build --workspaces
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked --bin deep-show
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/155-redraft-ac9 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/155-redraft-ac9/tsconfig.json   # type-check
```

The file builds `deep-show` once (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`) and copies it to
a temporary folder. Every temporary folder is `/tmp/dh155r-*`, removed after each test. Only `cargo` and `deep-show`
are started, each waited for; nothing is stopped by name or port; no network.

## The surface

- `deep-show run`: one scenario line `{evidence, calls}` on stdin, one answer `{ok: true, replies}` out.
- The pack: `packs/foley-1.0.0/pack.json`, `name: "foley"`, `version: "1.0.0"`, its `presets` map `"<material>.<action>@1"
  → preset` in #204's form `{nodes: {ID → {kind, …fields}}, edges: [[from, to, input]], out, params, cost}`.
- `{call: "install_pack", id: "deepbuild/foley", dir}` → `{outcome: "installed" | "refused", issues: [{path, actual?,
  what?}]}` (#306).
- `{call: "registries"}`: each registry with its entries; an entry of `synth.preset@1` carries `registry`, `name` and
  `kit.verdict`, as `204-gaps/registry.test.ts` reads it. A foley preset's entry is named `foley.<material>.<action>@1`
  (the design's `<pack>.<name>@<major>`).

## Criteria to tests

| ID | Test (`presets.test.ts`) | What it asserts |
|---|---|---|
| AC9 `#155.eaff7d6a` | 1 | `packs/foley-1.0.0/pack.json` is foley 1.0.0; its `presets` keys are exactly the 90 `<material>.<action>@1` of the issue's 10 materials × 9 actions; each is `{nodes, edges, out, params, cost}` with every node's `kind` in synth's eleven; installed as `deepbuild/foley` it is `installed` with no issue; `registries` then lists all 90 as `foley.<material>.<action>@1` entries of `synth.preset@1` with kit `PASS` |
| AC9 `#155.eaff7d6a` | 2 | The pack copied with `metal.scrape@1` given a node `grains` of kind `granular` after its output is `refused`, with an issue at `presets/metal.scrape@1` (or under it) whose path, `actual` or `what` names `grains` or `granular`; the same copy with `grains` a `gain` of 1 is `installed` with no issue |

## Planted programs

- **The planted foley preset** (test 2, built in test code): the committed pack, copied to a temporary folder, with
  `metal.scrape@1`'s output fed into a new node `grains: {kind: "granular", size: 0.05}`, which becomes `out`, and
  `cost` raised by 1. Its **clean twin** is the same copy with `grains: {kind: "gain", gain: 1}`: a gain of 1 changes
  no sample and adds the 1 to the cost the cost table gives a gain, so the twin passes exactly when the committed pack
  does, and must install. So the planted pack is valid but for the planted node, and its refusal can only be that
  node's. Each is installed in its own `deep-show` process, so neither meets the other's store row.
- **The merge base**: no foley pack; both tests fail on it.

## Not settled

- **Naming the node**: the design names the node in the refusal without saying by its ID or its kind; either counts.
  The preset is named by the issue's path (#204's reading), which holds its key.
- **"Within its estimate"**: read as the twin's cost raised by the added gain's own cost (1), so the twin keeps the
  committed preset's margin whatever the check's rule is.
- **Exactly the 90 presets**: the Scope makes foley@1 the (material, action) presets, so a key outside the grid fails
  test 1; a preset beside them would be a scope change.
- **Origin**: a first-party pack's entries could list as `first_party` or `pack`; the test reads only the name and the
  kit.
- The rest of #155 (rendering, Spawn, markers, processors, jobs, budgets) is other criteria's.
