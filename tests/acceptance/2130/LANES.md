# #2130's acceptance tests, second pass: tests the proof lanes can count

Added by the same blind job, after the first pass's eight files (README.md and the seven `.rs` files) were run at the
base and landed. Those eight are closed and are not edited here; this file is where the second pass speaks. A third pass then took every comment out of the 16 source files and changed nothing else (No comments, below), so the seven `.rs` files are no longer byte for byte the first pass's. The job
saw the issue, the design, the base commit `2a689d81f` and the base run's own output, and no implementation.

## Why more files

The proof lanes count a criterion as proven only by a test in a `.test.mjs` or `.test.ts` file whose name starts with
the criterion's ID (`scripts/proof-change.mjs`: `isTestFile`, `tagsIn`; `scripts/proof.mjs`: `trace`). The before lane
(`scripts/proof-runs.mjs`) runs each such test on the change and on a copy of the merge base that holds the change's
files under the test paths and nothing else of the change, so on that copy `crates/deep-canvas/Cargo.toml` has no
`[[test]]` entry. The seven Rust files alone therefore leave every criterion open. These files make them reachable
with nothing outside `tests/acceptance/2130/`.

## What was added

| File | What it is |
|---|---|
| `suite/Cargo.toml` | A cargo package of the suite's own, `acceptance-2130-suite`, outside the workspace (an empty `[workspace]` table). It depends on `deep-canvas` by path and on `serde_json = { version = "1", features = ["preserve_order"] }`, as `crates/deep-canvas/Cargo.toml` does. Its seven `[[test]]` targets are the seven committed files, by path (`../<file>.rs`), named `acceptance_2130_<file>` as the README named them. No lockfile of its own |
| `suite/src/lib.rs` | Empty, one newline: cargo takes no package without a lib or bin target |
| `lib.mjs` | Lays a copy of `suite/` under the checkout's `target/`, runs `cargo test` there and reads libtest's output |
| `budget-recheck.test.mjs`, `entry-digest.test.mjs`, `migrates-from.test.mjs`, `duplicate-check-kind.test.mjs`, `recipe-channels.test.mjs`, `check-reads.test.mjs`, `module-of-check.test.mjs` | node:test files, built-ins only: one node test for each of the 12 Rust tests, its name starting with the criterion's ID |
| `lane.json` | The folder runs alone (below) |
| `LANES.md` | This file |

### What `lib.mjs` lays, and the command

In the checkout the files are in (`<checkout>`, three folders up from `lib.mjs`), under `target/acceptance-2130/suite/`:

- `Cargo.toml`: `suite/Cargo.toml` with `path = "../../../../crates/deep-canvas"` rewritten to
  `path = "../../../crates/deep-canvas"` and each `path = "../<file>.rs"` to
  `path = "../../../tests/acceptance/2130/<file>.rs"`. A manifest that no longer holds one of those eight lines is
  `BLOCKED`.
- `src/lib.rs`: as committed.
- `Cargo.lock`: `<checkout>/Cargo.lock`, the copy's starting lockfile, so every crate builds at the workspace's pins;
  cargo drops the entries the package does not use and rewrites only the copy. `Cargo.lock.from` beside it holds the
  SHA-256 of the root lockfile it was laid from; the lockfile is laid again only when the root's differs from it.

A file is written only when its text differs, so a second run rebuilds nothing. Nothing is written under `tests/`,
and `target/` is ignored by git. Then, from `<checkout>`, once per target and once per process:

```sh
cargo test --no-fail-fast --manifest-path target/acceptance-2130/suite/Cargo.toml --target-dir target/acceptance-2130 --test acceptance_2130_<file>
```

with `CARGO_TERM_COLOR=never`, `NO_COLOR=1` and `RUST_BACKTRACE=0` added to the caller's environment, under an
18-minute bound (a `// deadline:`; nothing is judged by it). Each test file names one target, so a file that does not
build stops only itself.

### How a node test reads the run

`readLibtest` takes each `test <name> ... <word>` line and each failed test's `---- <name> stdout ----` block;
`outcome` decides one Rust test:

- **passes** only when libtest printed `test <name> ... ok`;
- **fails at its assertion** (`assert.equal(result, 'ok', failure)`, in the test file) when libtest printed `FAILED`:
  the message is the Rust test's own panic message, as its stdout block holds it, then one line naming libtest's
  line, where it panicked and the cargo command. So on the merge base each fails with the words `base-run.txt` shows;
