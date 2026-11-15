# #1334 blind redraft, for #2565: the promotion and rollback tests on a fixture whose lanes load, with the frozen timed turns

#1334's suite has six tests that build the watched repository (`watched()`), two of them through the rollback scene
(`rollbackScene`): `crash.test.mjs` (two tests), `misjudge.test.mjs` (one) and `hold.test.mjs` (three). #2565 says
all six fail on main in their setup, for two faults of the suite's own helpers, and neither is about what #1334
asks of the product:

1. The fixture copies this repo's `scripts/` into a repository with no `node_modules`. Since 76ddd340b the copied
   lanes load `scripts/proof-binaries.mjs`, which imports `typescript`. The fixture's main watch then never has a
   clean run, so the first promotion is refused and no test reaches what it judges.
2. The rollback scene's worker looks for the planted build's first run and, finding none, sleeps 3 s. A planted
   build that is rolled back within those 3 s gets no turn, and the test fails at "the session worked no turn while
   the planted build was in" before it reads the notice.

No criterion of #1334 is touched. The redraft keeps each test's scenario, name, criterion ID, INCONCLUSIVE reading
and every assertion, and changes two things in `helpers.mjs`: the fixture gets a `typescript`, and the worker's first
turn starts at the planted build's hub start instead of at a look on a timer. From that turn on the worker is the
frozen one: a turn every 3 s, 12 at most, until the last good build is back.

This replaces an earlier redraft in this folder, which made the worker work one turn per run of the planted build.
The owner rejected that: a crashing build runs a few times in its 25 s, so only a few moments of the outage got a
call, and a program that loses calls made mid-outage could pass. What changed against it:

