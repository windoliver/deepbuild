# Twins for the #1334 redraft

`../twins.json` names them by criterion, with the frozen suite's names (`../../1334/twins.json`), so
`scripts/proof-runs.mjs` (`twinsOf`) finds them for the tests of this folder as it finds the frozen ones for theirs.

The frozen suite's twins can't be laid over the base. Each is a copy of the blind job's throwaway `promote.ts`, which
the base doesn't hold: it imports `answers` from `service.js`, calls `hub.turns` and `hub.fixture`, and runs
`scripts/main-watch.mjs passed`, none of which the base has. `tsc -p packages/hub/tsconfig.json` on the base with a
frozen twin's file fails (`Module "./service.js" declares 'answers' locally, but it is not exported`), so a frozen
twin fails every test before its fault is reached. Its README says so: "A copy goes stale as the real file changes",
and "The implementing job can plant the same faults in its real code under the same names".

So each twin here is the base's own `packages/hub/src/promote.ts` (base `2c1c8cacc`) with the frozen twin's one
fault planted under the frozen twin's name, marked `/* TWIN <name>: … */`. It replaces only that file, never a test
or a helper. Only the ten twins of the tests this folder redrafts are here; the frozen suite's six others replace
`doctor.ts` and `server.ts`, for tests that stay where they are.

| Criterion | Twin | The planted fault | Test file |
|---|---|---|---|
| `#1334.775c65d4` | `slow-rollback` | waits 75 s for the new hub before it rolls back | `crash.test.mjs` |
| `#1334.775c65d4` | `two-notices` | records the rollback's notice twice | `crash.test.mjs` |
| `#1334.775c65d4` | `notice-names-restored` | the notice names the build that came back | `crash.test.mjs` |
| `#1334.775c65d4` | `fresh-root-on-rollback` | rolls back to an empty record and spool | `crash.test.mjs` |
| `#1334.14e4b3e9` | `pings-only` | the health check only waits for the hub to answer | `misjudge.test.mjs` |
| `#1334.14e4b3e9` | `judges-in-promote` | judges the fixture claim in promote's own process | `misjudge.test.mjs` |
| `#1334.a6dc45e5` | `promotes-while-red` | checks only that the commit is the last clean one | `hold.test.mjs` |
| `#1334.a6dc45e5` | `no-drain` | restarts the hub without waiting for turns | `hold.test.mjs` |
| `#1334.a6dc45e5` | `refuses-while-turn` | exits at once while a turn runs, never promoting | `hold.test.mjs` |
| Scope: a passed commit | `promotes-any-commit` | promotes any commit while landings are open | `hold.test.mjs` |

To run one: copy the checkout to a scratch tree (built, with `target/debug/deep-hook`), then in that tree

```sh
cp -R tests/acceptance/1334-redraft-2565/twins/<name>/packages/. packages/
node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json
node --test tests/acceptance/1334-redraft-2565/<file>.test.mjs
```

`../BASE-RESULTS.txt` has each one's run and the assertion it failed at. A copy goes stale as the real file changes,
and still holds its fault.
