# Acceptance tests for #1721: on a live hub, an agent can't patch the document it just drew

Written first, blind, from issue #1721 (updatedAt 2026-11-23T19:58:55Z: its report, Scope, three acceptance criteria, Proof and
Depends on), the design sections it links and base commit `c8d9684f0` (`main`, "Merge pull request #3268 …"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
this job's blind redraft (design: Dogfooding). Lean: one test per criterion, in one file.

## What was read

- `docs/canvas-primitives.md`: Patch (its fields, ops, result and refusal codes; "recorded as one `doc.patched` event … per call
  for an agent") and Revision ("The `doc.patched` event is the commit point"; a restart rebuilds each document from it).
- The sibling suites whose surfaces this issue builds on: `tests/acceptance/806/` (the hub in a temporary home, its stand-ins,
  `deep mcp`), `96/` (patches, writer layers, `read`), `1725/` (deep_* calls through a hub, 3D documents), `26/` (the socket and
  the MCP client), `1720/` and `1515/` (a hub stopped by PID and started again on one home), `1722/` and `3017/` (a 3D
  render-back and its `visible` table).
- At the base, to learn the surface and never for expected values: `packages/hub/src/hub-canvas.ts`, `canvas.ts`,
  `mcp-operations.ts`, `mcp.ts`, `tools.ts` (the deep_show schema), `server.ts` (the app hello), `packages/contracts/schemas/doc.patched@2.json`,
  and in `crates/deep-show` `canvas_side.rs`, `shared.rs`, `shared/calls.rs`, `ask.rs` and `probe.rs` (`render_back`).

## The base

With no world file the hub gives its canvas core each document as `{panel}` only (`canvas.ts`, `shape`), so a whole revision is
presented at revision 1 and recorded (`doc.patched@2`, rev 1, its canonical document in evidence), and the next patch to the same
doc ID is refused `ref_unresolved` at `doc` ("no shared document has this ID"). All three tests fail there, at the patch, naming
that code and path (`BASE-FAILURE.txt`).

The calls and readers were tried at the base beyond that point, in a scratch test since removed. On a hub whose world file seeds
the document, the same calls give what the first two tests ask: the patch applied at rev 2, the box's `visible` box from
[124.9, 84.9, 70.2, 70.2] to [189.7, 84.9, 75.6, 70.2], the second session's item in its own layer and both layers in `read`.
With no world file, the same session's next deep_show after a hub restart is bound and presented. So nothing but the document
stands between the base and these tests.

## Run

```sh
npm ci && npm run build --workspaces      # the hub, deep mcp
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  cargo build --locked --bin deep-show --bin deep-hook     # the hub's canvas core; a hub needs deep-hook to start
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1721 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1721/tsconfig.json
```

Node 24, macOS (the hub reads a socket peer's process; a 3D render-back draws on Metal). No network, model, account or timing.
The tests build nothing; the hub runs the newer of `target/release/deep-show` and `target/debug/deep-show`. Each test starts its
own hub with #806's `startHub` under `/tmp/dh806-*` with `HOME` there, so the real `~/.deepbuild` is never touched; processes are
stopped by PID only (#806's `cleanup`; `restartHub` stops the hub the test started). Timeouts: 300 s a test, 900 s a hook. A run
with `--root` here leaves Vitest's `node_modules/.vite` in this folder; delete it.

The folder runs alone by its own `lane.json`, which lands with its suite (`scripts/lanes-lists.mjs`, #1327), so `scripts/lanes.mjs`'s
`alone` list needs no line for it.

## The surface under test

Nothing here is invented for the implementation to build. The tests reach the code only through:

- **`deep hub run`** in a temporary `HOME`, with `DEEP_HUB_TEST_SHOW` unset (no world file), stopped by SIGTERM to its own PID and
  started again on the same `HOME`.
- **Claude Code sessions bound by their hooks**: #806's stand-ins, each a process of its own whose `deep mcp` is its child. The
  same process and the same `deep mcp` live through the restart, and send one `PreToolUse` hook before the next call.
- **`deep_show` through `deep mcp`**, as `deep mcp` lists it at the base: `{doc, document, t, size, include}` (a whole revision),
  `{doc, patch}` (#96's Patch, as its JSON text) and `{doc, rev, t, size, include}` (a render-back). Doc IDs and patch IDs are ULIDs.
  A refusal is a tool result that holds the reply.
- **The replies** as #96, #393 and #3017 define them: `outcome`, `rev`, `issues: [{code, path, …}]`, and a 3D render-back's
  `visible: [{id, box: [x, y, w, h], …}]`.
- **`read`**, #96's call, through the hub's `canvas.user` on an app connection holding the control token (how the app plays a
  canvas call on the hub), read by #96's own `shown`, `layerOf` and `writerOf`.
- **The record** through `events.read` (#26) and the evidence store's public reader (#806's `readEvidence`).

The test-side names (`draw`, `patched`, `visibleBox`, `readDoc`, `restartHub`, the item IDs `box` and `second-label`, the session labels)
are this job's and reach no product code but as IDs.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text (`criterionId`, `scripts/proof-change.mjs`). All in `patches.test.ts`.

| ID | Criterion | What the test asserts | Wrong programs it fails on |
|---|---|---|---|
| `#1721.ec24a571` | Through a running hub with no world file, `deep_show` with a whole revision and then a patch to the same doc ID, based on that revision: the patch is `applied` at rev 2, and a render-back at rev 2 shows the moved item's `visible` box shifted right. On the merge base the patch is refused with `ref_unresolved` at `doc` and the test fails, naming it | The one-box scene presented at rev 1 and rendered back at rev 1; the issue's patch (`set items/box/at/pos` to [1, 0.5, 0], base 1) answers `applied` at `rev` 2; a render-back at rev 2 shows the box, both its edges more than 40 px right of rev 1's (1 m is 64 to 70 px there) | The merge base (refused `ref_unresolved` at `doc`, which the failure names). A hub that applies the patch to a fresh, empty document (the set names no item, or the render-back shows no box); one that opens every document empty and keeps that empty envelope (the scene's `camera` unresolved, rev 1 not presented); one that numbers the patch's revision from 0 (rev 1); one that answers `applied` and renders rev 1 back |
| `#1721.d05285db` | A second session's patch to that document lands in its own writer layer, and `read` lists both layers, as #96's suite reads them through `deep-show run` | The second session's `create` on base 1 is `applied` at rev 2; `read` at rev 2 has exactly one layer by each session's writer (`agent:<thread>`), `second-label` in the second's and `box` in the first's, both layers in `files`, both items in `draws` | The merge base. A hub that merges the second session's items into the first's layer, or takes the box into the second's; one that shows the second session a document of its own (`box` gone); one that writes as you or as the first session |
| `#1721.560ffc8c` | A hub restart between the revision and the patch still applies the patch, from the record | Rev 1 presented, rendered back, and held by the record (`doc.patched` rev 1, its canonical document in evidence by hash); the hub stopped by PID and started again on the same `HOME`; the first session's patch on base 1 answers `applied` at `rev` 2; a render-back at rev 2 shows the box moved right of where rev 1 drew it before the restart; the record's newest `doc.patched` about the document is rev 2 with the patch's ID | The merge base. A hub that keeps the document only in memory (refused); one that reopens rev 1 as a stored revision 0 (the base refused as `stale_base`, or rev 1 answered); one that gives the reopened box to no writer or another's (`not_your_layer`); one that redraws rev 1 after the restart; one whose patch is never recorded, so the next restart loses it |

## Readings

- **"With no world file"** is `DEEP_HUB_TEST_SHOW` unset. **"The same doc ID"** is a fresh ULID per test, which deep_show names first
  in the whole revision.
- **"Shifted right against rev 1's"** compares with rev 1's render-back made before the patch, so a program that renders the current
  revision for any `rev` isn't measured against itself.
- **"A second session's patch to that document"** creates an item, since a patch to the first session's item is `not_your_layer` by #96.
  It is a 2D `rect@1`, as #96's patches create; #96 covers no 3D create, and the base's canvas core refuses a patch that creates a
  `mark.box@1` with `module_missing` on a document its world file seeds too, which is not this issue's.
- **"From the record"** is read as: the record held revision 1 before the stop, and holds the patch's revision after it. The tests
  don't say how the hub rebuilds the document, nor forbid a cache beside the record.

## Not covered (no criterion asks)

Undo and history through the hub (the Scope's "undo, history and `read` work … as #96 defines them"; the criteria name `read` only),
conflicts and rebases, `deep show` from the CLI, the app's drawing of a patched revision, and a hub with a world file (#806's suite).

## Files

`helpers.ts` (the world, the scene, deep_show and its readers), `patches.test.ts`, `tsconfig.json`, `lane.json`, `BASE-FAILURE.txt` (the run at the base).
