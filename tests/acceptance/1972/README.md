# Acceptance tests for #1972: a guide on patches, and patch refusals that name the right path and envelope

Written first, from issue #1972 ("A guide on patches: every patch op with an example from the patch schema, and patch
refusals that name the right path and envelope": its Scope, its two acceptance criteria and its Proof line), the design
sections it links, and base commit `e0c90a5a5` (`origin/main`, "Merge pull request #2455 …"), by a job that never saw
an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 1972`, and its parent #1658, whose "Amended again (Nov 8)" paragraph gives
  the patch's shape (`{patch: ULID, doc, base: rev, reason, ops: [{op: set, id, path, value} | create | unset | delete
  | move | reorder]}`, paths rooted at `items/<id>/…`) and the dry run's two refusals: a bare op list refused
  `out_of_range` with "a patch is an object" and the fix "Give the field a value of its type inside its range", and a
  path `at/pos` refused `bad_path` because section `at` is not one of the path grammar's sections.
- The oracle page (`doneright/oracles/issues/1972.md` in `DeepBuildAI/deepbuild`, branch `doneright`): no upstream
  test checks either criterion; both are held to our own fixtures and planted twins.
- `docs/technical-design.md`: the MCP tools row of "Five ways in, all onto the same core" (the `deep_kinds` paragraph:
  guides served and read in pages; errors share one shape), the canvas primitive "Patch", and Dogfooding (blind
  tests, the redraft on a dispute). `AGENTS.md` (Proof).
- At the base, for surfaces and conventions only: `tests/acceptance/1971/` (deep_kinds `op: field` on `deep-show
  run`, the line reading, the README and BASE-FAILURE layout), `tests/acceptance/412/` (deep_kinds `read` and
  `gallery`, plants by `--planted <name>`), `tests/acceptance/306/` (patches sent as you through `deep show` with a
  peer outside every agent's process tree, shared documents stored in a scenario); `crates/deep-show/src/kinds.rs`
  (`kinds_reply`, `kinds_field`, `kinds_read_guide`, `kinds_gallery`, `Planted::named`),
  `crates/deep-show/src/main.rs` (`via`, `start_args`, `planted_named`, the scenario's `docs`, `processes`,
  `panels`), `crates/deep-show/src/shared.rs` (`open_shared`, `check_patch`, the patch reply's `outcome` and
  `issues`), `crates/deep-canvas/src/document/apply.rs` (the envelope's fields, the ops it takes, `op_path`,
  `writable`), `crates/deep-canvas/src/document/mod.rs` (an issue's `what`, `fix` and `fix_ops`; `fix_for`), and
  `crates/deep-show/gallery/` (the product reveal, `gallery.json`).

## What the base already does, which the tests don't credit

From the base run (`BASE-FAILURE.txt`):

- The installed guides are canvas-working-order, familiar-names and logic. `deep_kinds read guide: patches` is refused
  `not_found` at `/guide` ("Give a guide's name as a search hit gives it.").
- `deep_kinds op: field` exists (#1971) but reads only `<kind>@<major>[.<field>]`: `patch` and every `patch.<op>` are
  refused `unknown_field` ("patch is no kind this build lists", "patch.reorder is no kind …"), so no op is listed.
- The gallery's product reveal ("Product reveal: a lamp on a turntable") is served by `deep_kinds read example` and,
  stored as a shared document, takes your patch: the control (`set` of `items/name/at/pos` in its envelope) applies.
- A patch whose path is `at/pos` is refused `bad_path` with the fix "Write the path as
  <section>/<id>[#<sub>]/<field>[/<field>...]."; a bare op list is refused `out_of_range` ("a patch is an object") with
  the fix "Give the field a value of its type inside its range." Neither fix names what the criteria ask.
- The three plants are unknown startup arguments: `deep-show run --planted <name>` answers
  `{"ok":false,"code":"bad_input"}` and exits 2.

## Run them

```sh
npm ci                                    # once; the tests run no built CLI or hub
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1972 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1972/tsconfig.json
```

Node 24, `cargo` on the `PATH` (on a shared Mac, wrap the run in `scripts/lease`). Each file builds the full
`deep-show` once (`cargo build --locked --bin deep-show`, default features, which are `full`), honouring
`CARGO_TARGET_DIR`, and runs the executable cargo reports. Every call goes through `deep-show run`, one scenario per
input line; the suite starts no long-lived process. Every temporary folder (`deep-1972-*` under the OS temp folder) is
deleted after its file. Node built-ins and vitest only. A run with `--root tests/acceptance/1972` may leave Vitest's
cache in `tests/acceptance/1972/node_modules`; delete it.

`scripts/lanes.mjs` needs `'tests/acceptance/1972/'` in its `alone` list (the files build cargo), as #1971's and
#412's folders are; this README is the instruction, and the implementer makes that edit.

Each test passes its timeout as the last argument of `it` (3,600,000 ms), since a cold build of `deep-show` takes many
minutes on a loaded Mac.

`BASE-FAILURE.txt` is the run at the base.

## The surfaces under test

- **deep_kinds on `deep-show run`**, as #1971's and #412's suites call it: a scenario `{"evidence", "calls"}`, one
  reply per call.
  - `{"call": "deep_kinds", "op": "read", "guide": "patches"}`, then with `"offset": <next>` while a page says
    `truncated: true`: the guide's `text`, every page joined.
  - `{"call": "deep_kinds", "op": "field", "path": "patch"}` and `{"…", "path": "patch.<op>"}`: the patch schema, as the
    issue's scope says `op: field` answers it.
  - `{"call": "deep_kinds", "op": "gallery"}` and `{"…", "op": "read", "example": <hash>}`: the gallery's product reveal,
    the example whose title holds "product reveal", parsed from the `text` it serves.
- **Patches on `deep-show run`**, as #306's suite sends them: a scenario `{"evidence", "processes", "panels", "docs":
  {<doc ID>: {"panel": "main", "document": <the product reveal>}}, "calls"}` stores the product reveal as a shared
  document at revision 0, and `{"call": "deep show", "peer": {"pid": 3002, "start": 3000}, "doc": <doc ID>, "patch":
  <the patch>}` sends the patch as you (the peer runs in no agent's process tree). The reply's `outcome` is read
  (`applied` or `refused`), and on a refusal its `issues`, each with `code`, `path`, `what`, `fix` and any `fix_ops`.
  Each patch goes to a fresh copy, one scenario each.
- **Planted twins** are startup arguments, `deep-show run --planted <name>`, as #412's and #1971's are; each name below
  is this job's invention, for the implementer to add.

| Plant | The wrong program | What it must make fail |
|---|---|---|
| `patches_guide_without_reorder` | the `patches` guide served with every mention of `reorder` left out (its section and its example); nothing else changes, and `op: field` still lists `reorder` from the patch schema | AC1's first check, naming reorder, and only reorder |
| `patch_fix_path_without_id` | the refusal of a patch whose path is `at/pos` keeps its code and outcome, but its fix names `items/at/pos`, the section without the item's ID | AC2's path check, naming `items/name/at/pos` |
| `patch_fix_envelope_without_reason` | the refusal of a bare op list keeps its code and outcome, but its fix names the envelope's fields without `reason` | AC2's envelope check, naming reason |

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 | `guide.test.ts` (3): the guide holds an example of every op the patch schema lists (and the schema lists the six the issue's parent names); for every op, one of its examples applies to the product reveal with outcome `applied`; `patches_guide_without_reorder` fails the first check naming reorder and no other op, while `op: field` still lists reorder |
| AC2 | `refusal.test.ts` (4): the `at/pos` patch is refused with a fix naming `items/name/at/pos`; its twin `patch_fix_path_without_id` fails naming it; the bare op list is refused with a fix naming patch, doc, base, reason and ops; its twin `patch_fix_envelope_without_reason` fails naming reason. Each runs the control first: the same op in its envelope with path `items/name/at/pos` applies |

Each test's name starts with its criterion. Where a criterion or the Proof line names a wrong program, the test runs
its plant and asserts the criterion's check fails, its failure naming what the criterion says.

## Readings of what the criteria leave open

- **The ops the patch schema lists** are read from `deep_kinds op: field`, which the issue's scope says takes `patch`
  and `patch.<op>` and answers from the same schema as the guide: the candidates are every lower-case word in the JSON
  of the answer to `path: "patch"`, with the six ops the parent issue names (set, create, unset, delete, move,
  reorder), less the patch's own fields (patch, doc, base, reason, ops, and the base's coalesce_key and dry_run); an op
  is a candidate whose `path: "patch.<op>"` answers lines (#1971's reading: a non-empty `lines`, else non-empty `text`;
  a refusal holds none). The six named ops must be among them, or AC1 fails naming the missing ones: otherwise a
  schema that lists nothing would pass vacuously. Whatever else the schema lists (rows or break_out, say) is held to
  the same check.
- **The guide's examples** are the patches its text holds: every JSON object or array written in it that parses, and
  every object with an `ops` list found inside one (also inside a string holding JSON text, as `deep_show` takes a
  patch), each once, in the guide's order. An op's examples are the patches holding an op with that `op` name. A bare
  op list is no patch, and pseudo-JSON that doesn't parse holds none.
- **"Each example applies"**: every op the schema lists has at least one example that applies. The guide may also show
  patches that are refused on purpose (a stale base, the two refusals), so an op passes when one of its examples
  applies; every example's outcome is printed.
- **"Applies to the gallery's product reveal through `deep-show run` with outcome `applied`"**: each example on its
  own, as written, to a fresh copy of the product reveal as deep_kinds serves it, stored as a shared document under the
  doc ID the example's `doc` names, at revision 0 (the stored document, so an example made for it says `base: 0`), and
  sent as you. You, because the stored product reveal has no layers: only your patch takes an item into your layer,
  and an agent's patch to one of its items is `not_your_layer` (Writer layer), which the issue doesn't change. An
  example whose `doc` isn't a non-empty string can't be stored under it and doesn't apply.
- **"A planted guide missing `reorder` fails, naming it"**: AC1's first check run on the plant: a failure starts with
  the op it names, and every failure names reorder. The plant must leave `op: field` alone, so the test first checks
  that the planted build still lists reorder.
- **"A fix that names `items/<id>/at/pos`"**: the patch sets `name` (the product reveal's text item, which has
  `at.pos`) to `[400, 140, 0]` with path `at/pos`; the reply's outcome is `refused`, and one of its fixes (an issue's
  `fix`, with its `fix_ops` as JSON text, or the reply's own `fix`) holds `items/name/at/pos`, or `items/<id>/at/pos`
  as the issue writes it, matched as `(?<![A-Za-z0-9_])items/(?:name|<id>)/at/pos(?![A-Za-z0-9_/])`: not inside a
  longer word, and not a deeper path such as `items/name/at/pos/0`.
- **"A fix that names the envelope fields"**: the same op sent as a bare list, `[{op: set, id: name, path:
  items/name/at/pos, value: [400, 140, 0]}]`, in place of the patch; the outcome is `refused`, and one fix names each of
  the envelope's fields the parent issue gives, patch, doc, base, reason and ops, each as a word (not inside a longer
  one: `doc` in `document` or `base` in `based` doesn't count).
- **The control**: the same op in its envelope (`{patch: <ULID>, doc, base: 0, reason, ops}`) with path
  `items/name/at/pos` applies, so each fixture is refused for its path or its shape alone. Every AC2 test runs it.

## Not tested, because no criterion asks

What `op: field` answers for each op beyond answering lines; the guide's path grammar sections and what it says about
`base` and a stale base; any refusal's code or path; the hub and `deep mcp` routes, where a patch is a string holding
JSON text; an agent's patches.

## Files

- `helpers.ts`: the full build, `deep-show run`, the patch schema's ops, the guide and its patches, the product
  reveal, the fixtures and the criteria's checks.
- `guide.test.ts` (AC1), `refusal.test.ts` (AC2).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
