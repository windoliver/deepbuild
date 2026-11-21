# Acceptance tests for #1101: a hold before what can't be undone, and a receipt with no Undo once it ran

Written first and blind, at base commit `7a256fd4b` (origin/main), from issue #1101 (its Scope, the seven acceptance
criteria and Proof; it has no comments), the design and the base, before any implementation. The implementing agent
does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
`TASTE.json` is the one file here a person's call changes.

## What was read

- **The issue**: Scope (a step that can't be undone starts only after a 10 s hold the hub keeps, its receipt "Starts in
  10 s · Undo" counting down; Undo inside the hold runs nothing, records `approval.withdrawn` with the step and opens the
  ask again on its card; after the hold the receipt says it ran and can't be undone, with no Undo; a step that can be
  undone runs at once; the app quitting doesn't stop the hold, a hub restart reopens the ask; a batch holds each such
  step and Undo withdraws only those not yet started; Undo on a receipt is the hub's undo, the one `deep inbox undo`
  calls; a single-step card has no switch), the seven criteria and Proof. For context only: #241, #327, #319, #2029,
  #1806, #1807, #1461.
- **The design**: `docs/technical-design.md`, Plans before acting (the plan, the step drawn from the call, "A hold
  before what can't be undone"), Every ask ends (a batch's step that can't be undone starts switched off);
  `docs/canvas-primitives.md`, Question card (arming, the answered card's one-line receipt with Undo).
- **The base**, for its surfaces only: `packages/hub/src/{server,core,holds,human-answers,inbox,trusted,plant,hookmap}.ts`
  (`test.clock`, DEEP_HUB_TEST_CLOCK, `ask.answer`, `ask.undo`, `ask.card`, `inbox.read`, the plan a held push gets);
  `crates/deep-app/src/{question,card,codes,answer}.rs` (the card's rows, switches and receipt, its control keys
  `card-option:<id>`, `card-step:<n>`, `card-undo`); `crates/deep-replica/src/drive/{mod,frames,hubcopy}.rs` (launch on a
  fixture at NOW, `wait_for` with `step_ms`, `open`, `see`, `act` with `source: "hid"`, `screenshot`, `record`);
  `crates/deep-hook/default-rules.json`; and the suites `2029` (whose world, session and page reads these copy), `16`,
  `327`, `319`, `1462`, `667` and `2219`.

## How to run

With Node 24.22 first on `PATH`, cargo (1.99.1) on `PATH`, on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
npx vitest run --root tests/acceptance/1101 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1101/tsconfig.json
DA1101_SCREENS=<dir> npx vitest run --root tests/acceptance/1101 shown --testTimeout=600000   # keeps AC7's files
```

- **Builds** are #2029's, built only when a test needs them: `deep-hook` into the checkout's target, where the hub looks
  for it, and `deep-drive` with `--features deep-app/test-confirm` (#1454's stand-in for the OS confirming you, which the
  card asks for before it sends a yes; #1462's suite builds it the same way), or with `env-plants` too, then plain again
  so the target never holds a plant, each copied to `$TMPDIR/da1101-bin-<uid>-<checkout>/`, each in a grant of
  `scripts/throttle.mjs build --wait 240`, with #1172's build
  environment (`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`), skipped when the binary is newer than every Rust
  source. `CARGO_TARGET_DIR` is honored.
- **Folders and processes.** Homes are under `/tmp` (#16's `tempDir`). Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID. No network, no model.
- **Windows.** Nothing opens a window: `deep-drive` draws headless.
- **Lanes.** The files start hubs and draw, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list in a macOS
  lane; the implementer makes that edit.
- Vitest writes `tests/acceptance/1101/node_modules/.vite/` under `--root`; delete it before committing.

## The surfaces (my choice where the issue names none)

### The world and the clocks

**The hub** is a real `deep hub run` in a temp HOME (`helpers.ts` `world`): the shipped default guards, your ask
settings, the OS confirming you, and a git repository `shop` whose `origin` is a bare repository on disk, holding
nothing. A Claude Code session sends its hooks on the hook wire as deep-hook sends them; you typed "Fix the login bug in
src/auth.js.", which names no push and no pull request, so each is held by the shipped `push-needs-ask` or
`pr-needs-ask` with an authority ask (the base's own path).

**The virtual clock** is the hub's test clock: DEEP_HUB_TEST_CLOCK starts it a minute after the replica's NOW, and #965's
`test.clock` (DEEP_HUB_TEST_CLOCK_STEPS=1) steps it. Hooks and transcript lines are stamped as deep-hook stamps them,
on that clock's base without its steps, which the hub adds (#965). The test clock also runs with real time, so a step is
"to" a time: when real time already carried the clock past it, nothing is stepped, and a run whose clock passed 9 s into
a hold before its Undo, its stop or its next try is INCONCLUSIVE, never PASS.

**The hold's start** is the `ts` of the `ask.answered` the hub records for the yes. **A step starts** when the hub lets
the agent's PreToolUse for it through: the agent runs the same call again, as a held call is told to, right after the
yes, 9 s in and at 10 s; a call the hub lets through runs for real (a push is a real `git push` to the bare repository,
so a git process starts only then). A try's time is the hub's clock read right after its reply, so it is never earlier
than when the hub decided. A hub that keeps the call waiting through the hold instead of refusing it is read the same
way: its try comes back at 10 s.

### The yes and the Undo

**Allowed on its card**: in AC1 and AC6 Allow is pressed on the card in the replica (below) and what the app sent its
hub reaches the real hub signed, as the app sends it (`crates/deep-app/src/answer.rs`: `ask.answer {ask, option,
plan_hash, token, steps?}` on an app connection, signed by a device paired with the hub, #1579's format, at the hub's
time). In AC2 to AC5 and AC7 the same answer is built from the card the hub serves (`ask.card`), as #2029 does. A batch
is approved on its first step's card with every step's index (#327).

**Undo** is the receipt's Undo as the app sends it: `ask.undo {ask}` on an app connection, signed the same way: the
hub's undo, the one `deep inbox undo` calls (#1806). For a batch it is sent on the card the batch was approved on, its
first step's ask.

### The card and its receipt

They are read where a person reads them: the ask's page, `ask/<ULID>` (#1460), in the app's views drawn headless by the
real `deep-drive` (#124), launched on a copy of the hub's record (`launch.from: "fixture"`, which starts the replica's
clock at NOW) and its clock moved on with `wait_for` to a time of the hold; the OS confirms you whenever the card asks
(DEEP_APP_TEST_CONFIRM's file says `confirmed`). A copy is the hub's `events.read`, one
`{session_id, event}` per line. The words are judged as #2029 judges them: a piece must be one of the page's strings, or
within them joined.

## Pinned here: the implementation must provide these

1. **The hold is the hub's and on the hub's clock.** A step that can't be undone, approved, is let through no earlier
   than 10 s after its `ask.answered` on the hub's clock, and is let through once `test.clock` has brought the clock to
   10 s, though less real time has passed.
2. **The receipt counts down from the record.** The ask's page, drawn from a copy of the record taken during the hold,
   reads "Starts in 10 s" with an Undo control (a node named `Undo`, or `card-undo`) 200 ms into the hold, and "Starts
   in 6 s" with it 4.2 s in. The issue's "Starts in 10 s · Undo" is read as that text beside that control, whatever
   separates them. Reading 200 ms past each whole second lets a countdown that names the seconds left rounded up, or to
   the nearest, read the issue's numbers.
3. **After the step ran** (its PostToolUse recorded), the page a second later reads that it ran (`ran`) and can't be
   undone ("can't be undone", or the design's "can't be taken back"), and no node in the page is named `Undo` or is
   `card-undo`, and no string holds the word `Undo`.
4. **Undo inside the hold** (`ask.undo` on the answered ask) is accepted, records an `approval.withdrawn` whose
   `subject` or `data` names the ask's handle or the step's command, leaves the ask open (`inbox.read` lists it not
   `closed` and `unanswered`, and `ask.card` offers its allow option again), and the step never runs.
5. **A hub stopped during a hold** and started again on the same home leaves the ask open as in 4, and its step runs
   neither on the next try nor past where the hold would have ended.
6. **A batch's Undo** on the card it was approved on withdraws exactly the steps not yet started: an
   `approval.withdrawn` names each push and none names a pull request (a withdrawal names a step by its `data`, or by
   its `subject` alone when its `data` names no other step of the batch); each push's ask is open as in 4; each pull
   request's ask stays `closed`, `answered`.
7. **The card.** The single push's card (its `question-card` node wherever the window draws it, else its page) holds
   no switch: no node whose role is `switch`, `check_box` or
   `toggle_button`, and no `card-step:<n>` control. Once its card (`question-card`) reads `armed`, one hardware press
   (`act` click, `source: "hid"`) on `card-option:<allow option's id>` makes the app send exactly one `ask.answer` with
   that option (`see`'s `hub` list), and the hub, taking it, holds the push. On the batch's first card, read before it
   is answered, each push's switch (a switch whose name holds its command) reads `off`.

## Plants

Each is selected by `DEEP_HUB_PLANT=<name>`: the app reads it through `deep_app::plain::planted` in `deep-drive`'s
`env-plants` build, and the hub is given it too only when `packages/hub/src/plant.ts` lists the name (`hubLists`); the
hub refuses a plant it doesn't list. A plant whose wrong program is the hub's must be listed there; one that is the
app's needs no listing. Each plant's test holds the clean run to the same judge first, so a program that already fails
can't make its plant look caught, and a plant the build ignores fails ("wasn't caught").

| Plant | Criterion | The wrong program | Must fail naming |
|---|---|---|---|
| `hold-starts-at-click` | AC1 | the yes starts the push at the click, with no hold (its card is pressed in the replica with the plant, and the hub runs it when listed) | the step, `git push origin main` with its ask |
| `undo-runs-anyway` | AC2 | after Undo the host runs the push anyway | the ask |
| `undo-closes-declined` | AC2 | Undo closes the ask as declined instead of opening it again | the ask |
| `receipt-keeps-undo` | AC3 | the receipt still shows Undo after its step ran | the receipt of the ask |
| `restart-runs-held` | AC4 | a hub that runs held steps when it starts again | the step, `git push origin main` |
| `batch-holds-all` | AC5 | a batch that holds all four steps, those that can be undone too | a pull request's step |
| `undo-withdraws-ran` | AC5 | Undo withdraws a batch's step that already ran | a pull request's step |
| `single-step-switch` | AC6 | a single-step card with a switch, so a yes takes two presses | the card of the ask |

No `twins.json`: every criterion is new behaviour the base doesn't have, so each test fails on the merge base at its
assertion, and the wrong programs the criteria name are these plants.

## The fixtures

- **The push**: `git push origin main` from `shop`, to a bare `origin` that holds nothing.
- **The batch** (AC5, AC6): your visits every 2 minutes (`asks.batch.every: "2m"`). Inside one window on the hub's clock
  the agent's `git push origin main`, `gh pr create --base main --head fix-login --title "Fix the login check" --body "Fix the login check."`,
  `git push origin v2.0.0` and `gh pr create --base main --head auth-tests --title "Tidy the auth tests" --body "Tidy the auth tests."` are held (a body, so the gate's Closes rule, #322, can read it); the
  clock is stepped past the next window's start and the agent's turn ends waiting on your answer, and the hub, reading
  the asks again at that stop, shows the four as one batch (`ask.batched`), as #2029's batch shows. A pull request that
  runs prints its URL; nothing reaches a forge.

## Criterion to tests

| Criterion | ID | Test | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| AC1 approving a push starts no git process for 10 s; "Starts in 10 s · Undo" counting down; the push starts at 10 s; a planted card that starts it at the click fails naming the step | `#1101.5140ae1c` | `push.test.ts` (1) and (2), plant `hold-starts-at-click` | the base (the push runs at the click); a hold on real timers (it doesn't start at 10 s on the test clock); a receipt with no countdown or no Undo | FAIL |
| AC2 Undo at 6 s runs nothing, records `approval.withdrawn`, the ask open on its card again; a planted host that runs it anyway or closes the ask as declined fails naming the ask | `#1101.08523c57` | `undo.test.ts` (1), (2) `undo-runs-anyway`, (3) `undo-closes-declined` | the base (no hold; `ask.undo` refuses an answered ask) | FAIL |
| AC3 after the push runs, its receipt says it ran and can't be undone, no Undo in the text snapshot; a planted receipt that still shows Undo fails naming the receipt | `#1101.2d545cc0` | `push.test.ts` (3) and (4), plant `receipt-keeps-undo` | the base ("Allowed · ran"); a receipt that keeps Undo | FAIL |
| AC4 with the hub stopped at 4 s into a hold and started again, the push hasn't run and its ask is open; a planted hub that runs held steps on restart fails naming the step | `#1101.96f7bd58` | `restart.test.ts` (1), (2) `restart-runs-held` | the base (the push runs at the click) | FAIL |
| AC5 a batch of four with two that can't be undone runs the reversible two at once and holds the other two; Undo at 5 s withdraws exactly those two; planted batches fail naming the step | `#1101.538a1251` | `batch.test.ts` (1), (2) `batch-holds-all`, (3) `undo-withdraws-ran` | the base (the pushes run at once) | FAIL |
| AC6 a push's card holds no switch; one press on Allow starts the hold; a batch of four starts its step that can't be undone switched off; a planted single-step card that needs two presses fails naming the card | `#1101.b49d00ae` | `card.test.ts` (1), (2) `single-step-switch` | the base (the push's card draws a switch for its step) | FAIL |
| AC7 screenshots of the held card with its countdown and Undo, and of the receipt after it ran, with a recording of the countdown; one taste call, recorded; INCONCLUSIVE without it | `#1101.cf35fa4c` | `shown.test.ts`, `TASTE.json` | the base (no held card to picture) | FAIL before any picture |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text in the live issue body. Each test's name
starts with its ID. No test passes when its surface is missing: a missing build, hub, ask, record or page stops it
`BLOCKED: …` or fails naming what's missing; a run the Mac was too slow for is `INCONCLUSIVE: …`.

## Readings where the issue leaves a choice (a redraft may revisit them)

1. **"Starts no git process"** is read at the hub's door: no PreToolUse of the push is let through before 10 s on the
   hub's clock, and the bare `origin` holds no `main` until then. The agent stand-in starts `git push` only for a call
   the hub let through, as Claude Code does.
2. **"Counting down on a virtual clock"** is the replica's clock moved on over one copy of the record: 10 s left 200 ms
   into the hold, 6 s left 4.2 s in. The hold must therefore be in the record (Pinned 2); the hub's own clock is the
   virtual clock the hold itself runs on.
3. **"Open on its card again"** is the inbox's row (`inbox.read`: not closed, `unanswered`) and the card the hub serves
   offering its allow option. The app's page isn't read for it.
4. **The hub stopped "at 4 s"** is SIGTERM to its PID once its clock reads 4 s into the hold; it starts again on the same
   home with its clock going on from where it stopped.
5. **The batch's two steps that can be undone are pull requests opened.** The base's plan says a PR "Revert it with a
   new commit", and the issue's list of what can't be undone (a push, a send to a public target, a delete outside
   staging, an external post) doesn't name opening one. A design that counts opening a pull request as an external
   post needs a redraft with another step that can be undone and that the shipped guards hold.
6. **"Runs at once"** is the first try right after the yes let through before 10 s; **"Undo at 5 s"** is the batch's
   Undo once the clock reads 5 s (later only if real time carried it there, and never past 9 s).
7. **"One press on Allow starts the hold"** is one hardware press after the card arms: it sends exactly one yes, and the
   hub taking that yes holds the push. A card that needs its step's switch turned on first sends nothing on that press.
8. **AC7's pictures** are taken from the app's views at the reference window as the replica draws them headless; no real
   window is opened. "Attached to the PR and shown to you in the session" no test can see: the implementing agent does
   it. The taste call is TASTE.json's `verdict` on exactly the files the run wrote, by SHA-256.
9. **AC7 doesn't wait for the 10 s hold in real time**: the recording is the replica's clock moving from 0 s to 10 s over
   one copy of the record taken during the hold.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: a send to a public target, a delete outside staging or an
external post held (only a push is); the app quitting during a hold (the hold is the hub's, which AC1 to AC5 read
directly); the real app's Undo reaching the hub (#1806) and where the receipt sits (#1807); the words `deep inbox undo`
prints.

## Files

- `helpers.ts`: IDs, plants and the issue's words; the world, its clocks and restart; the session on the hook wire, the
  held call and its tries; the app's signed yes and Undo; the record's reads; the replica's page reads, the card's press
  and the receipt judges; the batch. Reuses `../16/helpers.ts`; the world, the session, the device and the page reads are copied from `../2029/helpers.ts` with changes.
- `push.test.ts` (AC1, AC3), `undo.test.ts` (AC2), `restart.test.ts` (AC4), `batch.test.ts` (AC5), `card.test.ts`
  (AC6), `shown.test.ts` (AC7) and `TASTE.json`.
- `tsconfig.json`: as #2029's. `BASE-FAILURE.txt`: the run at the base.
