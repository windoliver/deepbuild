# Blind redraft of #3549's turn, window and compiles tests under #3660's option A

Under #3549, a build asked for under no grant is admitted, then waits for a turn of the machine's pool with no limit. The owner chose option A on #3660 (2026-11-27): the turn wait now runs on the caller's bound.

- With `--wait <min>`, the deadline set when the request asked still holds once the build is admitted.
- With `--stall <min>`, the stall keeps running and starts again each time a turn of the pool is taken or given back.
- With no turn in time, the build gives back its admission, starts nothing, and exits as an admission timeout does: exit 3, `INCONCLUSIVE no grant`, and a `timeout` log entry.

#3660's fifth criterion names three files of `tests/acceptance/3549/` in which a build waits for its turn past its own `--wait`, which option A reverses: `turn.test.mjs`, `window.test.mjs` and `compiles.test.mjs`. This folder redrafts those three files. Every other file of `3549/` stays as it is. The originals are not edited. `scripts/lanes-lists.mjs` is the implementer's to map these files in.

## Inputs

- Issues #3549 (its body and the comment with the owner's answer (a)) and #3660 (its body and comments, with option A and its six criteria).
- `AGENTS.md`.
- The base `3359cc775` (PR #3591's head; its merge base with main is `c0a16dda6`), read for call shapes:
  - `scripts/throttle.mjs`: the CLI, `acquire`, the log's `granted`/`timeout`, `blockers` and `lender`;
  - `scripts/lease`;
  - `tests/acceptance/3549/` in whole: the README, `helpers.mjs` and the three originals;
  - `tests/acceptance/3588-redraft-3549/REDRAFT.md`, for the layout of a redraft folder.
- Not read: PR discussions, other branches, and anything describing how #3660 is implemented (none existed).

The files import `../3549/helpers.mjs` as it is: no helper had to change. They have no comments. The one exception is a `// deadline:` marker on `compiles.test.mjs`'s once-a-second `setInterval`, which the wait ratchet requires and the comment ratchet exempts.

## Run

```sh
node scripts/throttle.mjs test --wait 600 -- node --test tests/acceptance/3549-redraft-3660/*.test.mjs
```

The tests need a test run to have tables of their own, as `3549/` does. `compiles.test.mjs` needs cargo, and works offline.

## What changed, test by test

| Original (file › test) | Why it no longer holds under option A | Replacement |
|---|---|---|
| `turn.test.mjs` › `#3549.b6b01435 on a pool of 4 tokens a second stub build of 40 s …` | It still holds. Every build asks with `--wait 10` and gets its turn within seconds. | Unchanged, same name. |
| `turn.test.mjs` › `#3549.b6b01435 on a pool of 1 token a build asked beside one under way, by throttle.mjs build and through scripts/lease, is admitted, waits for its turn past its own wait limit, and then runs under a jobserver of its own` | Two builds, one direct and one through `scripts/lease`, ask with 0.05 min while the pool's one token is held. The test needs them still in line after a 0.1 min witness. Under option A, a right program ends both at 0.05 min with exit 3. On the throwaway right program it fails with "the build `direct` … left the line while the pool's one token was held (exit 3): it wasn't admitted, or its turn had a wait limit". | `#3549.b6b01435 #3660.a7f3d0fa on a pool of 1 token a build asked beside one under way, by throttle.mjs build and through scripts/lease, is admitted and waits for its turn on its own wait: with 0.05 min it ends INCONCLUSIVE at that wait with its command never started, and with 10 min it runs under a jobserver of its own once the token goes back`. Same scene, now in two parts. See the notes below the table. |
| `window.test.mjs` › `#3549.7ba8246d a window opens only once an admitted build that is under way has ended` | It still holds. | Unchanged. |
| `window.test.mjs` › `#3549.7ba8246d a window opens only once every admitted build has ended: one that waited for its turn …` | It still holds. The waiting build asks with `--wait 10` and gets its turn within seconds. | Unchanged. |
| `window.test.mjs` › `#3549.7ba8246d a window does not open while an admitted build still waits for its turn: asked under the build that holds the one token of the pool, its request runs out its wait` | The waiting build asks with 0.05 min. Its admission was proved by its outliving that wait. On the throwaway right program it fails with "the build … waits-its-turn … left the line while the pool's one token was held (exit 3): it wasn't admitted, so no admitted build waits for a turn". | `#3549.7ba8246d a window does not open while an admitted build still waits for its turn inside its own wait: …`. See the notes below the table. |
| `compiles.test.mjs` › `#3549.13a91455 two real cargo builds …, and a third build asked beside them waits for its turn` | The third build asks with 0.05 min and must wait until a cargo build ends. On the throwaway right program it fails with "the third build, … --wait 0.05 … didn't wait for its turn and then run (exit 3; its start: undefined; …)". | Same name. See the notes below the table. |

**`turn.test.mjs`, second test.** The changed test runs in two parts.

- **0.05 min.** A direct build and a leased build (`DEEP_LEASE_WAIT=0.05`) ask first. Each must:
  - end within 60 s of asking, with exit 3 and `INCONCLUSIVE no grant`;
  - never start its command;
  - show in the log a top-level `granted` of class `build` (its admission), then a `timeout` of class `build` with `wait` 0.05.
- **10 min.** Then the two builds ask again with 10 min. The original's witness still runs: a test request asked after them, kept out by the load, waits out its 0.1 min.
  - Neither build has started, both still run, and each has its `granted` entry, so each is admitted and waits for its turn.
  - When the token goes back, each starts no earlier than the holder's end, exits 0, prints no INCONCLUSIVE, and runs under a build grant and a jobserver of its own.
- **Order.** The two short builds ask before the two long ones, so at most three builds are admitted at once, under the Mac's ceiling of 4.

**`window.test.mjs`, third test.** The waiting build asks with `--wait 10`, a bound that covers its turn.

- Its admission is read from the log's top-level `granted` entry for its pid, after the witness.
- After the window's request has run out (exit 3), the test also checks that the build is still waiting. The rest is as in the original.

**`compiles.test.mjs`.** Two changes.

- The third build asks with `--wait 15`, which covers its wait for a cargo build to end.
- The bounds keep the file under the suite's 20 minutes:
  - the test's timeout is 19 min, not 25;
  - both builds must be under way within 3 min, not 10;
  - both must end within 12 min, on one shared deadline, not 20 min each.

  The test itself took 16 s on the Linux machine. The INCONCLUSIVE message no longer says the turn "has no wait limit".

### Which tests carry `#3660.a7f3d0fa`

Only `turn.test.mjs`'s second test carries it. Under option A it is the one test that fails on a program that keeps the unbounded turn wait. On the base it fails with "the build `direct-short` … was still waiting 60 s after asking: its wait for its turn ran past its own wait".

The window and compiles replacements give the waiting build a bound that covers its turn, so they pass on the base too. They guard against regression and carry only their #3549 tags.

## Kept as they are

- Every test of the three files, by criterion and scene. Each keeps its #3549 tag: `turn.test.mjs` `#3549.b6b01435`, `window.test.mjs` `#3549.7ba8246d`, `compiles.test.mjs` `#3549.13a91455`.
- `../3549/helpers.mjs`, imported unchanged.
- No `twins.json` or `twins/` here. The twins are the implementer's.

## Wrong programs (one fault each)

Each is the throwaway right program below with one fault, and each was run against the file it is for.

| Test | Wrong program | Result |
|---|---|---|
| `turn.test.mjs`, first | The ceiling of builds is 1, so top-level builds are served one at a time. | Fails: "the second build, `node throttle.mjs build --wait 10 -- node stub.mjs second sleep 40` …, had not ended: not within 60 s of asking. It waited behind the first, of 400 s". |
| `turn.test.mjs`, second | The ceiling of builds is 1. | Fails: "the log shows no top-level granted of class build for the build `direct-short` …: it wasn't admitted, so its timeout is its admission's, not its turn's". |
| `turn.test.mjs`, second | The base itself, whose turn wait has no limit. | Fails: "… was still waiting 60 s after asking: its wait for its turn ran past its own wait". |
| `turn.test.mjs`, second | A top-level build asked with `--turns 0`, as `scripts/lease` asks, is admitted and takes no turn. | Fails: "the build `leased-short`, `scripts/lease node stub.mjs leased-short exit (DEEP_LEASE_WAIT=0.05)` …, didn't end at its wait as an admission timeout does, with exit 3 and INCONCLUSIVE no grant (exit 0)". The first test passes. |
| `window.test.mjs`, first and second | A window waits for no build. | Not run here. This is the original README's plant, and these two tests are the originals byte for byte. |
| `window.test.mjs`, third | A window takes an admitted build waiting for its turn as waiting: `blockers()` without `!request.window`. | Fails: "the window opened while the admitted build `node throttle.mjs build --wait 10 -- node stub.mjs waits-its-turn exit` … still waited for its turn: an admitted build had not ended". The first two tests pass. |
| `compiles.test.mjs` | A turn's jobserver is filled with the pool's count less one at once, and the tokens are never taken back. | Fails: "at look 7 (+6.0 s): 4 (first 2, second 2), 4 compiler processes ran at once, more than the pool's 2 tokens; 6 of 12 looks were above 2". |

**Gap.** A program whose turn timeout keeps its admission, instead of giving it back, passes `turn.test.mjs` on the Linux machine (lane H: both tests pass). That machine's ceiling of 6 leaves room for the two long builds beside the two kept admissions.

- On the Mac, with a ceiling of 4, that program would hold 1 + 2 + 2 = 5 admissions, so one long build would not be admitted. Not run there.
- Giving back the admission is #3660's first and second criteria, held by `tests/acceptance/3660/`, not by these files.

## Runs

All runs were on the Linux machine: aarch64, 20 cores, node v24.22.0, cargo 1.99.1, 1-minute load 23 to 31. Each lane ran `node --test --test-reporter=spec <files>` in a `systemd-run --user` unit, on 2026-11-28 from 05:09 UTC, with all lanes side by side and each test on its own throttle table.

The throwaway right program was written from #3660's decision alone. It is the base's `scripts/throttle.mjs` with four changes in `acquire()`:

1. Once a build is admitted, its deadline is no longer set to Infinity, so the wait's own deadline still holds for the turn.
2. A stall's bound starts again when a `turn` grant is taken or given back.
3. On a turn timeout, the build's admission grant is removed from the table.
4. That timeout's log entry has the build's id and `waited`.

The right program and the wrong programs were copies of `scripts/` and `tests/acceptance/3549/` from `git archive 3359cc775`, in `/var/tmp` outside the checkout. They are deleted. They prove nothing about the real change.

| Lane | Program | Files | Expected | Result |
|---|---|---|---|---|
| A | throwaway right | the 3 redraft files | all pass | 6 pass, 0 fail (82 s) |
| B | base `3359cc775` | the 3 redraft files | only `turn.test.mjs`'s second test fails | 5 pass, 1 fail: the second test, at "the build `direct-short` … was still waiting 60 s after asking: its wait for its turn ran past its own wait" (132 s) |
| C | throwaway right | the 3 originals (`3549/`) | the three tests #3660 names fail | 3 pass, 3 fail. The failing words are in the table "What changed, test by test". The two window tests and the first turn test that are left pass. (79 s) |
| D | ceiling 1 | `turn.test.mjs` | both tests fail | 0 pass, 2 fail (94 s) |
| E | window takes a waiting build as waiting | `window.test.mjs` | the third test fails | 2 pass, 1 fail |
| F | `--turns 0` takes no turn | `turn.test.mjs` | the second test fails | 1 pass, 1 fail (76 s) |
| G | jobserver full at once, never taken back | `compiles.test.mjs` | fails | 0 pass, 1 fail (12 s) |
| H | turn timeout keeps its admission | `turn.test.mjs` | (the gap) | 2 pass: undetected on Linux |

Each lane was run once, and no result was retried. Lints: `node scripts/wait-ratchet.mjs` and `node scripts/comment-ratchet.mjs` report no finding in this folder. Both report findings in other files at the base: `packages/hub/test/start-budget.test.ts` and `scripts/shards.mjs`.

**Not run:**

- these files on the Mac (it has a disk hold, so no cargo builds there);
- `--stall` scenes, since no test of these three files asks with a stall;
- a lane, preflight or twin in its line form.
