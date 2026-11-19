# Acceptance tests for #549: a lockstep match over the declared relay, opened only by Join, with full-state hashes and the merged record

Written first, blind, from issue #549 (live: its Scope, its Fields, its eight acceptance criteria, its Proof line and
its Oracle line), the design sections it links and those they lean on, and the base commit `06e231702` ("Merge pull
request #2735"), by a job that never saw an implementation. No other worktree, branch, pull request, stash or plan was
read. The job ran twice. The first run wrote every test file here and in the Oracle lane on November 16, 2026. The
second, on November 17, wrote only this README, `BASE-FAILURE.txt` and the Oracle lane's README, from the first run's
files; it changed no test file. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the two planted twins the
criteria name. The Oracle line's lane is `tests/acceptance/549-oracle/`.

## What was read

By the second run, which wrote this file:

- The issue (`gh issue view 549 --repo windoliver/deepbuild`), its parent #179, the epic #310 and the sibling parts, for
  what is theirs: #550 (peers' entries checked, matches that end on a fault, a desync located, net in the tools), #551
  (rollback, the window, the rate and lead rules), #552 (`match.me`, courtesy fog, random draws), #553 (rollback over
  occurrences, voices and saves, the match budgets), #554 (device bridges, ports, readings, world pages). Their
  behaviour isn't tested here.
- The Oracle page `doneright/oracles/issues/549.md` on branch `doneright` of `DeepBuildAI/deepbuild`.
- `docs/technical-design.md`: The net module (Match, Lockstep, Desync and replay, Relay and Join, Relay protocol);
  Dogfooding; Tests written first; Proven on the base. `docs/canvas-primitives.md`: Shared play over a relay; Net
  `net@1`; Net: lockstep; Net: desync and replay; Net: relay and Join; Net: relay protocol `relay@1`; Check input: net
  kinds; Seam and backend; Export: web player; Render-back; Registry and seal: runtime digest. `docs/parallel-proof.md`,
  section 6. `CONTRIBUTING.md`. AGENTS.md.
