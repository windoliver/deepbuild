# Blind redraft of #96's AC6, AC9, AC14 and Proof

A blind redraft, written for #1412, of four of #96's criteria ("Documents several agents write: patches by writer, history,
and a merge by ID"). It was written from the issue, the current design at base `118ec119f` (origin/main) and the
base code, in a fresh GitHub clone that held no other branch, PR or diff. It replaces nothing in `tests/acceptance/96/`,
the first draft, which stays as it is. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- Issue #96: its scope, its Patch, Writer layer, Provenance and Writer connection fields, its fourteen criteria and
  its proof line.
- `AGENTS.md` (Proof).
- The design sections the issue names. `node scripts/design-section.mjs --issue 96` answers BLOCKED because #96 is
  closed and isn't among the open issues it reads, so each section was printed by its anchor instead:
  `docs/canvas-primitives.md#patch`, `#revision`, `#writer-layer` and `#writer-connection`;
  `docs/technical-design.md#provenance` and `#socket-roles-and-contract-versions`. The event catalogue and the
  projections table were also read (`doc.patched {doc, rev, patch, writer, achieved}`, which feeds "an item's
  history and the by-writer lens", and the `documents` projection `{doc, rev, writer, hash}`).
- The published contracts `packages/contracts/schemas/doc.patched@1.json` and `doc.patched@2.json`. @2 "adds the
  revision's hash and the writer layer it went into (#806)": `data.hash`, `data.layer` (pattern
  `^[a-z]+-[0-9a-f]{12}$`) and `data.thread`. Its fixture is `packages/contracts/fixtures/doc.patched@2/01.json`.
- The first draft `tests/acceptance/96/`: its README, helpers, `commit.test.ts`, `undo.test.ts`, `proof.test.ts` and
  fixtures. Its surfaces, its fixtures, the numbers it uses and the values it expects are all kept here, except where
  the list of departures below says otherwise.
- At the base: `crates/deep-show` (`deep-show run`, the scenario binary for the hub's canvas side: `src/shared.rs`,
  `src/shared/calls.rs`), `crates/deep-canvas/src/show.rs` (`Writer::layer_id`) and `packages/hub/src/canvas.ts`
  (the real hub records `doc.patched@2`).

## Run them

```sh
source ~/.nvm/nvm.sh && nvm use 24
npm ci && npm run build --workspaces       # once
cargo build --locked --bin deep-show       # first, on a loaded machine; each file's beforeAll runs it again (cached)
NO_COLOR=1 npx vitest run --root tests/acceptance/96-redraft-1412 --no-file-parallelism --testTimeout=60000
npx tsc -p tests/acceptance/96-redraft-1412/tsconfig.json   # type-check
```

Each test makes its own temporary evidence root and hub state folder, and deletes both afterwards. Tests reach
`deep-show` only through `deep-show run` (JSON lines), and the contracts package only through its public entry
(`validate`). The surface they read is the first draft's, as its README defines it: patch, undo, `read`,
`revisions`, `history`, `by_writer` and `screen` calls; the `state` folder with `layers/` and `record.jsonl`; the
`fault` values `layer_file_fails` and `kill_after_layer_file`; and `planted: "newest_layer_file_current"`.
`BASE-RUN.txt` is the one run on the base.

## Criteria to tests

Test names start with the same tags the first draft uses: `AC6`, `AC9`, `AC14`, and `Proof:` on the describe block.

| ID | Criterion | Tests |
|---|---|---|
| AC6 | A write acknowledged and then dropped surfaces in the reply or on the next call, never as success (parity/agent/write-readback.scene) | `commit.test.ts`. (1) The first draft's test: `layer_file_fails` on alpha's move. Either the move's reply says it didn't land, or alpha's read-back lists it in `lost`. The box stays where the first write put it, the first write is never `lost`, no current revision holds the move, and the record has only the first write's event. (2) New: alpha's next call is a patch, not a read. The move surfaces in its own reply or in that patch's reply. The next patch applies, and the record holds the two writes that landed and nothing of the move. |
| AC9 | A `deep show` patch run from inside an agent's process tree lands in that agent's writer layer, never yours, and its undo leaves your change in place | `undo.test.ts`. The first draft's two tests: (1) `deep show` from alpha's tree lands in alpha's layer. Its revision is stamped alpha, and its event is `agent` with alpha's session. Your move is recorded as you. Alpha's undo from its tree removes the box and leaves your move. (2) From alpha's tree, a set or a delete on your node is `not_your_layer`, a payload naming you as writer is refused, and the hash doesn't change. Added to (1): your event's session is `null`; the undo is recorded as alpha with alpha's session; and an event at `v: 2` must name the right `layer` and `thread`. |
| AC14 | The `doc.patched` event is the commit point: … | `commit.test.ts`. The first draft's two tests: (1) Two moves of your n1 with `kill_after_layer_file` on the second. The run dies answering nothing, the record holds only the first move's valid event, and the second move's layer file is in the state folder with no event naming it. After the restart, the shown revision is 1 and is the record's last, n1 is at the first move, the orphan is in no `files` and in no current revision, and a next patch applies. (2) The planted `newest_layer_file_current` shows the lost revision, and the same check fails, naming patch `P(2)`. New: (3) after the restart, the record's last event carries its revision's hash, and that hash equals the shown revision's `hash`. |
| Proof | Two scripted agents co-authoring one document, with the history shown | `proof.test.ts`: the first draft's script and checks. Alpha (MCP) draws two nodes, bravo (`deep show` in its tree) adds two arrows (one with `~1`), and each edits its own. The checks cover `achieved`, `ids`, `cost_delta` and `undo`; the by-writer lens; both items' histories with reasons; four valid `doc.patched` events in order, with writers and sessions; and both agent layers on screen, named and outlined. Added: bravo's first patch's `achieved` (`{path@1: 2}`), and `layer` and `thread` on `v: 2` events. |

