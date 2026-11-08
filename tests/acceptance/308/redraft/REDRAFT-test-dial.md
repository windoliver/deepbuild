# #308 `test.dial`: blind redraft of module.test.ts's second AC2 test

**Dispute** (`DISPUTE-test-dial.md`). The test builds `full,test-control-kind`, which README.md defines as a second
canvas module `test.dial` filling the entry `test.dial` into `control@1`, and expects the build to seal with
`test.dial` listed as `module: "test.dial"`. `control@1` is declared by the input module (issue #308: `{owner: input,
fill: [module], resolve: seal}`), and canvas-primitives.md, Registry and seal: registries, says the seal "refuses a
canvas module's entry in a registry another canvas module declares" (and, under It can never, "take a canvas module's
entry into a registry another canvas module declares"). So no correct program can seal that build. AC2 asks only for
"a planted test kind"; it names no second module.

**What changed.** Who fills `test.dial`: in a build with feature `test-control-kind`, the input module itself fills
one more entry, `test.dial`, into `control@1`; no other canvas module joins the set. The test now expects the listing
to show `test.dial` with `module: "input"` (was `"test.dial"`) and kit `PASS`, and its name carries " (redraft)".
Unchanged: the feature name `test-control-kind`, the planted names `control_kind_recompute`, `control_kind_no_keyboard`,
`control_kind_agent_input` (and `control_kind_reads_modifiers`), the kind name `test.dial`, the unplanted seal, and
every refusal it checks (`reason: entry_refused`, `registry: control@1`, `entries` naming `test.dial`, the rule
`replay`, `keyboard` or `input`). `README-test-dial.md` holds the README rows to replace.

`module-ac2-redraft.test.ts` replaces that one test in module.test.ts; it builds only `full,test-control-kind` and uses
`../helpers.ts` (`useBuilds`, `deep-show`), not the swapped `redraft/helpers.ts`. Note that `vitest run --root
tests/acceptance/308` also collects this file, so the redrafted test runs beside the original until the original is
replaced.

```diff
--- module.test.ts (AC2 second test)
+++ redraft/module-ac2-redraft.test.ts
@@ -1,9 +1,9 @@
-  it('AC2 a planted test kind computed again from the camera at replay fails the replay part at the seal, naming the kind; one with no keyboard path is refused, naming it; one an agent\'s input writes is refused, naming it; the same kind unplanted seals', () => {
+  it('AC2 a planted test kind computed again from the camera at replay fails the replay part at the seal, naming the kind; one with no keyboard path is refused, naming it; one an agent\'s input writes is refused, naming it; the same kind unplanted seals (redraft)', () => {
     const bin = builds.bin(TEST_KIND);
     none(sealFailures(startup(bin), 'the test kind test.dial'), 'the control kind test.dial, unplanted');
     const [reply] = run(bin, scenario(evidence(), [REGISTRIES]));
     const dial = listedRegistry(reply!, 'control@1').entries.find((e) => e.name === 'test.dial');
-    expect([dial?.module, dial?.kit.verdict], 'test.dial is filled by the module test.dial and passes the kit').toEqual(['test.dial', 'PASS']);
+    expect([dial?.module, dial?.kit.verdict], 'test.dial is filled by the input module, which declares control@1, and passes the kit').toEqual(['input', 'PASS']);
     for (const [planted, part] of [['control_kind_recompute', 'replay'], ['control_kind_no_keyboard', 'keyboard'], ['control_kind_agent_input', 'input']] as const) {
       none(refusalFailures(startup(bin, planted), { reasons: ['entry_refused'], registry: 'control@1', entries: ['test.dial'], rules: [part] }), `the kind test.dial planted as ${planted}`);
     }
```

**AC14 (grammar.test.ts).** Its use of `control_kind_reads_modifiers` builds `full,test-control-kind` and checks only
the refusal (`entry_refused`, `control@1`, `entries` naming `test.dial`, rule `replay`). It reads no module name, so it
holds whichever module fills `test.dial`; it is not redrafted.

**Written blind.** Written from the issue, AGENTS.md, technical-design.md (Dogfooding), canvas-primitives.md (Registry
and seal: registries; Control: kinds as a registry), the original suite in `tests/acceptance/308/`, the earlier
redraft (`DISPUTE.md`, `REDRAFT.md`, `helpers.ts`) and `DISPUTE-test-dial.md`. No implementation was read
(`crates/deep-canvas-input`, `crates/deep-input`, the uncommitted changes to `crates/deep-show`,
`crates/deep-canvas-test-modules` or any `git diff` of `crates/`). Deviation from the design's Dogfooding rule: that
rule gives a redraft "the same inputs and the criterion, never the work, the diff or the dispute"; this job was asked
to read the dispute, which quotes one refusal line from the work.

**Base run** (`BASE-FAILURE-test-dial.txt`). Not built: the working tree holds uncommitted crate changes, so the base's
manifest was read with `git show c3978da0:crates/deep-show/Cargo.toml`; it has no feature `test-control-kind`, so the
test's first step (`cargo build --locked --bin deep-show --no-default-features --features full,test-control-kind`)
fails and the test fails at "the binary builds". Typecheck: `node node_modules/typescript/bin/tsc --noEmit -p
tests/acceptance/308/tsconfig.json` (its `include` is `./**/*.ts`, so it covers this folder) exits 0. Vitest was not
run.
