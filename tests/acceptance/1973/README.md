# Acceptance tests for #1973: field shapes and examples

Written first, from issue #1973 ("Field shapes and examples: each structured field prints the forms its reader takes, a
refused value names its form, and every listed kind has an example": its Scope, its three acceptance criteria and its
Proof line), the parent issue's dry-run amendment it points back to, the design sections it links, and base commit
`e0c90a5a5` (`origin/main`, "Merge pull request #2455 …"), by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 1973`, and its oracle page (`doneright/oracles/issues/1973.md` in
  `DeepBuildAI/deepbuild`, branch `doneright`): no upstream test checks any of the three criteria; each is held to our
  own fixtures and planted twins.
- The parent, #1658, for its "Amended (Nov 8, from an agent dry run on main d4ed7be7)" section, which #1973's text
  points back to: `slab@1.size` reads `type: json, unit: m, default: null`; the guess `[20, 20]` was refused with
  `out_of_range` by both `scene3d.lights` and `scene3d.build` ("the two issues"), "can't evaluate this", fix "Give the
  field a value of its type inside its range"; and ten kinds list no example: `image@1`, `marks@1`, `axis@1`,
  `scale@1`, `mask@1`, `group@1`, `star@1`, `frame@1`, `matte@1`, `overlay.frame@1`.
- `docs/canvas-primitives.md`: Canvas module; Registry and seal: registries ("`deep_kinds` lists every registry and its
  entries in one shape"). `docs/technical-design.md`: "Five ways in, all onto the same core" (the `deep_kinds`
  paragraph: "each example is pinned by its hash, read and never run, and one whose bytes don't match is never
  served"; "Errors share one shape") and the Dogfooding paragraph. `AGENTS.md` (Proof).
- At the base, for surfaces and conventions only: `crates/deep-show/src/kinds.rs` (`op: field` from #1971 and its
  line: the listing's field row with `path`, `module` and `stability`; `fields_of`, whose `forms` only a number field
  with a unit gets; `crates/deep-show/src/forms.rs`, whose extra fields carry one `form`; `example_params`,
  `drawn_example` and `kinds_read_example`; `Planted::named`), `crates/deep-canvas/src/kinds.rs`,
  `crates/deep-canvas/src/document/mod.rs` (an issue's fields and `fix_for`), `crates/deep-show/src/frames.rs`
  (`op_issue`: an operator's error as "<operator> can't evaluate this"), `crates/deep-canvas-scene3d/src/{module,
  builders,curve,spec}.rs` (scene3d.lights runs on a document with a light; the slab reads `size` as exactly three
  numbers, each above 0; its spec's `size` is `vec3` in m with no default), `crates/deep-show/src/main.rs`
  (`deep-show canvas` plays the hub's calls as a `run` scenario), `packages/hub/src/{mcp-operations,hub-canvas}.ts`
  (the deep_kinds and deep_show tools go to the canvas side, `kinds` and `show`), and the sibling suites `tests/acceptance/1971/` (closest), `1970/`, `412/`, `420/`
  (a scene and the agent's deep_show on `deep-show run`).

## What the base already does, which the tests don't credit

From the base run (`BASE-FAILURE.txt`):

- `deep-show kinds --dump` writes the whole sealed listing; the full build's lists 582 fields, 515 of them typed
  json. `op: field` (#1971) answers each with one line: the listing's row (`name`, `type`, `unit`, `range`, `list`,
  `default`) with `path`, `module` and `stability`. A number field with a unit adds the unit grammar's `forms`; none
  of those is typed json.
- 20 json fields already give a form: the extra fields `forms.rs` lists for #535–#538 (such as
  `marks@1.columns.<name>.range`, `"form": "[min, max] (a row outside it hides)"`). The other 495, `slab@1.size` among
  them (`"type": "json", "unit": "m", "default": null`), give none.
- The one-slab scene with `size: [20, 20]` is refused with the dry run's two issues, both `out_of_range` at
  `items/box/params/size`: "scene3d.lights can't evaluate this" and "scene3d.build can't evaluate this", each with the
  code's one fix, "Give the field a value of its type inside its range." The same scene with `size: [1, 1, 1]` is
  presented with no issue, so the scene is sound and the slab's reader takes three numbers.
- `deep_kinds list` shows 68 kinds of `kind@1` as available. 57 list an example hash that `read` serves, a text that
  hashes to it and names the kind (the kinds' generated examples, one item at the defaults). Eleven list `example:
  null`: the ten the issue names and `axes3d@1` (#226's kind, drawn by the marks module with no kind-registry entry,
  added after the dry run's `d4ed7be7`). The criterion covers it too: it is available.
- `--planted field_size_json_alone` is an unknown startup argument: `deep-show run` answers
  `{"ok":false,"code":"bad_input"}` and exits 2.

## Run them

```sh
npm ci                                   # once, for vitest and typescript
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1973 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1973/tsconfig.json
```

Node 24, `cargo` on the `PATH`. Each file builds the full `deep-show` once (`cargo build --locked --bin deep-show`,
default features, which are `full`) in the checkout's own `target/`, with `CARGO_TARGET_DIR` dropped and
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` unless set, as #1971's suite does; the binary under test is the newer
of `target/release/deep-show` and `target/debug/deep-show`. No hub, no `deep mcp` and no built packages: every surface
is the canvas core's own, on `deep-show run` and `deep-show kinds --dump`. Every temporary folder is under
`/tmp/dh1973-*` and is deleted after its file; the tests start no process that outlives its call. Node built-ins and
vitest only. A run with `--root tests/acceptance/1973` may leave Vitest's cache in `tests/acceptance/1973/node_modules`;
delete it.

