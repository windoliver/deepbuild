# #3222: what a `deep_show` waits behind other sessions' calls on the canvas core's line

Every session's `deep_show` and `deep show` goes through the hub's one `Canvas` (one promise chain,
`packages/hub/src/canvas.ts`) to one `deep-show canvas`, which answers one line before it reads the next. This folder
drives a real hub's canvas side with 1, 4 and 16 scripted sessions and reads, for each call, how long it waited
before the core started it and how long the core then took. It changes no code on main: the harness loads a probe
into the hub it starts and reads everything else from outside. The proof is `tests/acceptance/3222/`, written blind
from the issue before this spike.

**The answer.** A call waits for the other sessions' calls ahead of it, and each of those costs far more than its
own work. `deep-show canvas` plays every call on a fresh hub after every call it kept before it, every session's,
and it keeps every call but six reads, render-backs included. So a call's service grows with all sessions' history,
about the same for a one-value patch as for a 3D render-back. With 16 sessions the median service of the first 20
calls was 25 ms and of the last 20 2,490 ms, and a patch of one value waited 13.0 s at the median and 45.6 s at the
95th percentile. A slow call, once kept, is drawn again inside every later call: 15 patches behind the heavy
fixture's 3D render-back took 434 ms of service at the median, against 88 ms with no slow call. Running calls side by
side would not help while each still plays every kept call first. The follow-up filed is #3262: a call plays once.

## Files

- `harness.mjs`: the harness. Run from the repository root on macOS with Node 24, after `npm run build --workspaces`
  and `cargo build --bin deep-show --bin deep-hook` (`deep-show` is the canvas core the hub starts, and the hub needs
  `deep-hook` to start). `node docs/spikes/3222/harness.mjs --sessions <n> [--patches] [--slow] [--gate]
  [--plant times-from-core-start] --home <dir> --out <file>` starts a hub (`deep hub run`) with HOME at `<dir>` and
  `<n>` scripted sessions. Each session is #806's agent stand-in (`tests/acceptance/806/fixtures/agent.mjs`)
  presenting itself as a Claude Code session through its hooks: its `deep_show` goes through its own `deep mcp`,
  bound to it by its process, and its check is `deep show --check` run in its process tree, bound by the peer check.
  Each session draws on documents of its own. The header of `harness.mjs` says what each flag does.
  - The table's runs (no `--patches`): each session makes two setup calls, a whole revision of its 2D figure (#806's
    six-item board) and one of its 3D document (#1722's box under a badge), then rounds of six calls in a rotation
    that starts at its own place: a patch of one value, a check, a render-back in 2D, a whole revision of the 3D
    document, a render-back in 3D and a whole revision of the 2D figure, each after a seeded gap of 0 to 250 ms. 20, 5
    and 2 rounds for 1, 4 and 16 sessions, so at least 20 calls of each kind. Both whole revisions are `revision`.
  - The planted slow call's runs (`--sessions 15 --patches`, and the same with `--slow`): 15 sessions each show their
    figure, then all patch one value at once. With `--slow` a 16th session first shows the heavy fixture, #671's scene
    (`tests/acceptance/671/fixtures/scene.json`: 200 one-metre boxes and a beacon under an orbiting camera, at
    640 × 480), the heaviest 3D document the repo's suites hold, without pixels; it then sends that revision's 3D
    render-back, marked `planted`, and the 15 patches go once the probe saw its line written to the core.
- `probe.mjs`: loaded into the measured hub with `NODE_OPTIONS=--import`. It acts only in the hub's core thread
  (`core-worker.js`, where the canvas side runs) and only when `DEEP_SPIKE_3222_LOG` names its log. It wraps
  `McpOperations.mcpCall` (deep_show, deep_query, deep_kinds) and `HubCanvas.showCli` (`deep show`) to open a store per
  call where it arrives, and `HubCanvas.show`, `Canvas.call` and `Canvas.send` to note, under that call, when it joins
  the line and when each of its lines is written to the core and answered. It changes no argument, reply or order.
- `out/`: each run's output as `harness.mjs` wrote it (`sessions-1.json`, `sessions-4.json`, `sessions-16.json`,
  `patches-15.json`, `patches-15-slow.json`), and the probe's log beside each (`*.probe.jsonl`), which the output's
  rows are read from.