- **throws a plain `Error` whose message starts `BLOCKED:`**, never an assertion, when cargo is not on `PATH`, the
  suite cannot be laid, the run was stopped at the bound or killed, cargo exits non-zero with no test named (the
  target does not build), the output does not name the test or names it twice, libtest printed another word than `ok`
  or `FAILED` (`ignored`), or it printed `FAILED` with no message in a block. Nothing unrun passes, and the before
  lane reads a `BLOCKED` on the base as a failure before the assertion, never as the criterion's.

## The 12 node tests

| ID | File | Node test (after the ID) | Rust test it reads |
|---|---|---|---|
| `#2130.766a56f0` | `budget-recheck.test.mjs` | a second light created past budget.lights 1 is rechecked against the whole document: None, or over_budget at budget/lights | `ac1_a_second_light_past_budget_lights_1_is_checked_against_the_whole_document` |
| `#2130.766a56f0` | `budget-recheck.test.mjs` | a patch to one of three lights past budget.lights 2 keeps the over_budget the whole check raises | `ac1_a_patch_to_one_of_three_lights_past_budget_lights_2_keeps_the_over_budget` |
| `#2130.766a56f0` | `budget-recheck.test.mjs` | a document whose budget names only a class is rechecked whole too: one fill light past the fill_shaded of its class | `ac1_a_document_whose_budget_names_only_a_class_is_checked_whole_too` |
| `#2130.873c8710` | `entry-digest.test.mjs` | the pack check refuses a data.layout@1 entry with no canonical form, naming the registry and the entry | `ac2_the_pack_check_refuses_an_entry_with_no_canonical_form_naming_registry_and_entry` |
| `#2130.873c8710` | `entry-digest.test.mjs` | the seal gives no entry a canvas module fills an empty digest | `ac2_the_seal_gives_no_module_entry_an_empty_digest` |
| `#2130.00e7dfcf` | `migrates-from.test.mjs` | a range some version of an earlier major meets is met by a module at 2.0.0 that migrates from it | `ac3_a_range_some_version_of_an_earlier_major_meets_is_met_by_a_module_that_migrates_from_it` |
| `#2130.b3f91bae` | `duplicate-check-kind.test.mjs` | the seal refuses a module that registers the check kind c.audit twice, with duplicate_check_kind naming the module | `ac4_the_seal_refuses_a_module_that_registers_one_check_kind_twice` |
| `#2130.96087f96` | `recipe-channels.test.mjs` | a document channel at an ID the channel of the named test recipe expands to is refused bad_id at that channel | `ac5_a_document_channel_where_the_tests_recipe_channel_expands_to_is_refused_bad_id` |
| `#2130.96087f96` | `recipe-channels.test.mjs` | a document channel at n1.rise, where the channel of a one-item recipe expands to, is refused bad_id | `ac5_a_document_channel_at_n1_rise_is_refused_bad_id` |
| `#2130.219ed3ba` | `check-reads.test.mjs` | the not_exact refusal of a check with machines any that reads c.p names the array in its arrays | `ac6_a_not_exact_refusal_of_a_checks_read_names_the_array` |
| `#2130.219ed3ba` | `check-reads.test.mjs` | the unresolved_read refusal of a check that reads c.q, which no operator writes, names the array in its arrays | `ac6_an_unresolved_read_refusal_of_a_checks_read_names_the_array` |
| `#2130.995b1ac2` | `module-of-check.test.mjs` | module_of_check of geometry.shading is Some(loop) in the sealed set of the core, with no loop module | `ac7_geometry_shading_names_the_loop_module_in_the_cores_sealed_set` |

