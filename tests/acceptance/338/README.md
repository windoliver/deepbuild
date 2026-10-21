# Acceptance tests for #338: the replica, the registries and the canvas mounted with no fork

These tests were drafted blind from issue #338 (its text as of October 20), `docs/technical-design.md` (the DeepBuild app row; `deep.registerView`; Blocks for plug-ins that host something live; Panels and devices: Needs-you view and Replica; Every ask ends, Asks stay current and One table for an ask's life; the registry's kit rows; Decided: The reference window, The app's toolkit, The canvas's GPU layer; The reference Macs), `docs/canvas-primitives.md` (Replica `deep_drive`; Projections the canvas reads), the `ask.*` schemas under `packages/contracts/schemas`, gpui-kit at the commit `crates/deep-app/Cargo.toml` pins (gpui-shell's component registry, dock registry and role names) and the base commit `2307398`, which has none of #338. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

The issue is a spike, so what it proves is a record plus a headless run. The tests don't take the record's word for what they can recompute: they derive the Needs you rows from the fixture record's events and compare them with the rows the view showed; they work out what each planted view got wrong and which asks its kit failure may name; they compare the replica's snapshot with the live tree node for node and find the first node where a scale-1 replica departs; they judge the launch times against 2 s, the screenshots against the reference window, file hashes, and the dependency sources for a fork. The live tests run the headless command themselves and hold its fresh output to the same checks.

## The surface (my choice, since the issue names none)

Following #337, the spike keeps one public record, `docs/spikes/338/record.json`, and a tracked copy of its headless run's output directory. Every path is relative to the repo root and tracked by git (committed or staged).

### The record, `docs/spikes/338/record.json`

```json
{
  "spike": 338,
  "machine": { "model": "Mac15,12", "chip": "Apple M3", "memoryBytes": 17179869184, "power": "ac", "lowPowerMode": false, "thermalState": "nominal", "macosBuild": "<sw_vers -buildVersion>" },
  "out": "docs/spikes/338/out",                         // the tracked copy of the run's output directory (below)
  "window": { "size": [1512, 982], "scale": 2 },        // the reference window, as the design decides it
  "clock": "virtual",
  "headless": { "command": ["cargo", "test", "-p", "deep-app", "--test", "<target>"] },
  "launch": { "test": "<libtest name>", "method": "<how a launch is timed, from what to what>" },
  "views": [ { "id": "needs-you", "test": "<libtest name>" }, { "id": "sidebar", "test": "..." }, { "id": "session", "test": "..." } ],
  "needsYou": {
    "fixture": "docs/spikes/338/fixtures/needs-you.events.jsonl",
    "log_pos": 44, "now": 1800000000000, "held": "ask:<id>",
    "panel": { "file": "<tracked .js: the fixture panel that replaces Needs you>", "sha256": "<hex>", "test": "<libtest name>" },
    "kit": { "test": "<libtest name: the fixture panel passes needs-you@1>" },
    "planted": { "cap20": { "file": "...", "sha256": "...", "test": "..." }, "drop-folded": { ... }, "list-superseded": { ... }, "hide-newest": { ... } }
  },
  "parity": { "test": "<libtest name>", "scale1": { "test": "<libtest name>" }, "liveCapture": "<how the live tree was read on the reference Mac>" },
  "registry": { "slots": { "sidebar": { "file", "sha256", "test" }, "home": { ... }, "tab": { ... }, "line": { ... }, "replace": { ..., "view": "needs-you" } } },
  "canvas": { "test": "<libtest name>" },
  "decision": { "registryCovers": true, "fork": false, "row": "| The app's toolkit |", "text": "<the decision, exactly as it appears in that Decided row>" }
}
```

