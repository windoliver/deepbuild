# Acceptance tests for #1971: one field by path in deep_kinds

Written first, from issue #1971 ("One field by path in deep_kinds: one line per field from the sealed listing, and a
miss refused with close names": its Scope, its four acceptance criteria and its Proof line), the design sections it
links, and base commit `4004257cd` (`origin/main`, "Merge pull request #2246 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 1971`, and its oracle page (`doneright/oracles/issues/1971.md` in
  `DeepBuildAI/deepbuild`, branch `doneright`): no upstream test checks any of the four criteria; each is held to our
  own fixtures and planted twins.
- `docs/technical-design.md`: the MCP tools row of "Five ways in, all onto the same core" (the `deep_kinds` paragraph;
  "Errors share one shape: a code from a closed set, whether a retry can help, one remediation action, the value it
  refused at the path it names … A misspelt argument, tool or enum value's remediation names the nearest listed name,
  by the canvas's close-name distance and reach") and the Dogfooding paragraph (blind tests, the redraft on a dispute).
- `docs/canvas-primitives.md`: Canvas module; Registry and seal; Registry and seal: registries ("`deep_kinds` lists
  every registry and its entries in one shape").
- `AGENTS.md` (Proof).
- At the base, for surfaces and conventions only: `tests/acceptance/412/` (deep_kinds on `deep-show run`, its plants
  by `--planted <name>`, `deep-show kinds --dump`, the budget test's reference-Mac gate and judge),
  `tests/acceptance/1718/` (deep_kinds through the hub and `deep mcp`), `tests/acceptance/1970/` (`deep mcp` against a
  hub in a temporary home; a remediation that "names" a choice); `crates/deep-show/src/kinds.rs` (`kinds_reply`, its
  ops and refusals, `fields_of`, the dump, `Planted`), `crates/deep-show/src/main.rs` (`start_args`, `planted_named`,
  the deep_kinds call), `crates/deep-canvas/src/kinds.rs` (`test.slab` at majors 1–3: `w` renamed `width` in @2, `h`
  renamed `height` in @3; @3 holds width, height, label and corner), `crates/deep-canvas/src/document/close.rs` (the
  close names #412 computes: a rename record's name first with `renamed_in`, then kinds that define the name, then
  spelling), `packages/hub/src/core.ts` (`kinds`: the call forwarded with null fields dropped, a refusal rethrown as
  code, path, remediation and actual), `packages/hub/src/canvas.ts` (`kindsCommand`, `canvasCore`),
  `packages/hub/src/tools.ts` (the deep_kinds schema), `packages/contracts/schemas/error@{1,2,3}.json`.

## What the base already does, which the tests don't credit

From the base run (`BASE-FAILURE.txt`):

- `deep-show kinds --dump` writes the whole sealed listing; the full build's lists 504 fields across 52 kinds, all
  entries of `kind@1`, each field `{name, type, unit, range, list, default}` in the kind's order. test.slab@3's are
  width, height, label and corner. By its code, the listing (`op: list`) already gives each kind's fields in that
  shape, with `grammar` and `forms` added for a field that takes a literal.
- deep_kinds has no `field` op: `{op: "field", path}` is refused with `enum` at `/op` ("Give op as one of list, word,
  search, read, gallery, sheet or step_ceilings."), for a field path, an object path and a miss alike. That refusal is
  already in the shared shape; its code and its names are what AC4 fails on.
- The deep_kinds tool's schema doesn't take `path`: through `deep mcp` and the hub, the call is refused with
  `unlisted_field` at `/params/arguments/path`, listing the tool's fields.
- By its code (not run here), the document check already computes close names for an unknown field (#412,
  `close.rs`): for `w` on test.slab@3,
  width with `renamed_in: test.slab@2` first, then test.rect@1, which defines `w`; for `widht`, width by spelling.
  Nothing on deep_kinds uses them.
- `--planted field_listing_without_corner`, `field_line_600_bytes` and `field_object_by_name` are unknown startup
  arguments: `deep-show run` answers `{"ok":false,"code":"bad_input"}` and exits 2.

## Run them

```sh
npm ci && npm run build --workspaces     # once: refusal.test.ts runs the built CLI (deep hub run, deep mcp)
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1971 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1971/tsconfig.json
```

Node 24, `cargo` on the `PATH`. Each file builds the full `deep-show` once (`cargo build --locked --bin deep-show`,
default features, which are `full`); `refusal.test.ts` also builds deep-hook (`cargo build --locked -p deep-hook --bin
deep-hook`, a separate run so neither changes the other's features), which the hub needs to start. Both build in the
checkout's own `target/` with `CARGO_TARGET_DIR` dropped and `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` unless
set, since the hub runs its canvas core from there; the binary under test is the one the hub would run, the newer of
`target/release/deep-show` and `target/debug/deep-show`. `refusal.test.ts` starts one hub and one `deep mcp` with `HOME`
in a folder under `/tmp/dh1971-*` (a socket path must fit in 104 bytes on macOS), so it never touches your
`~/.deepbuild`, and stops both by PID after the file, never by name or port. Every temporary folder is deleted. Node
built-ins and vitest only. A run with `--root tests/acceptance/1971` may leave Vitest's cache in
`tests/acceptance/1971/node_modules`; delete it.

`scripts/lanes.mjs` needs `'tests/acceptance/1971/'` in its `alone` list (the files build cargo, start a hub and time
calls), as #412's and #1718's folders are; this README is the instruction, and the implementer makes that edit.

Each test passes its timeout as the last argument of `it` (3,600,000 ms), since a cold build of `deep-show` takes many
minutes on a loaded Mac.

`BASE-FAILURE.txt` is the run at the base.

## The surfaces under test

- **deep_kinds on `deep-show run`**, as #412's suite calls it: one scenario `{"evidence", "calls": [...]}` per batch,
  one reply per call, each call `{"call": "deep_kinds", "op": "field", "path": <path>}`. The hub sends `deep-show
  canvas` the tool's arguments the same way (`core.ts`, `kinds`), so this is the canvas core's answer to the tool.
- **The deep_kinds MCP tool** (AC4 only): `deep mcp` started by hand against `deep hub run` in a temporary home, spoken
  to as an MCP client speaks it (`initialize`, `tools/call deep_kinds` with `{op: "field", path}` and nothing else, as
  #1718's suite leaves the other fields out). No session is bound: deep_kinds needs none.
- **`deep kinds --dump`**: it runs the canvas core's `kinds --dump <dir>` (`packages/hub/src/canvas.ts`,
  `kindsCommand`), so the tests run `deep-show kinds --dump <dir>` on the binary under test and read the file named in
  its `{"ok": true, "path", "module_set"}` line. The dump is the reference for every criterion and is always the
  unplanted build's.
- **Planted twins** are startup arguments, `deep-show run --planted <name>`, as #412's deep_kinds plants are
  (`kinds::Planted::named`); each name below is this job's invention.

| Plant | The wrong program |
|---|---|
| `field_listing_without_corner` | the listing `op: field` prints from leaves out `test.slab@3`'s field `corner`; nothing else changes |
| `field_line_600_bytes` | the line `op: field` answers for `test.slab@3.width` is 600 bytes; nothing else changes |
| `field_object_by_name` | an object path answers its kind's lines in field-name order instead of the listing's |

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 | `one-field.test.ts` (3): every field of the dump answers one line under 512 bytes whose type, unit, range and default equal the dump's; `field_listing_without_corner` fails naming test.slab@3 and corner, and only that field; `field_line_600_bytes` fails naming test.slab@3.width, and only that line |
| AC2 | `object-path.test.ts` (2): every kind the dump lists with params answers, by its object path, as many lines as it lists params, in its order; `field_object_by_name` fails on test.slab@3 naming corner, the first line out of place |
| AC3 | `budget.test.ts` (1): every one-field reply answers one line and is under 1 KB; on a fit reference Mac, p95 under 100 ms by #412's judge, else INCONCLUSIVE after the structural check |
| AC4 | `refusal.test.ts` (2): through `deep-show run`, and through the deep_kinds tool over `deep mcp`: test.slab@3.widht is one unknown_field error in the shared shape naming width first; test.slab@3.w names width with renamed_in test.slab@2 |

Each test's name starts with its criterion. Where a criterion names a wrong program, the test runs its plant and
asserts the criterion's check fails, its failure naming what the criterion says.

## Readings of what the criteria leave open

- **A path** is `<entry name>.<field name>` for each element of an entry's `fields` array in the dump, every registry
  walked (`test.slab@3.width`); an **object path** is the entry's name (`test.slab@3`), called for every entry the dump
  lists with at least one field. An entry the dump lists with no fields (a kind drawn with no registry schema) is not
  called: no criterion asks what it answers.
- **"One line"**: the answer to `op: field` holds `lines`, an array whose elements are each a line of text (a string
  with no newline; one with newlines counts as that many lines) or an object (its line is its JSON text); failing
  that, `text`, split on newlines. That is the least the issue fixes ("one line per field", "exactly one line"), in
  deep_kinds' JSON replies.
- **A line's values** are read from the one JSON object the line is or holds, under the dump's own keys: its `type`,
  `unit`, `range` and `default` equal the dump field's by JSON value (`10.0` and `10` are one number; a missing key
  equals only a missing key). A line whose text isn't one JSON object can't be compared, and fails AC1. A line names
  its field by `name` (the field's name or its whole path) or `path`; AC2 reads that to place each line. The issue's
  other contents of a line (forms, canvas module, stability) are not asserted: no criterion asks.
- **Bytes**: a line's size is the UTF-8 bytes of its text (an object element's as `JSON.stringify` writes it); "under
  512 bytes" is fewer than 512. A reply's size is the UTF-8 bytes of its JSON, as #412's suite measured replies; "under
  1 KB" is fewer than 1,024. A refusal is not a one-field reply: AC3's reply must answer one line.
- **"Fails, naming the kind and the field / naming it / naming the first line out of place"** is this suite's check
  (helpers.ts, `oneFieldFailures`, `objectFailures`) run on the plant: each failure starts with the field's path (kind
  and field), and an order failure says "out of place" and names the first line, in answer order, that isn't the
  dump's field at that place. Each plant is fixed to one field so the names are known: corner (the last field of
  test.slab@3, added in its minor 1) for the left-out field, width for the long line; field-name order puts corner
  first, the first line out of place. The plants must change nothing else: AC1's plant tests fail on any other field.
- **AC3's timing** follows #412's AC10: a reference Mac fit to judge, five runs after a warm-up, each a `deep-show run`
  kept open, each call timed as its scenario's wall time less the median of twenty twins with no call, p95 per run of
  twenty calls, judged PASS when every run is within 100 ms, FAIL when every run is past it by more than the margin
  (the larger of 5% and the runs' spread), else INCONCLUSIVE. On any other machine, or under a 1-minute load above the
  core count, the timing skips as INCONCLUSIVE after the structural check, which still runs and can fail. It never
  passes by skipping.
- **"One error in the shared shape"** (AC4): the reply is `{"error": E}` holding no lines, text, errors or issues (over
  MCP, a tool result with isError holding E), and E validates against one of the error@N schemas
  `packages/contracts/schemas` publishes: exactly its six fields (code, retryable, remediation, path, actual,
  evidence), each of its type, with a code from its closed set. At the base no published error schema lists
  `unknown_field`, so the shape the refusal is in must list it. The refusal's `path` is not asserted: the issue names
  none.
- **"Naming width first" and "names width with renamed_in: test.slab@2"** (AC4) are read in the remediation, the one
  field of the shared shape that carries names to an agent (the hub passes on only code, path, remediation and
  actual), as #1970's suite reads "a remediation naming doc": it singles width out among test.slab@3's fields (names it
  more often than some other field, so a list of every field once names nothing). For widht, width is also the first
  close name the remediation names: the earliest of test.slab@3's fields, or of any `name@major` other than a major of
  test.slab, that it names. For w, the remediation also names `test.slab@2`, the version whose rename record made w
  width. Should the error also carry a `close` list (a published shape would have to list it), it must agree: widht's
  starts with width, and w's holds `{name: width, renamed_in: test.slab@2}`.
- **The deep_kinds tool** (AC4) takes `op: field` and `path` as the issue names them; its other fields are left out.

## Not tested, because no criterion asks

The line's forms, canvas module and stability; `op: field` on an entry the dump lists with no fields; a miss's close
names beyond width (test.rect@1, which defines w, among them); the hub route for AC1–AC3; the Proof line's runs, which
`BASE-FAILURE.txt` and the branch's run give.

## Files

- `helpers.ts`: the full build, `deep-show run` and `kinds --dump`, the line reader, the criteria's checks, the shared
  error shape, the timed process with #412's gate and judge, and the hub with `deep mcp`.
- `one-field.test.ts` (AC1), `object-path.test.ts` (AC2), `budget.test.ts` (AC3), `refusal.test.ts` (AC4).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
