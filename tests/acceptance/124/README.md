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
`cargo build --locked -p deep-replica --bin deep-drive`; the live agents file also needs `target/debug/deep-hook`. Temp folders are
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
