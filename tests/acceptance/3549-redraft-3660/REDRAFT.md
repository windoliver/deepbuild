# Blind redraft of #3549's turn, window and compiles tests under #3660's option A

Under #3549, a build asked for under no grant is admitted, then waits for a turn of the machine's pool with no limit. The owner chose option A on #3660 (2026-11-27): the turn wait now runs on the caller's bound.

- With `--wait <min>`, the deadline set when the request asked still holds once the build is admitted.
- With `--stall <min>`, the stall keeps running and starts again each time a turn of the pool is taken or given back.
- With no turn in time, the build gives back its admission, starts nothing, and exits as an admission timeout does: exit 3, `INCONCLUSIVE no grant`, and a `timeout` log entry.

#3660's fifth criterion names three files of `tests/acceptance/3549/` in which a build waits for its turn past its own `--wait`, which option A reverses: `turn.test.mjs`, `window.test.mjs` and `compiles.test.mjs`. This folder redrafts those three files. The originals are not edited.

## Second round (2026-11-28): `turn.test.mjs` and `window.test.mjs` redrafted again, on a base that holds #3694

The first round was written on the base `3359cc775`. Main has since gained #3694 and #3698:

- **#3694.** A plain `test` request (under no grant, not an `affected.mjs` run's) is admitted as a run is, without the load, and then takes a turn of the pool with no limit, as a build does. Its command starts only once it holds a token.
- **#3698.** The pool lends what the even shares leave free. A waiting turn request takes the lent tokens back at the lender's next look, about a second.

On the new base `9bbe0f24c`, with option A applied to builds only, the first round's two files no longer formed their scenes:

| First-round test | What failed | Why |
|---|---|---|
| `turn.test.mjs`, first | "a test request on a table that holds no test grant didn't run: `node throttle.mjs test --wait 0 -- node stub.mjs control-1 exit`" | Its two controls were plain test requests, asked while four builds held the pool's four tokens. Under #3694 each waits for a token with no limit. |
| `turn.test.mjs`, second | "the build that holds the pool's one token, or the test grant's holder, never started" | A plain test grant, `test-holder`, was to run beside the build on a pool of one token. Under #3694 it waits for that token. |
| `window.test.mjs`, second | "the build that holds the pool's token, or the test grant's command, never started" | The plain test grant `chain`, which asks for the window, waits for the pool's one token. |
| `window.test.mjs`, third | "the build that holds the pool's token, or the test grant's holder, never started" | As `turn.test.mjs`'s second: `test-holder` on a pool of one token. |

The original `tests/acceptance/3549/turn.test.mjs` fails the same two ways on the plain base, so the turn scenes broke under #3694, not #3660. `tests/acceptance/3549-redraft-3694/window.test.mjs` forms the window scenes under #3694, but its third test keeps a build waiting past its own `--wait 0.05`, which option A reverses.

`compiles.test.mjs` is the first round's, untouched in this round: see "First round" below.

### Inputs of this round

- Issues #3660 (body and comments), #3549 (body and comments), #3694, #3698, #3221.
- `docs/parallel-proof.md` sections 6, 7a, 12a and 13, `docs/technical-design.md` Dogfooding and `AGENTS.md`, at the base.
- The base `9bbe0f24c`, for call shapes: `scripts/throttle.mjs`, `scripts/lease`, `scripts/lanes-lists.mjs`, `scripts/lanes.mjs`.
- The suites `tests/acceptance/3549/`, `tests/acceptance/3549-redraft-3694/`, `tests/acceptance/3694/`, `tests/acceptance/3549/DISPUTE-3694.md`, and the first round's files here and in `tests/acceptance/3660/`.
- Not read: #3660's implementation, its branch's `scripts/` or `docs/`, or any PR discussion.

The files import `../3549/helpers.mjs`, and `window.test.mjs` also `turnsOf` from `../3549-redraft-3694/helpers.mjs`, as they are. They have no comments.

### What changed, test by test