- `analyze.mjs`: `node docs/spikes/3222/analyze.mjs` rewrites `record.json`'s `runs` and `planted` from `out/`;
  `node docs/spikes/3222/analyze.mjs tables` prints this file's tables.
- `record.json`: the table (`runs`), the planted slow call's runs (`planted`), the list (`list`, `line`,
  `side_by_side`) and the follow-up (`followUp`), with each kept output's sha256.

## What a time is

All times are the probe's, in the hub's core thread, in ms since the epoch (`performance.timeOrigin +
performance.now()`):

- **arrival** (`arrivedMs`): the call reaches `McpOperations.mcpCall` (deep_show through `deep mcp`) or
  `HubCanvas.showCli` (`deep show`): the hub has read and parsed it from its socket.
- **start in the core** (`startedMs`): the hub writes the call's own line to `deep-show canvas`. The core reads a line
  only once it has answered the one before, and the hub writes a line only once the one before is answered, so the
  write is when the core starts the call.
- **reply** (`repliedMs`): the core's answer to that line reaches the hub.
- **wait** is arrival to start; **service** is start to reply. Each row also keeps its wait's parts (`parts`):
  binding and the world's reads before the call joins the chain (`hub`), the calls ahead of it on the chain
  (`behind`), and the world sent again in its turn when the hub's world changed (`world`).

Percentiles are by nearest rank: the smallest value with at least p of the values at or below it. p50 is the median,
p95 the 95th percentile.

## The table

Readings on a Mac17,10 (Apple M5 Max, 18 cores, 64 GB, macOS 27.2), Node 24.22.0, the debug `deep-show` that a
checkout's hub starts, at main `f8c6cff82` with only the acceptance tests on top. Each run's load is in its output
and below.

| Sessions | Kind | Calls | Wait p50 | Wait p95 | Service p50 | Service p95 |
|---|---|---|---|---|---|---|
| 1 | revision | 42 | 0 ms | 1 ms | 520 ms | 628 ms |
| 1 | patch | 20 | 0 ms | 1 ms | 534 ms | 651 ms |
| 1 | check | 20 | 26 ms | 55 ms | 483 ms | 625 ms |
| 1 | render_back_2d | 20 | 0 ms | 1 ms | 493 ms | 639 ms |
| 1 | render_back_3d | 20 | 0 ms | 1 ms | 551 ms | 657 ms |
| 1 | every call | 122 | 0 ms | 40 ms | 509 ms | 639 ms |
| 4 | revision | 48 | 1137 ms | 2305 ms | 412 ms | 828 ms |
| 4 | patch | 20 | 1212 ms | 2498 ms | 464 ms | 887 ms |
| 4 | check | 20 | 1123 ms | 2390 ms | 481 ms | 890 ms |
| 4 | render_back_2d | 20 | 1304 ms | 1770 ms | 475 ms | 667 ms |
| 4 | render_back_3d | 20 | 1191 ms | 2314 ms | 476 ms | 810 ms |
| 4 | every call | 128 | 1212 ms | 2390 ms | 464 ms | 865 ms |
| 16 | revision | 96 | 10.4 s | 44.8 s | 716 ms | 3050 ms |
| 16 | patch | 32 | 13.0 s | 45.6 s | 903 ms | 3355 ms |
| 16 | check | 32 | 12.1 s | 45.7 s | 866 ms | 3312 ms |
| 16 | render_back_2d | 32 | 12.8 s | 44.8 s | 947 ms | 3004 ms |
| 16 | render_back_3d | 32 | 12.1 s | 45.9 s | 917 ms | 3197 ms |
| 16 | every call | 224 | 11.7 s | 45.0 s | 861 ms | 3185 ms |

| Sessions | Run taken (UTC) | Load at start (1, 5, 15 min) | Load at end | First call's service | Service p50, first 20 calls | Service p50, last 20 calls | Calls held at the end |
|---|---|---|---|---|---|---|---|
| 1 | 2026-11-23 09:37:00 | 45.96, 53.34, 60.08 | 23.99, 45.53, 56.55 | 9 ms | 362 ms | 605 ms | 122 |
| 4 | 2026-11-23 09:38:21 | 23.99, 45.53, 56.55 | 21.15, 40.54, 53.92 | 6 ms | 246 ms | 799 ms | 128 |
| 16 | 2026-11-23 09:39:23 | 20.81, 40.15, 53.7 | 383.74, 210.62, 121.99 | 8 ms | 25 ms | 2490 ms | 224 |

