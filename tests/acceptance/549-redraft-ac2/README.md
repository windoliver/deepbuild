# #549 criterion 2, redrafted blind: the app after a person's click, and the third connections

A blind redraft (design: Dogfooding) of one test of criterion 2, `#549.83ea272a`, the third test of
`tests/acceptance/549/ac2-join-only.test.ts`:

- "in the app, after a person's click every connection goes to the declared relay or the other copy with no cookie or
  credential, and a third connection with a guessed match ID receives nothing"

The first draft's other three tests of criterion 2 (the app before a click, headless Chrome before and after a click)
stand and aren't redrafted here.

**Written blind.** From issue #549 (live, November 17, 2026), the design and the base commit `06e231702`
("Merge pull request #2735") with the first draft of the suite untracked in `tests/acceptance/549/` and
`tests/acceptance/549-oracle/`. No implementation of #549, diff, branch, pull request, other worktree or dispute was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- The issue, live (`gh issue view 549 --repo windoliver/deepbuild`): Scope (Relay and Join), Fields (Net: relay and
  Join), criterion 2. Issue #309 (relay@1 and the shipped relay), which #549's Scope names as not in this task.
- AGENTS.md. `docs/technical-design.md`: The net module; Dogfooding; Tests written first. `docs/canvas-primitives.md`:
  Net `net@1`; Net: relay and Join; Net: relay protocol `relay@1`.
- The first draft: `../549/ac2-join-only.test.ts`, `../549/helpers.ts`, `../549/fixtures.ts`, `../549/tsconfig.json`,
  `../549-oracle/helpers.ts` (how a sibling folder imports them), and the names `../549/helpers.ts` imports from
  `../309/helpers.ts`.
- The redraft models: `../172-redraft-ac2/` and `../545-redraft-ac3/`.
- At the base, for surfaces and the facts below: `packages/contracts/slots/relay@1.json`,
  `crates/deep-relay/src/relay.rs`, `crates/deep-show/src/net.rs`, `crates/deep-show/src/main.rs` (the scenario and its
  calls), `crates/deep-show/src/input.rs` (`scope`), `crates/deep-show/src/hub.rs` (a refused revision's reply),
  `crates/deep-canvas/src/document/check.rs` (`check_params`), `scripts/lanes.mjs`, `scripts/throttle.mjs`,
  `scripts/lease`, `scripts/proof-change.mjs` (`criterionId`).

Every expected value comes from the issue and the design.

## Run it

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 240 -- scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/549-redraft-ac2
node node_modules/typescript/bin/tsc -p tests/acceptance/549-redraft-ac2/tsconfig.json
rm -rf tests/acceptance/549-redraft-ac2/node_modules      # vitest's cache after a --root run
```

The environment is the first draft's, since the file runs through `../549/helpers.ts` as it stands:
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` (the helpers set both when the environment doesn't), the pinned
Rust toolchain on `PATH` (the helpers add it when it is installed), `CARGO_TARGET_DIR` honoured, and the openssl CLI
for #309's throwaway certificate. The file's `beforeAll` builds `deep-show` with the `full` features and `deep-relay`,
which is why the run takes the machine's build grant. The test passes its own timeout (the first draft's `TIMEOUT`,
90 minutes); the match itself is 200 steps at 20 Hz, 10 s. Every `deep-show` and relay the file starts is stopped by
its PID after the test, and its temp folders are removed. Headless Chrome isn't used.

**`scripts/lanes.mjs` needs this line**, beside the first draft's (the implementer adds it):

```js
alone.push('tests/acceptance/549-redraft-ac2/');
```

The file builds two cargo binaries and plays two live copies in real time, so nothing runs beside it.

## The test

`ac2-third-connection.test.ts`, one test:
`AC2 #549.83ea272a in the app, after a person's click every connection goes to the declared relay or the other copy with no cookie or credential, and a third connection with a guessed match ID receives nothing from the match`.

The surface is the first draft's, with no new call, field or planted name: the shipped relay (`startRelay`) behind the
suite's door (`startDoor`), which the piece declares; two copies in the app (`livePair`: `deep-show run`, the app's
prompt in `scope`, a person's click, `play_match` with `link_to`, `sockets`) on the lockstep piece (`lockstepDoc`,
`hash_every: 1`, `timeout: 120`) for 200 steps; a canary secret in the scenario's `secrets`; and this suite's own
relay@1 connections (`third`) straight to the relay.

In order:

1. The first copy joins on a person's click and writes its link. The match is open and not started.
2. Four third connections are made, one after another. Each reads the relay's hello, sends one `join` with
   `players: 2`, and waits for the relay's answer. Their match IDs are four different IDs, none the match's:
   - a random ID, `open: true`;
   - another random ID, `open: false`;
   - the match's ID with its last digit changed, `open: true`;
   - the match's ID with its first digit changed, `open: false`.
3. The second copy joins through the link, and the two play 200 steps. The third connections stay open.
4. What the first draft requires of the copies, unchanged: one match ID, in the link's fragment only; the first
   copy's prompt no longer open; equal full-state hashes at every step both report, at least 190 of them, one step
   apart; at the door, at least two connections, no cookie, credential, user information or the secret in any request
   head or message, only `join`, `signal` and frames sent, every frame and join naming the match; in each copy's
   `sockets` log, a connection to the relay, every other host the other copy on 127.0.0.1, and no cookie, credential
   or the secret; and a frame through the relay or a direct path in both logs.
