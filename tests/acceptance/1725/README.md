# Acceptance tests for #1725: deep mcp lists neither deep_query nor deep_show's modes, though the canvas core serves both

Written blind, from issue #1725 (its body, Scope, the four acceptance criteria, the Nov 8 amendment's two added criteria, Proof
and Depends on), `docs/technical-design.md`, `docs/canvas-primitives.md` and the base commit `e0c90a5a5`. No implementation
existed. The implementing agent doesn't edit these files; a dispute goes to this job's blind redraft (design: Dogfooding;
AGENTS.md, Proof).

What this job read: in the design, Five ways in, all onto the same core (the MCP tools row: `deep_query`, `deep_show`'s
shots, sheets, turntables, diagnostic modes and readings, every canvas reply's core version and module-set digest, the
strict validators), the Building blocks table and Dogfooding; in the canvas primitives, Render-back (`include: issues |
audit | timing | pixels`, `camera: item ID | pose | view`, `t: time | sheet`, the visible table), Render-back: diagnostic
modes, Geometry audit and Geometry audit: scenes (`scope`, `support`). The suites `tests/acceptance/26` (the MCP client, the
agent stand-in, `strictProblems`, the Strict section), `806` (the hub with its world file, the Claude Code and Codex
stand-ins bound by their hooks, `showArgs`, the figure world), `411` (the `deep_query` call, `mode`, the summary, AC5's
handle binding), `1723` (the hub's canvas core, the floating-crate scene form) and `1732` (`deep-show run`, render-back's
`audit`). At the base: `packages/hub/src/tools.ts` (the schemas and `checkArguments`), `canvas.ts` (`showCall`, the world
`shape`), `hub-canvas.ts` (`show`, `canvasWorld`), `mcp-operations.ts` (`mcpCall`, `bind`), and in `crates/deep-show`
`main.rs` (`call`, `query_call`), `modes.rs`, `query.rs` (`scene_query`, `summary`), `hub.rs` (`show_call`, `audit_of`,
`stamp`), `ask.rs`/`probe.rs` (`render_back`) and `crates/deep-canvas-motion/src/arrange.rs` (`audit`). Issue #1719's own
fixture was not among the inputs; the red-box fixture here is this job's (The fixture, below).

## Run

```sh
npm ci && npm run build --workspaces                       # the hub, deep mcp
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook -p deep-show   # the hub needs deep-hook; deep-show is its canvas core
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1725 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1725/tsconfig.json
```

At `e0c90a5a5` itself `cargo build -p deep-show` fails in `deep-contracts` (its committed `generated.rs` defines two rules
twice); the base run regenerated that file with `npm run generate -w @deepbuild/contracts` first and didn't commit it
(`BASE-FAILURE.txt`).