| | Earlier redraft | This redraft |
|---|---|---|
| When the first turn starts | at the planted build's first run of any kind | at its first `hub run` start (owner's decision 4) |
| The turns after it | one per further run of the planted build | one every 3 s while the good build isn't back, 12 at most: the frozen worker |
| The poll | wakes the worker after it reads the hub | wakes the worker before it asks the hub, so a start seen in that pass gets its turn before `backAt` can be set |
| Twins | ten | eleven: `loses-mid-outage` added (Wrong programs) |
| `watched`, the restart, `rolledBack`, the test files | | unchanged (the test files' two-line header names the new scene) |

Written from issue #1334 and issue #2565 with its comment, read live with `gh issue view`; the frozen
`tests/acceptance/1334/` (helpers.mjs, the three test files, twins.json) and this folder's earlier redraft; the
design (`docs/technical-design.md`: Dogfooding, Proven on the base, How it installs) and AGENTS.md, Proof; and base
`afe996e03`, read for how the surfaces are driven: `packages/hub/src/promote.ts` (the rollback, and where to plant
the twins), `packages/hub/src/paths.ts` (`root.spool`) and `crates/deep-hook/src/main.rs` (`spool`: deep-hook
spools to `~/.deepbuild/spool/spool.jsonl` when no hub answers). I never read a diff, a pull request, another
branch, another worktree or another job's notes.

## What is replaced, test by test

- **C1** `crash.test.mjs` › #1334.775c65d4 a planted build that crashes at start is rolled back within 60 s, with no
  attempt lost and one notice naming the commit
- **C2** `crash.test.mjs` › the hub runs from a promoted build in a versioned folder: its login service names
  ~/.deepbuild/versions/current, never a checkout or a temporary path
- **M1** `misjudge.test.mjs` › #1334.14e4b3e9 a planted build that starts but judges the fixture claim wrongly is
  rolled back the same way; a health check that only pings the hub passes this plant and fails, naming the claim
- **H1** `hold.test.mjs` › #1334.a6dc45e5 no promotion happens while main is red
- **H2** `hold.test.mjs` › a build is promoted only from a commit main watch passed: one of a landing it hasn't run on
  is refused, naming the commit
- **H3** `hold.test.mjs` › #1334.a6dc45e5 no promotion happens while a turn is running: it waits for the drain, the
  hub serving the turn, then promotes and the run resumes

| Original (path › test) | Criterion | Why the old expectation cannot be read | Replaced by |
|---|---|---|---|
| `1334/crash.test.mjs` › C1 | `#1334.775c65d4` | 1: nothing is promoted | `crash.test.mjs` › C1 |
| `1334/crash.test.mjs` › C2 | Scope | 1: the first promotion is refused | `crash.test.mjs` › C2 |
| `1334/misjudge.test.mjs` › M1 | `#1334.14e4b3e9` | 1. Then 2: in for under 3 s, so no turn | `misjudge.test.mjs` › M1 |
| `1334/hold.test.mjs` › H1 | `#1334.a6dc45e5` | 1: main watch reads `BLOCKED unit`, never red | `hold.test.mjs` › H1 |
| `1334/hold.test.mjs` › H2 | Scope | 1: it passes only because nothing is ever promoted | `hold.test.mjs` › H2 |
| `1334/hold.test.mjs` › H3 | `#1334.a6dc45e5` | 1: the first promotion is refused | `hold.test.mjs` › H3 |

The three test files are the frozen files byte for byte below a two-line header. They import `./helpers.mjs`, which
re-exports the frozen helpers whole and puts its own `watched` and `rollbackScene` in the place of the frozen ones.
`rolledBack`, the judgement the two rollback tests share, is the frozen function, imported, so no assertion, bound,
tolerance or message of it changes.

| | In #1334's suite | In this redraft |
|---|---|---|
| The watched repository | `watched()`: three repositories, c1, two lanes | Kept, plus one link beside them (change 1) |
| The scene up to the planted promotion | the frozen README's scenes table | Kept, line for line |
| The poll, and how the 60 s is measured | every 250 ms; `backAt` | Kept; each pass first wakes the worker (change 2) |
| The session's turns meanwhile | a look, then one turn every 3 s, 12 at most | The first at the planted hub start, then every 3 s, 12 at most (change 2) |
| After the rollback | one turn; the record settled; 3 s; the record | Kept, line for line |
| The restart | `hub.stop`, then `deep hub start` at once | Kept, line for line (owner's decision 3) |
| The judgement, `rolledBack` | 18 assertions, one of them INCONCLUSIVE | The frozen function, imported |
| `hold.test.mjs`, both scenes | every step and assertion | The frozen file; only `watched` differs (change 1) |

## The two changes

1. **The fixture gets its own `typescript`.** Main watch runs the lanes in a tree of its own, a checkout of the
   commit under the sandbox's home (`<sandbox>/h/.deepbuild/main-watch/<id>/tree`), so a `node_modules` in `mac` or
   `work` would never reach it. `<sandbox>/node_modules/typescript` links to the checkout's
   `node_modules/typescript`: above `work`, `mac` and main watch's tree, where Node's lookup finds it from each, and
   inside no repository, so no commit, landing or lane of the fixture differs from the frozen one's. With no `npm ci`
   in the checkout the helper stops at `BLOCKED: run npm ci`.
2. **The worker's first turn starts at the planted build's hub start.** Each planted `bin/deep` notes its run in
   `<sandbox>/starts.jsonl` before it does anything else (frozen `makeBuild`), with its arguments. The worker waits
   for the first line of the planted build whose arguments are `hub run` (`hubStarts(box, kind)`); runs of its
   `bin/deep` for anything else don't count. The file is watched (`fs.watch`), and each pass of the scene's poll
   wakes the worker before it asks the hub, so a start the watcher missed is seen within one pass and its turn begins
   before that pass can find the good build back. The wait also ends when the good build is back or the poll is
   over. Then the frozen loop runs as written: while the good build isn't back, a turn (12 at most), then 3 s. So a
   build rolled back within 3 s still gets its first turn at once, and a build that is out for 25 s gets a call
   every 3 s or so of it, each of which "no attempt lost" then looks for in the record.

## Kept as they are

- `1334/doctor.test.mjs` and `1334/contract.test.mjs`: neither calls `watched()` or `rollbackScene`, and neither
  runs main watch. They stay where they are and are not copied.
- `1334/` as a whole: unchanged; its helpers and fixtures are imported.
- Every timed step of the frozen scene: the 250 ms poll; the worker's 3 s between turns; the 3 s after the record
  settles and after the restart, which give a second notice time to appear; `hold.test.mjs`'s 20 s turn.

## Readings

1. **"While the planted build was in."** From the planted build's hub start until the last good build answers again
   (`backAt`, the frozen reading). The frozen worker started its turns once the planted build had run at all; this
   one starts at its first `hub run`, the moment the planted build is the installed hub, as the owner decided.
2. **Turns are timed, as in the frozen scene.** The criterion asks that no attempt is lost through the whole outage,
   so the session keeps working on the frozen 3 s beat while it lasts. Only the first turn is tied to an event.
3. **The restart is left as the frozen scene has it.** It stops the hub through its socket and runs `deep hub start`
   at once, with no wait for the old hub's exit (owner's decision 3). At this base `deep hub start` doesn't wait for
   an exiting hub either (#2570), so C1 and M1 can fail at "after the rollback the hub didn't come back from deep hub
   start". That is the product's to settle, and the test does not work around it.

## Wrong programs they still fail

`twins.json` names eleven twins under `twins/`, each the base's own `packages/hub/src/promote.ts` with one fault
(`twins/README.md`). Ten are the earlier redraft's, unchanged: the base's `promote.ts` is the same at `afe996e03` as
at the `2c1c8cacc` they were written on, and none of them needs the new scene. The eleventh is new:

- **`loses-mid-outage`** (`#1334.775c65d4`): just before `current` switches back to the last good build, the
  rollback removes `~/.deepbuild/spool/spool.jsonl`. While the crashing build is in no hub answers, so that file
  holds the session's calls made mid-outage, and only those; the calls from before are in the record and stay. It
  can be written in `promote.ts` alone. It fails C1 at "an attempt lost" when the run is not first read
  INCONCLUSIVE by the frozen deep-hook budget check, which `rolledBack` reads before it.

Each twin was run once on the scene as committed, in a scratch copy of the checkout with only `promote.ts` replaced
and `packages/hub` rebuilt. `BASE-RESULTS.txt` has each first failure line and the load.

| Twin | Test | Fails at (first failure) |
|---|---|---|
| `loses-mid-outage` | C1 | run 1 INCONCLUSIVE (load 74.5); run 2: "an attempt lost: 9 of the session's 11 calls aren't in the record after the rollback" |
| `slow-rollback` | C1 | "answered again 75.7 s after the planted build first ran; the bound is 60 s" |
| `two-notices` | C1 | run 1 INCONCLUSIVE (load 92.0); run 2: "one notice of the rollback … there are 2" |
| `notice-names-restored` | C1 | run 1 INCONCLUSIVE (load 124.3); run 2: "the rollback's notice must name the promoted commit" |
| `fresh-root-on-rollback` | C1 | INCONCLUSIVE in all three runs (loads 80.7, 43.1, 41.6): not shown on this scene |
| `pings-only` | M1 | "the last good build … never came back: … only pings the hub passes it" |
| `judges-in-promote` | M1 | the same assertion |
| `promotes-while-red` | H1 | "must be refused while main is red (exit 1 or 3): exit 0" |
| `no-drain` | H3 | "started as the installed hub 1.3 s after the promotion was asked for, while the session's turn ran" |
| `refuses-while-turn` | H3 | "deep hub promote ended 0.5 s in, while the turn ran" |
| `promotes-any-commit` | H2 | "a landing main watch hasn't run on, must be refused (exit 1 or 3): exit 0" (H1 fails too, at "versions/current must not appear") |

`fresh-root-on-rollback` is the one twin not shown to fail at its fault here: the frozen budget check, read before
"no attempt lost", found hook runs deep-hook couldn't spool in 50 ms in each of its three runs, even at a load of 41,
where other crash runs of the same hour got past it. Whether removing the spool folder under a running turn itself
makes deep-hook miss its budget was not looked into.

## On the base

`BASE-RESULTS.txt` has every command and its output, at `afe996e03` on a shared Linux arm64 machine (20 cores) on
November 15, 2026, with loads well over 100.

| Run | Load (1-min) | C1 | C2 | M1 | H1, H2, H3 |
|---|---|---|---|---|---|
| 1 | 131.9 → 151.8 | INCONCLUSIVE (5 hook runs not spooled in 50 ms, at 157.0) | pass | INCONCLUSIVE (4, at 157.8) | pass |
| 2 | 152.3 → 119.8 | INCONCLUSIVE (6, at 117.9) | pass | pass: back 2.7 s after the planted build first ran, 1 turn meanwhile | pass |

Neither run failed in setup, at "the session worked no turn", or at the restart (#2570). C1 read INCONCLUSIVE both
times by the frozen suite's own message, so C1 is not proven at the base on this machine; it needs a quieter run,
or the reference Mac. M1's pass in run 2 is the case the frozen scene missed: a build in for under 3 s, with a turn.

Not run: the reference Mac; the frozen `doctor.test.mjs` and `contract.test.mjs`; `scripts/proof-runs.mjs` and
`scripts/affected.mjs` over this folder; the frozen suite itself at `afe996e03` (the earlier redraft confirmed #2565's
two causes at `2c1c8cacc`; neither the fixture nor the scene's worker changed in the frozen files since).

## Run it

With the official Node 24.22 build first on `PATH`, from the checkout's root, after `npm ci`,
`npm run build --workspaces --if-present` and `cargo build --locked -p deep-hook`:

```sh
node --test --test-concurrency=1 tests/acceptance/1334-redraft-2565/{crash,misjudge,hold}.test.mjs
```

Six tests in three files. Sandboxes are the frozen suite's, `/tmp/d1334-*`, removed by its cleanup, which stops every
process it started by PID. The frozen README's load rule holds as written.

## At merge

The frozen `tests/acceptance/1334/` stays as written. The owner's call is to read `crash.test.mjs`,
`misjudge.test.mjs` and `hold.test.mjs` from this folder in place of the frozen three, and to keep the frozen
`doctor.test.mjs` and `contract.test.mjs`.