| Test | Change from the first round | What it holds now |
|---|---|---|
| `turn.test.mjs` › `#3549.b6b01435 on a pool of 4 tokens a second stub build of 40 s …` (name unchanged) | The two controls, which give a build that needn't wait time to start, are two top-level `bay-pair` requests with a wait of 0 (`probe`, #3549's own helper), each run to its end. A bay pair takes no turn of the pool, so the four tokens stay with the four builds. The fifth build is also checked still in line. | The criterion's numbers and every other assertion are the original's. |
| `turn.test.mjs` › `#3549.b6b01435 #3660.a7f3d0fa on a pool of 1 token a build asked beside one under way, … with 0.05 min it ends INCONCLUSIVE at that wait with its command never started and its admission given back, and with 10 min it runs under a jobserver of its own once the token goes back` | No plain test grant is in the scene. The first round's `test-holder` was there only so that a second test request, the witness, was kept out by the load and ran out its 0.1 min: a clock. Under #3694 the load keeps no test out. The long builds' admission is read from the log's `granted` entries, and the clock is two `bay-pair` probes run to their end. The holder asks with `--wait 10`. Two assertions are new: a short build may not give up before its 3 s, and the table may not drop a short build's grant as `holder gone`. | See below the table. |
| `window.test.mjs` › `#3549.7ba8246d a window opens only once an admitted build that is under way has ended` | The holder asks with `--wait 10`, not 0.1. | Cores 5: four tokens, enough for the build and `chain`. |
| `window.test.mjs` › `#3549.7ba8246d a window opens only once every admitted build has ended: one that waited for its turn …` | Cores 3, not 2: two tokens, one for the build `holds-the-token` and one for `chain`'s turn (#3694), so every token is held when `waits-its-turn` asks. The test checks that the log names `chain`'s turn. `waits-its-turn`'s admission is read from the log before the probes. The holder asks with `--wait 10`. | The window stays pending while the build waits, the freed token goes to the build, and the window opens only after that build ends. |
| `window.test.mjs` › `#3549.7ba8246d a window does not open while an admitted build still waits for its turn inside its own wait: …` | No plain test grant is in the scene: `test-holder` and its witness were the same clock as in `turn.test.mjs`. Cores 2, one token, held by the build that asks for the window. The waiting build asks with `--wait 10` (first round), and its admission is read from the log, then two probes run. The holder asks with `--wait 10`. | The window's request, `--wait 0.05`, runs out with exit 3 and `INCONCLUSIVE no grant`. The window never opens. The build is still in line, then runs with exit 0 and no INCONCLUSIVE once the token goes back. |

**Why the holders ask with `--wait 10`.** The originals gave them 0.1 min. Under option A that 6 s also covers the holder's own turn wait. Under #3698 a turn held alone is lent the rest of the pool and gives it back only at its next look, a second later. On a loaded machine a holder asked beside a plain test grant could run out 6 s. No criterion turns on the holder's wait.

**`turn.test.mjs`, second test.** A pool of one token (cores 2, load 1000: a build's admission doesn't read the load). The build `under-way` holds the token.

- **0.05 min.** A direct build and a leased build (`scripts/lease`, `DEEP_LEASE_WAIT=0.05`) ask. Each must:
  - end within 60 s of asking and not before 3 s, with exit 3 and `INCONCLUSIVE no grant`;
  - never start its command;
  - show in the log a top-level `granted` of class `build` (its admission), then a `timeout` of class `build` with `wait` 0.05.
- **10 min.** Then two builds ask the same two ways with 10 min.
  - Each has its top-level `granted` entry. Two probes later neither has started and both still run, so each is admitted and waits for its turn.
  - The log holds no `released` entry with `reason: "holder gone"` for either short build: each gave its admission back itself.
  - When the token goes back, each starts no earlier than the holder's end, exits 0, prints no INCONCLUSIVE, and runs under a build grant and a jobserver of its own.
- **Order.** The short builds ask before the long ones, so at most three builds are admitted at once, under the Mac's ceiling of 4.

### Which tests carry `#3660.a7f3d0fa`

Only `turn.test.mjs`'s second test. On the base it fails with "the build `direct-short` … was still waiting 60 s after asking: its wait for its turn ran past its own wait", and it passes under option A.

The other four tests give every build a wait that covers its turn. They pass on the base too and carry only their #3549 tags.

### Wrong programs (one fault each)

Each is the throwaway right program below with one fault. Each was run once against the file it is for. No twins are written here.

| Test | Wrong program | Result |
|---|---|---|
| `turn.test.mjs`, first | The ceiling of builds is 1: top-level builds are served one at a time. | Fails: "the second build, `node throttle.mjs build --wait 10 -- node stub.mjs second sleep 40` …, had not ended: not within 60 s of asking. It waited behind the first, of 400 s". |
| `turn.test.mjs`, second | The base: the turn wait has no limit. | Fails: "… was still waiting 60 s after asking: its wait for its turn ran past its own wait". |
| `turn.test.mjs`, second | The ceiling of builds is 1. | Fails: "the log shows no top-level granted of class build for the build `direct-short` …: it wasn't admitted, so its timeout is its admission's, not its turn's". |
| `turn.test.mjs`, second | At the turn wait's timeout the turn request goes but the admission stays in the table. | Fails: "the table gave back a grant of the build `direct-short` … only once it found its holder gone: the build left its admission behind when its wait ran out". The first test passes. |
| `window.test.mjs`, first and second | A window waits for no build: `blockers()` leaves build grants and turns out for a window. | Both fail: "the window opened while the admitted build … `under-way hold` … had not ended" and "… `waits-its-turn hold` … had not ended". The third fails too. |
| `window.test.mjs`, third | A window takes an admitted build that waits for its turn as waiting: `blockers()` without `!request.window`. | Fails: "the window opened while the admitted build `node throttle.mjs build --wait 10 -- node stub.mjs waits-its-turn exit` … still waited for its turn: an admitted build had not ended". The first two pass. |