- **The machine.** `machine` uses the field names of `scripts/benchmark.mjs`'s `fingerprint()`. Either reference Mac counts, Mac15,7 (Apple M3 Pro, 36 GB) or Mac15,12 (Apple M3, 16 GB), on mains power, Low Power Mode off, thermal state nominal, with a macOS build. Off either, the launch time and the live tree are INCONCLUSIVE, and criteria 1 and 3 fail until re-measured.
- **The window and the clock.** `window` must be the design's reference window, 1512 × 982 points at 2×. `clock` is `virtual`. The clock is otherwise checked only through the fixture: every open ask's deadline, and the Later ask's `until`, come after `needsYou.now`, the virtual time the replica runs at.
- **The headless command** must be one a lane in `scripts/lanes.mjs`'s `checks` runs, or `cargo test -p <a workspace crate> ...` while a lane runs `cargo test --workspace`. It may not start a display server. `.github/workflows/` must be absent or empty. The live test runs it from the repo root with `DISPLAY`, `WAYLAND_DISPLAY` and `CI` unset and **`DEEP_338_OUT`** set to a fresh directory, and the tests named in the record must report `ok` in libtest's `test <name> ... ok` lines, with exit 0.
- **The decision** says whether the registry covered every slot (`registryCovers`, which must be `true`, since the toolkit row reopens otherwise), that the canvas was registered with no fork (`fork: false`), and its text names `IOSurface` and a cost in `ms` (the finished macOS GPU-layer spike), the word `registry` and the word `replica`, and appears, whitespace collapsed, in the Decided row of `docs/technical-design.md` that `row` names by its `| <question> |` start.

### The output directory, `$DEEP_338_OUT` and its tracked copy `record.out`

The headless tests write these files into `$DEEP_338_OUT` when it is set. The record keeps one run's copy under `record.out`, a directory under `docs/spikes/338/` whose files are all tracked. The public tests read the copy; the live tests read a fresh run's. Every file is JSON unless named `.png`.

| File | Holds |
|---|---|
| `launch-ms.json` | At least five launch times in ms, each from `launch.method`, all strictly under 2,000 |
| `snapshots/<view>.json` | The replica's text snapshot of a shipped view at the reference window, scale 2 (shape below) |
| `snapshots/<view>.scale1.json` | The same view from a replica laid out at scale 1 (`window.scale: 1`): the planted replica |
| `live/<view>.json` | The live app's accessibility tree with bounds on the reference Mac, in the same shape (tracked copy only; a fresh run needn't write it) |
| `screens/<view>.png` | The replica's screenshot of the view: a PNG of 3024 × 1964 pixels, the reference window at 2× |
| `needs-you/rows.json` | The fixture Needs you panel's rows, top to bottom, each an ask handle `ask:<id>` |
| `needs-you/planted/<id>.rows.json` | Each planted view's rows, the same way, for `cap20`, `drop-folded`, `list-superseded`, `hide-newest` |
| `needs-you/kit.json` | `{"fixture": {"result": "pass"}, "planted": {"<id>": {"result": "fail", "names": "ask:<id>"}}}`: needs-you@1's verdicts |
| `parity.json` | `{"<view>": {"result": "pass"}, "scale1": {"<view>": {"result": "fail", "firstNode": {"index": n}}}}`: the parity check's verdicts, `index` the pre-order index of the first differing node |
| `canvas.json` | `{"component": "<name>", "arguments": [{"name", "type"}], "retainedState": true}`, read back from gpui-shell's component registry |

`<view>` is each of `needs-you`, `sidebar` and `session`, the shipped views criterion 3 names; `views` may list more, each with a snapshot and a screenshot.

**A snapshot** is `{"window": {"size": [1512, 982], "scale": 2}, "tree": <node>, "items": [{"id": "<canvas item ID>", "value": <its evaluated value>}]}`. A node is `{"role": "<snake_case accessibility role, as gpui-shell's role names spell it>", "name": "<accessible name>" | null, "value": <value> | null, "bounds": [x, y, w, h], "children": [<node>]}`, bounds in whole device pixels at the window's scale, inside the window. Some node has a name, and across the shipped views at least one snapshot lists a canvas item by ID (the session page's line draws through the canvas). Two trees are equal node for node when their pre-order walks have the same length and every node agrees on role, name, value and bounds; the first index where they don't is the first differing node. Bounds are in device pixels so a replica laid out at scale 1 differs at its first node whose bounds aren't 0.

### The fixture record, `needsYou.fixture`

One JSON object per line, `{"session_id": "<the agent session the event belongs to>", "event": {...}}`, in log order with strictly increasing `event.log_pos`. Each `event` is a catalogued event that validates against its kind's published schema through `packages/contracts/src/index.ts`'s `validate(name, value)`, `log_pos` included; `session_id` is the events table's column, kept beside the event because the schemas have no field for it. An ask's handle is `ask:<the id of its ask.created event>`.