`scripts/lanes.mjs` needs `'tests/acceptance/1973/'` in its `alone` list (each file builds cargo and starts
`deep-show`), as #1971's folder is; this README is the instruction, and the implementer makes that edit.

Each test passes its timeout as the last argument of `it` (3,600,000 ms), since a cold build of `deep-show` takes many
minutes on a loaded Mac.

`BASE-FAILURE.txt` is the run at the base.

## The surfaces under test

- **`deep kinds --dump`**: it runs the canvas core's `kinds --dump <dir>`, so the tests run `deep-show kinds --dump
  <dir>` on the binary under test and read the file named in its `{"ok": true, "path"}` line. The dump is AC1's list
  of fields: every field of every entry whose `type` is `json`, always from the unplanted build.
- **deep_kinds on `deep-show run`**, as #1971's and #412's suites call it: one scenario `{"evidence", "calls": [...]}`
  per batch, one reply per call. AC1 calls `{"call": "deep_kinds", "op": "field", "path": "<kind>@<major>.<field>"}`
  and reads the answer's one line (`lines[0]`) for its forms. AC3 calls `{"op": "list", "registry": "kind@1"}`, paged
  by its `next` cursor, and reads each entry's `name`, `available` and `example`; then `{"op": "read", "example":
  <hash>}` and reads `error` or `text`. The hub sends `deep-show canvas` the tool's arguments the same way
  (`hub-canvas.ts`, `kinds`), so this is the canvas core's answer to the deep_kinds tool.
- **The document check**: the agent's `deep_show` of a whole revision with `include: ["issues"]`, on `deep-show run`
  with the agent's session, its process tree and one panel per document in the scenario, as #420's suite drives it.
  That is the check the deep_show tool runs: the hub has `deep-show canvas` play the call as a `run` scenario. The
  reply's `outcome` (`presented` or `refused`) and `issues` (each `code`, `severity`, `path`, `fix` and any other
  field) are read. `deep-canvas check`, the other check surface at the base, holds only the core's kinds, not scene3d's
  builders, so it can't read `slab@1`.
- **The scene** (`helpers.ts`, `slabScene`): a `scene` document requiring scene3d, holding a camera `cam`
  (`camera@1`), a sun `sun` (`light.sun@1`, its defaults) and the slab `box` (`slab@1`) with only `size` set. The sun is
  there because scene3d.lights runs only on a document with a light, so the scene reproduces the dry run's two issues.
- **Planted twins** are startup arguments, `deep-show run --planted <name>`, as #412's and #1971's deep_kinds plants
  are (`kinds::Planted::named`); the name below is this job's invention. AC2's and AC3's "on the merge base … fail" are
  proven by `BASE-FAILURE.txt`, not by plants.

| Plant | The wrong program |
|---|---|
| `field_size_json_alone` | the line `op: field` answers for `slab@1.size` gives its type `json` and no form (no `forms`, `form` or `shape`); nothing else changes |

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 | `one-form.test.ts` (2): every field typed json in the full build's dump answers, by `op: field`, one line giving at least one form; each form printed for `slab@1.size`, fed back as the slab's size with every number set to 1, passes the document check; `field_size_json_alone` fails, naming `slab@1.size` and no other field |
| AC2 | `refusal.test.ts` (1): the scene with `size: [20, 20]` is refused with exactly one issue at `items/box/params/size`, an error, whose fix names the 3-number form, and no other error; the same scene with `size: [1, 1, 1]` passes the document check |
| AC3 | `examples.test.ts` (1): every kind `deep_kinds list` shows as available, the ten among them, lists an example hash, and `read` serves it: no error, a text that hashes to it and names the kind |

Each test's name starts with its criterion. Where a criterion names a wrong program, the test runs its plant and
asserts the criterion's check fails, its failure naming what the criterion says.

## Readings of what the criteria leave open

- **A field typed json** is an element of an entry's `fields` array in the dump whose `type` is `json`, every registry
  walked; its path is `<entry name>.<field name>` (`slab@1.size`), as #1971 reads it.
- **"`op: field` gives at least one accepted form"** (AC1): the answer holds `lines`, one line (an object, or a string
  holding one JSON object's text), as #1971 answers; its forms are the strings it gives under `forms` (the key the
  listing already uses for a number field's unit forms), `form` (the key `forms.rs` already uses) or `shape` (the
  issue's word), each a string or a list of strings or of objects holding a string `form`. A form that is empty or
  only the type name `json` is no form. Whether each printed form is accepted is held only where the criterion holds
  it, on `slab@1.size`; the other fields need at least one form. The base's `forms.rs` fields already give a `form`, so
  they pass at the base; the test doesn't credit them, since the criterion is every json field.
- **"A form printed for `slab@1.size`, fed back as the field's value with every number set to 1"** (AC1): each form
  the line gives is fed back, since each is printed as one the reader takes. A form's value is its first list `[…]`
  or object `{…}` (so prose around it, such as "in m", is not the value), read with every placeholder set to 1: each
  element of a list, and each member's value in an object (a member is `name` or `name: …`), is a number unless it is
  itself a list or object, which is read the same way; a form with no list or object is one number, 1. So `[x, y, z]`,
  `[x m, y m, z m]` and `[0.5, 0.5, 0.5]` each feed back `[1, 1, 1]`, and `{azimuth, elevation, distance}` feeds back
  `{"azimuth": 1, "elevation": 1, "distance": 1}` (`helpers.ts`, `fedBack`).
- **"Passes the document check"**: the agent's deep_show of the scene with that size is `presented` with no issue of
  severity `error`. A warning doesn't fail it.
- **"Fails, naming the field"** (AC1's plant) is this suite's check (`formFailures`) run on the plant: a failure starts
  with `slab@1.size` and says its line gives no accepted form. The plant must change nothing else: the test fails on
  a failure for any other field.
- **"Refused with one issue at `items/<id>/params/size`"** (AC2): the revision's `outcome` is `refused`; exactly one
  of its issues, of any severity, is at `items/box/params/size`, and it is an error; no error is at any other path.
  The control, the same scene with `size: [1, 1, 1]`, must pass the document check, so the scene holds no other
  error. The issue's code is not asserted: the criterion names none.
- **"Whose fix names the 3-number form"** (AC2): an issue's fix is its remediation, as #1970's suite reads it: its
  `fix` text, its `fix_ops`, its `forms` and any field it carries beyond what it is (`check`, `code`, `severity`,
  `what`), where (`ids`, `path`, `step`) and what it refused (`actual`), and `carried` and `close`. `what` is not the
  fix. The fix names the 3-number form when it says "3 numbers" or "three numbers", or holds a list `[…]` of exactly
  three elements, such as `[x, y, z]` (`namesThreeNumbers`). The scope's "and the form it got" (such as "got 2") is
  not asserted: no criterion asks for it.
- **"Every kind `deep_kinds list` shows as available"** (AC3): each entry of the `kind@1` registry, over every page of
  `{op: list, registry: kind@1}`, whose `available` is `true`. The ten kinds the parent names must be among them, so a
  build can't pass by listing them as unavailable or leaving them out.
- **"Has an example hash that `read` serves"** (AC3): the entry's `example` is a non-empty string, and `{op: read,
  example: <it>}` answers with no `error` and a `text` whose SHA-256 (of its UTF-8 bytes) is that hash, the design's
  "pinned by its hash … one whose bytes don't match is never served". It is that kind's example: its text names the
  kind, as the JSON string `"<name>@<major>"`. Whether the example passes the document check is not asserted: no
  criterion asks.
- **"On the merge base the two issues name no form and fail" and "the ten kinds above fail, each named"**: shown by
  the base run in `BASE-FAILURE.txt`, where AC2's failure lists each issue the base gives at the path with its fix, and
  AC3's names each kind.

## Not tested, because no criterion asks

The form a refusal says it got; forms on fields typed other than json; the forms of fields other than `slab@1.size`
fed back; whether a form is generated from the reader's declared forms rather than written by hand (the Scope's
"never written by hand" is a property of the code, which a blind suite can't see; AC1's fed-back check and its plant
are what hold the forms to the reader); the examples' contents beyond naming their kind; pack kinds' examples (no
pack is installed here); the deep_kinds and deep_show tools through the hub and `deep mcp`, which forward to the same
canvas core; the Proof line's runs, which `BASE-FAILURE.txt` and the branch's run give.

## Files

- `helpers.ts`: the full build, `deep-show run` and `kinds --dump`, the form reader and `fedBack`, the scene and the
  agent's deep_show, and the criteria's checks.
- `one-form.test.ts` (AC1), `refusal.test.ts` (AC2), `examples.test.ts` (AC3).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
