# Acceptance tests for #1415: canvas session states answer with refusal codes

Written first, blind, by a job that never saw an implementation of #1415; none existed. Written from the issue (its body,
Scope, Fields, the nine acceptance criteria, Proof and Not in scope), `docs/technical-design.md`, `docs/canvas-primitives.md`
and the base commit `c21400b43` ("Merge pull request #2828 …"). The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The issue's checkboxes carry no IDs, so AC1 to
AC9 are their order; each test's name starts with its criterion's ID, and each criterion is quoted above its test.

What was read:

- The design: in `docs/canvas-primitives.md`, Document session (the six states, "one table with no default cell … served so
  a writer can read why it was refused", `session_frozen` and `session_closed`), Patch (fields, result, the closed refusal
  codes with "a session's state adds `session_frozen` and `session_closed`"), Revision, Writer layer, Writer connection
  (`retry_after_ms`), Admission and latch, Content key, Item and kind, ID and sub-address, Registry and seal and its
  registries section (what `deep_kinds` lists, hub slots beside registries), Pack and Pack: kinds in any pack, What holds a
  document to its rules. In `docs/technical-design.md`, Lifecycles (the degrade level's ladder), How we know version 0 works
  (Wrong programs, Dogfooding, Generated edges and exact issues, Built to be hard to get wrong), Five ways in, the Building
  blocks table (the Canvas and Screen and panel rows) and Composition (hub slots and `deep.register*`).
- At the base: `crates/deep-show` (`main.rs` `call`, `scenario`, `CanvasSide`; `hub/call.rs`; `shared/calls.rs` `patch`,
  `check_patch`; `frames.rs` `eval`; `registries.rs`; `kinds.rs` `listing`; `Cargo.toml`'s `test-*` features),
  `crates/deep-canvas` (`schedule/mod.rs` `Session::frozen`, `schedule/tests.rs`
  `a_panic_freezes_its_session_alone_until_a_new_revision`, `document/apply.rs` `create`, `document/mod.rs` `CORE_CODES`),
  `scripts/canvas-lint.mjs` (its scope and its refusal of a `feature` cfg in `deep-canvas*` crates), `packages/hub/src`
  (`tools.ts`, `mcp.ts`, `wire.ts`, `plant.ts`, `codes.ts`, `mcp-operations.ts`, `hub-canvas.ts`, `canvas.ts`, `server.ts`,
  `core.ts` `init`/`queue`, `session-state.ts` `mcpHello`), `packages/extension-host/src/host.ts` (`load`, `ready`,
  `start`, `deep.registerCheck`), `packages/contracts/hub-slots.json` and the suites `96`, `393`, `387`, `1725`, `806`,
  `26`, `412`, `200`, `1801`, `1922`, `348`, `1514`.

What the base does (seen in scratch runs of `deep-show run` and in `BASE-FAILURE.txt`, but the slot fills, which were read in
`packages/hub/src/canvas.ts` `shape`):

- No document session has a state. `deep-show run` has no `session_table` and no `close` call (a scenario holding either is
  `bad_input`), no `planted` value of this suite, and deep-show has no `test-boom` or `test-session-call-*` feature.
- A patch whose ops set fields to the values they hold is `applied` as a new revision with the same hash
  (`achieved.unchanged: true`, `undo: []`), and an undo of it is applied as one more.
- A create of an ID the document holds is refused `bad_id`, "ID already exists", with the hash unchanged.
- `eval` (a frame) of a shared document (#96's `docs[…].document`) answers `no_revision`: only a document drawn by whole
  revisions has a scheduler session, so the freeze an operator panic causes (`schedule/tests.rs`) can't reach a document a
  patch writes. A whole revision on a hidden panel answers `not_presented`, reason `hidden`, and still makes a revision.
- Through `deep mcp`: a missing non-nullable field is refused `required` at `/params/arguments/<field>` with no schema; a
  canvas core refusal (`deep_show` or `deep_query` bound to no session, `no_session`) comes back as an ordinary result with
  `isError: false`; every other call of the walk acts. While the hub's core starts, `deep mcp`'s hello waits for the core's
  `ready`, so a call made then answers `unavailable` after 1 s (the hub didn't answer on its socket). The hub hands its
  canvas core none of its installed slot fills, so `deep_kinds` lists `check.kind@1` with no plug-in's check kinds.
- `deep install` of the test plug-in, a check plug-in of 40 kinds, works at the base.

## Run them

```sh
npm ci --ignore-scripts && npm run build --workspaces     # the hub, deep mcp and the CLI
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0      # the same for every cargo call below and inside the tests
cargo build --locked -q -p deep-show -p deep-hook         # the canvas core and the hook client the hub needs
npx vitest run --root tests/acceptance/1415 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1415/tsconfig.json
```

- `states.test.ts` builds deep-show once more with `--features deep-show/test-boom` (same package selection as above),
  copies that binary to a temporary folder, and builds the default again, so the checkout's `target/debug/deep-show`, the
  canvas core the hub runs, stays the default build. `compile.test.ts` runs `cargo check -p deep-show --bin deep-show` twice,
  with each planted-call feature. The tests' cargo calls inherit the environment (and set the two `CARGO_*` values above
  when unset), so run them with the settings the binaries were built with, or the first file rebuilds every crate.
- `mcp.test.ts` starts three hubs (#806's `startHub`, a Claude Code stand-in bound by its hooks, a `deep mcp` bound to no
  session) and `loading.test.ts` three (one to install the test plug-in, then two timed starts). Every home is a temporary
  folder under `/tmp/dh806-*` with `HOME` there, so the real `~/.deepbuild`, `~/.claude` and `~/.codex` are never touched;
  every process is stopped by its PID (#806's `cleanup`). `deep-show run` scenarios use temporary evidence roots, removed
  after each file.
- The files build binaries, start hubs and time a load, so they run one at a time: `scripts/lanes.mjs` needs
  `alone.push('tests/acceptance/1415/')`, as #1725's and #1801's READMEs asked for theirs. This README is the instruction; the
  implementer makes that edit. With `--root` here Vitest writes `node_modules/.vite` in this folder; delete it before
  committing.

## Surface choices

Everything #393's, #96's, #387's, #411's, #412's, #200's and #806's READMEs define stays as it is: `deep-show run`'s
JSON-lines convention and `bad_input`, the scenario (`evidence`, `sessions`, `panels`, `docs` with `document` for a shared
document, `clock` with `at`, `planted`, `calls`), patches and undo (#96), whole revisions (#393), `revisions`, `eval`,
`panel`, `render_back`, `deep_query`, the `deep_kinds` listing (`registries`, a slot row's `fills: [{name, kit}]`), and the
hub world (`DEEP_HUB_TEST_SHOW`, the stand-ins, `deep mcp`). The same calls work on `deep-show canvas`, the canvas core the
hub runs. What follows is added; every name is this job's choice, and the implementation matches it.

### The fixture

The shared board (`helpers.ts` `board`), stored at revision 0 on panel `main`, with alpha's (`sess-alpha`, thread
`thread-alpha`) and bravo's (`sess-bravo`) sessions: layers `alpha-main` (writer `agent:thread-alpha`) and `bravo-main`;
items `door` (a `rect@1` in `bravo-main`), `card` and `tag` (`rect@1`s in `alpha-main`), and for AC1 and AC3 `fuse`, a
`test.boom@1` item in `alpha-main` with `at: "1s"`. Patch IDs are ULIDs `01JB1415P…`, the doc ID `01JB1415D00000000000000001`.

### test-boom (what freezes a session stays as built)

A deep-show cargo feature, `test-boom`, never in a shipped build, that seals a test canvas module (in
`deep-canvas-test-modules`, chosen by the feature as `test-weight` is) with one kind, `test.boom@1`, params `{at: time = 1s}`.
Its one operator runs on each `test.boom@1` item every frame, reads the frame's time (so it runs again at a new time), writes a
value at a frame before `at`, and panics at a frame at or after `at`: the operator panic that freezes a live session, as built
(`schedule/tests.rs`). A frame (`eval`) of a shared document evaluates its current revision in that document's session, live,
so the freeze reaches a document patches write. The suite freezes the board by `eval` at `t: "2s"`, after revision 2 was
evaluated at `0s`; that frame's reply is `outcome: "frozen"` as at the base (or a reply naming `session_frozen` or
`operator_panic`).

### The state table (`deep-show run`: `session_table`)

`{"call": "session_table"}` answers the table:

```json
{"states": ["checking", "live", "refused", "frozen", "hidden", "closed"],
 "calls": ["show", "patch", "undo", "render_back", "query", "frame", "close"],
 "cells": [{"state": state, "call": call, "acts": bool, "code": code | null, "why": text | null}]}
```

- One cell per state and call, 42 in all. A cell either acts (`acts: true`, `code: null`) or refuses with a named `code` and a
  `why` a writer can read. Every refusing cell of `frozen` names `session_frozen` and of `closed` `session_closed`; (frozen,
  patch) and (closed, patch) refuse with them, and so does (closed, close), since closing a closed session does nothing.
- The calls, as the walk makes them: `show` a whole revision (`deep_show` with `document`), `patch` and `undo` (#96), `render_back`
  (a render-back of a revision, the hub's `deep_show` with no document), `query` (#411's `deep_query`), `frame` (`eval`),
  `close` (below). Exactly these seven: the walk can't make a call it doesn't know.
- The table is one Rust `match` over (state, call) with no wildcard arm, in deep-show (the canvas core's binary crate, where
  these calls are served). The states are an enum with the variants `Checking`, `Live`, `Refused`, `Frozen`, `Hidden`,
  `Closed`. It sits in deep-show and not in deep-canvas because AC4's seam is a cargo feature: `scripts/canvas-lint.mjs`
  fails any `feature` cfg in a `deep-canvas*` crate and runs clippy there with `--all-features`, so a feature that makes the
  crate fail to compile would block the lint lane; deep-show is outside that lint's scope and already selects its test canvas
  modules with `test-*` features.

### The planted call (AC4)

Two deep-show cargo features, never in a shipped build: `test-session-call-undecided` adds a call variant `Planted` to the
table's call enum with a cell for every state but `Hidden`; `test-session-call-decided` adds the same `Planted` with a cell
for all six. `cargo check -p deep-show --bin deep-show --features test-session-call-undecided --message-format short` fails
with `error[E0004]` (non-exhaustive patterns), its line naming `Hidden`, since rustc names the pattern not covered (for a
match over the pair, something like `(…::Hidden, …::Planted)`; the enums' own names are the implementer's). The same check
with `test-session-call-decided` passes, so the error is the missing cell alone. A table with a wildcard arm compiles the
undecided call and fails AC4. The first `cargo check` of deep-show checks its dependencies too (cargo keeps check output
apart from build output), so it takes about as long as their build; this job didn't time it.

### `close`, and refusals for a session's state

- `{"call": "close", "doc": doc ID}` closes the document's session, as you closing its panel; when its cell acts it answers
  `{"outcome": "closed", "doc": doc ID}`. Nothing at the base closes a session; this is how a test reaches `closed`.
- A call refused for the session's state answers `outcome: "refused"` (a patch keeps the Patch result's other fields) and
  names its code as its top-level `code` or as an issue's `code` (the walk reads `code`, `reason` and each issue's `code`).
  A `session_frozen` refusal adds `"last_good_rev": <rev>`, the Document session's field: the newest revision whose check
  passed, the one the session froze at. A refusal claims no success and changes no revision.
- `session_frozen` and `session_closed` join the closed refusal list (the issue's Fields), and every new code the core emits
  joins the check catalog (What holds a document to its rules); no test here reads either list.

### A patch that changes nothing (AC6), and a create of an ID the document holds (AC7)

- A patch whose ops leave every item as it was answers with the code `no_change` (top level or an issue), `"hash"`: the current
  revision's hash, `rev` (when it names one) the current revision, no `undo` ops, and an outcome other than `applied`; it makes
  no revision, and an undo of it (`undo: {patch, of}`) applies nothing.
- A `create` of an ID the document holds is refused (`outcome: "refused"`) with an issue `{code: "id_taken", ids: [ID, …],
  actual: {"layer": <the ID's writer layer>, …}}`, and the document's hash is unchanged.
- `planted` values of the scenario, reachable only there: `no_op_commits` (AC6: a patch that changes nothing is committed as a
  new revision, as the merge base does) and `create_overwrites` (AC7: a create of a held ID replaces that item).

### Through `deep mcp` (AC5, AC8, AC9)

- **The canvas tools**: `deep_show`, `deep_query`, `deep_kinds` and `deep_job` (Building blocks: the Canvas row's two, the
  Screen and panel row's `deep_show`, and `deep_job` for jobs). A field is required when its published schema doesn't take
  null (in the strict subset every property is listed in `required`, and an optional one is nullable).
- **`missing_field`**: a call with a required field left out is refused (error@2, `isError: true`) with `code:
  "missing_field"`, `path: "/params/arguments/<field>"`, and `schema`: that tool's input schema, whose `properties` hold the
  same fields as the one `tools/list` publishes, in under 4,096 bytes of JSON.
- **The error flag**: every refusal sets the tool result's `isError`, a canvas core refusal (`outcome: "refused"` or a
  top-level `code`, such as `no_session`) included.
- **`not_ready`**: `deep_kinds` asked before every registry, pack and plug-in has finished loading answers a refusal with
  `isError: true`, `code: "not_ready"`, `loaded` and `total` (integers, `0 ≤ loaded < total`; what they count is the
  implementer's) and `retry_after_ms` (an integer > 0, as `over_quota` names its wait). The hub answers `deep mcp`'s hello
  while it loads, so the call reaches it. Once loaded, `deep_kinds {op: "list", registry: "check.kind@1"}` lists the slot row
  with every check kind an installed plug-in registered among its `fills` (`{name, kit}`), as #200's `installed` gives
  `deep-show run` its fills.
- **The test plug-in** `test/forty` (`fixtures/forty`, installed with `deep install`): its manifest declares 40 check kinds,
  `ext.forty.k01` … `ext.forty.k40`, and its code registers them with `deep.registerCheck`, one every 50 ms, 2 s from its
  start.
- **`DEEP_HUB_PLANT` values**, each a planted hub in `packages/hub/src/plant.ts`'s list: `kinds-op-optional` (AC5:
  `deep_kinds` publishes `op` as nullable while its handler needs it), `kinds-refusal-as-text` (AC9: `deep_kinds` returns its
  refusals as ordinary results, `isError` unset), `kinds-partial-while-loading` (AC8: while loading, `deep_kinds` answers the
  listing as it stands, the kinds registered so far, instead of `not_ready`).

## The walk (AC3)

`states.test.ts` reads the table from the default build, holds it to its shape, then on the `test-boom` build plays, for
every state, a baseline scenario and one scenario per call, each ending with `revisions`:

- **How each state is reached**: alpha's patch P1 makes revision 1 and a frame at `0s` evaluates it; then `live` adds
  nothing, `hidden` hides the panel (`{"call": "panel", "panel": "main", "visible": false}`), `frozen` evaluates a frame at
  `2s`, `closed` closes the session, `refused` sends alpha's whole revision without `tag` and no `removes` (refused
  `unintended_removal`), and `checking` runs on #96's virtual clock (60 Hz, 2 ms lead, 0.1 s a check): P1 at 0, the frame
  at 0.2 s, P2 at 0.4 s, and the walk's call at 0.45 s, while P2 is in its check.
- **The walk's calls**: `show` alpha's whole revision (card, tag with a new box, fuse); `patch` alpha's patch on `tag` with
  base 1; `undo` alpha's undo of P1; `render_back` revision 1 at 0 s, 64 × 36 px; `query` alpha's `deep_query`; `frame`
  `eval` at `0s`; `close` (when its cell acts, followed by a patch, which must be refused `session_closed`).
- **What acting means**: `show`, `patch` and `undo` make a new revision by alpha that `revisions` lists under the reply's `rev`
  (patch and undo answer `applied`, naming their patch); `render_back` answers `presented` with a snapshot in the evidence
  store; `query` answers rows of the board with a `rev`; `frame` answers `evaluated` with nodes run; `close` answers `closed`
  and the patch after it is refused `session_closed`.
- **A refusing cell**: the reply names the cell's code, claims no success (`applied`, `presented`, `evaluated`, `closed`), and
  the revisions are the baseline's.

## The walk through deep mcp (AC5, AC9)

`mcp.test.ts`: the Claude Code session draws #393's small board on `DOC.a` through `deep_show`. Then, for each canvas tool
`tools/list` publishes, from the session's own `deep mcp`: the call with every field at its default (every optional field
null; `doc` the board's document, an enum its first value), the call with each optional field left out, and the call with
each required field left out; and from the `deep mcp` bound to no session, the default call. Acting there means `isError`
unset and: `deep_show` answers `presented` (a render-back of the current revision), `deep_query` answers rows, `deep_kinds` a
listing (`registries`), `deep_job` its `kinds`. AC9 holds every refusal of that walk (a value with `outcome: "refused"` or a
top-level `code`) to `isError: true`, and requires `deep_show` and `deep_query` bound to no session to be refused.

## Timing on a loaded machine (AC8)

The hub listens on its socket before its core starts, and test/forty's code runs only once the core loads extensions, so its 2 s
of registering start after the socket appears. `loading.test.ts` installs test/forty, stops the hub, starts it again and takes
the time the socket appears as 0; a `deep mcp` started and initialized beforehand asks `deep_kinds {op: "list", registry:
"check.kind@1"}` at 0.5 s, every 250 ms after while the answer is `not_ready`, and once more at least 3 s in, after the hub
reported ready. A partial list (some of the 40 missing) fails at any time, naming the first missing kind; any answer other
than `not_ready` or the whole list fails; the last listing must hold all 40. A first answer holding all 40 that came back within
1.5 s of the socket fails (test/forty can't have finished); one that came back later is INCONCLUSIVE: the reading was late,
and the test can't tell `not_ready` from a server that waited. A late reading never passes a wrong program and never fails a
right one; the planted run is INCONCLUSIVE, never passed, when its first reading came late.

## Criteria to tests

| ID | Criterion | Test | Wrong program it fails on | On the base |
|---|---|---|---|---|
| AC1 | A patch to a frozen session is refused with `session_frozen`, naming the last good revision, and changes no revision | `states.test.ts`: P1, P2 (revision 2), frame at 0 s, frame at 2 s (frozen by test.boom@1's panic); P3 is refused `session_frozen`, `last_good_rev: 2`, the revisions unchanged | a canvas core that applies the patch (the base's scheduler unfreezes on a new revision) | FAIL: BLOCKED, deep-show has no feature `test-boom` |
| AC2 | A patch to a closed session is refused with `session_closed` | `states.test.ts`: P1, `close`, then P2 is refused `session_closed`, the revisions unchanged | a core with no `close` (the base) | FAIL: the scenario with `close` is `bad_input` |
| AC3 | Every call in every state either acts or returns a named code: a generated test walks the table | `states.test.ts`: the served table's shape, then the walk over its 42 cells | no served table (the base); a cell whose call answers a success that did nothing, or a code other than its cell's | FAIL: `session_table` is `bad_input` |
| AC4 | A planted call added with no decision for one state fails to compile | `compile.test.ts`: `cargo check` with `test-session-call-undecided` fails with E0004 naming `Hidden`; with `test-session-call-decided` it compiles | a table with a wildcard arm (the undecided call compiles) | FAIL: deep-show has no such feature (no E0004) |
| AC5 | For every published canvas tool, a call with one required field removed is refused with `missing_field`, naming the field and carrying that one tool's schema in under 4 KB; a call with any one optional field removed acts. A planted tool whose schema marks a field optional while its handler needs it fails the walk, naming the tool and the field | `mcp.test.ts`: the walk; `kinds-op-optional` fails it naming `deep_kinds` and `op` | `kinds-op-optional`; the base | FAIL: refused `required` with no schema |
| AC6 | A patch whose ops leave every item's content key unchanged returns `no_change` with the current revision's hash and creates no revision and no undo step. A planted handler that answers success with a new revision number fails, naming the revision | `patches.test.ts`: P1, then a patch setting the card's box and name to what they are, then an undo of it; `no_op_commits` fails naming `rev 2` | `no_op_commits`; the base | FAIL: applied as rev 2, undone as rev 3 |
| AC7 | A patch that creates item `door` in a document that already holds `door` is refused with `id_taken`, naming the ID and its writer layer, and the document's hash is unchanged. A planted handler that overwrites the item fails by hash | `patches.test.ts`: alpha's create of `door`, which bravo's layer holds: refused `id_taken` with `ids: [door]` and `actual.layer: "bravo-main"`, hash unchanged; `create_overwrites` fails by hash | `create_overwrites`; the base | FAIL: refused `bad_id` |
| AC8 | With a test plug-in that takes 2 s to register 40 kinds, a listing asked for at 0.5 s answers `not_ready` with `loaded`, `total` and a retry time, and at 3 s lists all 40. A planted server that returns the partial list fails, naming the first missing kind | `loading.test.ts`: the timed start above; `kinds-partial-while-loading` fails naming the first missing kind | `kinds-partial-while-loading`; the base | FAIL: asked at 0.5 s, answered `unavailable` at 1.5 s |
| AC9 | Every refusal in the walk sets the protocol's error flag. A planted tool that returns its refusal as ordinary text with the flag unset fails, naming the tool | `mcp.test.ts`: every refusal of the walk has `isError`; `kinds-refusal-as-text` fails naming `deep_kinds` | `kinds-refusal-as-text`; the base | FAIL: `no_session` with `isError: false` |

The wrong programs the issue names (AC4's planted call, AC5's planted tool, AC6's and AC7's planted handlers, AC8's planted
server, AC9's planted tool) each have a test that runs them and requires the failure the criterion describes; at the base each
of those tests fails because the plant doesn't exist (the hub refuses an unknown `DEEP_HUB_PLANT` at start, and `deep-show
run` answers `bad_input` for an unknown `planted` value). AC1 to AC3 name none; each fails on the merge base, and the trace
lane's mutants cover the new code.

## Ambiguities, and how this suite reads them

- **Which calls are "session calls"** (AC3): those a writer makes on one document's session in the canvas core: a whole
  revision, a patch, an undo, a render-back, a query, a frame, and closing it. `revisions`, `read` and the record's reads stay
  outside the table. Each state is reached as "How each state is reached" says; `refused` reads as "the newest revision the
  session was sent was refused, its last good revision still current", and `checking` as "a revision in its check when the
  call arrives".
- **"A call to a frozen or closed session is refused with `session_frozen` or `session_closed`"** (the design) is read as: a
  cell of those states that refuses uses that code; whether a read such as `query` acts on a frozen session is the table's.
  The cells the suite pins are the patches (AC1, AC2) and closing a closed session, a success that would do nothing; a frame of
  a frozen session can't act, since a frozen session runs nothing (as built) and acting needs nodes run.
- **"Naming the last good revision"** (AC1) is `last_good_rev`, the revision the session froze at: the suite freezes it at 2 s
  after revision 2 was evaluated at 0 s, so revision 2 is good by any reading.
- **"A patch to a closed session"** (AC2): nothing at the base closes a session, so the suite adds `close`, by you.
- **What freezes a session** stays as built (an operator panic in a live frame); the suite adds only `test-boom`'s kind to
  cause one and needs a frame of a shared document to run in its session.
- **"Acts"** for a call whose only effect is a refusal of its content: the walk's calls are valid in every state, so acting
  means doing what was asked (above); through `deep mcp`, acting means the tool's answer with `isError` unset.
- **"Every field at its default"** (Scope): every optional (nullable) field null, every required one given (`doc` the drawn
  document, an enum its first value); leaving an optional field out must act as the same call.
- **"Carrying that one tool's schema"** (AC5): a `schema` with the same fields as the tool's published one, so a compact
  form without descriptions counts; no other tool's fields.
- **"The walk"** of AC9 is the walk through `deep mcp`, where the protocol's error flag exists; the state walk of AC3 runs on the
  canvas core, whose replies reach agents through `deep_show` and `deep_query`, which that walk calls bound to no session to
  hold a canvas core refusal.
- **"Content key"** (AC6) is read as each item's canonical bytes; the no-op patch sets two fields to the values they hold,
  unchanged under either reading. **"No undo step"**: the reply carries no undo ops and an undo of the patch applies nothing.
- **"Its writer layer"** (AC7) is the layer holding the ID, by its ID (`bravo-main`), not the creating writer's.
- **AC8's "kinds"** are check kinds a plug-in registers through `deep.registerCheck` (the `check.kind@1` slot, "one per
  kind"); **"a listing"** is `deep_kinds {op: "list"}` of that slot; **"a retry time"** is `retry_after_ms`; `loaded` and
  `total` may count kinds or pieces; **"at 0.5 s" and "at 3 s"** are measured from the hub's socket appearing, which precedes
  the plug-in's start (above). `not_ready` is a refusal, so it sets `isError` (Scope: every refusal sets the flag).

## Not covered (no criterion asks)

Serving the state table to agents through the hub (a resource or `deep_kinds`; the walk reads it from the canvas core),
the codes' `deep://codes/<code>` pages and the kit catalog's fixtures for the new codes, `missing_field` for a required field
sent as null, the degrade ladder, and what unfreezes a session.

## Files

- `helpers.ts`: `deep-show run`, the `test-boom` build, the board, the calls, reply readers, the table's shape and the walk.
- `hub.ts`: the hub world (#806's), the walk through `deep mcp`, AC5's and AC9's judges.
- `states.test.ts` (AC1, AC2, AC3), `compile.test.ts` (AC4), `mcp.test.ts` (AC5, AC9), `patches.test.ts` (AC6, AC7),
  `loading.test.ts` (AC8).
- `fixtures/forty/`: the test plug-in (`index.ts.fixture` is renamed `index.ts` when the test copies it).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