**The inbox projection's list for Needs you**, as the tests recompute it as of `needsYou.log_pos`: every ask created by an `ask.created` at or before that position and not closed by a later `ask.answered`, `ask.defaulted`, `ask.escalated`, `ask.cancelled`, `ask.superseded` or `ask.moot` with its handle as subject, **oldest first by its creation's `log_pos`**. Later, held and folded asks are open, so they're listed; superseded and moot asks are closed, so they're not. The fixture must hold, as of that position and `now`:

- exactly 40 open asks, among them every ask kind (`authority`, `unblock`, `taste`, `exception`, `choice`, `definition`), each with a deadline after `now`;
- exactly one open ask in Later: an `ask.later` on it with `now < until < deadline`;
- exactly one superseded ask, whose `by` is a newer open ask from the same session, and exactly one moot ask;
- exactly one session with ten open asks, so its sixth to tenth are the five folded into one exception, and no other session with more than five;
- `held`, the ask held for an unread message, an open ask that is neither the Later ask nor in the folding session. The hub's hold has no event at the base, so this one is the record's word, checked only for shape.

**The planted views** must have exactly the issue's faults and nothing else, judged against the recomputed rows: `cap20` shows the first 20 rows; `drop-folded` shows the rows without the five folded asks; `list-superseded` shows the rows plus the superseded ask, in any position; `hide-newest` shows the rows without the last. Each must fail needs-you@1 in `kit.json`, and the ask it names must be one its view got wrong: beyond row 20, a folded ask, the superseded ask, or the newest. The kit's own test, and each planted view's, must report `ok` in the live run (they assert the failures).

