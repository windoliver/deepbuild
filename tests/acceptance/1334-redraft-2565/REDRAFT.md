# #1334 blind redraft, for #2565: the promotion and rollback tests on a fixture whose lanes load, waiting on events

#1334's suite has six tests that build the watched repository (`watched()`), two of them through the rollback scene
(`rollbackScene`): `crash.test.mjs` (two tests), `misjudge.test.mjs` (one) and `hold.test.mjs` (three). #2565 says
all six fail on main in their setup, for two faults of the suite's own helpers, and neither is about what #1334
asks of the product:

1. The fixture copies this repo's `scripts/` into a repository with no `node_modules`. Since 76ddd340b the copied
   lanes load `scripts/proof-binaries.mjs`, which imports `typescript`. The fixture's main watch then never has a
   clean run, so the first promotion is refused and no test reaches what it judges.
2. The rollback scene works the session's turns on a 3 s timer. A planted build that is rolled back in under 3 s gets
   no turn, and the test fails at "the session worked no turn while the planted build was in" before it reads the
   notice.

I confirmed both at the base before writing anything. No criterion of #1334 is touched. The redraft keeps each
test's scenario, name, criterion ID, INCONCLUSIVE reading and every assertion, and changes two things: the fixture,
and what the session's turns wait for. While running it I found one more way the crash and misjudge cases can fail
at the base, in the scene's restart. The redraft keeps the frozen restart as it is, on the owner's decision, and
reports the finding (Found beyond #2565's two causes).

Written from issue #1334 (closed 2026-11-09) and issue #2565 with its one comment (open, updatedAt
2026-11-15T02:21:57Z), read live with `gh issue view`; the frozen `tests/acceptance/1334/` (README.md, helpers.mjs,
fixtures/launcher.mjs and gh.mjs, twins.json, twins/README.md and its `promote.ts` copies, BASE-FAILURE.txt, and all
five test files); the design (`docs/technical-design.md`: Landing in turn; Socket roles and contract versions; How it
installs, with The hub and Platforms; Parallel sessions, Load; Dogfooding) and AGENTS.md, Proof;
`tests/acceptance/823-redraft-2073/REDRAFT.md` and `306-redraft-1958/REDRAFT.md` for form; and base `2c1c8cacc`,
read for how the surfaces are driven: `scripts/main-watch.mjs` (`checkout`, `prepare`, `status`, its state file),
`scripts/lanes.mjs` (where it loads `proof-binaries.mjs`), `scripts/proof-binaries.mjs` (its imports),
`scripts/proof-runs.mjs` (`twinsOf`), `packages/hub/src/promote.ts`, `service.ts` (`startHub`, `startService`),
`paths.ts` (`rootOf`) and `hub-readings.ts` (`healthClaim`, `rolledBack`). The base holds #1334's implementation, so
`promote.ts` there is the product; I read it for the drain, the restart and the notice as surfaces, and to plant the
twins (Wrong programs). I never read a diff, a pull request, another branch, another worktree or another job's notes.

## What is wrong in the frozen suite, test by test

The six tests, by the short names the tables use:

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
| `1334/misjudge.test.mjs` › M1 | `#1334.14e4b3e9` | 1. Then 2: in for 1 s, so no turn | `misjudge.test.mjs` › M1 |
| `1334/hold.test.mjs` › H1 | `#1334.a6dc45e5` | 1: main watch reads `BLOCKED unit`, never red | `hold.test.mjs` › H1 |
| `1334/hold.test.mjs` › H2 | Scope | 1: it passes only because nothing is ever promoted | `hold.test.mjs` › H2 |
| `1334/hold.test.mjs` › H3 | `#1334.a6dc45e5` | 1: the first promotion is refused | `hold.test.mjs` › H3 |

Each replacement has the original's file name and test name, in this folder. The numbers are the faults above.

The three test files are the frozen files byte for byte below a two-line comment. They import `./helpers.mjs`, which
is this folder's: it re-exports the frozen helpers whole and puts its own `watched` and `rollbackScene` in the place
of the frozen ones. `rolledBack`, the judgement the two rollback tests share, is the frozen function, imported, so
no assertion, bound, tolerance or message of it could change.

| | In #1334's suite | In the redraft |
|---|---|---|
| The watched repository | `watched()`: three repositories, c1, two lanes | Kept, plus one link beside them (change 1) |
| The scene up to the planted promotion | the frozen README's scenes table | Kept, line for line |
| The poll, and how the 60 s is measured | every 250 ms; `backAt` | Kept, line for line |
| The session's turns meanwhile | one every 3 s, 12 at most | One at each run of the planted build (change 2) |
| After the rollback | one turn; the record settled; 3 s; the record | Kept, line for line |
| The restart | the socket quiet, then `deep hub start` at once | Kept, line for line |
| The judgement, `rolledBack` | 18 assertions, one of them INCONCLUSIVE | The frozen function, imported |
| `hold.test.mjs`, both scenes | every step and assertion | The frozen file; only `watched` differs (change 1) |

## The two changes