### Runs of this round

All on the Mac (18 cores, node v24.22.0), 2026-11-28, each lane once with `node --test --test-reporter=spec <files>`, no lane retried. Every request used its test's own table (`DEEP_THROTTLE_TABLE` in its sandbox). Stub builds only: no cargo. Lanes A and B ran side by side, then C to F side by side. The load is the 1-minute load at each lane's start and end.

The throwaway right program is the base's `scripts/throttle.mjs` with four changes in `acquire()`, written from #3660's decision alone:

1. Once a build is admitted, its deadline is no longer set to Infinity. A plain test's still is.
2. In an admitted build's turn wait, a stall's bound starts again when the table's turn grants change.
3. At a timeout in that turn wait, the build's admission grant leaves the table with the turn request.
4. That timeout's log entry carries the admission's id and `waited`.

It and the wrong programs were copies of `scripts/` and these test folders in a scratch folder outside the checkout. They are deleted and prove nothing about the real change.

| Lane | Program | Files | UTC start → end | Load start → end | Result |
|---|---|---|---|---|---|
| A | throwaway right | `turn`, `window`, and `3660/lanes.test.mjs` | 08:11:02 → 08:12:18 | 8.8 → 6.6 | 6 pass, 0 fail |
| B | base `9bbe0f24c` | the same three | 08:11:02 → 08:13:15 | 8.8 → 6.3 | 4 pass, 2 fail: `turn`'s second test and the lanes test, each at the words expected. `turn`'s first and the three window tests pass. |
| C | ceiling 1 | `turn.test.mjs` | 08:12:26 → 08:14:00 | 6.7 → 7.5 | 0 pass, 2 fail |
| D | a window waits for no build | `window.test.mjs` | 08:12:26 → 08:12:30 | 6.7 → 6.7 | 0 pass, 3 fail |
| E | a window takes a waiting build as waiting | `window.test.mjs` | 08:12:26 → 08:12:38 | 6.7 → 6.3 | 2 pass, 1 fail: the third |
| F | the turn timeout keeps its admission | `turn.test.mjs` | 08:12:26 → 08:13:44 | 6.7 → 6.1 | 1 pass, 1 fail: the second |

Lints: `node scripts/wait-ratchet.mjs` and `node scripts/comment-ratchet.mjs` report no finding in this folder or in `tests/acceptance/3660/`. Both report findings in other files at the base.

**Not run in this round:**

- these files on the Linux machine, where the ceiling is 6;
- `compiles.test.mjs` (it needs cargo; not this round's to touch);
- the first round's files or `3549-redraft-3694/window.test.mjs` on the throwaway (the brief's measurements stand for those);
- `--stall` scenes, since no test of these files asks with a stall;
- a lane, preflight, `affected.mjs` or twin in its line form.

### Gaps

- The first and second window tests and `turn`'s first pass on the base. They guard #3549's criteria under option A and don't prove it.
- `turn`'s second test reads "gives back its admission" from the log: no `holder gone` release. `tests/acceptance/3660/wait.test.mjs` reads the table itself.
- A stall that doesn't start again on a turn is not caught here. `tests/acceptance/3660/line.test.mjs` holds it.

## First round: `compiles.test.mjs`

Written on the base `3359cc775` and run on the Linux machine (aarch64, 20 cores, node v24.22.0, cargo 1.99.1) on 2026-11-28 from 05:09 UTC.

`compiles.test.mjs` › `#3549.13a91455 two real cargo builds …, and a third build asked beside them waits for its turn`. In the original the third build asks with 0.05 min and must wait until a cargo build ends. On a right program it fails with "the third build, … --wait 0.05 … didn't wait for its turn and then run (exit 3; …)". Two changes:

- The third build asks with `--wait 15`, which covers its wait for a cargo build to end.
- The bounds keep the file under the suite's 20 minutes: the test's timeout is 19 min, not 25; both builds must be under way within 3 min, not 10; both must end within 12 min, on one shared deadline, not 20 min each.

The test took 16 s there. Its one comment is a `// deadline:` marker on its once-a-second `setInterval`, which the wait ratchet requires.

Its wrong program: a turn's jobserver is filled with the pool's count less one at once, and the tokens are never taken back. It failed with "at look 7 (+6.0 s): 4 (first 2, second 2), 4 compiler processes ran at once, more than the pool's 2 tokens; 6 of 12 looks were above 2". It passed on that round's throwaway right program and on its base. It has not been run on the base `9bbe0f24c`.
