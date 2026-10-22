# Acceptance tests for #96: documents several agents write

Written first, from issue #96 ("Documents several agents write: patches by writer, history, and a merge by
ID": its scope, its Patch, Writer layer, Provenance and Writer connection fields, its fourteen acceptance
criteria and its proof line), its Oracle page (`doneright/oracles/issues/96.md` in `DeepBuildAI/deepbuild`,
branch `doneright`: upstream tests for criteria 3 (Yjs's undo tests) and 7 (fractional-indexing's key tests),
none for the other twelve), the design sections it names and those they lean on, and base commit `ef2becb`
("Merge pull request #662 … feat/393-deep-show"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read:

- `docs/canvas-primitives.md`: The path grammar, Handles and Order keys (fractional base-62 keys, "jitter seeded
  from (writer, patch ID) … a replay gives the same keys. Ties break by ID"); What the kernel holds: Document
  envelope (`requires`: "each kind's minor is the lowest its used fields need"), Item and kind ("An unknown kind
  is skipped when drawing with the notice `unknown_kind` and kept byte for byte through other writers'
  patches"; a field a kind's version doesn't define is `unknown_field` unless the document requires a newer
  minor), ID and sub-address (temporary IDs `~1`), Path and handle, Writer layer (a document is the union of
  its writer layers by ID; your patch takes another writer's item into your layer; a reference left
  unresolved "hides only the referring item, with `ref_unresolved` sent to its writer"; no other writer's
  channel or placement may write your item, `not_your_layer`), Patch (its fields, ops, result and closed
  refusal codes; "A stale base rebases when no ID it touches changed since; otherwise it's a conflict naming
  both writers"; "The IDs a patch touches are those its ops target, plus the parent a create or move names and
  the neighbor a reorder names"; undo by the same writer only, refused if another writer touched those paths
  since; the five fuzzer laws; Apply ≤ 2 ms), Revision (the canonical document and its hash; "The `doc.patched`
  event is the commit point. A layer file is written by hash first … A fault fixture kills the hub between the
  two"), Lease; The event catalogue (`doc.patched {doc, rev, patch, writer, achieved}` feeding an item's
  history and the by-writer lens) and Projections (`documents`); The trusted compositor: Writer connection
  (quotas, `patches_per_s`), Document session, Admission and latch ("checks it off the UI thread with fairness
  between writers … At the latch, vsync minus the lead, each session takes its newest checked revision … It
  can never: Apply in the middle of a frame; let one writer's flood delay another's"), Frame clock and
  scheduler, Band; Placement, Clip, Channel and key.
- `docs/technical-design.md`: Socket roles and contract versions (the peer check: a `deep` command inside an
  agent's process tree acts as that agent; "Documents that age well": the lowest minor so an older app still
  opens a document, unknown kinds kept byte for byte), the Patch and Provenance primitives, the MCP and CLI
  tool rows (`deep_show` "from R2 … also carries the agent's patches to a document it writes"), Dogfooding and
  Tests written first.
- At the base: the earlier blind suites `tests/acceptance/389/`, `391/`, `392/`, `393/`, `394/` (READMEs,
  helpers, BASE-FAILURE files) and `14/`, `16/` (budgets on the reference Mac, the perf lane); `crates/deep-show`
  (`deep-show run`, #393's scenario binary standing in for the hub's canvas side), `crates/deep-canvas`
  (`deep-canvas check | apply | canonical`, the kernel registry with `test.slab@3.1`, `deep_canvas::show`'s
  writer text `<kind>:<id>`), `crates/deep-canvas-marks` (the 2D marks and the clean look's roles `ground`,
  `ink`, `muted`), `crates/deep-canvas-motion` (clips and placements), `packages/contracts` (`doc.patched@1`
  and `validate`), `packages/record`, `benchmarks/budgets.json`, `scripts/benchmark.mjs`, `scripts/lanes.mjs`.

There is no `parity/` corpus at the base (no `parity/kernel/` or `parity/agent/` scene anywhere in the tree),
so the two parity scenes the issue names are this suite's own fixtures:
`fixtures/parity/kernel/unknown-kind-roundtrip.scene.json` and `fixtures/parity/agent/write-readback.scene.json`.
When the parity corpus lands, those scenes can be moved there as they are.

## Run them

Like #391's to #394's suites, these build cargo binaries, so they run with `--no-file-parallelism`
(`scripts/lanes.mjs` needs `tests/acceptance/96/**` added to the unit lane's `--exclude` list and
`tests/acceptance/96/` to its one-at-a-time line, as those suites' READMEs say for theirs; this job edits
nothing outside this folder):

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/96 --no-file-parallelism
npx tsc -p tests/acceptance/96/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first runs `cargo build --locked --bin deep-show --bin deep-canvas` (cached after the first file)
and fails each of its tests when the build fails. Each test makes a temporary evidence store root and a
temporary hub state folder and deletes both. The tests use only node built-ins and vitest, and the contracts
package's public entry (`packages/contracts/src/index.ts`: `validate`). A run with `--root
tests/acceptance/96` leaves Vitest's cache in `tests/acceptance/96/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base: every test fails there, for a missing surface (below).

`budgets.test.ts`'s two timing tests count only on a reference Mac (Mac15,7 / M3 Pro / 36 GiB or Mac15,12 /
M3 / 16 GiB) on mains power, Low Power Mode off and no thermal warning. Anywhere else, and when a reading falls
between the limit and the margin, they fail with a message that starts `INCONCLUSIVE:`; they never pass on a
reading they can't trust. The merge-base comparison is the perf lane's, as #16's is: the first budgets test
checks the two tasks are in `benchmarks/budgets.json`, valid against the merge base's
(`git merge-base HEAD origin/main`).

## The surface under test

The issue names patches, writer layers, history, a by-writer lens, a merge by ID, undo by writer, quotas, the
latch and the commit point, but no code API, and the hub that would serve them for agents doesn't exist at the
base. These tests extend the surfaces the earlier blind suites defined, and add as little as they need:

- `deep-show run` (#393's scenario binary, the hub's canvas side): patches, undo, reads, history and the
  by-writer lens through `deep_show` and `deep show`; shared documents minted from a stored document; a state
  folder for layer files and the record; quotas and a virtual display clock; two fault fixtures and four
  planted programs.
- `deep-canvas` (#389's kernel binary): a `merge` subcommand, `as_build` on `check`, and `requires.kinds` on
  what `apply` writes.
- `benchmarks/canvas.mjs` and two tasks in `benchmarks/budgets.json` (the perf lane).

Everything #393's README defines for `deep-show` stays as it is (the JSON-lines convention, `bad_input`,
sessions, the process table and its peer check, panels, `evidence`, whole revisions and their replies,
`revisions`, `screen`, its fault and planted values); what follows adds to it.

### Writers, layers and IDs

A writer is `{"kind": "you" | "shell" | "record" | "agent" | "plugin", "id": string}` (Writer connection): a
`deep_show` call writes as its bound session's agent, `{kind: "agent", id: <thread>}`; `deep show` writes as
the agent whose process tree its peer runs in, else as you, `{kind: "you", id: "you"}` (#393's peer check). A
layer's `writer` field holds the writer's text `<kind>:<id>` (`you:you`, `agent:thread-alpha`), as the base
stamps it. A writer's layer is the one layer whose `writer` is its text; when it has none, the hub adds one
(ID, title and order of its choosing; the outline and band as #393's). Every item a writer creates, and every
entry of another map keyed by ID it writes (channels, clips, placements, …), belongs to its layer. Payloads
never name a layer or a writer: a patch payload with a `writer` field is refused.

### Scenario fields added

```json
{"docs": {doc ID → {"panel": panel ID, "document"?: Document}},
 "state"?: dir,
 "quotas"?: {session ID → {"patches_per_s": n}},
 "clock"?: {"refresh_hz": n, "lead": flicks, "check": flicks},
 "fault"?: {"kill_after_layer_file": patch ULID} | {"layer_file_fails": patch ULID} | #393's {holds, ms},
 "planted"?: #393's values | "rebase_counts_op_targets_only" | "diffs_whole_document" | "one_fifo_check_queue" | "newest_layer_file_current",
 …#393's other fields}
```

- `docs[…].document`: a shared document as a release stored it: the envelope, `layers` (with their writers)
  and `items` (with their `layer`), and no `id` (the hub fills in the doc ID, in lower case as #393's does).
  The hub opens it as **revision 0**, current. Every revision after it is one applied patch, undo or whole
  revision, numbered 1, 2, … in the order they become current. Without `document`, a doc behaves as #393's.
  A patch's `doc` and `base` name the doc ID as the scenario writes it and the revision it was made on.
- `state`: the hub's state folder. Without it the hub keeps the same things in memory and nothing persists.
  With it:
  - `<state>/layers/<first 2 hex>/<other 62 hex>`: **layer files**, each named by the SHA-256 of its bytes:
    UTF-8 JSON `{"doc": doc ID, "layer": layer ID, "writer": {kind, id}, "items": {ID → Item}, …}` (the layer's
    entries of every other map keyed by ID beside `items`, under their map's name). Every revision that
    changes a layer writes that layer's file before anything else of its commit.
  - `<state>/record.jsonl`: the hub's **record**, one appended event per line, `{"log_pos": n (1, 2, …),
    "session": session ID | null, "event": Event}`. Every applied patch, applied undo and presented whole
    revision appends one `doc.patched` event that validates as `doc.patched@1`
    (`packages/contracts/schemas/doc.patched@1.json`): `data.doc` is `doc:<doc ID>`, `data.rev` the revision
    it made, `data.patch` the patch's ULID, `data.writer` the writer's kind, `data.achieved` the result's
    `achieved`; `evidence` lists the layer files that revision wrote, by hash; `session` is the session the
    writer acts as (`null` for you). **The event is the commit point**: a revision is current only once its
    event is appended.
  - A run whose `state` already holds a record **restarts** from it: each document is its `docs[…].document`
    with each layer taken from the file the latest event that wrote that layer names, at that event's `rev`.
    A layer file no event names is never current.
- `quotas`: a writer's `patches_per_s` (Writer connection). Writers without one are unlimited.
- `clock`: a virtual display clock, so a run reads no wall time. Vsync is at `k × 705,600,000 / refresh_hz`
  flicks for k = 1, 2, …; the **latch** is at each vsync minus `lead`. With `clock`, every call carries
  `"at": flicks` (its arrival), calls arrive in `at` order (ties in call order) and replies stay in call order.
  The hub keeps **one check queue per writer** and one checker that takes one patch at a time, round-robin
  across writers with patches queued; every patch it takes occupies it for `check` flicks, whether it is
  checked or refused for its quota. A patch taken when its writer already had `patches_per_s` patches applied
  in the second before is refused `over_quota` (or superseded, for a coalesce key). A checked revision becomes
  current at the first latch at or after its check, never between latches.
- `fault` (reachable only through this field, only for these proofs):
  - `kill_after_layer_file: P`: while committing patch `P`, the hub writes its layer file by hash and then
    ends at once, as SIGKILL would (no answer line, nothing after), before its `doc.patched` event is appended.
  - `layer_file_fails: P`: writing patch `P`'s layer file fails at its commit, so `P` never becomes current;
    the run goes on.
- `planted` (reachable only through this field, only to prove the tests can fail):
  - `rebase_counts_op_targets_only` (AC2): a stale base rebases when no ID its ops target changed since,
    ignoring the parent a create or move names and the neighbor a reorder names;
  - `diffs_whole_document` (AC11): a whole revision is diffed against every ID in the document, not just its
    writer's layer;
  - `one_fifo_check_queue` (AC13): one check queue for all writers, in arrival order;
  - `newest_layer_file_current` (AC14): on restart, each layer is the newest layer file written for it,
    whether or not an event names it.

### Calls added

**A patch**: `{"call": "deep_show", "session", "doc", "patch": Patch, "at"?}` or `{"call": "deep show",
"peer", "doc", "patch": Patch, "at"?}`. Patch `{"patch": ULID, "doc", "base": rev, "reason": string,
"gesture"?, "dry_run"?, "coalesce_key"?, "ops": [op]}` with the issue's ops: `create {item}` (an item without
`layer`; its `id` may be a temporary `~n`, and its `order` may be left out when the same patch reorders it),
`set {id, path, value}`, `unset {id, path}`, `delete {id, cascade}`, `move {id, parent, keep}`, `reorder {id,
after | before}` (a key between the named sibling and its neighbor in the patch's base, with jitter seeded
from (writer, patch ID)), `rows`, `break_out`. The reply is the Patch result:

```json
{"outcome": "applied" | "superseded" | "conflict" | "refused", "rev": u64,
 "ids": {"~n": ID}, "achieved": {"created": {kind: n}, "updated": n, "deleted": {kind: n}, "unchanged": bool},
 "issues": [Issue], "truncated"?: {…}, "cost_delta": {"cpu_ms", "gpu_ms", "vertices", "lights", "gpu_mb"},
 "undo": [op],
 "conflict"?: {"ids": [ID], "writers": [{kind, id}]},
 "lost"?: [patch ULID],
 "arrived"?: flicks, "checked"?: flicks | null, "current"?: flicks | null}
```

- `rev`: the revision the patch made, else the current one. `issues`: `{code, ids, path, actual, what, fix}`
  (#389's), codes from the issue's closed list.
- `conflict` (with outcome `conflict`): the IDs the patch touches that another writer changed since its base,
  and the writers involved: the patch's own and each writer who changed them. A conflict also carries a
  `stale_base` issue naming those IDs.
- `lost`: patches of this writer to this document that an earlier reply acknowledged as `applied` and that
  never became current, each reported once, on the writer's next reply to that document (a patch, undo, whole
  revision or `read` naming the writer).
- `arrived`, `checked`, `current` (with `clock`): when it arrived, when the checker finished with it (`null`
  if never taken), and the latch at which its revision became current (`null` if it never did).

**An undo**: `{"call": "deep_show" | "deep show", …, "doc", "undo": {"patch": ULID, "of": ULID}}`: undo patch
`of` as a new patch `patch`, by the same writer; the reply is a Patch result. Undoing another writer's patch,
or one whose items another writer has changed or taken since, is refused (`undo_conflict` or
`not_your_layer`).

**Whole revisions** (#393's `document` calls) work on shared documents too: diffed against the writer's own
layer only, so another writer's items never count as removed and stay as they are.

**`{"call": "read", "doc", "session"? | "peer"?}`** → `{"rev": u64, "hash": sha256, "document": Document,
"draws": [ID], "issues": [Issue], "files": {layer ID → sha256}, "lost"?: [ULID]}`: the current revision.
`document` is the stored document (with `id`, `layers`, items with `layer`); `hash` is the SHA-256 of its
canonical bytes (what `deep-canvas canonical` gives for `document`); `draws` the IDs of the items that draw
(sorted; an item hidden by an unresolved reference or of an unknown kind is left out); `issues` the current
revision's issues, only those on items in the reader's layer when the call names a writer (by `session` or
`peer`, as a patch does); `files` each layer's layer file by hash; `lost` as above, for the writer named.

**`{"call": "history", "doc", "item": ID}`** → `{"history": [{"rev", "patch", "writer": {kind, id},
"reason"}]}`: every revision whose patch created, changed, moved, took or deleted the item, in revision order.

**`{"call": "by_writer", "doc"}`** → `{"writers": [{"writer": {kind, id}, "layer": ID, "items": [ID],
"patches": [ULID]}]}`: for each layer, the items it holds now and the patches its writer applied, in order.

**`revisions`** rows gain `"patches": [ULID]`, the patches that revision applied; revision 0 of a minted
document is a row too, with `writer: null`.

### `deep-canvas` additions

- **`merge`**: input `{"base": Document, "a": Document, "b": Document}` → `{"outcome": "merged", "doc":
  Document, "hash": sha256}` or `{"outcome": "conflict", "conflicts": [{"id": ID, …}]}`. A three-way merge by
  stable ID over every layer and every map keyed by ID: an entry the same in `a` and `b`, or changed on one
  side only, takes that value; changed differently on both sides, it's a conflict naming the ID, and nothing
  is merged. `merge(base, a, b)` and `merge(base, b, a)` give the same bytes; `hash` is the merged document's
  revision hash. A line missing `base`, `a` or `b` answers `bad_input`.
- **`check` with `"as_build": ["family.name@major.minor"]`**: the check runs as a build whose registry has
  each named kind at that version, its params limited to those its minor has (the previous release); other
  kinds as this build has them.
- **`apply`** writes `requires.kinds` on the document it returns: for each kind in the build's registry its
  items use, `family.name@major.minor` at the lowest minor that defines every param they use.

### The perf lane

`benchmarks/budgets.json` gains tasks `canvas-patch-apply` and `canvas-merge-10k`, with commands `["node",
"benchmarks/canvas.mjs", "patch-apply"]` and `[…, "merge-10k"]`, an `initialReason` naming #96, valid by
`scripts/benchmark.mjs`'s `validateBudgets` against the merge base's budgets; each command exits 0.

## Fixtures

- `board.json`: the shared board as stored: layers `you-main` (`you:you`), `alpha-main`
  (`agent:thread-alpha`) and `bravo-main` (`agent:thread-bravo`); your nodes `you.n1` (order `a0`, at `[40,
  40, 0]`) and `you.n2` (`a1`, at `[40, 200, 0]`), each a `rect@1`. Agents' nodes are `rect@1` and their
  arrows `path@1` parented to a node (the R1 slice's 2D marks), drawn in the clean look's roles.
- `parity/kernel/unknown-kind-roundtrip.scene.json`: the same board as a newer release saved it, with
  `bravo.gizmo` of kind `acme.gizmo@2` in bravo's layer: nested params, a float, an array and a string.
- `parity/agent/write-readback.scene.json`: alpha's write (a box at `[400, 40, 0]`) and the move whose layer
  file fails (to `[400, 260, 0]`).

## Criteria to tests

Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test runs it
through `planted` and asserts the planted run fails the check the way the criterion says, naming what it says.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | Two agents editing different layers merge cleanly | `merge.test.ts`: alpha's and bravo's patches on revision 0 (each a node and an arrow in its own layer) both apply in either arrival order, to one revision hash, each item in its writer's layer, yours untouched (a hub that refuses the stale second patch, or orders layers by arrival, fails). `deep-canvas merge` of the base, alpha's document and bravo's is `merged`, symmetric, and hashes to the hub's revision; one item changed two ways is a `conflict` naming it (a merge that returns one side, or picks one change, fails) |
| AC2 | Agent A's patch on base r that creates an arrow parented to your node n1, sent after your patch moved n1, is refused with outcome conflict, naming A, you and n1, and leaves the document byte-identical; resent on the new base, it applies; a planted rebase that counts only the IDs ops target applies the first patch and fails | `conflict.test.ts`: the stale patch is `conflict`, `conflict.ids` has `you.n1`, `conflict.writers` is alpha and you, a `stale_base` issue names `you.n1`, rev, hash and canonical bytes unchanged; resent on base 1 it applies. A stale patch parenting to the untouched n2 rebases. `rebase_counts_op_targets_only` applies the first patch and the same check fails, naming it |
| AC3 | Your change survives an agent's undo | `undo.test.ts`: alpha undoes its own patch after you moved n1: its items go, n1 stays where you put it. After your patch takes alpha's tag, alpha's undo of its earlier change to the tag is refused and your change stays. Alpha's undo of your patch is refused (an undo that reverts by path, or by any writer, fails) |
| AC4 | An item of a kind this build doesn't know survives other writers' patches byte for byte, and a patch that targets it is refused with unknown_kind (parity/kernel/unknown-kind-roundtrip.scene) | `kinds.test.ts`: on the scene, your patch and alpha's apply and `bravo.gizmo` reads back strictly equal to the stored item, its JSON text unchanged; bravo's set and delete and your set on it are each refused with `unknown_kind`, the document unchanged |
| AC5 | A document requires the lowest minor of each kind its fields use, so a document that uses no new field opens in the previous release | `kinds.test.ts` (kernel, `test.slab`, whose `corner` came in minor 1; no 2D mark has a minor above 0 at the base): slabs without `corner` require `test.slab@3.0`, with it `3.1`, unset back to `3.0`, and a stored `3.1` with no corner is written `3.0` (a writer that stamps the build's minor fails). Checked `as_build: ["test.slab@3.0"]`, the plain document opens with no issue, no notice and both slabs drawn; the cornered one opens with `corner` skipped by an `unknown_field` notice |
| AC6 | A write acknowledged and then dropped surfaces in the reply or on the next call, never as success (parity/agent/write-readback.scene) | `commit.test.ts`: with `layer_file_fails` on alpha's move, either the move's reply isn't `applied` or alpha's next call (its read-back) lists it in `lost`; the read-back shows the box where the first write put it; the first write is never `lost`; no current revision and no `doc.patched` event holds the move |
| AC7 | Two writers inserting siblings at one spot get distinct order keys seeded from writer and patch, and the merge orders them the same on every machine | `merge.test.ts`: alpha and bravo each insert a node after your n1: distinct base-62 keys between `a0` and `a1`; the same keys, sibling order and revision hash in both arrival orders and a replay. The same insert under four patch IDs doesn't give one key, nor do alpha and bravo under the same four (a key from the neighbors alone, or seeded without the writer, fails) |
| AC8 | An agent's channel or placement that writes a path of an item in your layer is refused with not_your_layer, and your item doesn't move | `layers.test.ts`: alpha's whole revision with a channel targeting `items/you.n1/at/pos/0`, and one with a placement binding `you.n1` to its clip, are refused with `not_your_layer`, the document and n1 unchanged; the same on alpha's own tag is never `not_your_layer`, and the placement there is presented (a hub that refuses every channel or placement, or none, fails) |
| AC9 | A `deep show` patch run from inside an agent's process tree lands in that agent's writer layer, never yours, and its undo leaves your change in place | `undo.test.ts`: `deep show` from alpha's tree creates a box in alpha's layer, its revision stamped alpha and its `doc.patched` event `agent` with alpha's session; your `deep show` move is recorded as you; alpha's undo from its tree removes the box and leaves your move. From alpha's tree a set or delete on your node is `not_your_layer`, and a payload naming you as writer is refused |
| AC10 | Deleting your node that an agent's arrow is parented to applies, hides only the arrow and sends the agent ref_unresolved, and the document doesn't freeze at its last good revision | `layers.test.ts`: your delete of n1 applies and is current; alpha's arrow to n1 stays in alpha's layer but isn't in `draws`, everything else is; alpha's read has exactly one `ref_unresolved`, on that arrow. Then alpha moves the arrow to n2: applied, current (rev 3), drawn, no `ref_unresolved` left |
| AC11 | In a board where test agent A holds 6 items and test agent B 4, A's whole revision of its layer with all 6 is presented and B's 4 stay, by hash; A's revision with 4 of its 6 and no `removes` is refused with unintended_removal naming exactly A's two; a planted diff against the whole document refuses A's first revision, naming B's four, and fails | `layers.test.ts`: bravo's 4 then alpha's 6 by whole revision: presented, created exactly alpha's six, bravo's layer file hash and items unchanged; re-sent unchanged, the document hash is the same; 4 of 6 refused naming exactly `alpha.i5`, `alpha.i6`, the six-item hash kept. On a stored board holding only bravo's four (in bravo's layer), `diffs_whole_document` refuses alpha's first revision with `unintended_removal` naming exactly bravo's four, and the check fails naming each (redrafted after a dispute: see Readings) |
| AC12 | Budgets, on the reference Mac in the local preflight, compared with the merge base: a patch applies in under 2 ms, and merging two 10,000-item documents takes under 200 ms | `budgets.test.ts`: the perf lane's two tasks, valid against the merge base's budgets, and their bench commands exit 0. The issue's numbers: 200 of alpha's patches on a 1,000-item board, the run less the same run with none, per patch, under 2 ms; `deep-canvas merge` of two 10,000-item documents, six merges less one, per merge, under 200 ms (reading and writing the JSON lines included, so the reading is conservative); five runs after a warm-up each, judged as #14's, INCONCLUSIVE off a fit reference Mac |
| AC13 | With writer A's quota at 60 patches a second sending 6,000 valid patches in 1 s and writer B sending one patch at 0.5 s, B's patch is checked ahead of A's later backlog and current at the first latch after its check; A's extra patches are superseded or refused, never applied mid-frame; one FIFO check queue across writers delays B and fails, naming B's patch | `schedule.test.ts`, on the virtual clock (60 Hz, 2 ms lead, 0.5 ms a check): B's patch applies within two check slots of its arrival, ahead of alpha patches that arrived before it, current at the first latch at or after its check; alpha's outcomes are applied, superseded or refused (`over_quota`), some apply, at most 60 in any second, every applied patch current at a latch and after its check, nothing else current. `one_fifo_check_queue` fails the B check, naming B's patch |
| AC14 | The `doc.patched` event is the commit point: a fault fixture kills the hub after a layer file is written by hash and before its `doc.patched` event lands, and after the restart the shown revision is the one before, the record and the shown revision agree, and the orphan layer file is never current; a hub that takes the newest layer file as current shows the lost revision and fails this test, naming it | `commit.test.ts`: two moves of your n1, `kill_after_layer_file` on the second: the run dies answering nothing, the record holds only the first move's valid event, and the second move's layer file is in the state folder, named by no event. Restarted: the shown revision is 1, the record's last, n1 at the first move, the orphan in no `files` and no current revision; a next patch applies on it. `newest_layer_file_current` shows the lost revision and the check fails, naming its patch |
| Proof | Two scripted agents co-authoring one document, with the history shown | `proof.test.ts`: alpha (MCP) draws two nodes, bravo (`deep show` in its tree) adds two arrows, one with temporary ID `~1`, and each edits its own; results carry `achieved`, the real ID for `~1`, `cost_delta` and `undo`; the by-writer lens and each item's history name who made what, with reasons; the record holds four valid `doc.patched` events in order, with writers and sessions; both agent layers are on screen, named and outlined |

The `bad_input` convention is checked once, for the new `deep-canvas merge` subcommand (`merge.test.ts`).

## Readings where the issue and design leave a choice

- **Patches travel through `deep_show` and `deep show`.** The technical design's MCP row: from R2
  `deep_show` "also carries the agent's patches to a document it writes". So a patch call is #393's call with
  `patch` in place of `document`, and an undo with `undo`. You write through `deep show` from your shell,
  outside every agent's tree, which the Writer connection says writes as you.
- **Revision numbers.** A minted document is revision 0; every revision after it is one that became current.
  Tests send each patch on the revision they know, and AC10 reads the re-parent as revision 3.
- **"Naming A, you and n1"** is the conflict's `conflict: {ids, writers}` and a `stale_base` issue on `n1`.
  The design gives a conflict "naming both writers" and an issue's fields hold no writer, so the result
  gains `conflict`.
- **Undo** is a call naming the patch to undo, so the hub can tell an undo from a patch (`undo_conflict` is a
  refusal only an undo has). Undoing an item another writer has since taken, or another writer's patch, is
  refused; the tests accept `undo_conflict` or `not_your_layer`, since both rules apply and the design ranks
  neither, and read what matters: your change survives.
- **"A patch that targets it is refused with unknown_kind"** covers every writer, the unknown item's own
  included, and set and delete alike.
- **AC5 uses `test.slab`.** The lowest-minor rule needs a kind whose later minor added a field; at the base
  only the kernel's `test.slab@3.1` (`corner`, minor 1) has one. "Opens in the previous release" is a check
  as a build with `test.slab@3.0` (`as_build`), with no issue and no notice; the design's rule for a document
  requiring a newer minor (skip the field with a notice) is checked on the cornered one.
- **"Acknowledged and then dropped"** is driven by a fault fixture: the layer file of the second write can't
  be written at its commit. A hub that replies only after its commit never acknowledges it; one that replies
  first must report it in `lost` on the writer's next call. Either passes; `applied` with nothing after fails.
- **AC8's channel** uses the kernel's channel shape at the base, its `target` alone (#389): the marks module
  draws only channels with keys, which the kernel check refuses, so a channel can't be presented at the base
  either way. The test reads the refusal code there; the placement case also checks it's presented on
  alpha's own item.
- **"Sends the agent ref_unresolved"**: the agent reads it on its own `read` (issues on items in its layer).
- **"B's 4 stay, by hash"**: bravo's layer file hash in `files`, unchanged, and its items equal; re-sent
  unchanged, A's revision leaves the document's hash where it was.
- **AC11's planted test was redrafted after a dispute.** The first draft sent bravo's four through the planted
  hub as a whole revision on the board that also holds your two nodes; a hub that diffs every whole revision
  against the whole document refuses that one too (naming `you.n1`, `you.n2`), so bravo's four never land
  and alpha's revision can't name them. The redraft stores bravo's four in bravo's layer of the minted board,
  with nothing else in it, so the planted hub diffs only alpha's first revision, which it must refuse naming
  exactly bravo's four. The planted definition is unchanged; the real tests are unchanged.
- **AC13's clock is virtual** so the run is deterministic and reads no wall time. "Checked ahead of A's later
  backlog" is: B's check ends within two check slots of its arrival (the one in flight, then B's), and at
  least one alpha patch that arrived before B is checked after it. "Extra patches" are those past 60 applied
  in a second; the quota is read on applied patches by their check time. A patch refused for its quota still
  costs a check slot, so a single queue really delays B.
- **AC14's "kills the hub"** is a process that ends at once after writing the layer file (no answer line).
  "The record and the shown revision agree": the shown revision is the record's last `rev`, and holds that
  revision's content.
- **AC12** measures from outside the binary (a run with patches less the same run without; six merges less
  one), never a time the binary reports. A patch is measured on a 1,000-item board, a realistic shared board;
  the issue gives no size.
- **IDs carry their writer's prefix** (`you.`, `alpha.`, `bravo.`), as shared documents' IDs will under
  leases (#642), though no lease is taken here: leases on ID prefixes are #642's.

Not tested, because no criterion asks: dry runs, previews, gestures, coalesce keys, `rows` and `break_out`,
derived items, leases and `lease_held`, suggestions filed on `not_your_layer`, the read cap on patch results,
the five fuzzer laws as generated properties (laws 2 and 4 are checked on fixtures in AC2 and AC1), 3D layers,
and the outline's pixels.

## Upstream tests (the Oracle lane)

The Oracle page links Yjs's `tests/undo-redo.tests.js` (testUndoText, testUndoMap: one user's undo reverts only
that user's changes, another user's later insert survives it, an undo whose content another user has since
overwritten is skipped) for criterion 3, and fractional-indexing's `src/test.js` (`generateKeyBetween`: a key
between two neighbours sorts between them) for criterion 7. Both are ports: `undo.test.ts` follows Yjs's three
cases with writers, patches and layers, and `merge.test.ts` checks keys fall between their neighbours. A
linked test counts only when run against our output (#136); no runner for them exists at the base, so the
Oracle lane is BLOCKED there with one unblock ask, and these tests are the local proof.