Node 24, macOS (the hub reads a socket peer's process; the 3D render-back draws on Metal), `git` and `ps` on the `PATH`. No
network, no model, no account. The tests build nothing: `deep-show run` is the canvas core the hub runs, the newer of
`target/release/deep-show` and `target/debug/deep-show` (#1723's `hubCanvasCore`), and a missing build fails `BLOCKED`.
Each test starts its own hub with #806's `startHub` under `/tmp/dh806-*` with `HOME` there, so the real `~/.deepbuild` is
never touched; processes are stopped by PID only (#806's `cleanup`). Each file starts a real hub, so the implementer adds
`tests/acceptance/1725/` to the one-at-a-time list (`alone`) in `scripts/lanes.mjs`; this job writes tests only. With
`--root` here Vitest writes `node_modules/.vite` in this folder; delete it before committing.

## The surface

The tests reach the code only through these:

- **A running hub** (`deep hub run`) with #806's world file (`DEEP_HUB_TEST_SHOW`: both sessions' names, #393's panels, and
  the documents the hub minted, #393's `DOC.a`–`DOC.c`, on the main panel).
- **Two sessions bound by their hooks**, #806's stand-ins: a Claude Code session, whose `deep mcp` binds by its process, and
  a Codex session, whose every call binds by the `PreToolUse` stamped for it (`mcp__deep__<tool>`, the arguments as sent).
  Each speaks to its own `deep mcp` as an MCP client does (`initialize`, `tools/list`, `tools/call`; #26's client).
- **The record** through `events.read` (#26), and the hub's evidence store through `packages/evidence` (#806's
  `readEvidence`). For criterion 3, the Claude Code session's open ask is seeded in the record before the hub starts (#26's
  `seed`), as #806's scenarios seed theirs.
- **`deep-show run`** (#393's scenario: `evidence`, `sessions`, `record`, `panels`, `docs`, `calls`), played in the world the
  hub gives its canvas core: both sessions with their threads and names (`process {pid: 0, start: 0}`, as `canvas.ts` `shape`
  writes them), the world file's panels and documents, and the record's open ask as `{session, state: needs_you}`.

Object-valued arguments go as their JSON text where the tool's schema types the field as a string and not an object (#806's
`showArgs` rule, since a strict schema can't type an open object, so `document` is text), and as objects otherwise. A field
left out reads as null (#26).

### Used as the base defines them

- `deep_show {doc, document, include}`: a whole revision, presented with `outcome`, `rev`, `issues`, `snapshots: [{sha256,
  w, h}]` and a `visible` table, as #806 and #393 define it; `include: ["issues", "audit"]` adds render-back's `audit`
  (#1732).
- A refused argument is a tool result with `isError` holding error@2, with its `code` and the `path` it refused at (#26).
- `deep_query` is #411's call (`tests/acceptance/411/README.md`, `deep_query`) less `session`, which is the binding's: `{doc,
  rev?, what?: rows | summary | why, items?, paths?, at?, cap?, path?, t?}`; its replies are the canvas core's.
- `mode` is #411's field on a `deep_show` call, one of the closed list; a mode call with no document draws the session's
  current revision and mints none (#427), answering `snapshots` with `display_only: true` and the `drawn` rows, a box's as
  `{id, what: box, pos, min, max}` in m.

### Assumed surfaces

The issue leaves these open. Each is this job's choice, the most natural one on the base's call shapes; the implementer
matches it.

1. **`deep_query`'s arguments through `deep mcp`** are #411's call fields as listed above, `doc` required and the rest
   nullable. Its reply is the canvas core's reply for the call made as the bound session, unchanged but for `core` and
   `set_digest` (criterion 1 sets only those apart).
2. **`mode` on `deep_show`** is a nullable string from #411's closed list (`bounds`, …), sent with no `document`: `{doc, mode:
   "bounds", t: "0s", include: ["issues", "pixels"]}`. The reply is the canvas core's mode reply.
3. **The contact sheet field is `sheet`**, an object `{views: [view]}` whose views are named `front`, `back`, `left`,
   `right`, `top` and `three_quarter` (the design's Render-back takes `camera: … | view` and `t: time | sheet`; the issue's
   Scope names "sheets" as a field). It is sent with no `document`, as a render-back of the session's current revision:
   `{doc, sheet: {views: [the six]}, include: ["issues", "pixels"]}`. The reply is presented with one entry in `snapshots`
   per view, each `{sha256, w, h, view, visible}`: `view` the view's name and `visible` that view's own visible table, rows
   `{id, box}` as the base's top-level table.
4. **The resting gap is a row of render-back's `audit` include**, the surface #411's `deep_show` already defines (the design's
   Render-back request `include: … | audit`; the base answers `audit: {failures}` there, #1732): `audit.support` is a list
   with one row per 3D item, `{id, gap}`, `gap` the distance in m the item would fall along gravity before it meets what lies
   under it (null when nothing does). Read on a deep_show of a whole revision with `include: ["issues", "audit"]`.

## The fixture

- **The red box** (`helpers.ts`, `redBox`), an agent's own 3D document (no layers, no item layer), metres with +Y up as
  #1723's scenes: a camera (`camera@1`, the document's `camera`), a sun (`light.sun@1`), a red material (`material@1`,
  base colour 0.8, 0.05, 0.05), a 2 × 0.1 × 2 m slab centred at y 0.05 m (its top at 0.1 m), and a 0.4 × 0.3 × 0.2 m box in
  the red material resting on it, centred at (0.5, 0.25, 0.3) m: off the slab's centre on x and z, so no two of the six
  named views frame it alike. Five items. **The planted twin** (`redBox(0.2)`) lifts the box 0.2 m: its bottom at 0.3 m, a
  0.2 m gap above the slab's top.
- **The gate board** (`gateBoard`), criterion 3's: #411's AC5 board as an agent's own document, a gate whose fill a status
  binding reads from the Claude Code session's open ask, and a caption.

## Criteria

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] `
dropped (the command in `tests/acceptance/48/README.md`). One test per criterion; each name starts with its ID.

| ID | Criterion | Test | Wrong program it fails on | On the base |
|---|---|---|---|---|
| `#1725.6bd3c6a3` | Through a running hub and `deep mcp`, with a session bound by its hooks, `deep_query` with `what: summary` on a document the session drew answers, apart from `core` and `set_digest`, what `deep-show run` answers for the same call. On the merge base `deep_query` is not in the tool list and the test fails, naming it. | `summary.test.ts`: the Claude Code session's `tools/list` holds `deep_query`; it draws the red box on `DOC.a` and asks `{doc, what: summary}`; the reply less `core` and `set_digest` equals `deep-show run`'s for the same two calls by the same session | a hub without `deep_query` (the base); one that forwards the call as no session or another, or reshapes the canvas core's reply | FAIL: `deep_query is in deep mcp's tool list … it is not` |
| `#1725.cdf8a813` | `deep_show` with `mode: bounds` on that document answers with a `display_only` snapshot and its numbers. On the merge base it is refused `unlisted_field` at `/params/arguments/mode`. | `bounds.test.ts`: after the red box is drawn, `{doc, mode: bounds, t: 0s, include: [issues, pixels]}` is presented; every snapshot is `display_only`, a PNG in the hub's evidence store under its hash; `drawn` gives the red box's bounds (0.3, 0.1, 0.2)–(0.7, 0.4, 0.4) m and the slab's (−1, 0, −1)–(1, 0.1, 1) m within 1e-6 | a schema without `mode` (the base); a hub that drops `mode` and answers the plain render-back (no `drawn`, no `display_only`) | FAIL: `refused unlisted_field at /params/arguments/mode` |
| `#1725.9bb6c26d` | `deep_query` on a document another session wrote answers only that session's layer as the binding allows, as #411's suite reads it through `deep-show run`. | `binding.test.ts`: the Claude Code session draws the gate board bound to its own open ask; the Codex session's `deep_query {what: rows, paths: [gate fill], at: [0s]}` equals `deep-show run`'s for the Codex session (less `core`, `set_digest`), its rows are the gate and the caption, all in the layer the record holds the Claude Code session's revision in, and the gate's fill is `[null]` with `ref_unresolved` on the path and the gate's row, `needs_you` nowhere; the Claude Code session's own query equals `deep-show run`'s for it and reads the value | the base (no `deep_query`); a hub that binds the call to the writer's session, to you or to the first stamp (the value leaks) | FAIL: `deep_query is in deep mcp's tool list … it is not` |
| `#1725.fb4e8d7a` | Every listed tool's schema passes the strict-validator test #26 runs; a planted schema with `anyOf` fails it, naming the tool. | `strict.test.ts`: #26's `strictProblems` over every tool the session's `deep mcp` lists finds nothing; the same list with deep_show's `mode` planted as `anyOf` (a nullable enum) fails it with a line starting `deep_show` and naming `anyOf` | a list with a schema outside the strict subset; a validator that misses `anyOf` | PASS: the base's list is strict (it lists no `deep_query` and no `mode`) |
| `#1725.8867fb84` | `deep_show` with a contact sheet of the six named views (front, back, left, right, top and three-quarter), on the red-box fixture of #1719, returns one snapshot per view, each with its own `visible` table, from one call. On the merge base the field is refused at `/params/arguments`. | `sheet.test.ts`: after the red box is drawn, one `{doc, sheet: {views: [six]}, include: [issues, pixels]}` is presented with six snapshots, one per view by `view`, six distinct hashes, each with a `visible` table holding the red box, no two tables alike | a schema without the field (the base); one snapshot drawn six times, or one visible table copied to every view | FAIL: `refused unlisted_field at /params/arguments/sheet` |
| `#1725.52debd6c` | The geometry audit's scene scope (Geometry audit: scene, `support`) is reachable as a reading through `deep mcp`, as `deep_show`'s `audit` include or a `deep_query` row, whichever #411's surface already defines. It gives each 3D item's resting gap below it in m. A planted box 0.2 m above the slab reads 0.2 within 1e-6, and `deep-show run` gives the same number. The reading never passes a claim; `geometry.audit` through #1723 does. | `gap.test.ts`: the session draws the twin with `include: [issues, audit]`; `audit.support`'s row for the red box reads 0.2 within 1e-6; `deep-show run` for the same call gives it within 1e-9; the reply's `result` isn't PASS and the record gains no `verdict.made` | the base, whose audit gives `failures` only; a gap from the authored position of another item, or from the box's top | FAIL: `the reply's audit reading gives each 3D item's resting gap (audit.support): audit is {"failures":[…]}` |

The issue's Proof asks for the base's missing tool and refused mode beside the branch's replies, and the strict-validator
run: `BASE-FAILURE.txt` holds the base's side.

## Readings where the issue leaves a choice

- **"A session bound by its hooks"** is #806's: the stand-in sends SessionStart, UserPromptSubmit and a first PreToolUse
  from hook processes that are its children, and its `deep mcp` is its child too.
- **"What `deep-show run` answers for the same call"** is the reply to the same calls, made as the same session, by the
  canvas core the hub runs, in the world the hub hands it: the session's deep_show of the document, then the query.
- **"That document"** (criterion 2) is criterion 1's red box, drawn by the same session; the mode call carries no document.
- **"Another session wrote"** (criterion 3): the Claude Code session writes the board, the Codex session reads it. **"As the
  binding allows"** is #411's AC5 rule: a value read through a handle the calling session can't read is never returned. The
  Claude Code session's own query is the twin that shows the value is there to read.
- **"Each with its own `visible` table"** is a table on each view's snapshot, and no two alike: with the box off the slab's
  centre on both x and z and not a cube, any two of the six views frame it differently.
- **"Reads 0.2 within 1e-6"** is `|gap − 0.2| ≤ 1e-6`; **"the same number"** is `deep-show run`'s gap within 1e-9 of the
  hub's.
- **"The reading never passes a claim"** is read as the reading's reply carrying no PASS and the record gaining no
  `verdict.made` from it; `geometry.audit` through a claim is #1723's suite.

## Not covered (no criterion asks)

`deep_query`'s series, provenance and diffs, its why and its row cuts through the hub (#411's suite covers them on
`deep-show run`), its description's generation from the Building blocks table (#26's drift test covers every listed tool),
frames and turntables on `deep_show`, the other modes, and `deep_job` (#410's).

## Files

- `helpers.ts`: criterion IDs, the red box and its twin, the gate board, the world (#806's hub and stand-ins, the seeded
  ask), the deep_* calls through a session's `deep mcp`, the same calls on `deep-show run`, reply readers.
- `summary.test.ts`, `bounds.test.ts`, `binding.test.ts`, `strict.test.ts`, `sheet.test.ts`, `gap.test.ts`: one per
  criterion, in the issue's order.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
