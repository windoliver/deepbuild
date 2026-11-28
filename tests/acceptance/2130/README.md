# Acceptance tests for #2130: a patch to a budgeted document takes the whole check, and the seal refuses what it can't digest or sees twice

Written first, from issue #2130 (its opening, its seven scope lines, its seven acceptance criteria, "What goes wrong
today" with the code it quotes and each note, and its proof line), the design sections it links (canvas primitives:
The cost model; Registry and seal: registries; Migration), its epic #241 and #1940 for the words it cites, the audit
file it names (`reports/whole-project-audit-2026-11-09/06-canvas-core.md`) and the base commit `2a689d81f`, by a job
that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

What was read at the base, in `crates/deep-canvas/src/`: `lib.rs`; `registry/mod.rs` whole (`Manifest`, `Module`,
`Registrar` and its calls, `Check`, `SealError`, `Sealed` and its `satisfies`, `migrates_from`, `check_kinds`,
`check_kind`, `module_of_check`, `MODULE_CHECK_KINDS`, `KNOWN_MODULES`, `Registry::seal`, both `d1`s);
`registry/{semver,implementation,shapes,lists,fields,tests}.rs`, `registry/core_lists.rs` (`data_layout`, `obj`) and
`registry/paths.rs` (`check`); `kinds.rs`; `canon.rs` (`canonical_number`, the NFC key refusal); `budget.rs`;
`cost.rs` (`estimate_by`, its tests); `schedule/mod.rs` (`canonical`); `document/mod.rs`; `document/check.rs`
(`check_in`, `check_packed`, `lower`, `settle`, `finish`, `lights_check`, `fill_check`, `budget_check`, `recheck`,
`recheck_by`, `required_minors`, `check_item`, `resolve`); `document/check/check_assemblies.rs` (`check_targets`);
`document/packs.rs` (`check_pack`, `check_entries`, `check_recipe`, `Packs`, `resolve`, `driven_counts`);
`document/packs/{expand,entries,deps,moved,tests}.rs`; `document/pack_kinds.rs` (`check_kinds`). Outside the crate:
`crates/deep-show/src/kit/modules.rs` and `verdict.rs` (how a crate outside builds a manifest, and who asks
`module_of_check`), `scripts/canvas-lint.mjs`, `scripts/known-failures.json`, `scripts/known-failures-check.mjs`,
`lint/canvas/clippy.toml`, `tests/acceptance/rustfmt.toml`, and the suites `tests/acceptance/2662/`, `3023/` and
`2700/` (README).

## Run them

Seven files, one a criterion, each a Rust integration test of `deep-canvas`, the crate the issue changes, reaching it
only through its public items, with `std` and the crate's own `serde_json`. **The implementer adds these entries** at
the end of `crates/deep-canvas/Cargo.toml` (this job may write only here). The crate has no `[[test]]` entry at the
base; its `tests/cli.rs` is found by cargo as before.

```toml
# crates/deep-canvas/Cargo.toml
# Issue #2130: the acceptance tests, written blind in tests/acceptance/2130, one file a criterion.
[[test]]
name = "acceptance_2130_budget_recheck"
path = "../../tests/acceptance/2130/budget_recheck.rs"

[[test]]
name = "acceptance_2130_entry_digest"
path = "../../tests/acceptance/2130/entry_digest.rs"

[[test]]
name = "acceptance_2130_migrates_from"
path = "../../tests/acceptance/2130/migrates_from.rs"

[[test]]
name = "acceptance_2130_duplicate_check_kind"
path = "../../tests/acceptance/2130/duplicate_check_kind.rs"

[[test]]
name = "acceptance_2130_recipe_channels"
path = "../../tests/acceptance/2130/recipe_channels.rs"

[[test]]
name = "acceptance_2130_check_reads"
path = "../../tests/acceptance/2130/check_reads.rs"

[[test]]
name = "acceptance_2130_module_of_check"
path = "../../tests/acceptance/2130/module_of_check.rs"
```

From `<checkout>`, one `cargo test` call a file, so a file that does not build stops only itself:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
for t in budget_recheck entry_digest migrates_from duplicate_check_kind recipe_channels check_reads module_of_check; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 120 -- \
    cargo test --locked -p deep-canvas --no-fail-fast --test "acceptance_2130_$t"