1. **The fixture's lanes can load.** Main watch runs the lanes in a tree of its own, a checkout of the commit under
   the sandbox's home (`<sandbox>/h/.deepbuild/main-watch/<id>/tree`), so a `node_modules` in `mac` or `work` would
   never reach it. Two places do: a file the commit holds, or a folder above the tree. I took the second:
   `<sandbox>/node_modules/typescript` links to the checkout's `node_modules/typescript`, and Node's lookup finds it
   from `work`, `mac` and main watch's tree alike. It is in no repository, so c1, every landing and both lanes are
   what the frozen fixture makes. A link the commit held would be a tracked file the lanes list and read, and would
   make c1 differ from the frozen one. #2565's own trial did the same from outside (`/tmp/node_modules/typescript`).
   No product or `scripts/` file changes. With no `npm ci` in the checkout the helper stops at `BLOCKED: run npm ci`.
2. **The worker waits for the planted build's runs.** Each planted `bin/deep` notes its run in
   `<sandbox>/starts.jsonl` before it does anything else (frozen `makeBuild`). The worker waits for a line of the
   planted build it hasn't answered yet, and starts a turn at once. The file is watched (`fs.watch`), and each pass of
   the scene's poll looks again, so a change the watcher misses is seen within a pass. No timer decides when a turn
   starts. A build that crashes at start runs again when the service manager restarts it, so the crash case gets a
   turn per restart (3 at the base; the frozen suite's own run on its throwaway recorded 10); the misjudging build
   runs once and gets one turn. `rolledBack` asks for one or more, as before.

## Kept as they are

- `1334/doctor.test.mjs` (two tests, `#1334.32b63e42` and a Scope test) and `1334/contract.test.mjs` (two tests,
  `#1334.33ca60cb` and a Scope test): neither calls `watched()` or `rollbackScene`, and neither runs main watch. They
  stay where they are and are not copied.
- `1334/helpers.mjs`, `1334/fixtures/`, `1334/twins.json`, `1334/twins/`, `1334/README.md` and
  `1334/BASE-FAILURE.txt`: unchanged; the helpers and fixtures are imported.
- Every timed step that is the scenario itself or a time to let a wrong thing show, not a wait for a right one: the
  250 ms poll; the 3 s after the record settles and after the restart, which give a second notice time to appear;
  `hold.test.mjs`'s turn that runs for 20 s with a call at 10 s.

## Readings

1. **"While the planted build was in."** A turn is the session's work while the build is in when it starts at a run
   of that build and before the good build answers again. The frozen scene counted the same turns: it started one
   whenever the planted build had run and the good build wasn't back.
2. **Fewer turns in the crash case.** The frozen scene's number of turns came from its timer. The criterion asks
   that no attempt is lost, and the test asks for one turn or more while the build is in, with every call of every
   turn in the record. One turn per run of the build keeps that, and ties each turn to something that happened.
3. **A poll is a wait for an event.** The suite reads the hub from outside, so it learns of most events by asking
   again: `until` and the scene's poll, both frozen. What the redraft removes is a sleep that stands for an event.
4. **The restart is left as the frozen scene has it.** The scene stops the hub through its socket, waits for the
   socket to go quiet, and runs `deep hub start` at once. That can start nothing (Found beyond #2565's two causes).
   Whether `deep hub start` should wait for an exiting hub is the product's to settle, so the test doesn't work
   around it.

## Wrong programs they still fail

`twins.json` names ten twins by the frozen names, under `twins/`. The frozen twins are copies of the blind job's
throwaway `promote.ts`, which the base doesn't hold; laid over the base they don't compile (`service.js` exports no
`answers`), so each would fail every test before its fault. Each twin here is the base's own `promote.ts` with the
same one fault planted under the same name (`twins/README.md`). All ten were run, each in a scratch copy of the
checkout, and each fails the test of its criterion at the assertion its fault names. The ten runs were made while
`helpers.mjs` held the third change (On the base) and were not made again. That change touched only the scene's
restart. The six twins of C1 and M1 fail at assertions of `rolledBack` that come before its restart assertion and
read what the scene kept before the restart; the four twins of `hold.test.mjs` never run the rollback scene.

| Twin | Test | Fails at |
|---|---|---|
| `slow-rollback` | C1 | "answered again 75.5 s after the planted build first ran; the bound is 60 s" |
| `two-notices` | C1 | "one notice of the rollback … there are 2" |
| `notice-names-restored` | C1 | "the rollback's notice must name the promoted commit" |
| `fresh-root-on-rollback` | C1 | "an attempt lost: 4 of the session's 5 calls aren't in the record" |
| `pings-only` | M1 | "the last good build … never came back: … only pings the hub passes it" |
| `judges-in-promote` | M1 | the same assertion |
| `promotes-while-red` | H1 | "must be refused while main is red (exit 1 or 3): exit 0" |
| `no-drain` | H3 | "started as the installed hub 0.9 s after the promotion was asked for" |
| `refuses-while-turn` | H3 | "deep hub promote ended 0.3 s in, while the turn ran" |
| `promotes-any-commit` | H2 | "a landing main watch hasn't run on, must be refused (exit 1 or 3): exit 0" |

`promotes-any-commit` fails H1 too, at "versions/current must not appear": the same scene's earlier promotion went
through. `fresh-root-on-rollback` loses four of five calls: the one from before the promotion and the three worked
while the crashing build was in. The frozen suite's six other twins replace `doctor.ts` and `server.ts`, for the
tests that stay where they are; they are not here.

## On the base

`BASE-RESULTS.txt` has every command and its output, at `2c1c8cacc` on a shared Linux arm64 machine (20 cores), on
November 14, 2026.

- **Item 1, confirmed.** The frozen `1334/hold.test.mjs`: 1 of 3. Main watch prints `BLOCKED unit: Cannot find
  package 'typescript' imported from …/tree/scripts/proof-binaries.mjs`, and the first promotion is refused with "its
  last clean run here is none yet".
- **Item 2, confirmed.** A scratch copy of the frozen helpers with only change 1 added, `misjudge`, four runs: three
  fail at "the session worked no turn while the planted build was in" (the good build ran again 0.7 to 0.8 s after
  the planted one), and one, at a 1-minute load of 70, read INCONCLUSIVE.
- **The redraft, as committed, two runs.**
  - Run A (loads of 60 falling to 40): 4 of 6. C1 failed at "after the rollback the hub didn't come back from deep
    hub start: exit 3" (`no hub answered … within 15 s`). M1 read INCONCLUSIVE by the suite's own message (deep-hook
    couldn't spool one hook run within its 50 ms, at a load of 39.7). C2, H1, H2 and H3 passed.
  - Run D (loads of 7 to 10), the one run made after the restart was put back as the frozen scene has it: 6 of 6.
    C1: the last good build answered 25.3 s after the planted build first ran, 3 turns worked meanwhile. M1: 1.0 s,
    1 turn worked meanwhile, the case the frozen scene missed.
  - So C1 passes or fails at the restart from run to run, by the race below. Neither run fails in setup or at "the
    session worked no turn".
- **Runs made with a third change in, not runs of the code as committed.** For a while `helpers.mjs` also made the
  restart wait for the stopped hub's exit; the owner decided to drop that. Two runs of the whole folder (6 of 6
  each), one run through `scripts/affected.mjs`, and all ten twin runs were made with it in. Only the twin runs are
  kept in `BASE-RESULTS.txt` (Wrong programs says why they still stand).

Not run: the reference Mac, where #2565's first criterion is read; the frozen `doctor.test.mjs` and
`contract.test.mjs`; `scripts/proof-runs.mjs` over this folder; `scripts/affected.mjs` on the folder as committed;
any twin after the third change was taken out.

## Found beyond #2565's two causes

- **C1 and M1 can fail at the base at "after the rollback the hub didn't come back from deep hub start".** The
  scene asks for the start while the old hub is still exiting: it stops the hub through its socket, waits for the
  socket to go quiet, and runs `deep hub start` at once. The service manager stand-in, like launchd, starts a job
  only when it isn't running, so the call starts nothing; the old hub then exits 0 and stays stopped, and
  `deep hub start` exits 3 after 15 s. `BASE-RESULTS.txt` (section 3) has the stand-in's log of one such run: it was
  called 94 ms after `deep hub start` was launched, and saw the old hub's exit at 155 ms. A run that passed had 7 ms
  to spare. #2565's comment shows the same failure and puts it down to load. Whether `deep hub start` should itself
  wait for an exiting hub is the product's to settle (`promote.ts` waits for the old hub's process before it asks
  the service manager, and says why). The redraft keeps the frozen restart, so this failure stays possible until the
  product settles it.