## Departures from the first draft, and why

1. **The record is read by the version each event names, `doc.patched@1` or `@2`.** The first draft validated
   every event as `doc.patched@1`. The base publishes `doc.patched@2`, which "adds the revision's hash and the
   writer layer it went into (#806)", and the real hub writes @2 (`packages/hub/src/canvas.ts`: "records each
   revision it makes as doc.patched@2"). An @2 event fails @1's closed `data`, so `expectValidPatched` validates
   each event against `doc.patched@<v>`, for v in 1 and 2.
2. **AC14 adds a check that the event carries the revision's hash** (third AC14 test). The Revision section says
   "The `doc.patched` event carries the revision's hash" and "A fault fixture kills the hub between the two, and
   the record and the shown revision must agree". The first draft compared the shown revision with the record by
   `rev` and content only. This redraft also requires the record's last event to carry `data.hash` (the field @2
   defines), equal to the restarted read's `hash`. It is a separate test so the first draft's checks still read
   on their own.
3. **The fixture board's layer IDs follow the @2 layer pattern.** @2's `data.layer` has the pattern
   `^[a-z]+-[0-9a-f]{12}$` ("The writer layer it went into, from the connection"). The first draft's IDs
   `you-main`, `alpha-main` and `bravo-main` can't appear in a valid @2 event. They are renamed to the IDs the hub
   derives from each writer: `<kind>-<first 48 bits of SHA-256 of the writer text>`, which are `you-231b11069cb5`,
   `agent-cbdef1d2df05` and `agent-206b7a586a9c`. The last two match @2's own fixture. Nothing else in the board
   changes, and every test finds a layer by its `writer`, never by its ID.
4. **AC9 and Proof check `layer` and `thread` when an event is @2.** @2 has "`layer`: The writer layer it went
   into, from the connection" and "`thread`: An agent writer's thread, from the binding; null for you". Socket
   roles says "what it draws lands in that agent's writer layer". So an @2 event of alpha's `deep show` patch must
   name alpha's layer and `thread-alpha`, and yours must name your layer and `thread: null`. @1 events carry
   neither field and are only checked as before.
5. **AC6 counts `no_change` as a success reply.** The current Patch result adds `no_change` ("A patch whose ops
   leave every item's content key as it was answers `no_change` …"). The dropped move changes the box's
   position, so a `no_change` reply would claim it already holds. Only `refused`, `conflict` or `superseded` count
   as the move's reply saying it didn't land, as in the first draft. `applied` must be followed by `lost`.
6. **AC6's second test, where the next call is a patch.** The criterion says "on the next call", and the first
   draft's `lost` field is on "the writer's next reply to that document (a patch, undo, whole revision or `read`
   …)". The first draft only exercised the read. The Revision section's "a patch's reply and a hook call wait for
   no sync" is why an acknowledged write can still be dropped.
7. **Small additions in AC9 and Proof.** These are values the issue and the first draft's own surface already
   define: your event's `session` is `null`, the undo is recorded as alpha's, and bravo's first `achieved`.
8. **Only `deep-show` is built.** These four criteria never call `deep-canvas`. The build hook allows an hour
   because the machine is loaded.

Read and left as they are: the Revision text "A restart that can't read a layer file, or whose rebuilt document
hashes differently, stops that one document with an issue naming it". Neither AC14 nor any other criterion here
names it, and the first draft has no surface for it.

## Base run

`BASE-RUN.txt` holds the one run at `118ec119f`, with the checkout path written as `<checkout>` and home folders
as `~`. The load average was about 190. 7 tests pass and 1 fails:

- AC6: both tests pass.
- AC9: both tests pass. Every event at the base is `v: 1`, so the @2 `layer` and `thread` checks didn't apply.
- Proof: passes.
- AC14: the restart test and the planted test pass. The hash test (departure 2) **fails**: the record's last
  event has no `data.hash` (`expected undefined to be defined`, `commit.test.ts:109`). At the base, the commit in
  `crates/deep-show/src/shared/calls.rs` (`fn commit`) writes `"v": 1` with `data: {doc, rev, patch, writer,
  achieved}` only. The real hub's `packages/hub/src/canvas.ts` records @2 with `hash`, but the scenario binary's
  record that these tests read doesn't. Making it pass means the scenario binary writes `doc.patched@2` with
  `hash`, `layer` and `thread`.
