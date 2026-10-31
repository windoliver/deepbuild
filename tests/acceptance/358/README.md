# Acceptance tests for #358: the panel host spike, agent-built panels out of process with the JIT off

These tests were drafted blind from issue #358, `docs/technical-design.md` (Dogfooding; Tests written first; the Panel section; the Decided row "Where agent-built panels run"; the reference Macs), `docs/canvas-primitives.md` (Panel runtime and panel host), gpui-shell at the commit `Cargo.lock` pins (its `crates/shell/src/tests/benchmark.rs`, README and script surface) and the base commit `244a345`, which has none of #358. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

The issue is a spike, so what it proves is a record plus real runs. The tests don't take the record's word for what they can see themselves. They write the panels, with coordinates and text drawn per run; pass gpui-shell's own benchmark source, read from the pinned dependency; work out from the laid-out trees which nodes leave the panel or touch the card; decode the render's pixels; read the build's profile from cargo's messages and the entitlements from `codesign`; recompute the cost verdict from raw update times; and watch process IDs, CPU time and a real listener from outside.

## The surface (my choice, since the issue names none)

### The record, `docs/spikes/358/record.json`

```json
{
  "spike": 358,
  "machine": { "model": "Mac15,12", "chip": "Apple M3", "memoryBytes": 17179869184, "power": "ac", "lowPowerMode": false, "thermalState": "nominal" },
  "build": ["cargo", "build", "--release", "--locked", "-p", "<host crate>", "-p", "deep-app"],
  "host": { "bin": "<the host's binary name>" },
  "app": { "bin": "deep-app" },
  "check": ["{app}", "<subcommand>"],
  "run": ["{host}", "<subcommand>"],
  "bench": ["{app}", "<subcommand>"],
  "sign": { "command": ["codesign", "-f", "-s", "-", "--options", "runtime", "{binary}"] },
  "jit": { "switch": "<where the switch is>", "control": ["cargo", "test", "--release", "..."] },
  "out": "docs/spikes/358/out",
  "cost": { "runs": [ { "warmup": 64, "scriptNs": [], "ipcNs": [], "totalNs": [] } ], "jit": { "nativeEnabled": false, "installed": 0, "nativeEntries": 0 }, "hostPid": 2, "appPid": 1, "tree": {}, "worstP99Ms": 1.9, "fits": true },
  "decision": { "text": "<the decision, exactly as it appears in the Decided row>" }
}
```

`{app}` and `{host}` are the executables cargo reports for `app.bin` and `host.bin`, so they can't be another file. The tests add `--message-format=json` to `build`. `record.out` is a tracked copy of one live run, written by `DEEP_358_KEEP=docs/spikes/358/out node --test --test-concurrency=1 tests/acceptance/358/spike.live.test.mjs`: `cases/<id>.json`, `jit.json`, `signatures.json`, `bench.json`.

### The commands

All window geometry is in points. Each command writes JSON to `--out`.

**`check`**, the headless render check, in the app:

`{check} --host <path> --panel <dir> --origin agent_built --window 1512x982 --scale 2 --panel-area x,y,w,h [--card x,y,w,h --question <text>] --updates <n> --out <file> [--png <file>] [--serve]`

- `<dir>` holds `main.js`, as `crates/deep-app/panels/*/` do, and maybe `package.json`.
- It runs the panel in the host at `--host`, sends `n` invalidations, lays out each tree and shows the real question card when `--card` is given.
- It exits 0 on `pass`, 1 on `fail`. Any other exit is neither. Refused panels must still write `--out` and `--png`.
- Output: `{result, origin, runtime: "panel_host", appPid, hostPid, trees: [<one tree per invalidation>], violations: [{kind, update, bounds}], card: {question}}`. `kind` is `outside_panel`, `over_card` or `git_dependency`.
- A tree's node is `{kind, text?, bounds: [x, y, w, h], children}`, bounds in window points. **A string child is a node of its own**, as gpui-shell's snapshot counts it. A tree holds the panel's nodes only, without the app's frame.
- `--png` is the window's render, 8-bit RGB or RGBA, non-interlaced, at 3024 × 1964.

**`--serve`** holds the check open, with one JSON object per line: first `{ready: true, appPid, hostPid}`, then one reply per command on stdin:

| Command | Reply |
|---|---|
| `{cmd: "ping", seq}` | `{pong: seq}` |
| `{cmd: "invalidate"}` | `{tree}`, or `{error: "host_gone"}` with the host dead |
| `{cmd: "press", id}` | a real press on the panel's control `id`: `{serial}`, the gesture's serial |
| `{cmd: "blur"}` | the app takes focus back: `{}` |
| `{cmd: "focus_owner"}` | `{owner}`, `"panel"` when the panel holds focus |
| `{cmd: "focus_log"}` | `{moves: [{serial, result}]}`, `serial` null for none, `result` `moved` or `refused` |

**`run`**, the host alone: `{run} --panel <dir> --renders <n> --out <file>` writes `{pid, jit: {nativeEnabled, installed, nativeEntries}, renderNs: [...], tree}`, gpui-shell's `JitMetrics` by those names.

**`bench`**, through the app and the host: `{bench} --host <path> --panel <dir> --origin agent_built --runs <r> --updates <u> --out <file>` writes `record.cost`'s shape, without its verdict. `totalNs[i]` is one invalidation to a tree the app holds, at least `scriptNs[i] + ipcNs[i]`, each above zero; warm-up renders aren't counted.

**`jit.control`** runs the same host code with the switch flipped so the JIT is on, reading `DEEP_358_PANEL`, `DEEP_358_RENDERS` and writing `DEEP_358_OUT` in `run`'s shape. It can't be a way to turn the JIT on in the shipping host: a test target or a separate binary is the obvious form.

## How to run

- Public tests, fast with no build: `node --test tests/acceptance/358/spike.test.mjs`.
- Live tests, which build release binaries, on macOS: `node --test --test-concurrency=1 tests/acceptance/358/spike.live.test.mjs`. The cost comparison needs a reference Mac on mains at load under 8, and is INCONCLUSIVE, so failing, elsewhere.
- The checks' own tests, which plant wrong spikes: `node --test tests/acceptance/358/validator.test.mjs`. They pass at the base, since they test the tests.
- The preflight's patterns don't reach `.mjs` files here.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, computed with the command in `tests/acceptance/48/README.md`.

| ID | Criterion | Tests | Wrong programs it must fail on |
|---|---|---|---|
| `#358.bdd2af21` | A panel that draws outside its own area, or over the question card, fails the headless render check | Live, one each: an in-bounds control with the card up passes and is drawn in its fill; panels escaping `left`, `right`, `below`, `nested` (inside its parent, beyond the panel), `over-card` and `late` (in bounds on the first tree, out on the second) each exit 1, naming a violation the trees place there, with none of what they drew showing beyond the area or on the card. Public: the kept run's answers, recomputed | A host refusing everything (the control fails). One passing everything, or checking only the first tree. A check reading the source: coordinates are computed by the script at run time, and the violation must match a laid-out node. A crash (exit 101). A panel not run (no computed text). No card up. A panel drawn clipped but passed. Violations naming nodes nowhere in the trees. Planted in `validator.test.mjs` |
| `#358.fc68d243` | The panel host runs gpui-shell with its JIT off, through a switch the spike adds since gpui-shell's public runtimes turn the JIT on in release builds, and the signed app and panel host run without macOS's allow-jit entitlement | Live: cargo's message says the host has no debug assertions; it runs gpui-shell's numeric kernel 1,000 times with no native entries, no tier-up in its times and the same answer as the control, which enters native code and runs at least 1.2 times faster. The app and host, copied and signed by `sign.command`, have the hardened runtime and none of the three JIT entitlements by `codesign`, verify, and run the check right. Public: the kept run's, and every tracked `.entitlements` and `.plist` | A debug host, where gpui-shell's JIT is off anyway. Counters saying off with compiled speed. A control that never enters native code. A kernel that speeds up as it warms. A signature with allow-jit, or with `allow-unsigned-executable-memory` or `disable-executable-page-protection`. No hardened runtime. A broken signature. A tracked file carrying one. Real signed binaries in `validator.test.mjs` |
| `#358.b02d1647` | The decision records the panel host's element-tree cost on gpui-shell's 443-node benchmark, with the JIT off, against the 4 ms per-update budget | Public: five runs of 200 updates after 64 warm-up renders on a reference Mac, each through a process with the JIT off; the tree is 443 nodes with every cell's text; the verdict recomputed; the decision states it in the Decided row, either way. Live: gpui-shell's source from the pinned dependency, fresh, gives 443 nodes, with reported updates fitting the wall clock and the same side of 4 ms; a panel looping 2,000,000 times an update reports over 4 ms and doesn't fit; a small tree costs less than the 443-node one | A record saying it fits when its runs don't. A decision silent on a miss, or claiming one that isn't. A number not the runs'. A count of 441, or 443 nodes that aren't the grid. No IPC time. A wrong machine or thermal state. Too few runs, updates or warm-up. A hard-coded cost (fails the looping panel). A cost not moving with the tree |