- **The frozen twins no longer build on main** (Wrong programs). I compiled three of the ten `promote.ts` copies on
  the base (`BASE-RESULTS.txt`, section 6); all ten have the same imports. The six `doctor.ts` and `server.ts`
  copies, for the tests this folder doesn't replace, are copies of the throwaway too; I did not compile them.
- **`tests/acceptance/1334/` is on no list of `scripts/lanes.mjs`**, though its README asks the implementer to put
  it on `alone`. Nothing runs it but a person.

## Run it

With the official Node 24.22 build first on `PATH`, from the checkout's root, after `npm ci`,
`npm run build --workspaces --if-present` and `cargo build --locked -p deep-hook`:

```sh
node --test --test-concurrency=2 'tests/acceptance/1334-redraft-2565/*.test.mjs'
```

Six tests in three files. Sandboxes are the frozen suite's, `/tmp/d1334-*`, removed by its cleanup, which stops every
process it started by PID. The frozen README's load rule holds as written.

## At merge

The frozen `tests/acceptance/1334/` stays as written. The owner's call is to read `crash.test.mjs`,
`misjudge.test.mjs` and `hold.test.mjs` from this folder in place of the frozen three, and to keep the frozen
`doctor.test.mjs` and `contract.test.mjs`. #2565's first criterion names the frozen folder's command; with the swap
it is this folder's three files and the frozen folder's other two.
