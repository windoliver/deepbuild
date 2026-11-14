# Blind redraft: #1972 AC1, the applies clause

A fresh run of the blind acceptance-test job (design: Dogfooding), for one clause of issue #1972's first acceptance
criterion: "Each example applies to the gallery's product reveal through `deep-show run` with outcome `applied`". It
was written from the issue, the design and base commit `e0c90a5a5` only, by a job that saw no implementation, no
earlier draft and no dispute. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- Issue #1972, live (Scope, both criteria, Proof), and its parent #1658's "Amended again (Nov 8)": the patch's shape
  `{patch: ULID, doc, base: rev, reason, ops: [{op: set, id, path, value} | create | unset | delete | move | reorder]}`
  with paths rooted at `items/<id>/…`, and the dry run's refusals (a bare op list, then `at/pos`).
- The oracle page `doneright/oracles/issues/1972.md` (DeepBuildAI/deepbuild, branch `doneright`): no upstream test;
  both criteria are held to our own fixtures and planted twins.
- `docs/technical-design.md`: the MCP tools row of "Five ways in, all onto the same core" (`deep_kinds` serves the
  installed guides and a gallery of verified example documents, read in pages that say when they're cut and where the
  next starts; errors share one shape), the Patch primitive, and Dogfooding.
- `docs/canvas-primitives.md`: Patch (its fields, the closed op list `create`, `set`, `unset`, `delete`, `move`,
  `reorder`, `rows`, `break_out`, and the result's `outcome: applied | superseded | conflict | refused`), The path
  grammar, Writer layer.
- `AGENTS.md` (Proof).
- At the base, for surfaces and conventions only: `tests/acceptance/1971/` and `tests/acceptance/412/` (deep_kinds as a
  `deep-show run` call; `read` of a guide in pages with `truncated` and `next`; the installed gallery holds an example
  whose title holds "product reveal"), `tests/acceptance/96/` and `tests/acceptance/306/` (a stored document in
  `docs[…].document`, opened as revision 0; a patch as a `deep_show` call; the Patch result),
  `crates/deep-show/src/kinds.rs`, `main.rs`, `shared.rs`, `crates/deep-canvas/src/document/apply.rs`, and
  `crates/deep-show/gallery/`.

## How the clause is read

- **The guide** is `deep_kinds read guide: patches`, read from offset 0 page by page until a page isn't cut.
- **An example** is a patch or a single op in one of the guide's fenced code blocks (``` or ~~~) that holds JSON: the
  block as one value, or with its `//` and `#` comment lines left out, or else each of its lines that is one. A patch
  is an object with an `ops` list, or a call carrying one as its `patch`; a list of patches gives each. A single op is
  an object whose `op` is one of the design's ops. A bare list of ops is not an example (AC2 refuses it), and a reply
  (it holds `outcome`, not `ops`) is none. So a guide shows a refused form in prose or as its refusal, never as a JSON
  patch or op, since every JSON patch or op it shows must apply.
- **The ops the patch schema lists** are read through `deep_kinds op: field`, which the Scope says takes `patch.<op>`
  and answers from the same schema: each op of the design's closed list whose `patch.<op>` answers at least one line and
  no refusal is listed. The six ops of the patch's shape in #1658's amendment are always on the list, so a guide can't
  pass by having no examples. The test fails when the guide holds no example of a listed op, naming it: without an
  example of each, "each example applies" could hold for a guide that teaches nothing.
- **The gallery's product reveal** is the gallery's example whose title holds "product reveal" (`deep_kinds gallery`),
  parsed from the bytes `deep_kinds read example: <its hash>` serves, not from a copy in the test.
- **Through `deep-show run`**: one scenario stores, for each example, its own copy of the product reveal as a shared
  document (`docs[<doc>].document`, revision 0), so no example sees another's change. Doc IDs are
  `01JB1972D000…000<n>`, one per example n. The guide is for agents, so a test agent's session sends each example
  through `deep_show` (writer `agent:thread-guide`). Each copy holds the product reveal's items in that agent's own
  layer (`layers: {guide-main: {writer: "agent:thread-guide", …}}`, each item `layer: guide-main`), as they would be
  once the agent had shown the example as its document; otherwise an agent's `set` on `product` is `not_your_layer`
  whatever the guide says.
- **Sending an example**: a patch is sent as the guide gives it, with `patch` (a fresh ULID `01JB1972P000…000<n>`),
  `doc` (its copy) and `base` (0, the stored revision) bound to this store, and `reason` filled in only when it gives
  none. A single op is sent as the only op of such a patch. Its ops are never changed.
- **Applies** is the Patch result's `outcome` being `applied`, as the criterion names it.

## Run it

```sh
npm ci                                     # once
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1972/redraft-ac1
node node_modules/typescript/bin/tsc -p tests/acceptance/1972/redraft-ac1/tsconfig.json
```

Node 24 and `cargo` on the `PATH`. The file first runs `cargo build --locked --bin deep-show` (default features) and
runs the binary from `target/debug` (under `CARGO_TARGET_DIR` when set). Every scenario's evidence folder is a temporary
folder deleted after the file; a run that hangs is stopped by its own timeout, which signals only that child. A run
with `--root` leaves Vitest's cache under `tests/acceptance/1972/redraft-ac1/node_modules/.vite`; delete it. Node
built-ins and vitest only.

Not run at the base, where the guide doesn't exist (`read guide: patches` is refused `not_found`). Type-checked once.

## Surfaces under test

- `deep-show run` with `{"call": "deep_kinds", "op": "read", "guide": "patches", "offset"}` →
  `{"guide", "offset", "text", "truncated", "next"?}`.
- `{"call": "deep_kinds", "op": "field", "path": "patch.<op>"}` → lines (`lines` or `text`), or a refusal.
- `{"call": "deep_kinds", "op": "gallery"}` → `{"examples": [{"hash", "title", …}], "next"?}`, and
  `{"call": "deep_kinds", "op": "read", "example": <hash>}` → `{"example", "text"}`.
- `deep-show run` with `sessions`, `processes`, `panels`, `docs[<doc>]: {"panel", "document"}` and
  `{"call": "deep_show", "session", "doc", "patch": Patch}` → the Patch result's `outcome`.

## What it fails on

- An example the hub refuses on the product reveal: a path such as `at/pos`, a field its op doesn't take, an envelope
  field left out or misnamed, an ID the product reveal doesn't hold. The failure names the example, its code block, its
  ops and the issues.
- A guide with no example of an op the schema lists, such as one missing `reorder`, or one whose only example of an op
  is a bare op list: the failure names the op.
- No guide named `patches`, or no product reveal in the gallery.