done
```

No test reads a clock, a file, the environment or a GPU, starts a process or a thread of its own, or needs
`--test-threads=1`. The largest document holds 33 items. Each file is its own test binary and shares no helper file.
There is no `lane.json` and no `twins.json`: the files are cargo targets, which run where `cargo test --workspace`
runs, as #2662's do, and the merge base is every criterion's wrong program (the issue's proof line).

### What the lint lane will say of these targets

- **The canvas lint refuses each target's root.** `scripts/canvas-lint.mjs` fails a canvas crate's target rooted
  outside the crate, as it does #2662's and #3023's, which `scripts/known-failures.json` lists under `lint` (count 1)
  and `lintIssues` (a note ending `(#2381, added <date>)`). With the seven entries above it prints seven lines, one a
  file, which need the same listing or the lint lane fails; `scripts/known-failures-check.mjs` holds each note to an
  open issue and 14 days. The keys, with `<file>` each of the seven file names:

  `canvas-lint: deep-canvas compiles ../../tests/acceptance/2130/<file>.rs as a target's root, which the scan never reads: outside the crate, or under its target/ directory`

  That edit is outside this folder, so it is the implementer's, with the owner's word where the list needs it. The
  files name no clock, hash map, OS path or float method the lint's clippy run refuses.
- **rustfmt leaves these files as they are.** `tests/acceptance/rustfmt.toml` sets `disable_all_formatting`, so
  `cargo fmt --all -- --check` asks nothing of them, and plain `rustfmt` neither parses nor changes them. Each was
  parsed and formatted once with `--config disable_all_formatting=false`, and is unchanged by it.
- **Clippy was not run** (Not run, below).

## The surface

Every item of `deep_canvas` the files call, with its signature at the base. None is added by the change.

| Item | Signature at the base | Files |
|---|---|---|
| `registry::core` | `pub fn core() -> Sealed` | budget_recheck, entry_digest, recipe_channels, module_of_check |
| `registry::Registry::new`, `with`, `seal` | `pub fn new(build_set: BuildSet) -> Registry`; `pub fn with(mut self, module: Module) -> Registry`; `pub fn seal(mut self) -> Result<Sealed, Box<SealError>>` | entry_digest, migrates_from, duplicate_check_kind, check_reads |
| `registry::BuildSet::Core` | a variant of `pub enum BuildSet` | the same four |
| `registry::Module` | `pub struct Module { pub manifest: Manifest, pub register: fn(&mut Registrar) }` | the same four |
| `registry::Manifest` | `pub struct Manifest { pub name: String, pub version: Semver, pub core: Range, pub depends_on: BTreeMap<String, Dependency>, pub feature: String, pub license: String, pub implements: String, pub implementation: Implementation }` | the same four |
| `registry::Semver` | `pub struct Semver { pub major: u64, pub minor: u64, pub patch: u64 }`, `Copy`, `Display` | the same four |
| `registry::Range::parse` | `pub fn parse(text: &str) -> Option<Range>` (called with `"*"` only) | the same four |
| `registry::Implementation::reference` | `pub fn reference(name: &str, version: Semver) -> Implementation` | the same four |
| `registry::Registrar::check` | `pub fn check(&mut self, kind: &str, machines: &str, codes: &[&'static str], run: CheckRun) -> &mut Self`, `pub type CheckRun = fn(&Value, &Value) -> Vec<(String, Raised)>`; `Raised` is named as a type only | duplicate_check_kind, check_reads |
| `registry::Registrar::check_reads` | `pub fn check_reads(&mut self, arrays: &[&str]) -> &mut Self` | check_reads |
| `registry::Registrar::array` | `pub fn array(&mut self, name: &str, ty: &str, domain: &str, class: &str, phase: &str) -> &mut Self` | check_reads |
| `registry::Registrar::operator`, `Operator::determinism` | `pub fn operator(&mut self, name: &str, phase: &str, reads: &[&str], writes: &[&str]) -> &mut Operator`; `pub fn determinism(&mut self, class: &'static str) -> &mut Self` | check_reads |
| `registry::Registrar::kind` | `pub fn kind(&mut self, entry: Entry, needs: &[&str], draws_as: &str) -> &mut Self` | migrates_from |
| `registry::Registrar::entry` | `pub fn entry(&mut self, registry: &str, name: &str, value: Value, since: &str) -> &mut Self` | entry_digest |
| `registry::SealError` | fields `pub code: &'static str`, `pub modules: Vec<String>`, `pub arrays: Vec<String>`, `pub what: String` | the four that seal |
| `registry::Sealed` | fields `pub modules: Vec<SealedModule>` (`pub name: String`, `pub version: Semver`), `pub registries: Vec<lists::SealedRegistry>` | migrates_from, module_of_check, entry_digest |
| `registry::Sealed::module_of_check` | `pub fn module_of_check(&self, kind: &str) -> Option<String>` | module_of_check |
| `registry::Sealed::check_kind` | `pub fn check_kind(&self, kind: &str) -> Option<(&SealedModule, &Check)>` (read with `is_none` only) | module_of_check |
| `registry::Sealed::check_kinds` | `pub fn check_kinds(&self) -> Vec<&str>` | duplicate_check_kind |
| `registry::Sealed::registry` | `pub fn registry(&self, name: &str) -> Option<&lists::SealedRegistry>` | entry_digest |
| `registry::lists::SealedRegistry` | `pub entries: Vec<SealedEntry>`; `pub fn entry(&self, name: &str) -> Option<&SealedEntry>` | entry_digest |
| `registry::lists::SealedEntry` | fields `pub name: String`, `pub registry: String`, `pub digest: String` | entry_digest |
| `kinds::Entry`, `Version`, `Migration` | `pub struct Entry { pub family: &'static str, pub name: &'static str, pub versions: Vec<Version>, pub migrations: Vec<Migration> }`; `pub struct Version { pub major: u32, pub minor: u32, pub params: Vec<Param> }`; `pub struct Migration { pub from: u32, pub to: u32, pub renames: Vec<Rename>, pub retires: Vec<&'static str>, pub map: Option<MigrateFn> }` | migrates_from |
| `document::check_in` | `pub fn check_in(doc: &Value, sealed: &Sealed) -> CheckResult` | budget_recheck, migrates_from |
| `document::check_packed` | `pub fn check_packed(doc: &Value, sealed: &Sealed, packs: &Packs) -> CheckResult` | recipe_channels |
| `document::recheck` | `pub fn recheck(doc: &mut Value, prev_issues: &[Issue], changed: &BTreeSet<String>, sealed: &Sealed) -> Option<Vec<Issue>>` | budget_recheck |
| `document::CheckResult` | fields `pub issues: Vec<Issue>`, `pub lowered: Value` | budget_recheck, migrates_from, recipe_channels |
| `document::Issue` | fields `pub code: &'static str`, `pub severity: &'static str`, `pub ids: Vec<String>`, `pub path: String`, `pub what: String`; `pub fn to_json(&self) -> Value` | budget_recheck, migrates_from, recipe_channels, entry_digest |
| `document::Packs` | `Default`; `pub fn admit(&mut self, manifest: &Value, sealed: &Sealed) -> Result<&Pack, Vec<Issue>>` | recipe_channels |
| `document::packs::check_pack`, `Planted` | `pub fn check_pack(manifest: &Value, sealed: &Sealed, planted: Planted) -> Result<Pack, Vec<Issue>>`; `Planted: Default` | entry_digest |
| `document::packs::Pack`, `PackId::text` | fields `pub id: PackId`, `pub entries: Vec<registry::lists::SealedEntry>`; `pub fn text(&self) -> String` | entry_digest, recipe_channels |
| `budget::Class` | variant `Figure`; `pub fn fill_shaded(self) -> usize`; `pub fn name(self) -> &'static str` | budget_recheck |

Left alone on purpose, since the scope may change or add them: `registry::lists::entry_digest` and
`RegistryDef::digest` (scope line 2 may make `d1` return the `Result`), `Range::admits_major` (new, and its name is
the scope's suggestion), and `Sealed::satisfies`, `recheck_by` and `MODULE_CHECK_KINDS`, which are the crate's own.
One thing is assumed of the change: `SealedEntry.digest` stays a `String`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId`, checked with the inputs' `ids.mjs`. Each test's name starts
`ac<N>_`, each is a top-level test, and each failure message starts with the ID; a message that starts
`<ID> precondition:` is a case the issue leaves as it is, or a given, failing, and is this suite's to dispute, not the
change's. Each file's preconditions come before its criterion's assertion, so the base run shows them holding.

| ID | File and tests | What it holds | On the base |
|---|---|---|---|
| `#2130.766a56f0` | `budget_recheck.rs`: `ac1_a_second_light_past_budget_lights_1_is_checked_against_the_whole_document`, `ac1_a_patch_to_one_of_three_lights_past_budget_lights_2_keeps_the_over_budget`, `ac1_a_document_whose_budget_names_only_a_class_is_checked_whole_too` | In the core's build. (1) `budget: {lights: 1}`, one `light.sun@1`; the document after a second light `sun2` is created; `recheck` with `{sun2}` and the first document's issues returns `None`, or issues that hold `over_budget` at `budget/lights`; `check_in` of that document holds it (precondition). (2) `budget: {lights: 2}`, three lights, one renamed: the same of `recheck` with that light. (3) `budget: {class: figure}` and one fill light more than the class's `fill_shaded`, the last created: the same at `budget/fill_shaded`. Left as it is, in (1): with no `budget` member the same patch is answered by `recheck`, `Some`, with `check_in`'s issues by code, IDs and path | All three fail at their last assertion. (1): "… recheck, with the new item as changed, returned issues without over_budget at budget/lights, which check of the same document raises, so the patch is accepted: the reduced document it checked holds only the new light. It returned []". (2): "… the old over_budget was dropped and the reduced document, holding one light, raised none". (3): "… returned issues without over_budget at budget/fill_shaded …" |
| `#2130.873c8710` | `entry_digest.rs`: `ac2_the_pack_check_refuses_an_entry_with_no_canonical_form_naming_registry_and_entry`, `ac2_the_seal_gives_no_module_entry_an_empty_digest` | (1) `check_pack` of a pack `test/acc2130@1.0.0` whose one `data.layout@1` entry passes its kit and has `max_bytes: 9007199254740993` is `Err`, and one issue's written form holds both `data.layout@1` and `acc2130.grid`; the same for an entry with an extra member of that number and for one with two keys that are one key after NFC. Left as it is: with `max_bytes` 4096 and 4097 each is admitted with a digest, and the two differ. (2) A test module `acc` that fills `data.layout@1` with that entry does not seal. Left as it is: with 4096 it seals with a digest | (1) fails at `problems.is_empty()`: three lines, "the entry acc2130.grid (max_bytes: 9007199254740993) is admitted and sealed with the digest [\"\"]" and the like. (2) fails at its `panic!`: "the set sealed though the module acc fills data.layout@1 with acc.grid …; the sealed entries with an empty digest are [\"data.layout@1 acc.grid\"]" |
| `#2130.00e7dfcf` | `migrates_from.rs`: `ac3_a_range_some_version_of_an_earlier_major_meets_is_met_by_a_module_that_migrates_from_it` | Modules `b` and `c` at 2.0.0 sealed with the core; `b.thing` has majors 1 and 2 and a step from 1. A document with `requires: {modules: {b: <range>}}` raises nothing at `requires/modules/b` for `^1.2`, `~1.4`, `=1.3.0` and `>=1.1.0, <2.0.0`. Left as they are: `^1` and `^2` raise nothing; `^3`, `>=2.1.0`, `=2.0.1`, `<1.0.0`, `~0.9` and `>=1.5.0, <1.2.0` are `out_of_range` there; `c`, whose one kind has major 2 alone, is `out_of_range` for `^1.2` | Fails at `problems.is_empty()`: four lines, "b at ^1.2 is refused: [\"out_of_range: the document requires the b module at ^1.2; this build has 2.0.0\"]" and the like |
| `#2130.b3f91bae` | `duplicate_check_kind.rs`: `ac4_the_seal_refuses_a_module_that_registers_one_check_kind_twice` | A module `c` registers `c.audit` twice, with two run functions, beside a module `d` that registers `d.audit` once: the seal is `Err`, its code `duplicate_check_kind`, its `modules` `[c]`. Left as they are: `c` registering it once seals and `check_kinds()` lists it once; `c` and `d` each registering it are `duplicate_check_kind` | Fails at its `panic!`: "the set sealed though the module c registers the check kind c.audit twice: no duplicate_check_kind was raised, check_kinds() lists c.audit 2 times and only the first registration's run is ever reached" |
| `#2130.96087f96` | `recipe_channels.rs`: `ac5_a_document_channel_where_the_tests_recipe_channel_expands_to_is_refused_bad_id`, `ac5_a_document_channel_at_n1_rise_is_refused_bad_id` | The named test's pack and document, through `Packs::admit` and `check_packed` in the core's build. (1) Its recipe's `rise` expands to `n1.rise.0` and `n1.rise.1`; with a channel of the document's own at each, the check raises `bad_id` at `channels/<id>`, an error, and the lowered document's channel there is the document's. (2) The same with a step that makes one item, at `n1.rise`. Left as it is, in both: a document channel at `mine` raises no `bad_id`, stays in the lowered document, and the recipe's channels join it with the targets the named test reads | Both fail at `problems.is_empty()`: "no bad_id is raised at channels/n1.rise.0; the check raised […]" and "the lowered document's channel n1.rise.0 targets Some(\"items/n1.bars.0/params/h\"), not the document's own items/n1/at/pos/0: the recipe's channel took its place" |
| `#2130.219ed3ba` | `check_reads.rs`: `ac6_a_not_exact_refusal_of_a_checks_read_names_the_array`, `ac6_an_unresolved_read_refusal_of_a_checks_read_names_the_array` | (1) A module `c` with a `same_machine` operator that writes `c.p` and a check with machines `any` that reads it: the seal's error is `not_exact` and its `arrays` is `[c.p]`. Left as it is: with machines `same` it seals. (2) A check that reads `c.q`, an array no operator writes: `unresolved_read`, `arrays` `[c.q]` | (1) passes its code assertion and fails at `assert_eq!(e.arrays, ["c.p"])`: "the not_exact refusal's arrays is [], not [c.p]: the array a check reads is only in the refusal's text (…)". (2) the same at `["c.q"]` |
| `#2130.995b1ac2` | `module_of_check.rs`: `ac7_geometry_shading_names_the_loop_module_in_the_cores_sealed_set` | `registry::core().module_of_check("geometry.shading")` is `Some("loop")`. Given: the set holds no module `loop` and none registers the kind. Left as they are: `logic.determinism` is `Some("logic")`; `geometry.audit`, the core's own, and `nowhere.audit` are `None` | Fails at its last `assert_eq!`: "in the core's sealed set, with no loop module, module_of_check(\"geometry.shading\") is None, not Some(\"loop\"): …" |

After a right change every test passes, and every precondition holds before and after.

## Readings where the issue leaves a choice

- **`recheck`'s two answers (criterion 1).** The criterion allows `None` or issues with the `over_budget`; both pass.
  The documents are built as they stand before and after the patch, and `recheck` is called as the criterion says,
  with the new item's ID as `changed` and the earlier document's full check as the previous issues; no patch is
  applied through `apply`. The build is the core's: `light.sun@1` is no kind of it, so each light is kept and skipped
  with a notice and `lights_check` counts it by its kind's text, as the crate's own
  `lights_a_recipe_derives_count_against_the_documents_light_cap` has it.
- **The case left as it is for criterion 1** rests on scope line 1, "return `None` when the document has a `budget`
  member", and on `recheck`'s own contract at the base (a patch is re-checked incrementally, to the issues of a full
  check): a document with no `budget` member is still answered, so a recheck that always returns `None` fails.
- **The second and third tests of criterion 1** hold its first sentence, "a patch to a document that names a budget
  is checked against the whole document", on the two other cases "What goes wrong today" tells: "the other way round,
  a patch to one of three lights over the cap drops the old `over_budget`", with the issue's cap of 2; and a budget
  that names a class. The class's estimate needs the cost model's numbers to pass a cap, which this job could not
  run, so the class is held by its other whole-document count, `fill_shaded`, which the same `budget_check` runs on
  the reduced items: one fill light more than `Class::Figure.fill_shaded()`. A change that tests for `budget.lights`
  alone fails it.
- **"When the pack is checked" (criterion 2)** is `document::packs::check_pack`, the pack check `Packs::admit` runs.
  "Refused" is `Err`. "Naming the registry and the entry" is one issue whose written form (`Issue::to_json`) holds
  both names, wherever it puts them: its path, its `actual` or its text. The entry that "otherwise passes its kit"
  is the registry's own planted `no_doc` entry with a doc: `validator: planted`, one twin its `judged` refuses, no
  fixture.
- **"No sealed entry has an empty digest" (criterion 2)** is read of both places a `SealedEntry` is made, which the
  scope's second line names: the pack check and the seal. For the seal the test holds only that a module's entry
  with no canonical form does not seal; its code and what it names are not held, since the scope's "or make `d1`
  return the `Result`" leaves them open between `entry_refused` and the sibling's `bad_shape`. The extra member and
  the NFC keys are the issue's own ("or any extra member with such a number", and the note).
- **`satisfies("b", ^1.2)` (criterion 3)** is the crate's own function, so the answer is read where the document
  check reads it, `requires.modules`: `out_of_range` at `requires/modules/b` when it is false, the refusal the issue
  quotes. The pack check reads it too and is not held. `b.thing` has no param and draws nothing, the smallest kind
  with two majors and a step. The three other ranges are the issue's. The refused ranges hold "satisfies every
  bound" (`>=1.5.0, <1.2.0`: each bound has a 1.x version, no one version meets both) and leave the majors asked as
  the base has them, 1 up to the module's own (`~0.9`); `c` holds "by a module that migrates from it".
- **"Naming the module" (criterion 4)** is the error's `modules` being `[c]`, in a set that also holds `d`.
- **"The ID the recipe's channel expands to" (criterion 5).** In the named test the channel targets a step of two
  items and expands to two IDs, so each is held, each in a document of its own; the issue's own `n1.rise` needs a
  step of one item and is the second test. "Raises `bad_id` at that channel" is an issue with that code at
  `channels/<id>`, the scope's path, and "refused" is its severity `error`. That the lowered document keeps the
  document's channel rests on scope line 5, "insert each recipe channel only when the ID is free", and on "loses it
  in the lowered document". The issue's IDs, whether the instance still expands and the check's other issues are not
  held. The document's own channel moves the instance's own `at/pos/0`.
- **"The seal's refusals" (criterion 6)** are both the scope names: `not_exact`, the criterion's, and
  `unresolved_read`, of an array the module registers and no operator writes.
- **The cases left as they are for criterion 7** rest on the scope's row for the kind, not its family ("`geometry`,
  which is no module"): the core's own `geometry.audit` names no module. The other loop kinds the scope leaves to
  the owner are not read either way.

## Not tested

The class estimate's own sum on a recheck; `recheck_with`; `deep-show`'s caller of the recheck; a patch applied
through `apply`. The seal's code and names for an entry it can't digest; a module's digest part; `Packs::admit`; the
listing at `deep://registries`. `Range::admits_major` by name; the pack check's `requires.modules`; a module past
major 2. Which registration `check_kind` returns. A step's own channels, a nested recipe's, a module expansion's and
`drivers`. The `not_exact` refusal of a check that reads pixels, which reads no array. The BLOCKED row `deep-show`
builds from `module_of_check`, and every loop kind but `geometry.shading`.

## Base runs

There is no `BASE-FAILURE.txt`: this job made no base run. It was not allowed to compile (no cargo, no rustc; the
machine's build line is shared), so every call above was checked by reading the item's source and visibility at
`2a689d81f`, not by a compiler. The base run is the implementer's: add the seven entries, run the seven commands at
the base and keep their output; each file should build, each test named in the table should fail at the assertion
the table names, and no message should start `<ID> precondition:`. A file that does not build at the base, or a
precondition that fails there, is this suite's fault and goes to a redraft, never to an edit.

## Not run

`cargo` in any form (build, test, clippy, fmt, metadata), `rustc`, `scripts/affected.mjs`, `scripts/proof.mjs`,
`scripts/lanes.mjs`, `scripts/canvas-lint.mjs`, `scripts/repo-rules.mjs` and the preflight. Run: `rustfmt
--edition 2021` on each file, plain and with `--check` (both silent, as the folder's `rustfmt.toml` makes them) and
with `--config disable_all_formatting=false --check` (silent: each file parses and is in rustfmt's form);
`scripts/studied-names.mjs`'s `findings` over this folder (none); and the inputs' `ids.mjs` for the seven IDs. No
throwaway guess at the change was written.