Scope tests, untagged since the trace lane tags only criteria:

- **Out of process.** The host is the app's child, another program, by `ps`. A panel burning its update adds CPU time on the host and not on the app, compared with a quiet panel. After `SIGKILL` of the host the app answers `ping` and an update gives `host_gone`. Fails an in-process runtime, a host doing nothing beside one.
- **No network or program.** A panel tries `fetch`, `WebSocket`, `XMLHttpRequest`, gpui-shell's `process.run`, `child_process`, `net` and `cx.open_url` against a real listener and a canary file, with and without a manifest asking for those capabilities. Nothing arrives, no file appears, and without a manifest the panel still gets past its attempts, drawing `tried:8`. Fails honoring a panel's own `capabilities`.
- **Git dependencies.** Refused with exit 1 and `git_dependency`, and nothing reaches the listener, per the Decided row.
- **Focus.** A timer's move has no serial and is refused. A press gives a serial and moves focus. The same press's later move is refused. The next press has a newer serial and moves focus. Fails refusing every move, or checking only that a serial exists.

## What the base commit has

At the base `244a345` there's no `docs/spikes/358/record.json`, so every spike test fails at its assertion with `no spike record at docs/spikes/358/record.json`. `BASE-FAILURE.txt` holds that run. The validator's own tests pass.

## Assumptions a redraft may revisit

- I picked the record's path and fields, every command's flags and output shape, the serve protocol, and the violation kinds.
- **"Over the card" is tested only for a panel escaping its area onto a card beside it.** The card is drawn after everything (`crates/deep-app/src/card.rs`), and a full panel may lie beneath a card centered in the window, so ordinary content under the card isn't pinned either way. An intersecting node is read as a violation while the card is up; a panel whose area overlaps the card isn't tested.
- **Bounds come from the app's layout**, since the host sends trees without geometry, and are the implementer's report. The pixels and the script's computed text back them, but a check that lies consistently about bounds and clips the render isn't caught beyond that.
- **The verdict is the worst of five runs' P99**, 200 updates a run, as gpui-shell's benchmark counts, at most 4 ms. The issue says only "per-update"; a redraft may take the maximum.
- **The cost includes IPC**, an invalidation to a tree the app holds, since the design says the host's IPC cost isn't measured yet. Materializing per frame isn't in it.
- **An update may overrun.** The looping panel and the burning panel need updates of tens of ms to complete, so the host can't interrupt below that. The field `limits: {interrupt}` has no value in the issue. If the design wants a short interrupt, those two tests need a redraft.
- **The JIT's speed-up of 1.2 times** on gpui-shell's numeric kernel, and no more than 30% speed-up as it warms, are my thresholds, not yet measured on this kernel.
- **The switch's place isn't pinned.** The Decided row says the host carries one. Whether that's a patched gpui-shell conflicts with no test here. The control proves it flips; a dependency patch against #338's no-fork check is for the implementer to raise.
- **Ad-hoc signing counts.** `sign.command` may use `-s -`, since no Developer ID is assumed here, so the release identity isn't tested. Entitlements and flags read the same. Bare binaries are signed, as the base has no app bundle.
- **`limits`, `policy` and a shipped panel's in-process path aren't tested**, beyond what the network, program and process tests show. GPU API reach isn't probed: gpui-shell's `window.paint_path` is a paint call, and a script has no name for a GPU API to try.
- **The focus script uses gpui-shell's `cx.focus_handle()`, `.focus()`, `track_focus` and `cx.timer.after`**, and the no-network script its `process.run`. Focus is run without a card up, as the card keeps the keyboard.
- **The "press" is the app's headless click**, the same path `crates/deep-app/tests/headless.rs` uses. Whether it counts as hardware input isn't asked.
