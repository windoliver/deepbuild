# Acceptance tests for #393: deep_show for agents

Written first, from issue #393 (its scope, the Render-back, Revision, Writer layer and Band fields, its nine
acceptance criteria and its proof line), its Oracle page (`doneright/oracles/issues/393.md` in
`DeepBuildAI/deepbuild`, branch `doneright`, which says no upstream test checks any of the nine criteria), the
design sections it names and those they lean on, and base commit `4c6bba5` ("Merge pull request #658 …
feat/394-salience-sheets"), by a job that never saw an implementation; none existed. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read:

- `docs/technical-design.md`: the deep CLI and MCP tools rows (line 81, and 429: `deep_show` returns the
  document's issues, its audit and snapshots and "a picture is never proof"; `deep show --check --snap`); the
  read cap of 8,192 characters (157); Socket roles and contract versions (835, with the binding, "a call that
  binds to no session … never claims, asks, draws or attaches evidence", and the peer check, 837); The canvas
  core (1041); Patch (1467: a whole revision names what it removes or is refused with `unintended_removal`);
  Render-back (1491) and Document check (1499); Dogfooding (2508) and Tests written first (2539).
- `docs/canvas-primitives.md`: Conventions (7), with Handles (46: "Any other handle is `ref_unresolved` for
  that writer … no snapshot … shows a value its receiver couldn't read") and Order keys (53: "2D draws by
  writer-layer band, then layer order, then item `order`"); Document envelope (291), Item and kind (321), ID
  (393), Writer layer (428), Patch (451, its result with `truncated: {shown, total, by_code}` and its closed
  refusal codes), Revision (468), Lease (483); section 4, The trusted compositor (646): Writer connection
  (650), Document session (671), Admission and latch (693: `deep_show → presented | refused |
  not_presented(hidden | timeout)` within 2 s), Frame clock (713), Frame callback (746), Band (761), Question
  card (775), Meter and degrade ladder (895: canonical renders, render-back snapshots among them, run at fixed
  quality), Render-back (924) and its diagnostic modes (939); Image `image@1` (1762), Bound value (2128),
  Status binding (2167), Marker (5209); What holds a document to its rules (8155: issues errors first and then
  by code and ID, inlined up to the read cap, `truncated` when cut, every issue kept as evidence by hash; "A
  picture explains and never proves") and Check input (8159).
- At the base: the earlier blind suites `tests/acceptance/389/`, `391/`, `392/`, `394/` (their READMEs,
  helpers and BASE-FAILURE files) and `318/`; `crates/deep-canvas` (the `deep-canvas` binary: document check,
  canonical bytes, revision hash, apply as a writer), `crates/deep-canvas-marks` and `crates/deep-marks-render`
  (`deep-canvas-render`, GPUI offscreen Metal, images read by hash from a store), `packages/evidence` (the
  evidence store and its `<2 hex>/<62 hex>` file layout), `packages/record`, `packages/asks`, `packages/cli`,
  `packages/contracts/schemas` (`claim.made@1`, `doc.patched@1`, `check@1`), `scripts/lanes.mjs` and
  `vitest.config.ts`. The base has no hub daemon, no MCP server, no `deep show` command, no question card
  drawing and no verdict engine for claims, so these tests define the surface below.

## Run them

Like #391's, #392's and #394's suites they build a cargo binary, so they run with `--no-file-parallelism`
(`scripts/lanes.mjs` needs its exclude and its one-at-a-time line widened to this folder, as those suites'
READMEs say for theirs):

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/393 --no-file-parallelism
npx tsc -p tests/acceptance/393/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first runs `cargo build --locked --bin deep-show` in the checkout (cached after the first file) and
fails each of its tests when the build fails. Each test opens an evidence store in a temporary folder and
deletes it. The tests use only node built-ins and vitest, and read the evidence store through its public entry
(`packages/evidence/src/index.ts`: `openEvidenceStore`, `connect(…).put`, `read`). A run with `--root
tests/acceptance/393` leaves Vitest's cache in `tests/acceptance/393/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base: every test fails there because no `deep-show` bin target exists.

`card.test.ts`'s two pixel tests (criterion 8) draw the window with GPUI's offscreen Metal renderer, as #391's
and #392's GPU tests do: off macOS, and whenever `deep-show screen` answers `unsupported_platform`, they fail
with a message that starts `INCONCLUSIVE:`; they never pass there. Everything else runs on every platform:
render-back snapshots render in the headless canvas worker, with Vello CPU for 2D (Render-back), so they need
no GPU and no app.

## The surface under test

The issue names `deep_show`, `deep show --check --snap`, render-back, revisions, writer layers and bands, but
no code API, and the hub that would serve them doesn't exist at the base. So these tests define the smallest
surface they need: one binary, `deep-show` (found at `target/debug/deep-show`, in whichever workspace crate the
implementer puts it), whose `run` subcommand plays a scenario of calls against the hub's canvas side (deep_show
and `deep show` with their replies, the revisions they make and the bands on screen) and whose `screen`
subcommand also draws the window that scenario leaves. The scenario stands in for what the hub knows and the
tests can't build at the base: the sessions it bound, the OS process table its peer check reads, the panels,
the documents it minted, the record's objects and who may read them, claims' deliverables, the window and its
question card. Nothing else is read, except the evidence store's files, through its public entry.

### The JSON-lines convention

As #391's: `deep-show <run | screen>` reads one JSON object per stdin line and writes exactly one JSON object
per input line to stdout, in order, then exits 0. A line it can't read as JSON, or that lacks a required field,
or names an unknown `planted` value, is still answered with one line, `{"ok": false, "code": "bad_input"}`,
never a panic; a line is read before anything platform-specific, so `bad_input` comes before
`unsupported_platform`. A run that writes fewer lines than it read, or exits non-zero, fails every test that
drove it. A scenario that runs is answered `{"ok": true, …}` whatever its calls' outcomes; each call's outcome
is in its reply. Times in documents are the time grammar's text (`"1s"`); `as_of` is flicks.

### A scenario (`deep-show run`)

```json
{"evidence": dir,
 "sessions"?: {session ID → {"thread": string, "name": string, "process": {"pid": n, "start": n}}},
 "processes"?: [{"pid": n, "ppid": n, "start": n}],
 "panels"?: {panel ID → {"rect": [x, y, w, h], "visible"?: true}},
 "docs"?: {doc ID → {"panel": panel ID}},
 "record"?: {handle → {"session": session ID | null, "state"?: status state, "value"?: number, "as_of"?: flick}},
 "claims"?: {claim handle → {"session": session ID, "deliverables": [doc ID]}},
 "window"?: [w, h], "card"?: {"ask": handle, "question": string, "options": [{"id", "label"}], "rect": [x, y, w, h]},
 "fault"?: {"holds": "fallback_pipeline" | "rebuild_queue" | "asset_decode", "ms": n},
 "planted"?: "presents_unnamed_removal" | "diffs_items_only" | "inlines_every_issue" | "cuts_without_truncated" | "sorts_by_order_key_alone",
 "calls": [Call]}
```

Output `{"ok": true, "replies": [Reply]}`, one reply per call, in order. `evidence` and `calls` are required.

- `evidence`: the root of an evidence store. Every snapshot (a PNG) and every revision's full issue list is
  written there by its SHA-256, in the store's layout (`<first 2 hex>/<other 62 hex>`), so the store's `read`
  returns it; an image's asset is read from there by its hash (the tests `put` it first).
- `sessions`: the agents' sessions the hub knows. An agent writes as its session's `thread` (Writer
  connection); `name` is the agent's name its outline shows; `process` is the agent's process, the parent its
  hooks came from, with its start time.
- `processes`: the OS process table the peer check reads.
- `panels`: where documents draw, in window px; a panel with `visible: false` is hidden. `docs`: the documents
  the hub has minted (doc IDs; Document envelope: "minted by the hub"), each with the panel it draws on.
- `record`: the record's objects by handle, each with the session it belongs to (`null`: no session), the
  state a status binding reads and the value a bound value reads.
- `claims`: an agent's claims, each with the documents its definition names as deliverables.
- `window` and `card`: the window and the shell's question card, presented in its slot `rect` (window px).
- `fault`: a fault fixture, reachable only through this field: for `ms` after a call that renders is admitted,
  its frame can't settle, because a pipeline it draws with is still compiling and its items would draw with a
  fallback (`fallback_pipeline`), its rebuild queue holds its items (`rebuild_queue`), or its assets aren't
  decoded yet (`asset_decode`). Nothing else reads it.
- `planted`: the criteria's wrong programs, each reachable only through this field and only for this proof:
  - `presents_unnamed_removal` (criterion 7): a whole revision that leaves out IDs not in its `removes` is
    presented anyway;
  - `diffs_items_only` (criterion 7): the whole-revision diff reads only the `items` map;
  - `inlines_every_issue` (criterion 9): replies inline every issue, ignoring the read cap;
  - `cuts_without_truncated` (criterion 9): replies cut at the read cap but leave out `truncated`;
  - `sorts_by_order_key_alone` (criterion 8, on `screen`): the compositor draws every layer's items by item
    `order` alone, ignoring bands, the card included.

### Calls and replies

`{"call": "deep_show", "session": session ID | null, "doc": doc ID, "document": Document, "removes"?: [ID],
"t"?: time, "size"?: [w, h], "include"?: ["issues" | "audit" | "timing" | "pixels"]}`: an agent's MCP call.
`session` is the session the hub bound the call to; `null` is a call that bound to no session (Socket roles).
The rest is the render-back request (`doc`, `t`, `size`, `include`); `include` with `pixels` asks for a
snapshot at `t` of `size` px.

`{"call": "deep show", "peer": {"pid": n, "start": n}, …the same fields…, "check"?: bool, "claim"?: claim
handle}`: the CLI command, with the peer process the socket reported. The peer check walks `ppid` from the
peer through `processes`; the first process on that chain that is a session's `process` (same PID and start
time) makes the command act as that session's agent; none makes it you. `check: true` is `--check`, and `include`
with `pixels` is `--snap`; `claim` names the claim the check is for.

`document` is a whole revision as the agent sends it: the envelope (`format`, `profile`, `title`,
`description`, `size`, …) and its ID maps (`items`, `markers`, `bound_values`, `status_bindings`, …), with no
`id` (the hub fills in `doc`), no `layers` and no item `layer`: the hub stamps the layer and its writer from the
connection (Writer layer: "never in a payload").

A reply to either:

```json
{"outcome": "presented" | "refused" | "not_presented",
 "reason"?: "hidden" | "timeout",
 "code"?: string,
 "rev"?: u64,
 "issues": [Issue], "truncated"?: {"shown": n, "total": n, "by_code": {code → n}}, "issues_evidence"?: sha256,
 "changed"?: [ID], "unchanged"?: [ID], "created"?: [ID], "removed"?: [ID],
 "snapshots": [{"sha256", "w", "h"}],
 "result"?: "PASS" | "FAIL" | "BLOCKED" | "INVALID" | "INCONCLUSIVE"}
```

- `outcome`, `reason`: Admission and latch's replies; `reason` only with `not_presented`.
- `code`: a refusal before any revision exists; the one the tests read is `no_session`, for a deep_show call
  bound to no session (the design names no code for it; this is the suite's).
- `rev`: the revision its issues and snapshots are of (Render-back).
- `issues`: as #389's README gives an issue, `{check, code, severity, ids, path, actual, what, fix}`; the list
  is errors first, then by code, then by IDs, each compared by code point. A reply inlines the longest prefix of
  that list whose JSON text (the array as `JSON.stringify` writes it) is at most 8,192 characters (code
  points); when that prefix is shorter than the list it adds `truncated` with `shown` (the prefix's length),
  `total` (the list's) and `by_code` (each code's count over the whole list). `issues_evidence` is the hash of
  the whole list in the evidence store: UTF-8 JSON, an array of every issue in that order, each as a reply
  writes it.
- `changed`, `unchanged`, `created`, `removed`: on a presented whole revision, every ID its writer's layer held
  or holds, in every map keyed by ID, in exactly one list.
- `snapshots`: render-back's, each a PNG in the evidence store of `w` × `h` px; none unless `include` has
  `pixels`, and none of a frame that didn't settle or of a refused revision.
- `result` (only with `check`): the check's verdict, as the `deep` commands' exit-code table reads it: PASS
  when the revision is presented with no error and every snapshot it asked for was taken, and, with a
  `claim`, only when that claim's deliverables name the document; FAIL when the revision is refused for its
  issues; BLOCKED when a snapshot it asked for couldn't be taken because its frame didn't settle.

`{"call": "revisions", "doc": doc ID}` → `{"revisions": [{"rev", "base_rev", "writer": {"kind", "id"},
"hash", "state"}]}`: the document's revisions (Revision), `hash` the SHA-256 of the canonical document,
`state` `pending | current | last_good | superseded | refused`. A writer is `{kind: you | shell | record |
agent | plugin, id}` (Writer connection); an agent's `id` is its session's `thread`.

`{"call": "screen"}` → `{"bands": [{"layer", "owner": {"kind", "id"}, "band", "outline": bool, "name":
string | null}]}`: every layer on screen in the window, in the order they compose, back to front (Band), with
the question card as one row, `{"band": "card", "owner": {"kind": "shell"}}`. `outline` and `name` are the
outline a layer is drawn with and the name it shows.

### `deep-show screen` (macOS)

Input: a scenario with `window` and `"out": path`. It runs the calls as `run` does, then draws the window as
they leave it, every document in its panel by band, the card last in its slot, with GPUI's offscreen Metal
renderer at scale 1, and writes it to `out` as an 8-bit RGB or RGBA PNG of the window's size. Output `{"ok":
true, "width", "height", "replies": [Reply], "items": [{"id", "layer", "box": [x, y, w, h]}]}`: the replies, as
`run`'s, and each item drawn with its box in window px. Off macOS a line that parses answers `{"ok": false,
"code": "unsupported_platform"}`.

## Criteria to tests

Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test runs it
through `planted` and a comment or message at the assertion says what it must fail, naming what the criterion
says.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A deep_show snapshot at a declared time is taken only once the frame is settled (no fallback pipeline, an empty rebuild queue, decoded assets); a frame that can't settle within 2 s returns not presented with the reason, and a check that needed it is BLOCKED | `settle.test.ts`: a board with a bar, a label and a 32 × 32 magenta image put in the evidence store, shown at `t: "1s"` with a snapshot. Settled at once: presented, one 320 × 200 PNG read back by its hash, magenta at the image's center (the asset decoded). With each of the three faults held 1.5 s: the reply comes no sooner than 1.5 s and its snapshot is byte for byte the settled one (a snapshot taken before the frame settles, or a fault ignored, fails). Held 10 s: `not_presented` with `reason: "timeout"`, no snapshot, and the run ends within 2 s of a trivial run's time plus 750 ms (a program that waits for the frame fails). `deep show --check --snap`: PASS when the frame settles, BLOCKED for each fault held 10 s |
| AC2 | `deep_show` on a hidden panel returns "not presented" within 2 s | `settle.test.ts`: on the shown panel the board is presented; on the hidden one, `not_presented` with `reason: "hidden"`, within 2 s of a trivial run's time plus 750 ms |
| AC3 | A render-back snapshot never counts as proof for any claim | `proof.test.ts`: `deep show --check --snap` for alpha's claim whose deliverable is another document: presented, with a snapshot kept as evidence and no error, yet the result is a verdict other than PASS (a check that passes a claim on its picture fails); for the claim whose deliverable is the document itself, the same call passes |
| AC4 | A `deep show` run from inside an agent's process tree draws in that agent's writer layer, stamped as that agent and never as you, and a deep_show call bound to no session is refused | `writer.test.ts`: alpha's deep_show, then `deep show` from a process in alpha's tree with the same document: every item unchanged (the same layer; a layer of yours would create them), both revisions stamped `{kind: agent, id: thread-alpha}`, one layer on screen, alpha's, in the agent band. From bravo's tree: bravo; from alpha's: alpha; from your shell: you; under a process that reuses an ended agent's PID with another start time: you (a peer check by PID alone, or one that stamps every CLI call as you or as the first agent, fails). A deep_show bound to no session: refused `no_session`, no snapshot, no revision, nothing on screen, no evidence |
| AC5 | A deep_show document that binds a value or a status to a handle its session's credential can't read, such as another session's open ask, is refused with ref_unresolved naming the handle, and render-back returns no snapshot of it | `refs.test.ts`: a status mark bound to an open ask and a count bound to a reading. Both alpha's: presented with a snapshot. A status bound to bravo's open ask, or a value bound to bravo's reading: refused with a `ref_unresolved` issue whose `actual` is that handle, and no snapshot. After a good revision, the bad one is refused the same way and the good one stays current, by hash (a check that resolves any handle in the record, or one that refuses every binding, fails) |
| AC6 | An agent's deep_show document draws in its own writer layer, stamped from its connection and outlined with its name, in the agent band below the question card, and a document payload that names its own layer or writer is refused | `writer.test.ts`: alpha's and bravo's documents: each revision stamped from its own connection; on screen each in one layer of its own, owned by its thread, `band: "agent"`, outlined with the session's name, before the card, which composes last, once. A payload with a `layers` map, an item with `layer`, or a top-level `writer`: refused with an issue whose path names that field (`layers…`, `items/bar/layer`, `writer`), no current revision, nothing on screen |
| AC7 | A test agent's document of 14 items, re-sent as after /compact with 9 of them and no `removes`, is refused with unintended_removal naming exactly the five missing IDs, and the 14-item revision stays current, by hash; the same 9 with those five in `removes` is presented, its reply listing the five as removed and the nine as unchanged; and, from the 14-item revision, all 14 re-sent with one label's text changed reply with that ID as changed and the other 13 as unchanged. A planted deep_show that presents the 9-item revision fails, naming the five IDs it dropped, and one that diffs only the items map fails on a re-send that keeps all 14 items but leaves out one of the document's two markers, naming the marker | `revisions.test.ts`, on `fixtures/fourteen.json`: the 9-item re-send is refused, the `unintended_removal` issues naming exactly `label-3, label-6, label-7, row-3, row-6`, and the current revision keeps the 14-item revision's `rev` and `hash`; with those five in `removes`, presented with `removed` the five and `unchanged` the nine (and the two markers); all 14 with `label-2`'s text changed: `changed: [label-2]`, `unchanged` the other 13 (and the markers). `presents_unnamed_removal` fails the same check, the failure naming all five; all 14 items without the `review` marker are refused naming `review`, and `diffs_items_only` fails that check, naming `review` |
| AC8 | An agent document with the highest order key and bounds 100 times the window leaves the card's interior pixels equal to its isolated render; a compositor that sorts by order key alone draws above the card and fails, naming the item | `card.test.ts` (macOS): alpha's document of one `rect@1`, `flood`, with order key `zzzzzzzz` and a box 100 times the 800 × 600 window each way, centered. The window drawn with it and with no document (the card's isolated render): beside the card the flood draws, and every pixel of the card's interior, 16 px in from its edge, is the isolated render's. `sorts_by_order_key_alone` fails the same check, the failure naming `flood` |
| AC9 | A test agent's document of 5,000 marks, none of them named, sent with `deep_show` is refused with 5,000 issues: the reply inlines issues up to 8,192 characters, errors first and then by code and ID, and adds `truncated` with `shown`, `total: 5000` and `by_code` counting each code, while the full list reads back from its evidence hash, issue for issue, and the refusal counts all 5,000. A reply that inlines every issue, or one that cuts with no `truncated`, fails this test, naming the reply's size or the missing field | `issues.test.ts`: 5,000 `rect@1` marks `m-1` … `m-5000` with no `name`, written in a seeded shuffle. Refused; the list read back by `issues_evidence` holds 5,000 errors, one per mark naming it, errors first then by code and ID (code-point order, so `m-10` before `m-2`); the reply's issues are that list's first issues, issue for issue, at most 8,192 characters and the longest prefix that fits; `truncated.shown` their count, `total: 5000`, `by_code` the count of each code. The same for `deep show --check`, whose result is FAIL. `inlines_every_issue` fails, the failure naming the reply's size; `cuts_without_truncated` fails, naming the missing `truncated` field |

The bad_input convention is checked once for each subcommand (`writer.test.ts` for `run`, `card.test.ts` for
`screen`).

## Readings where the issue and design leave a choice

- **One binary standing in for the hub's canvas side.** deep_show is an MCP tool and `deep show` a CLI command,
  both served by a hub that doesn't exist at the base, so a scenario carries what the hub would know (bound
  sessions, the process table, minted documents, the record's objects, claims). The binding of a `deep mcp`
  call to its session is the hub's own work (Socket roles), so a call names the session it bound to, `null`
  when it bound to none; the peer check is this issue's ("run from inside an agent's process tree"), so the
  binary does it from the process table.
- **The peer check matches a process by PID and start time.** The design checks the agent's process "by the
  parent's start time and never by process ID alone"; a process that reuses an ended agent's PID is not inside
  that agent's tree, so `deep show` under it acts as you.
- **"Stamped as that agent"** is read as the revision's writer `{kind: agent, id: <thread>}` (Writer connection:
  "An agent writes as its session's thread"), and "draws in that agent's writer layer" as the CLI's revision
  diffing against the same layer the agent's deep_show wrote.
- **"Names its own layer or writer"**: a payload with a `layers` map, an item `layer` or a `writer` field. The
  refusal names the field in an issue's `path`; its code isn't fixed by the design, so it isn't read.
- **Unbound calls** are refused with `no_session`, this suite's code, and leave nothing behind: no revision, no
  layer on screen, no evidence ("never claims, asks, draws or attaches evidence").
- **"The nine as unchanged"** is read as the nine items. The diff covers every ID the writer's layer holds in
  every map keyed by ID, so the document's two markers, kept, are listed as unchanged too, and as created in
  the first reply.
- **Settled** is driven by a fault fixture, since a real frame on the CPU settles at once: the fault holds one of
  the three conditions the criterion lists for a given time. "Taken only once the frame is settled" is read as:
  no reply with a snapshot before the condition clears, and that snapshot equal, byte for byte, to the
  snapshot of the frame settled at once. **Within 2 s** is measured on the whole process, less the time of a
  trivial run of the same binary (start-up), with 750 ms for scheduling; the reason is `timeout` (Admission
  and latch). 1.5 s is the late-but-settling case, safely inside 2 s.
- **"A check that needed it"** is `deep show --check --snap`: its snapshot is what `--snap` asks for, so its
  result is BLOCKED when the snapshot's frame can't settle.
- **Proof for a claim.** No verdict engine exists at the base, so the claim is the scenario's (its
  deliverables) and the verdict is `deep show --check`'s `result`: "a document check passes a claim only when
  the document is itself the work". A presented, settled snapshot of a clean document whose claim names
  another deliverable must not PASS; any other verdict is accepted.
- **Readable handles.** An agent's session reads the record objects that belong to it; another session's ask
  or reading is not readable, so it is `ref_unresolved` for that writer (Handles). The issue names the handle
  in `actual`, the value refused at the binding's `source` path, as #389's bound-value issues do.
- **The read cap** counts the inlined `issues` array's JSON text in code points, and "inlines issues up to
  8,192 characters" as the longest prefix that fits. The 5,000 marks are unnamed `rect@1` items, pickable by
  default, so each is an error (Item and kind: `name` "required when pickable"); their code isn't fixed, so
  `by_code` is checked against the list read back. "The refusal counts all 5,000" is `truncated.total`.
- **The card and its isolated render.** The question card is the shell's (its own issue draws its contents),
  presented in the slot the scenario gives. Its isolated render is the same window with no document; the
  interior is the slot 16 px in from its edge, so rounded corners and edge antialiasing are left out.
  "Bounds 100 times the window" is a box 100 times the window's width and height, centered on it, and "the
  highest order key" the item's `order`, `zzzzzzzz`. The failure names the items whose box meets the card.
- **Snapshots** are PNGs in the evidence store, of the requested `size`, so the tests read them back by hash.

Not tested, because no criterion asks: `deep show --check --snap`'s steps (click, hover, type) and the panels
they can't reach, the audit, timing and `degraded` fields, the visible-items table's 200-row cap, one revision
in flight and superseding, the headless worker serving render-back with the app closed (every snapshot here
is taken with no app), carried issues, leases, quotas and the outline's pixels.

## Upstream tests (the Oracle lane)

The Oracle page lists no upstream test for any of the nine criteria (settled snapshots and the 2 s bound,
writer stamping, refusal codes, clipping to the card and the capped issue list are this design's own rules),
so these tests are their local proof.