- Every file of this folder and of `549-oracle/`, and this job's own log of its run at the base.
- At the base, only for surfaces and conventions: `scripts/lanes.mjs`, `scripts/throttle.mjs`, `scripts/lease`,
  `scripts/proof-change.mjs` (`criterionId`), `scripts/studied-names.mjs`, `scripts/public-text.mjs`;
  `crates/deep-show/src/net.rs` (#540's `net@1`), `main.rs` (its calls and `planted` names), `points.rs` (#540's
  `match`), `capture.rs` (a posted event's `source` and `pid`), `Cargo.toml` (the two test features);
  `crates/deep-canvas/src/registry/mod.rs` (the check kinds' names); `packages/contracts/slots/relay@1.json`;
  `tests/acceptance/309/helpers.ts` (the certificate and the relay, which `helpers.ts` imports); the READMEs and
  BASE-FAILURE files of `540/`, `540-oracle/`, `309/`, `172/` and `172-oracle/`. A search of the suites' READMEs for
  the throttle command's form also returned seven lines of `549-redraft-ac2/README.md`, its run commands; that folder
  wasn't opened, and nothing here comes from it.

The first run's files cite, beside these, #393's scenario, #383's `scope`, #504's input track entries, #539's `logic`,
#540's `match` and `steps`, #172's web export and player, #1920's `schedule` and runtime digest, #533's logic patch
build, #15's evidence store and #391's document envelope.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## What the base already does, and these tests don't credit

The base holds #540's `net@1` kind with five fields (`relay`, `players`, `step_rate`, `delay`, `window`) and its
`match` call, `{doc, steps}`, which steps every copy on the panel's recorded track in one process and answers `copies:
[{player, steps, track}]`: no relay, no message, no hash, no wait, no record. It holds #309's relay@1 contract, the
shipped relay `deep-relay` with its planted twins, and the macOS network backend, whose test client refuses a relay
that answers another protocol or digest. It holds #172's web export and player (`ready`, `play()`, `currentTime`,
`probe()`), #1920's runtime digest with the `schedule` call and the `test-physics-rapier-patch` build, #533's
`test-logic-patch` build, and the calls `deep show`, `scope`, `input`, `track`, `logic`, `export` and `render_back`. Its
registry lists the names `net.rollback`, `net.desync` and `net.budget` as the net module's check kinds. Its document
check already refuses a `relay` written as a list, as the base run shows.

None of it is the net module's Join or a live match. At the base `net@1` defines neither `hash_every` nor `timeout`, a
net item without a relay or with an http one is presented, and there is no Join prompt, no `sockets` or `play_match`
call, no test relay behind `match`, nothing that runs `net.rollback` or `net.budget`, no network backend in the web
player and no `match` in its `probe()`. Every test here fails at the base and none is a guard; `BASE-FAILURE.txt` is the
run.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH. In a fresh worktree run `npm ci` and `npm run build
--workspaces` once. Then run one file at a time, each under the machine's build grant:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-no-net ac2-join-only ac3-direct-path ac4-lockstep-300 ac5-waiting-notice ac6-refused-relays ac7-builds ac8-resend; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 node scripts/throttle.mjs build --wait 120 -- scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/549 $f.test.ts
done
node node_modules/typescript/bin/tsc -p tests/acceptance/549/tsconfig.json   # type check
rm -rf tests/acceptance/549/node_modules                                      # vitest's cache after a --root run
```

`--wait` is the minutes to wait for the grant; 120 is what the neighbouring suites use, and a busy machine may need
more. `helpers.ts` puts the pinned toolchain's folder first on PATH itself when it exists, and sets
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` for its cargo calls when they are unset. It honors
`CARGO_TARGET_DIR` and `CHROME_BIN`.

Every `it` and every build hook passes its own timeout of 5,400,000 ms. A live phase gives up after 2,400,000 ms.

What each file builds, in `beforeAll`, and starts:

| File | Builds | Starts |
|---|---|---|
| `ac1-no-net.test.ts` | `deep-show` (`full`) | `deep-show run`; a web export, this process's HTTP server and headless Chrome, with the page open for ten minutes of real time |
| `ac2-join-only.test.ts` | `deep-show` (`full`), `deep-relay` | a certificate; in each test the shipped relay and a door; headless Chrome in two tests; live matches of 200 and 100 steps; four third connections |
| `ac3-direct-path.test.ts` | `deep-show` (`full`), `deep-relay` | a certificate; two relays, each behind a door; two live matches of 240 steps |
| `ac4-lockstep-300.test.ts` | `deep-show` (`full`), `deep-relay` | a certificate, the relay behind a delaying door, a web export, the server, headless Chrome; one live match of 3,600 steps; `match` runs in process |
| `ac5-waiting-notice.test.ts` | `deep-show` (`full`) | `match` runs in process |
| `ac6-refused-relays.test.ts` | `deep-show` (`full`), `deep-relay` | a certificate; `deep-relay --planted hello_other_digest` and `hello_other_protocol`, each behind a door; headless Chrome |
| `ac7-builds.test.ts` | `deep-show` three times (`full`; `full,test-physics-rapier-patch`; `full,test-logic-patch`), `deep-relay` | a certificate, two relays behind doors, live copies of 200 steps |
| `ac8-resend.test.ts` | `deep-show` (`full`) | `match` runs in process |

- **Builds.** `cargo build --locked --bin deep-show --no-default-features --features <set>` once a set, and `cargo build
  --locked --bin deep-relay`. Each binary is copied out of `target/debug` into a temporary folder under its own name,
  since each set's build rewrites `target/debug/deep-show`. That is why the files run one at a time.
- **The certificate.** #309's helper makes a throwaway certificate authority and a relay certificate for IP 127.0.0.1
  with the `openssl` CLI in a temporary folder, and deletes it after the file. Nothing is installed in a keychain. The
  app trusts the authority through the scenario's `relay_ca`; Chrome trusts the relay certificate by its public key's
  pin, for that browser alone.
- **Live matches run in real time.** A live copy plays its match on the wall clock: 3,600 steps at 20 Hz last three
  minutes at the least, and criterion 1's page stays open ten minutes. No test reads how long anything took. `match`
  runs on the test relay's own clock, so its times are match times and never this machine's.
- **Processes and hosts.** Every `deep-show` is stopped by its PID after each test, every relay by its PID, Chrome by
  the PID of its own process group. The door and the HTTP server live in the test process and are closed after each
  test. Temporary folders are deleted. Everything listens on 127.0.0.1 at a port it picks. Nothing reaches another
  host: `https://relay.test/549` is declared only by pieces that never join.
- **Imports.** Node built-ins, vitest and `../309/helpers.ts` (read only). No browser-automation library.

**Gates.** None of these is ever a pass.

- `BLOCKED:` when cargo can't run; when the `openssl` CLI can't run; when Google Chrome isn't at
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` or `CHROME_BIN`; when Chrome opens no DevTools port
  within 120 s or the DevTools connection fails; when the player isn't ready within 180 s and Chrome offers no WebGPU
  adapter there. The openssl, Chrome and WebGPU messages carry their unblock.
- `INCONCLUSIVE:` when a live phase didn't finish in its time and the 1-minute load is above the core count: a
  `deep-show run` that didn't end in 40 minutes, a first player's link that wasn't written, a web player's match that
  gave no link or didn't end, a web Join that reached no relay in ten minutes. With the load at or under the cores the
  same is a plain failure.

## The lanes lines

The implementer adds these to `scripts/lanes.mjs`, beside #172's (this README is the instruction):

```js
// #549's files each build deep-show (ac7 in three feature sets; most also the shipped relay), start relays, doors and
// headless Chrome with WebGPU on, and play live matches in real time; the Oracle lane builds deep-show alone.
alone.push('tests/acceptance/549/', 'tests/acceptance/549-oracle/');
```

No file is `timed`: no test reads a time. No file is by hand.

## Criteria to tests

IDs are `#549.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`). The second run computed them again from the live issue; all eight match
`helpers.ts`. Each test's name starts `AC<n> #549.<h8>`; each file quotes its criterion in full.

| AC | ID | File (tests) | What it asserts |
|---|---|---|---|
| 1 | `#549.a86e15ac` | `ac1-no-net.test.ts` (3) | The piece without a net item, in the app: `state.join` is null at the start and at each of ten minutes of the scenario's clock, and `sockets` is empty at the end. In headless Chrome: `probe().match` is there and null before and after ten minutes of the page's clock, no Join prompt at any half minute, nothing reached but the bundle's own origin, by the browser's log and the page-side log. Three net items (no relay, an http relay, two hosts) each not presented, with an error naming `relay` on `match`; the same piece with one https relay presented |
| 2 | `#549.83ea272a` | `ac2-join-only.test.ts` (4) | The app, no person's click: the prompt names the relay host and the network address; it stays `open` after a tour's entries, the logic and a synthetic click; `play_match` answers `not_joined`; `sockets` is empty; nothing reached the door. Chrome, no person's click: the same after the tour, the logic and every script-made click. The app after a person's click: two copies play 200 steps to equal hashes; every message at the door is a `join`, a `signal` or a frame of that match; no cookie, credential or canary secret in any request head or message; each copy's `sockets` hold the relay and at most the other copy; four third connections get nothing of the match. Chrome after a person's click: the page reaches only the relay (`wss:`), plays to the app's hashes, and the bundle's host is never sent the match ID or a cookie |
| 3 | `#549.ef287875` | `ac3-direct-path.test.ts` (2) | Signaling allowed: no frame at the door, only `join` and `signal`, each copy's `sockets` show the relay and one more on 127.0.0.1. Signaling dropped: at least 240 frames at the door, all of this match, no other connection. Both: players 1 and 2, no rollback, equal hashes at every step between the copies and between the two runs, another match ID each match, and a late join to the ended match refused `unknown` |
| 4 | `#549.a6b30a32` | `ac4-lockstep-300.test.ts` (3) | The app's copy and Chrome's through the delaying door for 3,600 steps: the same hash at every interval both report (58 or more), each also the in-process run's with no delay; no rollback; the merged track the same on both, in the no-delay run and as player 1's script gives it; the peer's entries marked `peer`; 3,600 frames or more at the door and no signal past it; the no-delay run's `army.pos` is the mirror's. `net.budget`: `rollback_snapshot_bytes` 0, no rollback. `net.rollback`: PASS on the honest copies with messages held back; the planted `net_runs_step_early` FAILs, its lowest named step the first step this file finds run early |
| 5 | `#549.6bf6ea62` | `ac5-waiting-notice.test.ts` (3) | A 2 s hold from 10 s: copy 1 waits once, for player 2, at step 204 (give or take one), from about 10.2 s to 12 s; one notice naming player 2 from 0.25 s into the wait until the messages arrive; both render-backs show the step before; then 400 steps to the hashes of the run without the hold. A 6 s hold: `timeout` on both copies and in both records, copy 1 having run 204 steps, give or take one. The piece's layer during the notice is pixel for pixel the layer at the same step of a run without the hold |
| 6 | `#549.28bcfddc` | `ac6-refused-relays.test.ts` (2) | In the app and in Chrome, at each of the two planted relays: the prompt is `refused` and its text holds the relay's host and what it answered; no frame crossed the door; the relay's own record shows no `forward`; the app's `play_match` answers `refused` and its `sockets` hold no other host |
| 7 | `#549.c5f03db3` | `ac7-builds.test.ts` (2) | The physics patch build's Join to the shipped build's match: `play_match` `refused`, the prompt `refused` with `physics@1` and both pins' versions in its text and `refused.mismatch` set, no frame at the door. The logic patch build and the shipped build: equal hashes over 200 steps, each record carrying the plan's runtime digest, 2 players, one module-set digest and one document |
| 8 | `#549.c5b39b72` | `ac8-resend.test.ts` (2) | At 5% drops over 1,200 steps: 3% to 7% of the frames dropped, every lost step carried again by a delivered frame, some frame carrying more than one step; both copies run 1,200 steps with no rollback to equal hashes, the run's without drops too; `army.pos` and `army.vel` are the mirror's; each record's track is both scripts, each entry 4 steps on, a peer's marked `peer`. The planted `net_resends_nothing`: the waiting copy ran exactly the steps before the first lost step, its last wait names that step and player and never ends, both copies end `timeout`, and this file's stall check fails naming the copy, the step it waits for and the relay's lost step |

Test count: 3 + 4 + 2 + 3 + 3 + 2 + 2 + 2 = 21 (and 2 in the Oracle lane).

## The surface under test

The issue names a prompt, a click, sockets, a relay's log, hashes, a record, a notice, a render-back, check kinds and
planted programs, but no call. As #540's and #172's suites do, everything in the app is driven through `deep-show run`
(#393: one JSON scenario on stdin, one answer line `{"ok": true, "replies": [...]}`, one reply per call), and
everything on the web through the bundle the `export` call writes, opened in headless Chrome. **Every call, key, field,
attribute and name below is marked as the issue's or the design's own, or as this job's choice. The implementer builds
exactly these, or a dispute goes to a blind redraft.** Each row is taken from the test files and `helpers.ts` as they
use it. Times in calls are flicks (705,600,000 a second); times in reports are seconds; hashes are lower-case hex.

### The scenario

`helpers.ts`'s `scenario` writes #169's and #172's world: you and one agent's session.

| Key | As written | Whose | At the base |
|---|---|---|---|
| `evidence`, `sessions`, `processes`, `panels`, `clock`, `calls` | one session `sess-549` (pid 4100); seven processes, your shell's peer pid 3002; the first document on panel `main`, rect `[0, 0, 640, 360]`, each other on `side-<k>`, rect `[0, 720, 640, 360]`; `clock: {refresh_hz: 60, lead: 0, check: 0}`; each call with its `at` | #393's, #383's | exist |
| `docs.<id>.panel` | the document's panel | #393's | exists |
| `docs.<id>.link` | the link this copy opened the piece through (`link_to`, below) | this job's | new |
| `relay_ca` | the path of a PEM certificate authority the app's network backend trusts for this run, beside the platform's own | this job's (as `relay_client`'s `ca`, #309) | new |
| `secrets` | `{relay_token: "deep549-canary-…"}`: the app's secret store, as the scenario holds it | #172's suite's key | nothing in the base's `deep-show` reads it |
| `planted` | one of the two names under Planted twins | form exists | names new |

Criterion 7's plan is read with `planScenario`: #1920's scenario with no document and no clock, one panel of 800 × 600,
and the call `schedule` with no `at`.

### Calls

| Call | What the tests send | What they read | Whose | At the base |
|---|---|---|---|---|
| `deep show` | `{peer: {pid: 3002, start: 3000}, doc, document, include: ["issues"], at}` | `outcome` (`presented`), `issues` (`severity`, `code`, `path`, `ids`, `actual.field`) | #393's | exists |
| `scope` | `{panel: "main", at}` | `state.join` (The app's prompt, below) | call #383's; `state.join` this job's | call exists, `join` new |
| `input` | `{panel: "main", at, event: {type: "down" \| "up", pos: [x, y]}}`; a synthetic one adds `source: "synthetic", pid: 4102` to the event | nothing | call #504's; `source` and `pid` on an `input` event this job's, after #105's posted key | call exists, the marker new on `input` |
| `track` | `{doc, load: [entry], at}`, two entries `{t, seq: 0, control: "join", value: 1, writer: "tour", player: 1}` | nothing | #504's | exists |
| `logic` | `{doc, steps, at}` | nothing | #539's | exists |
| `export` | `{doc, out, video: {codec: "web"}, at}` | `outcome` (`exported`); `index.html` in `out` | #172's | exists; a piece with a net item is new |
| `schedule` | `{}` | `runtime_digest`; `interfaces["physics@1"].implementation.pins.rapier3d.version`; `interfaces["logic@1"].implementation.version` | #1920's | exists, read at the base |
| **`sockets`** | `{at}` | `log` (`sockets`, below) | this job's | new |
| **`match`** | `{doc, steps, plays?, relay?, check?, render_back?, at}` | `copies`, `relay`, `check`, `renders` (`match`, below) | call #540's; every member but `doc` and `steps`, and every reply field but `copies[].player` and `copies[].steps`, this job's | `{doc, steps}` exists |
| **`play_match`** | `{panel: "main", steps, plays?, link_to?, at}` | `code`, or a copy's report with `match` and `link` (`play_match`, below) | this job's | new |

A person's click is an `input` press and release 60 ms apart at the centre of the prompt's button, with no `source`:
every input of a scenario is hardware's. A synthetic click is the same two events with `source: "synthetic"` and the
posting process's `pid`, as deep_drive posts one in a replica; pid 4102 is in the agent session's process tree, not
your shell's.

### `match`

The call is #540's; this job adds its members. Every copy of the document's match, as its `net@1` item declares it,
runs in this process over the test relay, with no network, for `steps` match steps, on the relay's own clock (the
design's Check input: net kinds).

Sent:

- `plays: {"<player>": [{step, control, value}]}`: each player's script. An entry `{step: g, …}` is one that player
  makes when match step g is the first its copy hasn't run, so it is stamped `delay` steps later and lands at step
  g + `delay` (Net `net@1`). A player without a script makes none.
- `relay: {seed, drop?, hold?, log?}`: the test relay's faults. `seed` seeds them. `drop: 0.05` drops that share of the
  frames, by the seed. `hold: [{player, at, for}]` holds every message that player sends from match time `at` s for
  `for` s, then hands them on in order. `log: true` asks for every frame the relay carried. Without `relay`, every
  message is on time.
- `check: "net.rollback" | "net.budget"`: runs that check kind (the issue's own) on this match and adds `check` to the
  reply. With `net.rollback`, the tests read the reply's copies and relay log as the held-back run's: some frame is
  delivered after it was sent, and each copy waits at least once.
- `render_back: [{player, t}]` (`render_back`, below).

Read:

- `copies: [report]`, one a player (A copy's report, below), each with `steps`, #540's rows, of which the last row's
  `arrays["<logic item>.<array>"]` is read (`army.pos`, `army.vel`; the Oracle lane's `game.frame`, `game.state`), and
  `ran_at`.
- `relay: {frames, dropped, log}`, read only where `log: true` was asked. `frames`: the frames the relay carried.
  `dropped`: how many it dropped. `log: [{player, first, count, confirmed, at, delivered}]`, one row a frame: the
  sender's player number as the copies number them (1 or 2); the frame's `first` step, its `count` of steps and its
  `confirmed`, as relay@1's frame header names them; `at`, when it was sent; `delivered`, when the relay handed it to
  the other copy, or `null` for a frame it dropped (never absent). The rows whose `delivered` is null number `dropped`.
- `check: {kind, verdict, failures}`. `net.budget` adds `rollback_snapshot_bytes`, which is 0 in lockstep; its verdict
  may be any of `PASS`, `FAIL`, `INCONCLUSIVE`, `BLOCKED`, since its time is #553's to hold. `net.rollback` reads `PASS`
  with no failure for the honest copies, and `FAIL` for the planted one, each failure an object whose `step` is a step
  a copy ran early.
- `renders` (`render_back`, below).
- A refusal carries `code`; the tests need none.

### `play_match`

This job's call: this copy's live match, in real time. It is the app's net module after the Join: with no `link` on its
document it opens a match at the declared relay, and with one it joins that match; it waits for the match to start,
makes its player's entries, and returns once the copy has run `steps` match steps or the match has ended. A copy that
has run its steps leaves, which ends the match on the other copies.

- Sent: `plays: [{step, control, value}]`, this copy's player's script, as in `match`; `link_to` (below).
- `{code: "not_joined"}` when no person's click has answered the prompt. Nothing was opened.
- `{code: "refused"}` when the relay or the other copy refused the Join; the prompt then says why.
- Otherwise a copy's report, with `match`, the match ID as 32 hex digits, and `link`, the first player's link or
  null. No test asserts on the reply's `link`; the link they use comes from `link_to`'s file.

The scenario's other calls stay on its virtual clock. The `scope` and `sockets` calls after `play_match` are answered
after the match.

### `sockets`

This job's call: `{log: [{kind, host, …}]}`, every connection and request the app's capability layer has opened in
this run so far. `host` is `host:port`, as the piece names its relay (`127.0.0.1:<port>`). `kind` is any
string naming what was opened; the tests only print it. An entry may hold more. No entry may hold the canary secret, or
a quoted `cookie` or `authorization` anywhere in its JSON.

The log is empty for a piece without a net item, and before a person's click. After Join it holds the relay's host;
on a direct path one more host on 127.0.0.1, the other copy; with the direct path blocked, the relay's alone.

### The app's prompt

The issue's and the design's Join prompt, as `scope` reports it; the shape is this job's. `state.join` is always
there: `null` when the app shows no prompt, else

```json
{"state": "open" | "refused" | …, "relay": "127.0.0.1:<port>", "text": "…", "button": [x, y, w, h], "refused": {"mismatch": …}}
```

- `state`: `open` while unanswered; `refused` after a Join the relay or the copies refused. After a person's click and
  a match it is anything but `open`, or the prompt is gone (null).
- `relay`: the relay's host, as `host:port`.
- `text`: the prompt's words. They hold the relay's host and the words "network address" (who sees the copy's network
  address). After a relay is refused they hold the relay's host and what it answered: the other digest
  (`d1:0123…cdef`) or the other protocol (`relay@2`). After a build is refused they hold `physics@1` and both builds'
  pinned versions.
- `button`: the Join button's box in panel px. The app draws it at the same place in two runs of one scenario, since a
  first run reads where it is and the second clicks there.
- `refused`: read for criterion 7 alone, where it is an object with the member `mismatch`, the design's
  `mismatch {what}`.

### A copy's report

What `match` gives for each copy, what `play_match` gives for its own, and what the web player's `probe().match`
gives. The issue and the design name what it holds; the field names are this job's.

| Field | What | Read by |
|---|---|---|
| `player` | this copy's player: 1 for the first the relay saw join, 2 for the second | all |
| `ran` | how many match steps it ran | all |
| `rollbacks` | how many times it rolled back: 0 in lockstep | all |
| `hashes` | `[{step, hash}]`: its full-state hash at each hash interval it confirmed, `hash` a u64 as 16 hex digits, the rows exactly `hash_every` steps apart. Which step the first row names is the implementer's; two reports are compared at the steps both give | all |
| `waits` | `[{step, player, from, to}]`: each time it waited to run `step` for `player`'s message, from when to when; `to` null for a wait that never ended. Always an array | times read in `match` |
| `notices` | `[{player, from, to}]`: each time the app's waiting notice showed, naming whom; `to` null if it never cleared. Always an array | `match` |
| `end` | null while the match hasn't ended, else `left` or `timeout` | all |
| `record` | null, or `{document, module_set_digest, runtime_digest, players, track, confirmed, end}`: the issue's Record. `track`: entries `{t, player, control, value, writer, seq}`, `t` in flicks at the entry's step (step × 35,280,000 at 20 Hz), a peer's entry with `writer: "peer"` and this copy's own player's without. `confirmed`: the last step it confirmed. `document`, the digests: strings | all |
| `ran_at` | `[s]`: index k is when it ran step k | `match` |
| `steps` | #540's rows, with `arrays` | `match` |
| `match`, `link` | the match ID; the first player's link | `play_match`; `link` and `end` in `probe().match` |

Two records are compared up to the lower of their `confirmed`s, as each entry's step, player, control and value in
step, player and seq order. The writer isn't compared: your entry is a peer's on the other copy.

### `render_back`

A member of `match`, this job's: `render_back: [{player, t}]` asks for that copy's piece at match time `t` s, drawn as
the design's Render-back draws a document's own layer. The base's `render_back` call (#140) can't be asked for a copy
of a match, which lives only inside the `match` call. The reply's `renders` holds one row for each, in order:

- `player`, `t`: as asked.
- `step`: the last match step that copy had run at `t`. It is −1 for a copy that has run none (the Oracle lane).
- `sha256`: the SHA-256 of that layer's pixels, 64 hex digits.
- `notice`: always there: `null`, or `{player, since}`, the app's waiting notice at `t`: whom it names, and how many
  seconds the copy had then waited (the issue's Waiting notice).

Criterion 5 holds the layer's `sha256` during the notice equal to the same copy's at the same step in a run without
the hold, where `notice` is null.

### `link_to`

A member of `play_match`, this job's: a file path. The first player's copy writes its link there as soon as the relay
has seated it, before the match starts, so the test can hand it to the second copy.

The link is the issue's: it carries the match ID in its fragment. The tests need the ID as 32 lower-case hex digits
somewhere after the `#`, and nowhere before it; the first run of 32 hex digits in the fragment is taken as the ID. The
rest of the link's form is the implementer's. It is used two ways.
An app copy is given the whole link as `docs.<id>.link`, and after a person's click it joins that match and never
opens one. The web player is opened at the served bundle's own URL with the link's fragment appended
(`<origin>/index.html#…`), so it reads the match from its page's fragment alone. A link the web player gives
(`probe().match.link`) is handed to an app copy the same way.

### The web player's prompt

The bundle is #172's: `index.html` with one `<deep-player>`, whose `ready`, `play()`, `currentTime` and `probe()` the
tests use. What this task adds on the page, each this job's choice:

- **The prompt** is an element with the attribute `data-deep-join`, found by `document.querySelector`, so it is in the
  page's own tree and not behind a shadow root. A page with no prompt has no such element. The attribute's value is
  the prompt's state, `open` or `refused`; its text holds what the app's prompt's `text` holds.
- **The Join button** is the first `button` inside it. A person's click is the browser's own input at the centre of
  its box. Pointer, mouse and click events a script dispatches on it, `button.click()`, and Enter keys sent to it
  after `focus()` must each leave the prompt `open` with nothing opened.
- **`probe().match`** is always a member of what `probe()` returns: `null` for a piece without a net item. After a Join
  it is the page's copy's report: `link` is there once the relay has seated the page as the first player, and `end` is
  null or absent until the match has ended, when the whole report is read. What it holds before a Join isn't read.
- **The relay** shows in the browser's log or the page-side log as a URL that starts `wss:` and holds the relay's
  `host:port`. A direct path is an `RTCPeerConnection` whose ICE servers, if it names any, are on the relay's host.
- The page takes the match from its URL's fragment (`link_to`, above).

### Documents

`fixtures.ts` writes #391's envelope. The net item is the issue's own, field for field:

| Field | As written | At the base |
|---|---|---|
| `requires.modules` | `{scene3d: "^1", input: "^1", logic: "^1", net: "^1"}` | exists |
| `net@1` item `match` | `{relay, players: 2, step_rate: 20, delay: 4, window: 0, hash_every?, timeout?}` | `hash_every` and `timeout` refused as `unknown_field` |
| `relay` | `https://127.0.0.1:<port>`, the door's address, for a live match; `https://relay.test/549` where nothing joins | a string with no rule |
| `hash_every` | 1 where a criterion reads a hash at every step; 60 for criterion 4's live match and where no hash is read; unset where the check refuses the piece | new |
| `timeout` | 120 on every live piece; unset (5 s) in criteria 5 and 8; 60 in the Oracle lane | new |

**Refused at check** (criterion 1): `deep show` doesn't answer `presented`, and an issue of severity `error` names the
field. Its `code` is none of `unknown_kind`, `module_missing`, `unknown_field`; its `path` has the segment `relay`, or
its `actual.field` is `relay`; and it names the item, with `match` in its `path` or its `ids`. The three net items: no
`relay`; `relay: "http://relay.test/549"`; `relay: ["https://relay.test/549", "https://other.test/549"]`.

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted`, and changes nothing else. Both
names are this job's; the programs are the issue's.

| Name | Criterion | The wrong program | The test fails it |
|---|---|---|---|
| `net_runs_step_early` | 4 | a copy that runs a match step before it holds every player's message for it | under `match` with `check: "net.rollback"` and the relay's log: this file finds, from `ran_at` and `delivered`, the first step run before the other player's message arrived; `check.verdict` is `FAIL`, and the lowest `step` its failures name is that step; the copy's hashes part from the on-time run's no earlier than it |
| `net_resends_nothing` | 8 | a network backend whose frames carry each message once, so a dropped frame's message is gone | under `match` at 5% drops: the relay's log shows a step in dropped frames only; the other copy ran exactly the steps before it, its last wait is `{step, player, to: null}` for it, both copies end `timeout`, and the file's stall check fails naming the copy, the step it waits for and the relay's lost step |

Used as they are at the base: `deep-relay --planted hello_other_digest` and `--planted hello_other_protocol` (#309's),
and the Cargo features `test-physics-rapier-patch` (#1920's) and `test-logic-patch` (#533's). Made in test code:
criterion 2's piece that tries to join by itself, and its script-made clicks. Criteria 1, 3, 5, 6 and 7 name no
planted program; their wrong program is the merge base.

## Fixtures

All made at test time in `fixtures.ts`; no personal data; CC0.

- **The lockstep piece** (`lockstepDoc`; criterion 1's check and criteria 2 to 8): a 3D scene of 640 × 360, seed 549,
  span 200 s, with a camera, a box, the slider `push` (whole numbers −8 to 8), the logic item `army` (20 Hz, reads
  `push`, writes `pos` and `vel`, an i32 × 300 each) and the net item `match`.
- **`army`** (`armyProgram`): 311 B of WebAssembly written as bytes, one page of memory, no import. `init` lines 300
  units up 16 apart in rows of 20. Each step folds the step's entries, in the read region's order, into a running word
  (`acc = acc × 31 + player × 1000 + value + 8`), and each entry changes the velocity of the unit the word names
  (`vel[acc mod 300] = (vel × 3 + value × player) rem 17`); then every unit moves by its velocity. So an entry dropped,
  applied at another step, given another player or read in another order leaves other arrays, and the running word is
  carried state no array shows. The read region is Logic `logic@1`'s for one slider: a u32 count and 4 zero bytes at
  `reads_at` 0, then 16 B an entry, a u32 player, 4 zero bytes and the f64 value. The arrays start at `writes_at` 4096.
- **Scripts** (`script`, `scripts`): player p makes one entry at every match step g from 0 until 4 steps before the
  end, `push = ((7 g + 3 p) mod 17) − 8`.
- **The mirror** (`armyAfter`): this suite's own run of `army`'s rule on the scripts, each entry at its step plus the
  delay, a step's entries in player order. It gives the arrays every copy must hold.
- **The piece without a net item** (`plainDoc`; criterion 1): the same scene and logic, 12 s, requiring no `net`.
- **The piece that tries to join by itself** (`decoyDoc`; criterion 2): the lockstep piece with a press control `join`
  labelled "Join", and a tour that presses it at 2 s and 3 s and moves the slider at 2.5 s.
- **The stub game** (`stubProgram`, `stubDoc`): the Oracle lane's (its README).
- **Builds** (criterion 7): `full`, `full,test-physics-rapier-patch`, `full,test-logic-patch`. Each build's plan must
  show what the criterion needs before its test goes on: two physics pins and two runtime digests; two logic versions
  and one runtime digest. All of these hold at the base.
- **Seeds**: 549 for the test relay, the door's delays and the scene.

## The door, the third connection, the server and the browser

Test-side tools in `helpers.ts`. None stands in for the net module, a backend, the relay or the player.

- **The door** is the network between a copy and the shipped relay, seen from outside both, and the piece declares its
  address as the relay. It listens on 127.0.0.1 with the relay's own throwaway certificate, offering HTTP/1.1 alone,
  and opens its own TLS connection to the relay for each connection it takes. It logs each connection's upgrade
  request (its line and headers) and every relay@1 message either way: relay@1 is a WebSocket over https, each control
  message one JSON text message with one member, each frame one binary message (`packages/contracts/slots/relay@1.json`).
  It is the "socket log" and the "relay's log" of criteria 2, 3 and 6, since the shipped relay keeps none. On request it
  delays each frame the relay forwards by a seeded time, order kept (criterion 4: 0 to 150 ms), or drops every `signal`
  message both ways, so no direct path can be set up (criteria 3 and 4). A frame is read in relay@1's layout only for
  its `match`, the first 16 bytes.
- **A third connection** speaks relay@1 to the relay itself, trusting the authority: it reads the hello, sends one
  `join` and keeps whatever arrives.
- **The server** is a `node:http` listener in the test process on 127.0.0.1. It serves the bundle as written,
  `index.html` with `no-cache`, and logs each request's path, status and cookie.
- **The browser** is Google Chrome, `--headless=new` with `--enable-unsafe-webgpu --ignore-gpu-blocklist`, a fresh
  profile, driven over its DevTools protocol by `helpers.ts` alone. Pages are 1280 × 720. Everything a page reaches is
  logged twice: by the browser's Network domain for the page, and by a script installed before the page's own, which
  wraps `WebSocket`, `WebTransport`, `EventSource`, `RTCPeerConnection`, `fetch`, `XMLHttpRequest` and `sendBeacon`.
  The script wraps the page's own realm; what a worker opens is in the first log only as far as the browser reports
  it for the page. The door sees whatever reaches the relay, whoever opened it. A script's evaluation is never a user
  gesture; a person's click is `Input.dispatchMouseEvent`.

## Where a comment and the code differ

The code is what the tests run. Five places:

- **A live copy is two runs.** The comment over `liveCopy`'s part of `helpers.ts` says "One `deep-show run` per copy".
  The code runs two for each copy, one after the other: the first shows the piece and reads where the prompt's button
  is, the second shows it again, clicks there and plays. So the app must draw the prompt at the same place both times.
- **The door changes one header.** Its comment says it "hands every byte on". The code takes any
  `Sec-WebSocket-Extensions` header out of a copy's upgrade request before it reaches the relay, so no extension is
  negotiated and each frame stays readable. Everything else passes as it came, but for the delays and drops asked for.
- **The prompt is read from `scope` alone.** `Prompt`'s comment says "a `scope` (or `input`) reply". No test reads
  `state.join` from an `input` reply.
- **The page-side log is the page's own realm.** The browser's comment says "the page's every request and socket is
  logged twice". The installed script wraps the page's constructors, not a worker's (above).
- **The late join's wait** (`ac3-direct-path.test.ts`): the comment says the question is asked "for up to 30 s". The
  code asks up to 60 times, half a second apart, and each time waits up to 10 s for the answer.

## Disagreements

Where the issue and the design disagree, or a criterion needed a reading, and the reading these tests take.

- **A net item without a relay.** The Scope and the design say "a piece with no relay shows no Join"; criterion 1 says
  a net item without a relay is refused at check. Taken: a piece with no relay is a piece without a net item, which
  shows no Join; a net item must declare one, and one that doesn't is refused.
- **"With a second host"** (criterion 1). `relay` is one https URL, so a second host has no written form. Taken: a list
  of two https URLs. The base already refuses this one case; the test still fails there on the other two.
- **The prompt's `refused`.** The issue's Fields give the Join prompt as `{relay host, players so far, courtesy,
  readings}`; the design's adds `refused: unknown | full | started | mismatch {what} | none`. Criteria 6 and 7 need a
  refusal on the prompt. Taken: the design's.
- **"What it answered"** (criterion 6). The design says a refused relay is named with "the digest it gave". Taken: the
  other digest for the relay that answers relay@1 with one, and `relay@2` for the relay that answers another protocol.
- **"A test relay" with a copy in headless Chrome** (criterion 4). The design's test relay runs copies in one process
  with no network, where a browser's copy can't be. Taken: for the live match, the shipped relay behind the door, which
  delays each forwarded frame by a seeded 0 to 150 ms; the door keeps order, so a frame can wait longer behind the one
  before it. "A run with no delay", `net.budget`, `net.rollback` and criteria 5 and 8 use the design's test relay,
  through `match`.
- **"For 3,600 match steps"** and **"the same merged track"** (criterion 4). The app's copy runs exactly 3,600 steps and
  then leaves, which ends the match, so the page's copy has run at least 3,592 and ends `left`. The two live records and
  the no-delay run's are compared up to the lower `confirmed`, which is at least 3,588.
- **"Says who sees the copy's network address"** (the Scope): the prompt's text holds the words "network address". Who
  it names isn't read.
- **"The relay's log"** (criterion 3). The relay holds nothing and the shipped one prints nothing. Taken: the door's
  log of what each copy sent it. "Only their joining" is `join` and `signal` messages and no frame, since relay@1's
  `signal` exists only to set up a direct path; the test needs at least one `signal` to have crossed.
- **"A network that allows a direct path"** (criterion 3): both copies on 127.0.0.1 with signaling handed on.
  "Blocked": every `signal` dropped. "The other copy" in a `sockets` log is any port on 127.0.0.1.
- **"The relay holds no message, match ID or hash"**: a late `join` to the ended match's ID with `open` false is
  refused `unknown`.
- **"At every confirmed step"** (criteria 3, 5, 7, 8): `hash_every: 1`, compared at every step both reports give, a few
  short of all (10 in a live match, 2 in process). "At every hash interval" (criterion 4): `hash_every: 60`, at least 58
  intervals of 3,600 steps.
- **Player numbers.** The criteria's player 1 and player 2 are the first and second the relay saw join, and every
  report, entry and log row here counts from 1. relay@1's contract counts seats from 0 (`joined.player`: 0 to 7). No
  test reads the wire's player byte.
- **"A 10-minute session"** (criterion 1): in the app, ten minutes of the scenario's virtual clock, the scope read each
  minute; in headless Chrome, ten minutes of the page's real clock.
- **"deep_drive's click in a replica"** (criterion 2): an `input` event marked `source: "synthetic"` with the posting
  process's pid, in `deep-show run`; no replica is started. **"A tour's entry"**: two entries with `writer: "tour"`
  loaded on the piece's own `join` control, and the document's tour. **"The piece's logic"**: 100 steps of `logic`.
  **"A synthetic click dispatched in the page"**: every event a script can make on the button.
- **"No cookie or credential"**: no `cookie`, `authorization` or `proxy-authorization` header and no user information
  in any upgrade request at the door, no canary secret in a request head or message, none in a `sockets` row; in
  Chrome, none on any request the browser logged. The canary can only show on a build whose secret store is the
  scenario's `secrets`.
- **"A guessed match ID"**: a random ID, and the match's own with its last digit changed, each sent as an opening and
  as a non-opening `join`, straight to the relay, between the first copy's seating and the second's. Each gets the
  answer to its own join and nothing else.
- **"0 B of rollback snapshots counted by net.budget"**: `check.rollback_snapshot_bytes` is 0 on a 600-step match in
  process. The design counts those bytes a second; 0 is 0 either way.
- **`since`** in the waiting notice: the seconds the copy has waited so far, not the time the wait began.
- **"The app's notice … shown from 0.25 s"** (criterion 5): the copy's `notices` and each render's `notice`, as the
  app reports them on the test relay's clock, each within one step time (0.05 s). No pixel of the app's overlay is read.
  **"Shows no notice"**: the piece's own layer has the pixels it has without one.
- **"Stalls and fails, naming the lost step"** (criterion 8): no check kind of the issue covers drops, so the check is
  this file's own: a copy that stops short fails it, naming the step it waits for and the relay's lost step.
- **"Differ only in a bit, canonical logic implementation"** (criterion 7): the two builds' records carry one
  module-set digest, since that digest names the shapes a build registers (Registry and seal: runtime digest).

## Not tested, because no criterion reaches it here

Three to eight players; a window above 0 and rollback (#551); `net.desync`, and a match that ends `desync` or
`faulted` (#550); `draw_after`, `match.me` and the courtesy line (#552); `readings_from` and the readings line (#554);
the match budgets and `net.budget`'s verdict (#553); the prompt's `unknown`, `full` and `started`, and a relay's limits;
the match overlay; a record kept beside the piece as a fork and exported; scrubbing, seeking or forking during a
match; the step-rate rule; entries made in the web player (in every test here the page's player makes none, though its
copy sends a message each step); the web player's own waiting notice; a direct path to or from a page; `end: left` on
an app copy. They are follow-ups for the implementer's own tests or the sibling parts.

## What the implementer adds outside this folder

- The lanes lines above.
- In `net@1`: `hash_every`, `timeout`, and the rule that `relay` is one https host.
- In `deep-show`: the net module's Join, live match, hashes, record, waits and notices; the app's prompt in `scope`;
  the calls `sockets` and `play_match`; `match`'s members and reply; `net.rollback` and `net.budget`; the scenario's
  `docs.<id>.link`, `relay_ca` and `secrets`; `source` and `pid` on an `input` event; the two planted names.
- In the web player: its network backend, its prompt (`data-deep-join`), the match from the page's fragment, and
  `probe().match`.