**Panels** (the fixture Needs you, the four planted views and the five slots) are tracked `.js` or `.mjs` files hashing to their `sha256`, no two slots sharing a file, that use none of `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `child_process`, `require(`, `Deno.` or `Bun.`.

**No fork.** `Cargo.lock`'s `gpui-kit` and `gpui-shell` packages come from `git+https://github.com/longbridge/gpui-kit?rev=…` (a vendored copy has no source; a fork has another URL); no `Cargo.toml` at the root or under `crates/*/` has a `[patch]` table or a `path =` for `gpui`, `gpui-kit` or `gpui-shell`.

## How to run

- Public tests, fast and with no build: `node --test tests/acceptance/338/spike.test.mjs`.
- The fixture's schemas, in vitest like #606's contracts tests (needs `npm ci`): `npx vitest run tests/acceptance/338` from the checkout's root, with the repo's `vitest.config.ts`. The root config's `tests/**/*.test.ts` pattern means the unit lane runs it too.
- Live tests, which build the app and run its headless tests: `node --test tests/acceptance/338/spike.live.test.mjs`.
- The validator's own tests, which plant wrong spikes in a small temporary git repo: `node --test tests/acceptance/338/validator.test.mjs`. They pass at the base, since they test the tests and not the spike.
- The preflight's `tests/*.test.mjs` pattern doesn't reach the `.mjs` files here.

## Criteria, tests and wrong spikes

IDs are the first 8 hex digits of SHA-256 of each criterion's text, computed with the command in `tests/acceptance/48/README.md`.

| ID | Criterion | Tests | Wrong spikes it must fail on (planted in `validator.test.mjs`) |
|---|---|---|---|
| `#338.6257cd5b` | A replica launches headless at the reference window in under 2 s and returns a text snapshot with roles, names and canvas item IDs, and a screenshot, for the shipped views | public: the record's window and clock, a reference Mac, at least five launches all under 2,000 ms, each shipped view's snapshot (roles, names, bounds in the window, canvas items in at least one) and a 3024 × 1964 PNG. Live: the launch test and each view's test report `ok`, and a fresh run's output passes the same checks | A launch of 2,000 ms. Four launches. A Mac that is neither reference; the thermal state fair. A 1440 × 900 window. The real clock. A snapshot at scale 1, with no names, with a PascalCase role, with a node outside the window, with fractional bounds. No canvas item in any snapshot. A screenshot at 1×, a non-PNG, a missing one. A shipped view left out. No launch method. An untracked output file; an output directory outside `docs/spikes/338/` |
| `#338.ed0f5115` | A fixture panel replaces the shipped Needs you through gpui-shell's panel registry and passes `needs-you@1` headless in a replica on a fixture record of 40 open asks of every kind, with one in Later, one held for an unread message, five folded into an exception, and one superseded and one moot; the view's rows equal the inbox projection's list for Needs you at that `log_pos`, row for row. Planted views that cap at 20 rows, drop the folded asks, list the superseded one or hide the newest each fail, naming the ask | vitest: every fixture event validates against its schema with a `log_pos`. public: the fixture's composition above; the view's rows equal the recomputed list row for row, reporting the first row that differs; the fixture panel passes the kit; each planted view has exactly its fault and fails the kit naming an ask it got wrong. Live: the kit's, the panel's and each planted view's test report `ok`, and the rows a fresh run writes pass the same checks | 39 or 41 open asks; a kind missing; no Later, two Later, Later past the deadline or already over; no superseded ask, one superseded from another session; no moot ask; nine open asks in the folding session; two folding sessions; a deadline before `now`; `held` naming the Later ask, a folded ask or a closed one; a reused log position; a `log_pos` the fixture never reaches; an untracked fixture; an event missing required fields or of an uncatalogued kind. A view capping at 20 (fails at row 20), dropping the folded (row 5), listing the superseded, hiding the newest (row 39) or the oldest (row 0), newest first, or showing the moot ask. Rows that aren't handles; no rows. A kit failing the fixture panel, passing a planted view, naming an ask the view got right, naming none. A planted `cap20` at 19, `drop-folded` dropping four, `list-superseded` listing the moot one, `hide-newest` hiding the oldest, a planted view with the right rows, or one not recorded or with no rows. A panel with the wrong hash or calling `fetch` |
| `#338.78331b15` | For Needs you, the sidebar and a session page on one fixture record, the replica's snapshot with bounds equals the live accessibility tree with bounds on the reference Mac, node for node; a replica that lays out at scale 1 fails, naming the first node | public: for each of the three views, the replica's snapshot equals the tracked live tree node for node (the first differing node is reported with its index, role, name and field), the scale-1 snapshot differs, and `parity.json` passes the view and fails the scale-1 replica at exactly the recomputed first node; the live tree was captured on a reference Mac, by a stated method. Live: the parity and scale-1 tests report `ok`, and the snapshots a fresh run writes equal the tracked live trees | A snapshot one pixel off (names `sidebar`, node 4, bounds); a node missing; a different name; a different role. A scale-1 snapshot equal to the live tree; one not at scale 1; a verdict naming the wrong node; a scale-1 verdict that passes; a parity verdict that fails a view. No live tree; no scale-1 snapshot. A Mac with 8 GB. No capture method |

Scope tests, untagged since the trace lane tags only criteria: the panel registry fills every slot the issue names, `sidebar`, `home`, `tab`, `line` and `replace` (the shipped `needs-you`), each from its own tracked panel with a headless test, and the decision says it covers them (planted: a slot missing, two slots on one file, a replacement of `numbers`, an area the issue doesn't name, a wrong hash, no test, `registryCovers: false`). The canvas is a component in gpui-shell's registry with argument schemas typed as `ComponentArgument` kinds and a retained-state handle, with no fork (planted: no `canvas.json`, no arguments, a `json` type, `retainedState: false`, gpui-shell from `windoliver/gpui-kit`, gpui-shell vendored into the workspace, a `[patch]` table, a `path` dependency). The decision records the IOSurface handoff and its cost in a Decided row (planted: no `IOSurface`, no `ms`, a row the design lacks, a row that doesn't hold the text, a text silent on the registry, `fork: true`). The headless command in a preflight lane with no CI (planted: a command no lane runs, a workflow file). The live run (planted: a `FAILED`, `ignored` or missing result, a non-zero exit, a command that can't start, which is `BLOCKED`).

## What the base commit has

At the base `2307398` there's no `docs/spikes/338/record.json`, so every spike test fails with `no spike record at docs/spikes/338/record.json`: the 8 public tests, the 4 live ones and the 1 vitest test, 13 of 13. `BASE-FAILURE.txt` holds that run. The validator's own tests pass at the base, 108 of 108.

## Assumptions a redraft may revisit

- I picked the record's path and every field, the output directory and `DEEP_338_OUT`, every file name in it, the snapshot's JSON shape (a tree of `role`, `name`, `value`, `bounds`, `children`, plus `items`), bounds in whole device pixels, the fixture's `{session_id, event}` lines and the libtest-name surface for the headless tests.
- **Needs you lists every open ask, oldest first.** The design's Needs-you view says "every open ask in the record is listed" and "It can never: Leave an open ask out", and the issue's planted "hide the newest" and the view's "hides the oldest" read as the two ends of one list. So the list includes the Later, held and folded asks, in creation order, and only superseded and moot asks (closed, "neither counts in Needs you") are left out. Rows are compared by ask handle alone; how a view draws a Later, held or folded row (a section, an indent under the exception) isn't pinned, and the view's state words aren't compared. "Later hides an ask until a time you pick" is read as hiding it from the batch and the card, not from the list; a redraft may read it the other way, which would drop the Later ask from the expected rows.
- **Which events close an ask.** The base's ask kinds: `answered`, `defaulted`, `escalated`, `cancelled`, `superseded`, `moot`. The design also names `decided_for_you` and `unanswerable`, which no kind at the base records; a kind the implementer adds for them isn't counted as closing, so a fixture using one would show those asks as open.
- **Five folds after five.** The design says the five "is drafted at setup like the deadlines"; the tests pin 5, as the issue's "five folded" does, and read "once one session holds five open asks, its further asks fold" as the sixth onward, so one session holds ten open asks. A fixture whose folding session has eleven, or whose first five aren't all shown, fails.
- **Held is the record's word.** The design's hold ("an ask raised by a turn that hadn't yet read a message you typed") has no event at the base; `user.ask` is written when the agent reads the message, which ends the hold. So `needsYou.held` is checked only to be an open ask outside the Later and folding cases. A redraft may pin an event once the hub records one.
- **The 40 are open asks**, so the superseded and moot asks are two more created asks (42 `ask.created`), not two of the 40.
- **Launch is recomputed from the run, not a `runs` field.** `launch-ms.json` is written by the headless test itself, so the live test judges fresh launches; the design's five-run rule needs at least five, all strictly under 2,000 ms. No margin or INCONCLUSIVE band is applied to the launch, since the issue says "under 2 s" and a replica over it on any run isn't one you can run checks in. Off both reference Macs the result is INCONCLUSIVE and fails.
- **"The shipped views" of criterion 1** are read as at least the three criterion 3 names; a record may list more.
- **The live accessibility tree** can't be read in a headless run (it needs the live app on the reference Mac and the accessibility permission), so it's a tracked file the implementer captures, with `parity.liveCapture` saying how. The tests trust that the file is the live tree; a redraft may ask for a capture script in the repo.
- **Node-for-node equality is exact**, bounds included, on role, name, value and bounds; the design's sentence says "equals". Replica bounds are in device pixels so that scale is observable, so the live capture multiplies points by the backing scale. A node's children's order is the tree's.
- **The fixture panel's registry path isn't observable** from the record: that it loads "through gpui-shell's panel registry" is held only by the `replace` slot's headless test reporting `ok`. Likewise where each slot's panel is drawn, and "starting from scratch", are trusted to the slot tests.
- **The canvas's argument schemas** are read back as `canvas.json` from the headless test, typed by gpui-shell's `ComponentArgument` kinds; the tests don't inspect the registry themselves. "No fork" is checked on the dependency sources only: a patch applied some other way (a build script rewriting the checkout) isn't seen.
- **The GPU-layer spike** is recorded in the decision text (IOSurface, a cost in ms) in whatever Decided row the record names; the base's "The canvas's GPU layer" row already holds the handoff and its cost, so this test adds only that #338's decision repeats it with the registry and replica outcomes.
- **The virtual clock** is observable only through the fixture (every deadline and the Later's `until` lie after `now`); a replica on the real clock that still shows the same rows passes. A redraft may add a check that the view shows a time derived from the clock.
- **No display** is enforced only by unsetting `DISPLAY`, `WAYLAND_DISPLAY` and `CI` and refusing a display server in the command, as #337 does.