Each name is one string literal, so the lanes read it from the source. What each Rust test holds, and how the issue
was read, is the README's; nothing of that changed. There is no `twins.json`: the merge base is every criterion's
wrong program (the issue's proof line), and `base-run.txt` shows each test failing there at its assertion.

## Run them

From `<checkout>`, Node 24, cargo on `PATH`:

```sh
node --test tests/acceptance/2130/budget-recheck.test.mjs
node --test tests/acceptance/2130/entry-digest.test.mjs
node --test tests/acceptance/2130/migrates-from.test.mjs
node --test tests/acceptance/2130/duplicate-check-kind.test.mjs
node --test tests/acceptance/2130/recipe-channels.test.mjs
node --test tests/acceptance/2130/check-reads.test.mjs
node --test tests/acceptance/2130/module-of-check.test.mjs
```

One file at a time. The Rust files alone, through the same package, once a run above has laid it:

```sh
cargo test --no-fail-fast --manifest-path target/acceptance-2130/suite/Cargo.toml --target-dir target/acceptance-2130 --test acceptance_2130_<file>
```

## Lines the implementer adds elsewhere

**`scripts/repo-rules.json`, under `"deps"`**, after the `tests/acceptance/2700/probe-reached/Cargo.toml` entry, in
#2700's shape (the specs are what `scripts/repo-rules.mjs`'s `cargoSpec` reads from the manifest):

```json
    "tests/acceptance/2130/suite/Cargo.toml": {
      "dependencies": {
        "deep-canvas": {
          "spec": "* path=../../../../crates/deep-canvas",
          "why": "Issue #2130: the acceptance suite's seven Rust files call the canvas core's public items, built from each checkout's own copy; test-only, outside the workspace."
        },
        "serde_json": {
          "spec": "^1",
          "why": "Issue #2130: the suite's files build documents and manifests with the canvas core's own serde_json and its preserve_order feature; already in the tree, test-only."
        }
      }
    }
```

**No lane list line.** `lane.json` is the one shape `scripts/lanes-lists.mjs` reads (`LANE_FILE`,
`{ "alone": true, "why": "<reason>" }`), so the folder joins `alone` by itself, and `scripts/lanes.mjs` reads its
reason, `binary`, from the first word of its `why`. Why alone: each file starts `cargo test` for one target of the one
package, laid and built in the checkout's one `target/acceptance-2130`; beside the parallel block seven builds would
start there at once. The guard takes a new lane file only with its suite, in the change that names #2130 and before
the folder is on main (`scripts/proof-guard.mjs`), so it lands in the same change as the eight files.

No entry in `scripts/known-failures.json` is needed for the package: it is no workspace member and no canvas crate
depends on it, so `scripts/canvas-lint.mjs` does not read it.

## The seven `[[test]]` entries in `crates/deep-canvas/Cargo.toml`

**Nothing of this suite needs them any more.** The README asked for them because the first pass had no other way to
build its files. The node tests build the same seven files, unchanged, as the targets of `suite/`, and the lanes
count only the node tests. Whether the entries stay is the implementer's and the owner's:

- Taken out: `crates/deep-canvas/Cargo.toml` is as on main, the seven canvas-lint lines the README's "What the lint
  lane will say" names never appear and need no listing, and the README's own run commands
  (`cargo test -p deep-canvas --test acceptance_2130_<file>`) no longer find a target; the commands above stand in
  their place. `cargo clippy --workspace` and `cargo test --workspace` then do not read the seven files; the node
  tests run them.
- Kept: each file is built and run twice (as a target of `deep-canvas` and of `suite/`), and the seven canvas-lint
  lines need their listing, as the README says.

The README cannot be edited to say this, so this section is where it is said.

## What each file costs

Each test file is one `cargo test` call. The first in a fresh `target/acceptance-2130` builds the canvas core and the
crates it depends on in the dev profile (no debug info, no incremental state, the canvas core unoptimized) and one
test binary; each later file builds one more test binary and reuses the rest. The tests themselves took 0.01 s to
0.03 s a file in the base run. The build's time and the folder's size on disk were not measured by this job, which
could not run cargo. No file starts a hub, opens a window, reads a clock or needs a GPU.

## Not run

`cargo` in any form, `rustc`, `node --test` on these files (they start cargo), `scripts/affected.mjs`,
`scripts/proof.mjs`, `scripts/lanes.mjs`, `scripts/repo-rules.mjs`, `scripts/alone-lint.mjs`,
`scripts/wait-ratchet.mjs` and the preflight. So that `suite/Cargo.toml` is a package cargo takes, that the laid copy
builds from the root lockfile, and that libtest's lines in a real run read as they did in the probe, are unproven
here; the implementer's first run shows them, and a file that does not run goes back to this job with what cargo or
node printed. Run: `node --check` on `lib.mjs` and each test file; a throwaway probe that gave `lib.mjs`'s reader
`base-run.txt`'s seven transcripts (12 tests, each read `FAILED` with its own panic message first), a passing
transcript written by hand (`ok`), and the `BLOCKED` cases (cargo missing, no build, killed, stopped at the bound, a
test not named, named twice, `ignored`, `FAILED` with no block), then deleted; `scripts/studied-names.mjs`'s
`findings` over the folder (none); and, in the second pass, `shasum -a 256` of the eight committed files, unchanged then.

## No comments

The 16 source files (the seven `.rs` files, `suite/src/lib.rs`, `lib.mjs` and the seven `*.test.mjs` files) hold no
comments, by ADR 0001 (code carries no comments), which main gained after this suite's base. The third pass removed
every comment line from them and changed no token of code, no name, no string and no assertion message; no comment
trailed a line of code. One comment stays: the `// deadline:` marker on the line above `lib.mjs`'s `spawnSync` call,
which the rule does not count. `README.md`, `LANES.md`, `lane.json` and `suite/Cargo.toml` are not source and keep
their text. So the line numbers in the base run's panic locations are those of the `.rs` files before this pass; the
messages are the same. `README.md` is unchanged.

## What each file holds

What the removed headers and notes said, where the README and the sections above do not already say it.

`budget_recheck.rs` (`#2130.766a56f0`). `document` builds a figure with one `light.sun@1` item for each ID and no
`budget` member; `over_budget_at` says whether issues hold `over_budget` at a path; `listed` gives each issue as its
code, IDs and path, sorted, which a recheck's answer is compared by. The first test holds the case with no `budget`
member first, then the criterion. `light.sun@1` is no kind of the core's build, so each light is kept and skipped
with a notice and the cap counts it by its kind's text.

`entry_digest.rs` (`#2130.873c8710`). `NO_F64` is 2^53 + 1, a whole number no f64 holds. `layout` is a
`data.layout@1` entry that passes its kit: one twin, which its validator refuses, no fixture, and a doc. `pack_check`
gives what the pack check makes of the pack `test/acc2130@1.0.0` filling the registry with one entry: `Ok` with each
sealed entry's digest, or `Err` with each issue as it is written out. The module `acc`, at 1.0.0, fills the same
entry at the seal.

`migrates_from.rs` (`#2130.00e7dfcf`). `Sealed::satisfies` is the crate's own, so the answer is read where the
document check reads it. `manifest` is a test module at 2.0.0; `migrating_kind` is `b.thing`, majors 1 and 2 with a
step from 1; `single_major_kind` is `c.thing`, major 2 alone; `sealed_set` is the core with `b` and `c`; `requiring`
is a document with no item that requires a module at a range; `refusals` is what the check raises at
`requires/modules/<module>`, empty when the range is satisfied.

`duplicate_check_kind.rs` (`#2130.b3f91bae`). `manifest` is a test module at 1.0.0. The test holds, in order: the
kind registered once seals; the kind in two modules' checks is refused; then the criterion, `c` registering it twice
beside `d`, which registers its own.

`recipe_channels.rs` (`#2130.96087f96`). `OWN_TARGET` is what the document's own channel moves, the instance's own
position. `pack_of_two_bars` is the crate's own test's pack; `pack_of_one_bar` is the same with a step that makes one
bar; `checked` checks the test's document, holding one channel of its own at an ID, in the core's build;
`lowered_target` reads the lowered document's channel; `collision_problems` lists what is wrong: no `bad_id` at
`channels/<id>`, a `bad_id` that is no error, or a lowered channel that is not the document's.

`check_reads.rs` (`#2130.219ed3ba`). `manifest` is the test module `c` at 1.0.0. Three register calls: a
`same_machine` operator writes `c.p` and a check with machines `any` reads it; the same with machines `same`; a check
reads `c.q`, an array of the module no operator writes.

`module_of_check.rs` (`#2130.995b1ac2`). In order: the givens (no loop module, no module registers the kind), the
cases left as they are, then the criterion.

`suite/src/lib.rs`. No code: the package's targets are the seven files.

`lib.mjs`. As the sections above say. Beside them: `FILES` and `targetOf` name the seven targets; a message writes
this checkout's path as `<checkout>` and the home folder as `~`; a `BLOCKED` is a plain `Error`, never an assertion.

The seven `*.test.mjs` files. Each header named its criterion, its command and its one target, as the table and "Run
them" do: `budget-recheck` reads `acceptance_2130_budget_recheck`, and so each by its name.