5. What each third connection received, 0.5 s after both copies ended. A failure for each of:
   - a binary message (a frame);
   - a text message that isn't `hello`, `joined` or `refused` (so a `start`, a `closed`, a `signal` or anything else);
   - a message holding the match's ID, as 32 hex digits or as its 16 bytes;
   - no `joined` and no `refused`: the relay never answered its join, so the connection proved nothing.

It fails on (by the reading of the test and of relay@1; none of these wrong programs was run here):

- a relay that forwards a frame to another match's copies (the two opening connections hold seats in other matches);
- a relay that hands a `signal` to a seat of another match, or tells connections outside the match `start` or `closed`;
- a relay that seats a join naming an unknown ID, or one a digit off, in the open match;
- a copy that sends the relay anything but its join, signaling and frames, names another match, opens another host,
  or carries a cookie, a credential or the secret (the first draft's legs);
- the merge base, as `BASE-FAILURE.txt` says.

## What differs from the first draft's test, and why

**1. Each third connection names a match ID of its own.** The first draft's four connections name three IDs: its
third and fourth both send `near`, the match's ID with its last digit changed, one with `open: true` and one with
`open: false`, both with `players: 2`. At the base:

- `crates/deep-relay/src/relay.rs`, `control` (lines 208 to 240): a `join` for an ID the relay holds takes the next
  free seat whatever its `open` says (`Entry::Occupied`); only a join for an ID it doesn't hold is refused `unknown`
  when `open` isn't true. Once every seat is taken, `{"start": {"players": n}}` goes to every seat of that match.
- `packages/contracts/slots/relay@1.json`: `join`, "a second opening join of a held match joins it"; `start`, "To
  every copy of a match once its last seat is taken".
- `docs/canvas-primitives.md`, Net: relay protocol `relay@1`: "A join with `open` true opens its match", and one with
  `open` false is refused `unknown` only "for a match the relay doesn't hold".

So with the shipped relay, the first draft's third connection opens a match named `near` and is seated, its fourth is
seated in that same match, the match of 2 is full, and both receive `start`. The first draft then lists "the third
connection with the ID one digit off, opening received a start message" and the same for the joining one. That `start`
is from the third connections' own match, not from the copies'. It carries no match ID, so nothing on the wire tells
it from one that leaked. relay@1 and the shipped relay are #309's and "not in this task" (#549, Scope), so no work on
#549 can make those two lines go away: the first draft's test fails on a correct program. This is read from the
base's code and contract, not observed: no relay was built or run here.

Here the opening guess changes the last digit and the joining guess the first, so the four guesses are four IDs. The
test checks that they and the ID in the link are five different IDs before it connects, and lists a failure if a guess
equals the match's ID as `play_match` reports it. No third connection can then fill a match, and on a correct program
each receives the hello and one answer: `joined` for the two that open, `refused` for the two that join. Any `start`
is from a match the connection only guessed at.

**2. The test waits for the relay's answer to each third connection's join before going on.** At the base the relay
serves each connection on a thread of its own and reads it with a 2 ms poll (`relay.rs`, `serve` and `connection`), so
a join that was sent isn't yet a join the relay handled. The first draft sends and moves on. Here each connection is
seated or refused before the next is made and before the second copy joins, so each is in place when the match
starts. The wait ends after 30 s at the latest and decides nothing: an answer that never comes is
the same failure as in the first draft, read after the match.

**3. The title ends "receives nothing from the match"**, the criterion's words, and the file holds this one test.

Nothing else differs: the relay, the door, the piece, the scripts, the canary, the judgement of the copies and the
requirements on what a third connection received are the first draft's, line for line.

## Readings where the criterion leaves a choice

- **"A guessed match ID"**: an ID that isn't the match's, either random or the match's with one digit changed, sent
  both as a copy that opens a match and as one that joins one (the first draft's reading).
- **"Receives nothing from the match"**: on its own connection, beyond the relay's hello and the answer to its own
  join, nothing. The answer isn't from the match: it is the relay's word on the ID the connection itself named. Which
  answer it is (the seat, the refusal's reason) is relay@1's, proved by #309's suite, and isn't asserted here.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass. They are the first draft's helpers':

- BLOCKED without the Rust toolchain (`useBuilds`) or the openssl CLI (`useCertificate`).
- INCONCLUSIVE when a live phase doesn't finish in time and the machine's 1-minute load is above its cores (`gaveUp`).

## Not tested, and why

- A relay that would forward frames outside the match, in a run where the copies go direct: no frame reaches the relay
  then. The first draft's last line only requires that the messages went somewhere the file can see, and criterion 3
  plays the match with the direct path blocked.
- A third connection to a copy's own direct-path address: the criterion's third connection is to the relay.
- The other three tests of criterion 2, which stay the first draft's.

## BASE-FAILURE.txt

The test wasn't run: this job may not start a build, and the file builds `deep-show` and `deep-relay`. The file gives
what was run (the type check and the listing) and what was read from the base's code instead. Read, not observed: at
the base the first copy's piece is refused by `deep show`, since the base's `net@1` defines no `hash_every` or
`timeout`, so the test fails at the first draft's `presented` before a copy or a third connection reaches the relay.
