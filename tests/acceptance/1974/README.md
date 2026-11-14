# Acceptance tests for #1974: defaults proven by building

Written first, from issue #1974 ("Defaults proven by building: each printed default built against the field left out,
with a count that makes a skipped field INVALID": its Scope, its two acceptance criteria and its Proof line), its
parent #1658, the design sections it links, and base commit `c56fe5407` (`origin/main`, "Merge pull request #2462 …"),
by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 1974`, its parent #1658 (its parts, "Not in scope", and the Nov 8 dry-run
  amendments), and the oracle page (`doneright/oracles/issues/1974.md` in `DeepBuildAI/deepbuild`, branch
  `doneright`): no upstream test checks either criterion; both are held to our own fixtures and planted twins.
- `docs/canvas-primitives.md`: Canvas module; Registry and seal: registries ("`deep_kinds` lists every registry and its
  entries in one shape"). `docs/technical-design.md`: "Five ways in, all onto the same core" (the `deep_kinds`
  paragraph), the Dogfooding paragraph, and the verdict words and their precedence (`FAIL > INVALID > BLOCKED >
  INCONCLUSIVE > PASS`; INVALID names "which check or requirement, why"). `AGENTS.md` (Proof, and the invariant that
  nothing missing or unrun passes).
- At the base, for surfaces and conventions only: `crates/deep-show/src/kinds.rs` (`op: field` from #1971 and its
  line; `fields_of`; the dump, `dump_value`, and `kinds::command`, which takes `--dump`, `--diff` and `--planted`;
  `example_params`, which sets every param with a non-null default in a kind's generated example; `drawn_example`
  from #1973; `Planted::named`), `crates/deep-show/src/forms.rs` (the extra dotted fields the listing gives some
  kinds), `crates/deep-show/src/main.rs` (`deep-show kinds` runs `kinds::command` before any scenario; `deep-show run`
  and its `--planted`), `crates/deep-canvas/src/kinds.rs` (the core's kind registry, which holds the test kinds
  `test.slab@3`, `test.rect@1` and `test.dot@1` in every build; `ParamType`, `with_defaults`, "so a reader has one
  source of defaults"), `crates/deep-canvas-scene3d/src/{spec,scene}.rs` (`puff@1`'s spec gives `radius` the default 1,
  and its reader, `puff`, takes its own 1.0 for a radius left out), `packages/hub/src/canvas.ts` (`deep kinds` forwards
  `--dump` and `--diff` to `deep-show kinds`), and the sibling suites `tests/acceptance/1973/` and `1971/` (closest:
  `op: field`, `kinds --dump`, `--planted` plants, this layout) and `412/`.

## What the base already does, which the tests don't credit

From the base run (`BASE-FAILURE.txt`):

- `deep-show kinds --dump` writes the whole sealed listing; the full build's lists 582 fields, all of them on
  entries of `kind@1`. 249 have a default (a `default` that is not null), 215 of those typed json. The first field
  typed json with a default, in the dump's order, is `camera@1.projection` (default `"perspective"`; its `op: field`
  line prints the forms `perspective`, `orthographic` and `isometric`). `op: field` (#1971) answers each of the 249
  with its line and the same default.
- `puff@1.radius` is listed typed json, unit m, default 1 (one of 21 fields defaulting to 1); scene3d's puff reader
  already takes a value of its own, 1.0, when the radius is left out. It agrees with the line today; nothing proves
  it.
- Every kind's generated example (#1973) sets each param that has a non-null default to that default, so the example
  as served is already "set to the default" for those params; nothing builds it with a field left out.
- There is no defaults run: `deep-show kinds --defaults` answers `{"ok":false,"code":"bad_input","what":"deep-show
  kinds --dump <dir> | --diff <a> <b>"}` and exits 2, and `--planted defaults_reader_falls_back_to_2`,
  `defaults_compared_with_dump_only` and `defaults_skip_json` are unknown names, answered `{"ok":false,"code":
  "bad_input"}`.
- The dump lists no `test.defaults@1`.

## Run them

```sh
npm ci                                   # once, for vitest and typescript
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1974 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1974/tsconfig.json
```

Node 24, `cargo` on the `PATH`. Each file builds the full `deep-show` once (`cargo build --locked --bin deep-show`,
default features, which are `full`) in the checkout's own `target/`, with `CARGO_TARGET_DIR` dropped and
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` unless set, as #1971's and #1973's suites do; the binary under test
is the newer of `target/release/deep-show` and `target/debug/deep-show`. No hub, no `deep mcp` and no built packages:
every surface is the canvas core's own. Every temporary folder is under `/tmp/dh1974-*` and is deleted after its file;
the tests start no process that outlives its call. Node built-ins and vitest only. A run with `--root
tests/acceptance/1974` may leave Vitest's cache in `tests/acceptance/1974/node_modules`; delete it.

`scripts/lanes.mjs` needs `'tests/acceptance/1974/'` in its `alone` list (each file builds cargo and starts
`deep-show`), as #1971's and #1973's folders are; this README is the instruction, and the implementer makes that edit.

Each test passes its timeout as the last argument of `it` (3,600,000 ms), since a cold build of `deep-show` takes many
minutes on a loaded Mac.

`BASE-FAILURE.txt` is the run at the base.

## The surfaces under test

- **`deep kinds --dump`**: it runs the canvas core's `kinds --dump <dir>`, so the tests run `deep-show kinds --dump
  <dir>` on the binary under test and read the file named in its `{"ok": true, "path"}` line. The dump is the list of
  fields with a default each criterion walks, and AC2's fixture, always from the unplanted build.
- **deep_kinds `op: field` on `deep-show run`**, as #1971's and #1973's suites call it: one scenario `{"evidence",
  "calls": [...]}`, one reply per call, each `{"call": "deep_kinds", "op": "field", "path": "<kind>@<major>.<field>"}`.
  The test reads the answer's one line (`lines[0]`): its `default`, the default "`op: field` prints"; and for AC2's
  choice, its `forms`.
- **The defaults run** (the issue leaves its surface open; this is this job's reading): `deep-show kinds --defaults
  [--planted <name>]`, beside `--dump` and `--diff` in `kinds::command`, which already takes `--planted`. It is one
  proof run over the whole build, like the dump, so it is a `deep-show kinds` subcommand rather than a `deep_kinds` op,
  whose replies are cut at 64 KB. It prints one JSON object on one line, its report. The tests read only:
  - `verdict`: one of the design's verdict words (PASS, FAIL, INVALID, BLOCKED, INCONCLUSIVE);
  - `count`: the number of fields it built and compared;
  - `kinds`: the fields it compared, by kind, as a list of `{"kind": "<kind>@<major>", "fields": [entry]}` (`name` in
    place of `kind` is read too) or as an object from each kind's name to its list of entries (or to `{"fields":
    [entry]}`). An entry names its field by `field` or `name`, its name or its whole path; it gives `default`, the
    value it set the field to, and the two builds, `left_out` and `set`, each with `check` (the check result), `hash`
    (the built output's hash, a non-empty string) and `values` (the evaluated values). The two builds are read as
    `entry.left_out.check` or as `entry.check.left_out`, and so on for each of the six;
  - what the report names outside `kinds`: anything else it carries, such as a reason, a list of failures or of
    skipped fields.

  Its exit status is not asserted. What `check`, `hash` and `values` hold (a verdict or issues, a digest, the values
  or their digest) is the run's to choose; the tests compare the two builds' by JSON content. `deep kinds` in the CLI
  forwards only `--dump` and `--diff` at the base; the tests don't go through it.
- **Planted twins** are startup arguments, `deep-show kinds --defaults --planted <name>`, as the kinds command already
  takes #412's and #1971's plants (`kinds::Planted::named`); the names below are this job's invention.

| Plant | The wrong program |
|---|---|
| `defaults_reader_falls_back_to_2` | `puff@1`'s reader takes 2 for a radius left out, where its line says 1; the run is the right one, and nothing else changes |
| `defaults_compared_with_dump_only` | the same planted reader, and a run that builds nothing: for each field with a default it compares the default its `op: field` line prints with the dump's, and reports that |
| `defaults_skip_json` | the run skips every field typed json, building and comparing only the others; nothing else changes |

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 | `defaults.test.ts` (3): the run over the full build is PASS and lists every field with a default in the dump under its kind, each built left out and set to the default its `op: field` line prints, with the same check result, built output hash and evaluated values; `defaults_reader_falls_back_to_2` is FAIL, names `puff@1` and `radius`, and the check fails at that field alone, its two builds different; `defaults_compared_with_dump_only` is PASS, and the check fails on it, naming `puff@1.radius` |
| AC2 | `count.test.ts` (2): the dump lists `test.defaults@1` with four fields defaulting to a number, a choice, a list of 3 numbers and an object; the run compares all four, and its `count` equals the dump's count of fields with a default; `defaults_skip_json` reports a lower count, is INVALID, and names the dump's first field typed json with a default |

Each test's name starts with its criterion. Where a criterion names a wrong program, the test runs its plant and
asserts what the criterion says of it.

## Readings of what the criteria leave open

- **A field with a default** is an element of an entry's `fields` array in the dump, every registry walked, whose
  `default` is there and not null; its path is `<entry name>.<field name>`. A default of `""`, `0`, `false`, `[]` or
  `{}` is a default. The dotted fields the listing adds to some kinds (`forms.rs`, such as `plate@1.overlays[].opacity`,
  default 1) are fields with a default in the dump too, so they count: the criterion says every field with a default
  in the dump, and the parent's "paths into nested structured params" is about `op: field` paths, not this count.
- **"The default `op: field` prints"** is the `default` of the one line `{op: field, path}` answers for the field. The
  report's entry says which value it set (`default`), and it must equal that line's, by JSON content.
- **"Give the same check result, built output hash and evaluated values"** is read in the report, per field: its
  entry shows both builds, each with its check result, built output hash and evaluated values, none of the six missing
  or null, each hash a non-empty string, and the two builds' three alike by JSON content (key order aside). That is
  how the test holds the run to building, and not to the line or the dump: a run that shows no builds fails, whatever
  its verdict says. The run's verdict must also be PASS.
- **"A planted reader that falls back to 2 where the line says 1"**: the criterion names no kind, so the plant is
  `puff@1`'s radius, a reader that already takes a value of its own (1.0) for a field left out, the Scope's "a reader
  that falls back to a value of its own", and whose line says 1. The test first holds that `op: field` prints 1 for
  `puff@1.radius`. **"Fails, naming the kind and the field"**: the run's verdict is FAIL; outside `kinds`, one of the
  report's strings, or the string members of one of its objects together, holds `puff@1.radius`, or `puff@1` and
  `radius` as a word; and this suite's check, run on the report, fails at `puff@1.radius` with its two builds
  different, and at no other field, so the plant changes that one reader.
- **"A planted run that compares the line with the dump only passes that reader and fails this test"**: one startup
  argument takes one plant, so this plant holds the planted reader too. Its verdict is PASS (it lets the reader
  through), and this test's check, run on its report, fails, with a failure naming `puff@1.radius`.
- **AC2's fixture**: the full build's dump lists `test.defaults@1` with exactly four fields, and among them exactly one
  of each: a number field (`type: number`, its default a number); a choice (`type: json`, its default a string that is
  one of at least two forms its `op: field` line prints under `forms`); a list of 3 numbers (`type: json`, its default
  an array of three numbers); and an object (`type: json`, its default an object). The four default values are not
  fixed beyond that, and neither is their order. The kind lives in the full build the way `test.slab@3`, `test.rect@1`
  and `test.dot@1` do: in the core's kind registry, in every build, so `deep-show kinds --dump` of the full build lists
  it. A choice is typed json because a structured value lists its alternatives as forms (#1973), which a string field
  doesn't.
- **"Has all four compared"**: the report passes AC1's per-field check for each of the four.
- **"The run's count"** is the report's `count`; it must equal the number of fields with a default in the dump.
- **"Reports a lower count and is INVALID, naming the first field it skipped"**: `count` is a number below the dump's
  count of fields with a default; the verdict is INVALID; and outside `kinds` the report names the first field typed
  json with a default in the dump's order, by the same reading of naming as above. The run walks the dump's order
  (Proof: "the dump walked field by field"), so its first skipped field is that one.

## Not tested, because no criterion asks

What the check result, the output hash and the evaluated values hold, beyond the two builds' being alike; whether the
run builds through the document check, the frame or the export (the criterion names the three results, not the path);
`deep kinds --defaults` through the CLI or the hub; pack kinds' defaults (no pack is installed here); fields with no
default; the run's exit status and timing; the forms a line prints, beyond AC2's choice; the Proof line's runs, which
`BASE-FAILURE.txt` and the branch's run give.

## Files

- `helpers.ts`: the full build, `deep-show kinds --dump`, `op: field` on `deep-show run`, the defaults run, and the
  criteria's checks (`comparisonFailures`, `fixtureFailures`, `namesField`).
- `defaults.test.ts` (AC1), `count.test.ts` (AC2).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
