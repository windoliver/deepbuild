# Acceptance tests for #124: drive a replica of the app, with screenshots, snapshots and recordings

Written first, blind, from issue #124 (Scope, Fields, its five acceptance criteria, Proof, Depends on), the design and the base
commit `6ba47cdb` (origin/main), by a job that never saw an implementation; none existed. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read: `AGENTS.md`; `docs/technical-design.md` (Panels and devices: Replica; the Extension API section and its MCP tools
row, which describes `deep_drive`; Dogfooding; How runs become one of five verdicts, journey checks, evidence by hash, a picture is
never proof; the API's own acceptance test and its first-try reading rule, which criterion 1 copies); `docs/canvas-primitives.md`
(Replica `deep_drive`: fields, semantics, cost, it-can-never); `brand/palette.json`. At the base: `crates/deep-replica` (#338's
replica, `snapshot.rs`, `shell.rs`, `kit.rs`, the `deep-replica-canvas` bin), `crates/deep-app` (`notify.rs`, `brand.rs`, the
panels), `packages/hub/src` (`tools.ts`, `mcp.ts`, `show.ts`, `plant.ts`), `packages/verdicts`, `packages/gate`, `packages/leases`,
`packages/contracts/schemas` (`claim.sent_back@1`, `open_item.opened@1`), `scripts/benchmark.mjs`, `scripts/lanes.mjs`,
`scripts/proof-change.mjs`, `benchmarks/budgets.json`, gpui-shell's script API at the pinned gpui-kit commit, and the suites of
#338, #326/panels, #327, #377, #401, #806 and #26 for their shape and helpers.

## Run them

```sh
npm ci                                   # once
npm run build --workspaces               # ac5-lease and the live files run the built CLI (deep hub run, deep mcp)
npx tsc -p tests/acceptance/124/tsconfig.json
npx vitest run --root tests/acceptance/124 --no-file-parallelism
# by hand only, never in CI:
DEEP_DRIVE_BUDGETS=1 npx vitest run --root tests/acceptance/124 ac5-budgets.live.test.ts          # on the reference Mac
DEEP_DRIVE_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=... [CODEX_API_KEY=...] npx vitest run --root tests/acceptance/124 ac1-agents.live.test.ts
```

Node 24.22 first on `PATH`; cargo; macOS (the replica renders with GPUI's offscreen Metal renderer; off macOS every replica test
fails `INCONCLUSIVE:` and never passes). Every file builds `deep-drive` once with
`cargo build --locked -p deep-replica --bin deep-drive --features env-plants` (the planted replicas, #1408); the live agents file also needs `target/debug/deep-hook`. Temp folders are
`/tmp/dd124-*` (and #26's `/tmp/dh26-*`); every process is stopped by its PID. `scripts/lanes.mjs` needs `tests/acceptance/124/`
in its `alone` list (the files build binaries and start hubs) and both `*.live.test.ts` files in `byHand`; the implementer makes
that edit. No `[[test]]` entry and no file outside this folder was added by this job.

## The surface (the issue names `deep_drive` and its fields; everything else here is this job's choice)

The base exposes the replica as bin targets of `crates/deep-replica` driven over stdin/stdout (`deep-replica-canvas`, #806) and
agent tools through `deep mcp` with a strict input schema (`packages/hub/src/tools.ts`). The smallest real surface that sees each
criterion follows that: one new binary that hosts one replica and speaks `deep_drive`'s calls as JSON lines, the same call shape
as the `deep_drive` MCP tool's arguments, which the hub forwards to such a process.

### The binary: `deep-drive --out <dir>`

- A new `[[bin]]` of `crates/deep-replica`, name `deep-drive`, built at `target/debug/deep-drive`.
- First stdout line: `{"ready": true}`. Then one JSON line in on stdin per call, one JSON line out per call, in order. It exits 0
  when stdin ends. Files it writes (screenshots, frames, the trace) go under `<dir>`; replies name them by absolute `path`.
- It hosts at most one replica. Environment: `HOME` (where it finds your hub for `record_copy`), and `DEEP_DRIVE_PLANT=<name>` for
  the planted programs below; an unknown name exits 2 after one line.

### A call (the `deep_drive` tool's arguments, and a stdin line)

Every field but `call` is nullable and may be left out (a missing field reads as null, as #26's strict check reads it). Recorded
calls must pass `checkArguments('deep_drive', call)` from `packages/hub/src/tools.ts`, so `SCHEMAS.deep_drive` lists exactly these
fields, and `tools.json` describes the tool (its description says only assertions count, the tests look for `assert`).

```jsonc
{
  "call": "launch" | "act" | "wait_for" | "see" | "screenshot" | "record" | "expect" | "close",
  "replica": "replica:<alnum>",            // launch's answer; null only for launch
  "launch": { "from": "fixture" | "record_copy" | "empty",   // null: fixture = #338's docs/spikes/338/fixtures/needs-you.events.jsonl
              "panel": "<absolute path of a panel package>",  // mounted in the shell's sidebar slot, as #326's open_with_card mounts one
              "size": [w, h], "scale": 1 | 2, "theme": "light" | "dark", "reduced_motion": bool,
              "locale": "en-US", "clock": "virtual" | "real", "packs": ["name@version"] },
  "locator": Locator,                       // the call's target (see Locators)
  "act": { "kind": "click" | "double_click" | "type" | "press" | "drag" | "scroll" | "hover" | "set",
           "text": str, "keys": str, "to": Locator, "to_point": [x, y], "dx": int, "dy": int, "control": str, "value": str },
  "wait_for": { "state": "visible" | "hidden" | "enabled" | "text" | "value" | "settled", "value": str, "event": str,
                "t": int /* flicks since launch */ },
  "timeout": int,                           // ms of the replica's clock; null = 5,000
  "see": { "scope": "window" | "panel" | "locator", "include": ["roles", "names", "values", "bounds", "items"] },
  "screenshot": { "target": "window" | "panel" | "locator", "highlight": [Locator], "mask": [Locator] },
  "record": { "action": "start" | "stop", "fps": 30, "marks": "per_action", "mask": [Locator], "mask_kind": "fill" | "blur" },
  "expect": { "name": str, "assert": "visible" | "text" | "value" | "count" | "state", "value": str, "count": int,
              "state": "enabled" | "disabled" | "focused" | "checked" | ... }
}
```

- `act` without a `locator` acts on the focused element (`type`, `press`). `press.keys` are space-separated gpui keystrokes
  (`enter`, `tab`, `cmd-enter`). `scroll` with `dy: 200` scrolls by 200 points, delivered over successive frames as a trackpad's
  deltas are, so a recording has frames mid-scroll. Every action first waits until its target is visible, enabled and still for
  two frames, at most `timeout`.
- `drag`'s `to: locator | [px, px]` and `set {control, value}` are split into strict-schema fields (`to`, `to_point`; `control`,
  `value`); no test uses `drag` or `set`.

### Locators (strict: exactly one match, or an issue naming every match)

`{"role", "name"}` (either may be null, not both), `{"item": "ID[#sub]"}`, `{"handle"}`, `{"text"}`, `{"label"}`; one form per
locator. `{text: T}` is the innermost element whose drawn text is exactly T. `{label: L}` is the one form control (a text input of
any kind, check box, switch, radio, slider, combo box, spin button) whose accessible name is L or, when it has none, whose visible
label is L: the text L drawn before it in its own container. gpui-shell's script `Input` can't carry an accessible name (its
materializer drops `accessibility_label`), so the fixture's field is labelled the second way. `count` assertions count matches and
are the one place a locator may match zero or many.

### Replies

Every reply has `ok` and `t` (flicks since launch on the replica's clock; 705,600,000 a second). Failures are
`{"ok": false, "error": {"code", ...}}` with codes `locate.ambiguous` (`matches: [{role, name, bounds}]`, one per match),
`locate.none`, `timeout` (`timeout_ms`), `refused`, `blocked` (a launch past the lease names the lease).

| Call | Reply on success |
|---|---|
| `launch` | `{ok, t, replica: "replica:<id>", window: {size, scale}}` |
| `act` | `{ok, t, point: [x, y], box: [x, y, w, h], waited_ms}` |
| `wait_for` | `{ok, t}` |
| `see` | `{ok, t, snapshot, sha256}`; `snapshot` is #338's shape `{window, tree, items}`, a node `{role, name, value, bounds, children}`; with `scope: "locator"` the tree's root is the located node |
| `screenshot` | `{ok, t, sha256, path, w, h}`: the PNG at `path` hashes to `sha256` |
| `record` start | `{ok, t}` |
| `record` stop | `{ok, t, sha256 /* the video */, fill: [r, g, b, a], frames: [{t, sha256, path, masks: [[x, y, w, h]]}], actions: [{t, kind, point, box, locator}]}`; `frames[].t` and `actions[].t` are flicks since the recording started, frames at exactly 1/30 s apart |
| `expect` | `{ok: true, t, assertion: {name, assert, passed, expected, actual}}`; a failed assertion is still `ok: true` |
| `close` | `{ok, t, journey: {outcome, tests_run, failures, steps, evidence}, trace: {sha256, path}}` |

All bounds, points, boxes and masks are whole device pixels at the launch's scale (#338's convention). `journey` is the part of
`@deepbuild/verdicts`'s `Run` a journey check's runner takes from the replica: `outcome` `passed` (every assertion passed, at least
one), `failed` (one failed, or a call errored), `ran_nothing` (no `expect`); `tests_run` the number of assertions; `failures` one
verdicts `Failure` per failed assertion, `test` its `name` (else `step <i>`), `case` null or a text holding the name, plus one per
errored call (`test: "step <i>: <call>"`); `steps` one `{id, digest}` per call between launch and close, `digest` 64-hex; `evidence`
one captured slot `{slot, state: "captured", sha256}` per screenshot, recording and the trace.

### Planted programs

`DEEP_DRIVE_PLANT` on `deep-drive`: `answers-your-record` (the card's input counts as yours and its answer reaches your hub),
`writes-clipboard` (a panel's clipboard write reaches the system pasteboard), `moves-focus` (`activate_window` and focus reach the
OS: the replica becomes the frontmost app), `starts-sound` (the app's notification sound plays through the OS). `DEEP_HUB_PLANT` on
`deep hub run`: `deep-drive-no-lease` (deep_drive launches replicas without the lease); add it to `packages/hub/src/plant.ts`.

### The hub, the lease and the perf lane

`deep_drive` over `deep mcp` (a session's call, bound as #26 binds calls) starts a `deep-drive` process per launch under a lease
whose kind allows two per machine; a third launch while two run answers a refusal (an `isError` tool result or `ok: false`) whose
text names the lease, and no third process starts; `close` ends the process and the lease. `benchmarks/budgets.json` holds tasks
`replica-launch`, `replica-action`, `replica-snapshot-2000` and `replica-memory`, each running `deep-drive` (in its command or in the
script its command runs), so the perf lane compares them with the merge base.

### The reading: `scripts/drive-reading.mjs`

`export function driveReading({agent: {name, version}, runs: [{version, first_try: bool, failed_step: string | null}]})` returns
`{agent, version, runs: 5, first_try: k, open_item: null | {on: "extension-guide", text}}`. It throws unless there are exactly 5
runs, a pinned `agent.version`, and every run on it. `open_item` is set only when `k < 4`, and its text names the agent and a step
that failed. Nothing in it is `PASS` or `FAIL`.

### Recorded runs (`fixtures/runs/*.run.json`, format `deep_drive.run@1`)

`{format, agent: {name: "claude-code" | "codex", version}, session, panel, calls: [<deep_drive arguments>]}`. A replay (helpers.ts,
`replay`) sends the calls in order to a fresh `deep-drive`, with `launch.panel` replaced by the panel under test and `replica` by the
new handle, and adds a `close` when the run has none. The two fixture runs are written in each agent's manner (role-and-name locators
and a named `close` for Claude Code; a text-input role, typing into focus, `tab`, `count` assertions and no close for Codex); the live
file records real ones into the same format through `fixtures/mcp-record.sh`, from what the session sent: the agent starts
`/bin/bash mcp-record.sh <dir> node <cli> mcp`, which execs into `deep mcp` (same PID, so it stays the agent's direct child and the
hub binds its calls to the session) while two `tee`s copy the agent's lines to `<dir>/in.jsonl` and the replies to `<dir>/out.jsonl`.

### Fixtures

- `fixtures/panels/save-form`: an "Email" field (gpui-base `Input`, filled `#36d399`, a green nothing else draws), a Save button
  (accessible name "Save") enabled only for an email address, "Not saved" / "Saved <email>", 300 points above the field and 1,200
  below (both spacers `flex_shrink_0()`, so the scrolling column can't shrink them away), and a counter redrawn every 4 ms of the
  replica's clock. `save-form-twin`: the same with `SAVE_STAYS_DISABLED = true`, the one
  line that differs (the twin test checks it).
- `fixtures/panels/tries`: a "Try" button that writes `deepbuild-124-replica-clipboard-marker` to the clipboard, calls
  `window.activate_window()` and takes focus; its manifest grants the clipboard write.
- `fixtures/panels/many-nodes`: 2,000 buttons named `Node <i>`, all on screen in the 260-point slot (the snapshot budget, and the
  strict-locator test's many matches).

## Criteria, tests and wrong programs

| ID | Criterion (short) | Tests | Wrong programs it must fail on |
|---|---|---|---|
| `#124.b486fffb` | Recorded runs from a Claude Code and a Codex session pass in a replica, fail on the twin naming the assertion and send the claim back; the first-try reading | `ac1-replay.test.ts`: every recorded call passes the hub's strict check and `deep mcp` lists `deep_drive`; each run replayed on the fixture: every assertion answers its name and passes, journey `passed`, `tests_run` = assertions, a step per call, screenshots in the evidence by hash, and `verdict()` from `@deepbuild/verdicts` passes the claim; each run on the twin: `save-enabled` fails once, journey `failed` naming it, `verdict()` FAIL with a send-back for `journey:save-form` naming `save-enabled`; the run with its `expect` calls taken out ran nothing and isn't PASS; `driveReading` keeps the rule. Live: `ac1-agents.live.test.ts` | The twin panel; the run stripped of assertions (pictures only). Wrong readings planted in the file: an item at 4 of 5, a PASS/FAIL outcome, an item naming no step, a reading that ignores the pin |
| `#124.ca91d3c1` | A replica's input never answers an ask in your record, starts sound, writes the clipboard or moves focus in your app | `ac2-isolation.test.ts`: your hub holds an open choice ask; a `record_copy` replica with the trying panel takes every input that could answer or leak; your log gains no closing event for the ask and nothing written as `app`, the pasteboard never holds the marker, the frontmost app never changes nor becomes the replica, the replica never registers as a foreground app, and coreaudiod never holds audio out for it; the Try button was clicked | `DEEP_DRIVE_PLANT` = `answers-your-record`, `writes-clipboard`, `moves-focus`, `starts-sound`, each through the same fixture and judge, each named |
| `#124.3c201481` | The same run twice on a virtual clock: same snapshots, same screenshot hashes | `ac3-repeat.test.ts`: two replicas, one run each, five points (launch, typed, 1.5 s later, scrolled, saved): snapshots and their hashes equal, screenshot hashes equal (each file hashes to its reply), and the run changed the screen | The same run on `clock: "real"`, twice: the 4 ms counter differs and the judge names where |
| `#124.46173b23` | A recording with `mask: [{label: "Email"}]` over a 200 px scroll fills the field's box with the fill role in every frame, mid-scroll ones included; one actions entry per action, each click's point in its element's box | `ac4-mask.test.ts`: the run recorded masked and unmasked in two replicas; frames at exactly 30 fps with none missing; in every frame the masked box has the field's size and every pixel in it is the ink role (`brand/palette.json`'s ink, opaque, also the reply's `fill`); no pixel of the field's green shows anywhere; every green pixel of the unmasked frame lies in that frame's box; nothing outside the box differs; the boxes move 200 px x scale from `see`'s bounds before the scroll to after it, with at least one frame between; the actions list has 4 entries in order, each click's box equal to `see`'s bounds of the element and its point inside | On the real recording: mid-scroll frames dropped, the mask a frame behind, no mask, an entry missing. On synthetic recordings (judge tests): skipped frames, lag, a box stuck before the scroll, another fill, one unmasked frame, no scroll; a missing entry, a click outside, a wrong box |
| `#124.b8efd107` | Budgets on the reference Mac vs the merge base: launch < 2 s, action < 50 ms + wait, 2,000-node snapshot < 20 ms, < 500 MB, at most two per machine under a lease | `ac5-lease.test.ts`: the perf lane's four tasks exist and run `deep-drive`; through `deep_drive` over `deep mcp` from two agent stand-ins, two launches run, a third is refused naming the lease with never more than two processes, and succeeds once one closes. Live: `ac5-budgets.live.test.ts`, five readings each judged by `judgeLimit` (PASS only on a reference Mac): spawn to launch's answer < 2,000 ms; click round trip less `waited_ms` < 50 ms; `see` of the 2,000-node panel (2,000 `Node <i>` nodes) < 20 ms; peak RSS over a replay < 500,000,000 bytes | `DEEP_HUB_PLANT=deep-drive-no-lease`: a third replica runs, named |

Scope tests, untagged: strict locators (on the many-nodes panel, a `{role: "button"}` click answers `locate.ambiguous` naming every
button the snapshot holds, a missing text `locate.none`, and the snapshot is unchanged) and the default timeout (a click on the twin's disabled Save answers `timeout` with
`timeout_ms: 5000` after 5,000 ms of the replica's clock).

## Live only, and why

- Criterion 1's sessions (`ac1-agents.live.test.ts`, `DEEP_DRIVE_LIVE=1`): they run real `claude -p` and `codex exec` and spend plan
  usage. Per agent, one session drives a copy of the fixture panel and its recorded run is replayed on the fixture (pass) and the twin
  (fails `save-enabled`, sent back); five sessions build a panel from one brief and drive it, and the replica's answer to each session's
  first `close` says whether its first drive passed; `driveReading` makes the reading and writes it with every run file under
  `$DEEP_DRIVE_LIVE_OUT`. Hooks and `deep mcp` are wired as #806's live tests wire them; Codex signs in with `CODEX_API_KEY` or a copy of
  `~/.codex/auth.json`.
- Criterion 5's timings (`ac5-budgets.live.test.ts`, `DEEP_DRIVE_BUDGETS=1`): they count only on a reference Mac on mains power, so the
  local preflight's perf step runs them there; anywhere else `judgeLimit` gives INCONCLUSIVE and the test fails.

## Redraft, October 30 (two disputes from a run against an implementation)

- The save-form panel and its twin didn't scroll 200 points: their spacers were empty flex items in the `size_full()` scrolling
  column, so they shrank (measured: the field at y 475 device px at launch, and a 200-point scroll moved it 48). Both spacers now
  carry `.flex_shrink_0()`, the same edit in both files, so the twin still differs in its one line. Per the dispute, a copy with this
  edit put the field at y 754 and the 200-point scroll moved it exactly 400 device px.
- The strict-locator test assumed the shell draws a button besides Save; the shell's views expose none (their rows are `label`s).
  It now launches the many-nodes panel, whose own 2,000 buttons make `{role: "button"}` ambiguous whatever the shell draws.
- Criterion 2's record couldn't be seeded: an authority ask raised through #26's `seed` is refused by the asks core since #69
  (an authority ask must show its plan, and #26's `askData` gives none). Your record now holds an open `choice` ask, which the core
  accepts on the base (checked once by hand with #26's `seed`); the criterion covers any ask in your record, and the rest of the
  test and its judge are unchanged.
- The live recording left every deep_drive call unbound: a Node tee in front of `deep mcp` made the tee, not the agent, `deep mcp`'s
  parent, and the hub binds a call only to the session whose agent is that parent (`Core.bind`), so a live Codex run saw only
  `unbound` refusals. `fixtures/mcp-tee.mjs` is replaced by `fixtures/mcp-record.sh`, which execs into `deep mcp` and tees both
  streams to files beside it; checked by hand that the server runs as the PID the agent spawned, with the agent as its parent, and
  that both directions are recorded line for line, also with an empty environment. The rest of the live file and the reading are
  unchanged.

## Judgment calls a redraft may revisit

- **Run-time surface.** One binary per replica speaking the MCP tool's arguments as JSON lines, every name above, the reply shapes, the
  error codes, `t` in flicks, device-pixel geometry, the `expect.name` field (the issue's `expect` has no name; a failure must name
  its assertion), `record.action` (strict schemas have no boolean check at the base, so start and stop are an enum), and the panel in
  the sidebar slot.
- **"Sends the claim back"** is judged with the base's verdict engine on the replay's journey, as a journey check's run; the hub's own
  `claim.sent_back` event is not asserted, since sending back is the gate's work on the verdict. The judged requirement is one that
  must keep passing, so no merge-base run is needed.
- **The fill role** is `brand/palette.json`'s ink (21, 22, 25), opaque, for the light theme; a 1-device-pixel band around the box (the
  field's anti-aliased edge) isn't judged for leaks or differences. Pixels inside the box must be exact.
- **Mid-scroll frames exist**: a 200 px scroll spans several frames; an instant scroll fails ("no frame was recorded mid-scroll").
- **Your app**, for focus, is whatever is frontmost on this Mac; the clipboard is the general pasteboard; sound is an audio-out
  assertion coreaudiod holds for the replica's process tree, sampled every 100 ms until 1.5 s after the run. Switching apps or copying
  the marker by hand during a run would fail it. The planted clipboard and focus tests put the pasteboard text and the frontmost app
  back afterwards (`pbcopy`, `open -b`); a UI-element front app may not come back.
- **The answer attempt** reaches the card by clicking the ask's row (`{name: "ask:<id>"}`) and every uniquely named button, and
  pressing enter, 1, cmd-enter and space; the planted `answers-your-record` must answer through that same input.
- **Lease and processes.** Two per machine is observed as `deep-drive` processes under the hub and the refusal's words naming the
  lease; the lease kind's name and the record's lease events aren't pinned.
- **The reading's open item** is checked as `driveReading`'s output; filing it in the record (and on which `task_ref`) is left to the
  implementation, since the open item's schema needs a task and "the extension guide" is none.
- **The perf lane** is checked for its four task ids running `deep-drive`; their limits are left to the perf lane's convention (the
  issue's numbers are judged in the live file).
- **Real clock as the wrong program** for criterion 3 is probabilistic in principle; with a 4 ms counter over five points and seconds of
  wall time, two equal real-clock runs are not expected.

## Criteria 6 to 8, and the two Scope lines with no criterion of their own

Added blind on November 6 at base commit `c12a65bb`, by a job that saw only the issue with its November 3 reopen comment, the design
(Replica; Extension API; Dogfooding; How runs become one of five verdicts) and the code at that commit. No hit test, probe or UI check
exists there. The files: `ac6-scrim.test.ts`, `ac7-ui-check.test.ts`, `ac8-shown.test.ts`, `scope-merge-base.test.ts`, `ui-helpers.ts`,
`fixtures/panels/{scrim-dialog,audit-clean,audit-marks}`, `fixtures/stress/text.events.jsonl`. The commands above run them.

### New surface (additions to The surface; everything above stands)

**`act`, a pointer action.** Pointer actions are `click`, `double_click`, `hover`, `drag`, `scroll`, and `type` or `set` with a locator
(they click first). Before one, the replica hit-tests the exact point it will use, and that test sends the app nothing: no move, no
press, no hover. The element that would receive the event is the top one at the point, so a dialog's button inside its scrim's box
receives its own click.

- Delivered: the existing reply plus `result: "delivered"`. The reply says nothing about what the target did: no key like `handled`,
  `saved`, `success`. A button with no handler gets the same word.
- Another element would receive it: `{ok: false, error: {code: "refused", message, covered_by: {role, name, bounds}, point: [x, y],
  box: [x, y, w, h]}}`. `message` holds the name, `bounds` are that element's real bounds, `point` the point tested, `box` the target's.
  Nothing is sent, and a refused action fails the journey as any errored call does (`step <i>: act`, its failure text naming the element).

**`probe`, a new call.** `{"call": "probe", "replica": "...", "locator": Locator}`. It answers the action's hit test without acting:
`{ok, t, point, box, receiver: {role, name, bounds}, clear: bool}`. `point` is the point a click would use, `receiver` what would get
it, `clear` whether that is the target. It sends the app nothing, is no entry in a recording's `actions`, and answers the same twice.
`SCHEMAS.deep_drive` in `packages/hub/src/tools.ts` takes it (add `probe` to `call`'s enum and to the "Give one of" check).

**`launch.fixture`.** `launch.fixture: "<absolute path>"` is a record fixture in the format of #338's
`docs/spikes/338/fixtures/needs-you.events.jsonl` (lines of `{session_id, event}`), read in place of that default when `from` is
`fixture`. A path that can't be read is `refused`, never the default record.

**`ui_check`, a new call.** It needs no replica; send it to a fresh process.

```jsonc
{"call": "ui_check", "ui_check": {
  "changed": ["crates/deep-app/src/views.rs"],  // repo-relative paths of the files the change touches
  "fixture": "<absolute path>" | null,          // the record every render draws, as launch.fixture
  "panel": "<absolute path>" | null,            // a panel package, mounted as launch.panel, whose loaded files are also views' files
  "promise": "nothing_visible" | null,          // the change promises nothing visible changes
  "base": {"drive": "<absolute path>",          // a deep-drive built at the merge base; it is spawned with `--out <dir>`
           "panel": "<absolute path>" | null}   // the panel's folder at the merge base; null: the same panel
         | null}}
```

The reply is `{ok, t, claim, views, findings, not_covered, differs, evidence}`:

- `claim`: `FAIL` when a finding exists or, under the promise, a pair differs; else `INCONCLUSIVE` when `not_covered` isn't empty, nothing
  rendered, or the promise has no `base`; else `PASS`.
- `views`: one `{view, files, renders}` per view that loads a changed file, in any order. `view` is the panel's name in
  `crates/deep-app/inventory.json` (`deepbuild/sidebar` draws the session row, in `crates/deep-app/src/views.rs`). `files` are the
  repo-relative files it loads: a panel's entry and every file it imports, never a file beside them that nothing imports.
- `renders`: exactly four: `{size: [w, h], scale: 2, theme, path, sha256, w, h, snapshot, findings, base?}`, at the reference window
  `[1512, 982]` and one narrow width, each light and dark. `path` is the window's PNG; `snapshot` is `see`'s shape for that render.
- A finding, in its render's `findings` and in the top-level list: `{audit, view, size, theme, node: {role, name, bounds}, box, frame,
  text}`. `outside_frame`: `node` is the element, `frame` its bounds, `box` the extent actually drawn, past the frame. `cut_off`: `node`
  is the element, `text` the text as drawn, and its accessible name doesn't hold the full value. `no_name`: `node` is a control with no
  accessible name and no drawn text. `raw_key`: `text` is the key as drawn and `box` its bounds. `frame` and `text` are null where they
  don't apply.
- `not_covered`: the changed files no rendered view loads.
- `base` on a render, with `ui_check.base`: `{path, sha256, same}`, the same view at the same size and theme from the merge base's build.
  `same` is true only if the two PNGs are pixel for pixel equal. `differs`: `[{view, size, theme}]`, one per pair that differs.
- `evidence`: `{slot, state: "captured", sha256}` per render.

The merge base's side is driven through `launch`, `see`, `screenshot` and `close` alone, so a merge base with no `ui_check` still
renders. `DEEP_DRIVE_PLANT` applies to every render of the process it's set on, and not to `base.drive`.

### New planted programs

- `no-hit-test`: pointer actions skip the hit test; `probe` is left alone.
- `row-label-past-frame`: the real session row draws its label past its frame, as it does at the base on the stress set (below).
- `row-branch-cut-off`: the real session row draws cut off, with an accessibility name holding only the cut-off text, so a session titled
  with a branch name loses it. It draws nothing past its frame. Each plant changes what the row draws or names, never the audit.

### Fixtures

- `fixtures/panels/scrim-dialog`: a draft (`Draft: Release notes, second pass`), Save, a dialog open at launch with "Keep editing", and its
  transparent scrim, a button named `Scrim` over the whole panel. Pressing the scrim closes the dialog and discards the draft
  (`Draft discarded`). `Scrim events <n>` counts every pointer event the scrim is sent. `Ignores clicks` has no handler.
- `fixtures/panels/audit-marks` and `audit-clean`: `audit-marks` has an icon-only button with no name and the raw key
  `panel.actions.save_label` drawn as text; `audit-clean` has them put right. Each also has a text button with no name of its own, which is
  no finding. `audit-clean/main.js` imports `words.js`; `audit-clean/unloaded.js` sits beside it and nothing imports it.
- `fixtures/stress/text.events.jsonl`: the stress set for text. Six sessions, each titled with one string: a repo, a branch and a worktree
  path with no spaces, an issue title, a model ID and a command (`ui-helpers.ts`, `STRESS`); every session has the long branch and worktree
  in its `session.start`, and the command's session has a reading holding the command.

### Criteria, tests and wrong programs

| ID | Criterion (short) | Tests | Wrong programs it must fail on |
|---|---|---|---|
| `#124.770659f5` | A click on Save under the transparent scrim is refused naming it, draft unchanged | `ac6-scrim.test.ts`: "with the scrim over Save the click is refused..."; "every pointer action under the scrim is refused..."; "a journey that clicks under the scrim fails..." | A click that reaches the scrim; a refusal naming anything but the scrim's real node; any event sent to it, moves included |
| `#124.770659f5` | With the scrim gone the click is delivered and says so | "with the scrim gone the click is delivered...": also the scrim's pixels over Save are none, and a handler-less button gets `delivered` | A result that reports what the target did; a hit test that refuses a dialog's own button |
| `#124.770659f5` | The probe names the scrim without dismissing it | "the probe on Save names the scrim without dismissing it...": same answer as the refusal, same point as the click | A probe that moves the pointer, dismisses, or counts as an action |
| `#124.770659f5` | The planted driver dismisses the dialog, discards the draft and fails, naming the scrim | "a planted driver that clicks Save's box centre...": the name comes from the probe's real answer, the same judge as the honest run, and the verdict engine sends it back | `DEEP_DRIVE_PLANT=no-hit-test` |
| `#124.5bbd73d9` | The check on the session row renders it four ways | `ac7-ui-check.test.ts`: "a change to the session row renders it four ways..."; "the honest row draws nothing past its frame..." | Judge tests: three renders, one size, no narrow width, one picture twice, dark drawn light |
| `#124.5bbd73d9` | Fails a planted label past its frame and a cut-off branch name, naming each | "a planted label drawn past its frame fails..."; "a planted cut-off branch name..." | `row-label-past-frame`, `row-branch-cut-off`; each finding is checked against the render's own snapshot, and the first against ink in the PNG past the row's frame |
| `#124.5bbd73d9` | A file no view loads is not covered; the UI claim is INCONCLUSIVE, never PASS | "a change to a file no view loads..."; "a clean view beside a file no view loads..."; "a finding beside a file no view loads fails..." | Judge tests: PASS beside an uncovered file, an unlisted file. A program that calls everything in a panel's folder loaded, or only its entry |
| `#124.ca19630a` | The pictures and recording from the replica at the reference window; one taste call, recorded; without it INCONCLUSIVE, never PASS | `ac8-shown.test.ts`: "the check run takes the screenshots..."; "the taste call's rule..." | The rule test: nothing recorded, a call on other files, no name, another criterion, `looks_wrong` |

Scope tests, untagged: `ac7-ui-check.test.ts` "the panel with both gets one finding of each..." and "the same panel put right gets none..."
(an icon-only control with no name, a raw string key); "long repo, branch and worktree paths..." and "an honest ellipsis isn't a finding..."
(the stress set); `scope-merge-base.test.ts` (the merge base beside the change: four matching pairs and PASS, rendered by the base's own
build; a visible change fails naming each pair; the promise with no base is INCONCLUSIVE; the real session row).

### The taste call

`ac8-shown.test.ts` takes every picture from the replica and writes them to `$DD124_SHOTS`, or `target/acceptance/124/`:

| File | What it shows |
|---|---|
| `saved-highlights.png` | The save form driven to Save, with Save and the field highlighted in the strip |
| `masked-mid-scroll.png` | One frame of the masked recording, mid-scroll |
| `scrim-refusal.png` | The scrim panel after the refused click, with Save highlighted in the strip |
| `dark-launch.png` | The save form on a dark launch |
| `masked-scroll.apng` | The recording of the masked scroll |

It checks their form only. Those files are attached to the PR and shown to you in the session; that part is the implementing agent's and no
test sees it. Your answer goes in `tests/acceptance/124/TASTE.json`, the one file added to this folder after this redraft, and only to
record it (#1174's form):

```json
{"issue": 124, "criterion": "#124.ca19630a", "verdict": "looks_right" | "looks_wrong", "who": string, "when": "ISO 8601 time",
 "files": {"saved-highlights.png": sha256, "masked-mid-scroll.png": sha256, "scrim-refusal.png": sha256, "dark-launch.png": sha256, "masked-scroll.apng": sha256}, "note"?: string}
```

No `TASTE.json` is INCONCLUSIVE. A call with no name or time, on another criterion, or whose `files` aren't this run's SHA-256s is
INCONCLUSIVE. `looks_wrong` fails, and `looks_right` on exactly this run's files passes. The virtual clock makes the hashes repeat
(criterion 3), so a call stands until the pictures change.

### What the implementer owes outside this folder

`deep-drive` (the calls and plants above), `probe` in `packages/hub/src/tools.ts`, and the session row itself: at the base the real row
draws past its frame on the stress set (the repo row puts 106 pixels of ink in the 12 px band right of the frame at the reference window,
light, and short rows put 0), so the honest row has to end within its frame with its full text in its accessible name, as the sidebar's
readings already do. `scripts/lanes.mjs` already lists this folder as `alone`; nothing new is owed there.

### Judgment calls a redraft may revisit

- **"Nothing is sent" counts moves.** The scrim's counter counts `on_mouse_move` too, because a read-only probe that moves the pointer
  isn't read-only, and the base's click starts with a move. GPUI's own `hit_test` is `pub(crate)`, so the implementer has to read the frame
  another way (the observed elements' paint order, for instance). If that can't be done without a move, this is the assertion to dispute.
- **The scrim is a Button.** A script's plain `div` gets no accessibility node, whatever its `role`, so nothing could name it. The scrim is a
  transparent `Button` inside a positioned `div`; the pixel comparison in the delivered test holds that it draws nothing over Save.
- **The planted driver's "fails, naming the scrim"** is read two ways, and both are tested: the judge's problems, named from the probe's
  answer, and the journey's assertion `scrim-still-up`, sent back by the verdict engine.
- **Refused and timing.** An action under a scrim is `refused` with `covered_by`, whether at once or after a wait up to its `timeout`.
- **A pointer action** includes `scroll`, `drag`, and `type` with a locator (which clicks first); `set` isn't tested, the fixture has no input.
  A drag's drop point isn't hit-tested here.
- **The "branch name"** is a session titled with the branch, since the base row draws no branch. A row that draws `session.start`'s
  branch itself is equally judged, if `row-branch-cut-off` cuts it.
- **The narrow width** is any width under 1512; the issue names no number. Which other views `views.rs` touches, and any findings on them,
  aren't judged: the honest test reads `deepbuild/sidebar` alone, so a real defect elsewhere makes the claim FAIL there, not this suite.
  The clean-panel tests audit the panel's view alone, so the record's rows beside it don't count.
- **A file no view loads** is `crates/deep-replica/src/live.rs` (the live capture, a tool beside the app) and `audit-clean/unloaded.js`.
  A check that decides by Rust module graph or by `inventory.json` both fit.
- **`ui_check` is a call of the binary**, not yet of `deep mcp`: the hub starts a process per launch, the issue names no agent use of the mode,
  and a check runs it. `probe` is an agent's call, so the strict schema takes it.
- **Reading a PNG** in criteria 6 and 7 is arithmetic (size, mean luma, equal pixels, ink past a frame), never a judgment of how it looks;
  the taste call alone does that.
- **Findings and `claim`** are this job's shape; the UI claim is the reply's word, not yet a verdict-engine run.

## Redraft, November 6 (`ac5-lease.test.ts`, the count in `#124.b8efd107`)

Redrafted from the same inputs as the first draft and the criterion: the issue, the design (One role per credential; Replica, Cost)
and the code at base `c12a65bb` (`Core.mcpHello`, `Core.bind`, `hookmap.ts`, `drive.ts`, #806's `Stand`, #26's binding tests), never an
implementation. The first draft sent the Codex session's calls with no PreToolUse, so each was refused `unbound` before it reached
the lease; a Codex `deep mcp` binds to nothing and each call binds only by its own stamp. Every call now goes through `Stand.stamp`,
as #806's do. The judge also samples processes through the third launch's call instead of after it, and holds the exact count after
the launches, after the close and after the third launch gets its place. Its names, helpers and planted hub are unchanged.

## Redraft, November 7 (`ac2-isolation.test.ts`, focus in `#124.ca91d3c1`)

Redrafted from the same inputs as the first draft and the criterion: the issue, the design (Replica) and base `c12a65bb`, never an
implementation. The planted `moves-focus` replica wasn't named: on macOS 27.2, `lsappinfo info -only <key>` no longer prints
`"ApplicationType"="Foreground"`, `"pid"=…` or `"CFBundleIdentifier"="…"`; it prints its record, with `type="Foreground"`,
`pid = 123` and `bundleID="…"`. So the "registered as a foreground app" line never fired, the frontmost app's PID was always null,
and the planted tests never found the bundle to put the front app back. Cooperative activation (macOS 14 and later) also keeps
`activateIgnoringOtherApps` from changing the frontmost app, so that line can't catch the plant either; it stays as it was. The
three readers (`foreground`, `frontApp`'s PID, the planted tests' bundle id) now take either format. The judge's lines, names,
samples and the clipboard, sound and ask checks are unchanged. Measured on the base: the honest replica's judge returns no
problems, and `moves-focus` is named `moved focus: the replica registered as a foreground app`. A plant test can still pass when
someone switches apps during it, since any change of the frontmost app is judged as moved focus (Judgment calls: Your app).

## Criterion 9: a journey's UI check at every step (added November 7)

Added blind on November 7 at base commit `c12a65bb`, by a job that saw only the issue with the owner's new Scope line and criterion,
the design (Replica; Replica `deep_drive`; How runs become one of five verdicts, journeys and app journeys) and the code at that commit,
plus this folder's earlier blind files. No check over a journey, no step audit and no device exists there. The files:
`ac9-journey-steps.test.ts`, `scope-ac9-device.test.ts`, `journey-helpers.ts`,
`fixtures/panels/{journey-cover,journey-cover-twin,device-insets,device-insets-twin}`. `ui-helpers.ts` is used unchanged. Run them with
`npx vitest run --root tests/acceptance/124 --no-file-parallelism ac9`.

### New surface (additions to The surface; everything above stands)

**`ui_check.journey`.** `ui_check` takes a journey: `{"call": "ui_check", "ui_check": {"journey": [<deep_drive arguments>]}}`, the calls in
order, a `launch` first, with no `replica` (the check adds the handle, and a `close` when the journey has none). The other `ui_check` fields
may be left out; then `views` and `not_covered` are empty and the claim rests on the steps. The check replays the journey in a fresh replica
and audits the screen after every step: step `i` is the `i`-th call after the launch, as `close`'s `journey.steps` numbers it. With
`launch.panel`, it audits the nodes the panel draws, the same rule as the clean-panel tests above, so the shell's rows beside it don't count.
The reply adds:

- `journey`: `close`'s journey for the replay, `{outcome, tests_run, failures, steps, evidence}`.
- `steps`: one `{step: i, id: "step i: <call>", snapshot, findings}` per step, in order, `id` the journey's own step id, `snapshot` `see`'s
  shape for the screen after that step.
- Each finding also carries `step: i` and `by: {role, name, bounds}`, and is in its step's `findings` and the top-level list. Three new
  audits: `under_sibling`, a node drawn under a sibling, `by` the sibling over it; `under_system_bar`, `by: {role: "system_bar", name: null,
  bounds}`; `under_keyboard`, `by: {role: "keyboard", name: null, bounds}`. `node` is the covered element with its real bounds, `box` the part
  of it covered (the overlap of the two boxes), `size` and `theme` the launch's.
- `claim`: `FAIL` when a finding exists; else `INCONCLUSIVE` when a step has no audit or the journey didn't pass (it ran nothing, having
  no `expect`, or it failed); else `PASS`. Only the first two are tested; a failed journey is never PASS either way.

**`launch.device`.** `{"system_bar": <points>, "keyboard": <points>}`: the replica draws a system bar that tall over the window's top edge
for the whole run, and an on-screen keyboard that tall over the bottom edge while a text input has focus, each across the window's width.
In device pixels at the reference window and scale 2, `{system_bar: 24, keyboard: 300}` puts the bar at `[0, 0, 3024, 48]` and the keyboard at
`[0, 1364, 3024, 600]`. With no `device` there is neither. `SCHEMAS.deep_drive` in `packages/hub/src/tools.ts` takes it in `launch`.

### Fixtures

- `fixtures/panels/journey-cover`: three pages, each but the last with "Next". Page 3 has "Publish" and, in the same row, its sibling
  "Promo banner", drawn after it and filled `#e8590c`, an orange nothing else draws; "Hide banner" takes the banner away. With
  `COVERED = true` the banner lies over Publish. `journey-cover-twin` is the same file with `COVERED = false`, the one line that differs:
  the banner lies beside Publish. The journey: step 1 asserts "Page 1 of 3", steps 2 and 3 click Next, step 4 clicks "Hide banner",
  step 5 asserts Publish visible. So only the screen after step 3 has a node under a sibling, and the journey's assertions pass either way.
- `fixtures/panels/device-insets`: "Account" 4 points from the panel's top, a "Message" field mid-panel (labelled by the text before it),
  and "Send" pinned 12 points above the bottom. `device-insets-twin` is the same file with `SAFE = true`: Account 48 points down and Send
  under the field. The journey launches with `device: {system_bar: 24, keyboard: 300}`; step 1 asserts "Compose a message", step 2
  clicks the field, step 3 asserts again.

At the base, a plain run of each fixture draws what this says: on page 3 the banner's box holds Publish's and 9,440 of Publish's 11,200
pixels are orange (0 on the twin); Account is at `[24, 8, 200, 56]` and Send at `[24, 1884, 160, 56]` (twin: `[24, 96, ...]` and
`[24, 496, ...]`).

### Criteria, tests and wrong programs

| ID | Criterion (short) | Tests | Wrong programs it must fail on |
|---|---|---|---|
| `#124.f1263f80` | A planted button under a sibling at step 3 of a journey fails, naming the step and the node | `ac9-journey-steps.test.ts`: "a planted button under a sibling at step 3...": a plain run shows the banner over Publish after step 3 (its box and its pixels) and nothing covered at the end; the check audits all five steps, the journey passes, the claim is `FAIL`, and the one finding is `under_sibling` at step 3 alone, naming Publish at its real bounds under "Promo banner", `box` the overlap, `id` `step 3: act`; "the twin journey...": every step audited, page 3 reached with the two apart, no finding, `PASS`; "the same journey with its assertions taken out...": `ran_nothing`, steps still audited, `INCONCLUSIVE` | A check of the end screen alone, of the launch alone, or of the rendered views alone (none names step 3). Judge tests: the end screen alone saying PASS, no steps, a skipped step, a step with no snapshot, a finding at step 4, the sibling named as the covered node, no `by`, a wrong box, a finding missing from the top-level list or filed under another step |

Scope tests, untagged: `scope-ac9-device.test.ts`. On `device-insets` with the device, Account is named `under_system_bar` at every step and
Send `under_keyboard` at steps 2 and 3, not 1, each at its real bounds with the bar's and the keyboard's boxes; the claim is `FAIL`. The twin
gets nothing and `PASS`; the plant with no device gets nothing and `PASS`; the hub's strict check takes `launch.device`.

### Judgment calls a redraft may revisit

- **The surface for "a journey".** The check takes the journey as its list of `deep_drive` calls in `ui_check.journey` and replays it, as
  a journey check replays a recorded run, rather than a launch flag that audits an agent's live run. `ui_check` stays a call of the binary.
  The step numbering is the replica's own (`step i` from the first call after launch), so "step 3" is the third call.
- **What "fails" is.** The UI claim is `FAIL`; the journey's own outcome stays `passed`, since its assertions pass, and the claim is the
  reply's word, as in criterion 7. Whether a finding should also fail the journey for the verdict engine is left to a redraft.
- **One audit per step, at the launch's size and theme.** The step check doesn't render each step four ways, as a changed view is.
- **"Under a sibling"** is judged on the snapshot: two nodes of one parent whose boxes overlap, the later-drawn one on top. Here both are
  buttons, because a script's plain `div` gets no accessibility node; the base's snapshot puts every panel node under the window, so they
  are siblings there. Paint order is shown by the plain run's pixels, never asked of the check.
- **The system bar and the on-screen keyboard.** The design names neither for the replica: a fixed status bar appears only in an app
  journey's device profile (iOS simulator, Android emulator), and no on-screen keyboard appears at all. The issue's Scope line names both,
  so `launch.device` is this job's choice: a bar over the top edge and a keyboard over the bottom, given in points, the keyboard up only
  while a text input has focus. If the owner means something else (a device model, the macOS menu bar, the Accessibility Keyboard),
  `scope-ac9-device.test.ts` is the file to redraft; the criterion's file doesn't depend on it.
- **The panel's nodes only.** With a panel, the shell's "Needs you" heading and session row are left out: at the base they lie under a
  24-point bar and a 300-point keyboard too, and the shell has no device-aware layout.
