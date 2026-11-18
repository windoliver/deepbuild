# Twins for the 1358 tests

The base (`212f16d09`) already behaves as #1358's criteria say, so no test here can fail on it. Each test has a planted
wrong program here, and `../twins.json` names it by criterion. The `before` lane lays a twin's files over a copy of the
change, builds the copy and runs the tests in it.

Each twin is the base's `packages/hub/src/service.ts` with lines changed in `definition` or `launch`, each marked
`Planted`. It keeps every export the base has, and builds under `noUnusedLocals`. The plants sit where `deep hub start`,
setup and the first `deep` command all pass, so a twin is wrong for every way in.

| Criterion | Twin | What it plants | Why it is the criterion's wrong program |
|---|---|---|---|
| `#1358.a5dca18a` (another home's job is never kickstarted) | `as-reported` | On macOS, after a failed `launchctl bootstrap`, the job is kickstarted without asking launchd which plist loaded it | It is the program the issue reports. With the label loaded from another home's plist the stand-in logs a kickstart, so the first test fails at its first `expect` |
| `#1358.e5fdc397` (the definition carries `HOME`) | `as-reported` | The definition's environment holds `PATH` alone, in the plist and in the systemd unit | The same reported program: "The plist's `EnvironmentVariables` set only `PATH`". Both of the criterion's tests read no `HOME` and fail at their `expect`: the plist's in `launchd.test.ts` on macOS, the unit's in `systemd.test.ts` on Linux |
| `#1358.1077c231` (this home's own job is kickstarted as before) | `every-loaded-job` | On macOS, a job that is already loaded is refused whichever plist loaded it, this home's own too | It is the first criterion's rule without its condition. With the label loaded from this home's own plist the stand-in logs no kickstart, so the second test fails at its `expect`. The first and third tests pass on it |

On `as-reported` the second test passes: the reported program did kickstart a home's own job. `as-reported` leaves the
base's Linux lines in `launch` as they are; no criterion of the issue names what `deep hub start` does with a systemd
unit another home loaded.

A twin replaces the whole file, so a change's own lines in `service.ts` are gone under it. A change that adds an export
to `service.ts` which another module imports stops a twin from building. The lane then says BLOCKED for that twin,
naming the build, and the twin goes back to a blind redraft; no one edits it in place.
