# Twins for the 1334 tests

The base has no `deep hub promote`, no `hub.service` item and no contract check, so every test fails there at its
first assertion (`../BASE-FAILURE.txt`), and that proves little about what the tests can catch. These are planted
wrong programs, each a plausible way to fake one criterion. `../twins.json` names them.

The blind job built them on its own throwaway implementation, which isn't kept. It lived in a scratch tree, an APFS
clone of this worktree, and never in shipped paths:

- `packages/hub/src/promote.ts` (about 100 lines): `deep hub promote <folder>`, wired into `hub-command.ts`. It reads
  main watch through `node scripts/main-watch.mjs status` and a new `passed <commit>` subcommand, copies the build into
  `~/.deepbuild/versions/<commit>`, waits while the hub lists an open turn, stops the hub, switches `current`, starts
  the login service again (every 2 s, until a hub answers, up to 30 s), and asks the new hub to judge the fixture
  claim. On no answer, or a wrong verdict, it switches back, starts the last good build, and asks it to record the
  notice.
- `server.ts`: `hub.turns` (the sessions between a UserPromptSubmit and its Stop), `hub.fixture` and
  `build.rolled_back` for the CLI; with `contract-major-ahead`, a hello one major ahead and every hook answered with
  the floor's decision (only the `fail_closed` entries deny), the contract's reason on stderr, and nothing recorded.
- `core.ts`: `hub.fixture` (an empty fixture claim through the verdict engine, which reads INVALID; the fixture
  expects INVALID), `build.rolled_back` (appends the event), and `judges-claims-wrongly` flipping every verdict.
- `doctor.ts`: the `hub.service` item. `plant.ts`: the two plants. `service.ts`: `answers` and `control` exported,
  with a timeout. `contracts/schemas`: `build.rolled_back@1` and the `service_unpromoted` code.

That implementation passes all 10 tests (`../BASE-FAILURE.txt` has the runs). Each twin is a copy of one of its files
with one fault planted, marked `/* TWIN <name>: … */`, and replaces only that file, never a test or a helper. A copy
goes stale as the real file changes, and still holds its fault. The implementing job can plant the same faults in its
real code under the same names.

To run one: put the implementation in a scratch tree beside this suite, copy `twins/<name>/packages/` over its
`packages/`, build `packages/hub`, and run the test file the table names. The blind job ran each that way, one at a
time, on the official Node 24.22 build, and put the throwaway's own file back after each.

| Criterion | Twin | Replaces | The planted fault | Test file |
|---|---|---|---|---|
| `#1334.775c65d4` (AC1) | `slow-rollback` | `promote.ts` | waits 75 s for the new hub before it rolls back | `crash.test.mjs` |
| `#1334.775c65d4` (AC1) | `two-notices` | `promote.ts` | records the rollback's notice twice | `crash.test.mjs` |
| `#1334.775c65d4` (AC1) | `notice-names-restored` | `promote.ts` | the notice names the build that came back, not the promoted one | `crash.test.mjs` |
| `#1334.775c65d4` (AC1) | `fresh-root-on-rollback` | `promote.ts` | rolls back to an empty record and spool, losing what the session did | `crash.test.mjs` |
| `#1334.14e4b3e9` (AC2) | `pings-only` | `promote.ts` | the health check only waits for the hub to answer | `misjudge.test.mjs` |
| `#1334.14e4b3e9` (AC2) | `judges-in-promote` | `promote.ts` | judges the fixture claim with promote's own code, not the new build's hub | `misjudge.test.mjs` |
| `#1334.a6dc45e5` (AC3) | `promotes-while-red` | `promote.ts` | checks only that the commit is main watch's last clean one, not whether main is red now | `hold.test.mjs` |
| `#1334.a6dc45e5` (AC3) | `no-drain` | `promote.ts` | restarts the hub without waiting for turns | `hold.test.mjs` |
| `#1334.a6dc45e5` (AC3) | `refuses-while-turn` | `promote.ts` | exits at once while a turn runs, never promoting | `hold.test.mjs` |
| Scope: a passed commit | `promotes-any-commit` | `promote.ts` | promotes any commit while landings are open | `hold.test.mjs` |
| `#1334.32b63e42` (AC4) | `temp-only` | `doctor.ts` | flags only temporary folders, never a worktree or a checkout | `doctor.test.mjs` |
| `#1334.32b63e42` (AC4) | `flags-every-service` | `doctor.ts` | fails every service, a promoted build's included | `doctor.test.mjs` |
| `#1334.32b63e42` (AC4) | `names-no-path` | `doctor.ts` | says what kind of folder, never the path | `doctor.test.mjs` |
| `#1334.33ca60cb` (AC5) | `silent-refusal` | `server.ts` | refuses the older hook and tells the session nothing | `contract.test.mjs` |
| `#1334.33ca60cb` (AC5) | `replays-as-normal` | `server.ts` | tells the session, but records its hooks as replayed spool, so its claim is judged PASS | `contract.test.mjs` |
| Scope: fails closed | `fails-open` | `server.ts` | on a contract refusal, allows every call | `contract.test.mjs` |

All 16 fail the test of their criterion; `../BASE-FAILURE.txt` has each one's message and timings.