With one session nothing waits, yet every kind takes about half a second of service. Each fresh hub plays every kept
call again: a run's first call took 6 to 9 ms, and once a 3D call is kept every later call opens the GPU again
(`crates/deep-show/src/scene3d.rs:273`) and draws every kept render again. Service then climbs with the calls held,
and with 4 and 16 sessions each call waits for the calls ahead of it at that cost: the wait is nearly all `behind`.
The 16-session run's later calls and its p95 also carry the machine's load, which rose from 21 to 384 during it
(other sessions' builds on this Mac), so read them as one machine at one time.

## The planted slow call

The heavy fixture's 3D render-back took 555 ms of service. The 15 patches, side by side with the same 15 patches with
no slow call (two runs at a load of 380 to 400):

| Patch (in arrival order with the slow call) | Wait, slow call in flight | Wait, no slow call | Service, slow call in flight | Service, no slow call |
|---|---|---|---|---|
| 1: session 933418f4 on 01JC3200000000000000000001 | 557 ms | 0 ms | 517 ms | 88 ms |
| 2: session 53403b46 on 01JC3200000000000000000003 | 1067 ms | 89 ms | 434 ms | 56 ms |
| 3: session 3da37e12 on 01JC3200000000000000000005 | 1503 ms | 147 ms | 570 ms | 76 ms |
| 4: session f443d306 on 01JC3200000000000000000009 | 2075 ms | 223 ms | 470 ms | 109 ms |
| 5: session ab594d3f on 01JC3200000000000000000013 | 2546 ms | 471 ms | 441 ms | 85 ms |
| 6: session 75b809c2 on 01JC3200000000000000000007 | 2986 ms | 330 ms | 485 ms | 57 ms |
| 7: session 1ff8f18a on 01JC3200000000000000000011 | 3471 ms | 388 ms | 710 ms | 82 ms |
| 8: session 258368d0 on 01JC3200000000000000000019 | 4181 ms | 750 ms | 414 ms | 70 ms |
| 9: session 64572a71 on 01JC3200000000000000000017 | 4595 ms | 656 ms | 466 ms | 94 ms |
| 10: session d7263625 on 01JC3200000000000000000023 | 5063 ms | 967 ms | 404 ms | 83 ms |
| 11: session 32101912 on 01JC3200000000000000000021 | 5468 ms | 820 ms | 352 ms | 141 ms |
| 12: session d4fadf44 on 01JC3200000000000000000025 | 5822 ms | 1203 ms | 361 ms | 120 ms |
| 13: session f9e8a85f on 01JC3200000000000000000027 | 6186 ms | 1051 ms | 340 ms | 153 ms |
| 14: session 463ccfea on 01JC3200000000000000000029 | 6529 ms | 1323 ms | 343 ms | 93 ms |
| 15: session 1e37da0f on 01JC3200000000000000000015 | 6874 ms | 556 ms | 337 ms | 103 ms |

The first patch waited for the render-back (557 ms). Every patch behind it then took 2 to 9 times its service without
the slow call (434 ms against 88 ms at the median), because each played the render-back again before its own work. Their longest wait was 6.9 s,
against 1.3 s. A render-back mints no revision and writes nothing, yet it is kept, so it stays in every later call.

## What a call reads and writes, and which calls could run side by side

`record.json`'s `list` gives, for each kind of call that reaches the core through the hub, what it reads and writes
among the issue's four things (`document`: its own document; `shown`: other documents it reads, which includes every
document on its panel and the core's one look; `world`: what the hub sends; `evidence`: the evidence store), and which
kinds it must follow, each with a line of code at main and the text that line holds. `line` lists what every call
shares. In short:

- **Every call** joins one promise chain in the hub (`packages/hub/src/canvas.ts:213`), is kept unless it is one of six
  reads (`crates/deep-show/src/canvas_side.rs:153`), and is played on a fresh hub after every kept call
  (`canvas_side.rs:69`) against the world as it is now (`canvas_side.rs:88`), on one virtual clock for all sessions
  (`canvas_side.rs:111`).
- **revision** and **check** read and write their document, read every document on the panel when they present
  (`crates/deep-show/src/hub/presented.rs:31`: the hub puts every document it shows on one panel,
  `packages/hub/src/canvas.ts:243`), may set the look every later render reads (`crates/deep-show/src/hub.rs:1932`),
  change the world the hub sends on a document's first show (`packages/hub/src/hub-canvas.ts:227`), and write the
  canonical document and pictures to evidence, which the hub then stores (`hub-canvas.ts:386`).
- **patch** reads and writes only its document's shared copy, which exists only when the world seeds the document
  (`crates/deep-show/src/shared/calls.rs:210`; the hub seeds none, so a live session's patch is refused, #1721), and
  presents nothing.
- **render_back_2d** and **render_back_3d** read their revision and the look and write only their snapshot, by hash
  (`crates/deep-show/src/input.rs:789`, `crates/deep-show/src/probe.rs:137`), yet are kept and drawn again by every
  later call.
- **deep_query**, **deep_kinds** and **revisions** are reads, answered without being kept; **verdict** reads a claim the
  hub adds to the world for one call and its deliverables' revisions; **user_input** writes the input track and follows
  every call before it.

`side_by_side` takes each pair of the five kinds, from two sessions on documents of their own. Two calls could run
side by side when either order gives both the same replies:

| | revision | patch | check | render_back_2d | render_back_3d |
|---|---|---|---|---|---|
| revision | no | no | no | yes, unless the revision names a look | yes, unless it names a look |
| patch | | yes | no | yes | yes |
| check | | | no | yes, unless it names a look | yes, unless it names a look |
| render_back_2d | | | | yes | yes |
| render_back_3d | | | | | yes |

Revisions, checks and patches can't run beside each other's presentations because the hub puts every document on one
panel and each presentation draws all of them. Render-backs and patches could run beside nearly anything. As built,
though, no pair runs side by side, and none would gain much: each call still plays every kept call first.

## The follow-up

#3262, filed with three criteria: with this harness, a call's service no longer grows with the calls held (the last
20 calls' median at most 1.25 times the first 20's, drafted); the 15 patches' median service with the slow call in
flight at most 1.25 times their median with none (drafted), with a planted canvas side that keeps render-backs failing;
and every reply equal to a full replay's on the canvas side's suites' scenarios, with a planted canvas side that keeps
its hub across a world change that ended a session failing. Whether calls should then run side by side is for a
reading after it: with each call playing once, the line's cost is each call's own work.

## How the readings were taken, and what they can't read

- **The documents a patch reaches.** A patch reaches only a document the world seeds at revision 0, and the hub seeds
  none but through its test world file (#1721, open). So without a world file in its environment, the harness writes
  its own (`DEEP_HUB_TEST_SHOW`), seeding each 2D document with an empty board; the session's first whole revision is
  then revision 1, in its own layer, and its patches apply. With a world file in its environment (the held-busy test's)
  it uses that file as given, and its patch is refused, which the test reads only for its wait.
- **The check** is `deep show --check`, since the `deep_show` tool's schema has no `check`. It exits non-zero when its
  verdict isn't PASS. Every check here was presented (each row's `outcome`); its verdict isn't kept.
- **The debug core.** A checkout's hub starts the newer of `target/release/deep-show` and `target/debug/deep-show`;
  only the debug one was built here. A release build draws faster, which shortens every service, but each call still
  plays every kept call, so the growth stays.
- **The load.** Other sessions shared this Mac. The one-minute load was 46 to 24 for the 1-session run, 24 to 21 for
  the 4-session run, 21 to 384 for the 16-session run, and 380 to 400 for both planted runs. Each output keeps its
  load at start and end.
- **The clocks.** The probe's times are the hub's core thread's, and the held-busy test compares them with its own
  `Date.now()`; both are the wall clock in ms.
- **The held-busy run** (`tests/acceptance/3222/ac2-held-busy.test.mjs`): the test holds the core with four calls the
  world file's fault holds 1.5 s each, then lets the harness's session send its calls behind them. The harness read
  the session's first call's wait past 1 s, and its planted twin, which times each call from its start in the core,
  read none and failed, naming the call.
- **Setup calls** are rows of the table's runs like any other call, so the table counts 42, 48 and 96 revisions.
