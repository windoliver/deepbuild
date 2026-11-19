# #2402: a hook handler that keeps missing its deadline is set aside

The Proof the issue asks for: the hanging handler's ten calls with their waits on the merge base and on the change,
the record's events, the doctor item and the sessions' readings, and the planted host failing. Every number below
comes from a real hub, the real deep-hook and the built CLI, in temp homes, with the blind suite's test packages
(`tests/acceptance/2402/helpers.ts`): `acme/hang`, whose `tool.before` handler never replies, `acme/deny`, which
denies `./deploy.sh` calls in time, and `acme/flaky`, which never replies to a `flaky-hang` command and replies at once
to any other. No network, no model. Read on Nov 18, 2026, on an 18-core Mac at a 1-minute load of 22 to 54.

## The ten calls

Calls 1 to 5 in session S1, 6 to 10 in S2, each `./deploy.sh step-<n>`; the wait is deep-hook's run, start to exit.

| Call | Merge base 89863843d (ms) | Its control (ms) | The change (ms) | Its control (ms) |
|---|---|---|---|---|
| 1 | 516 | 16 | 523 | 24 |
| 2 | 511 | 11 | 514 | 45 |
| 3 | 512 | 13 | 510 | 8 |
| 4 | 513 | 12 | 7 | 7 |
| 5 | 516 | 10 | 7 | 7 |
| 6 | 512 | 15 | 6 | 7 |
| 7 | 511 | 12 | 7 | 7 |
| 8 | 511 | 10 | 12 | 7 |
| 9 | 511 | 11 | 17 | 15 |
| 10 | 517 | 15 | 14 | 17 |

The control is a second hub, the same world without `acme/hang`, called in turn. The merge base's column is the blind
suite's run on the base (`tests/acceptance/2402/BASE-FAILURE.txt`, load 160 to 200): `acme/hang` was asked about all
ten calls, and the record named it nowhere but in its own notes. The change's column is the suite's AC1 run at load 54
to 40: from the fourth call on, `acme/hang` is no longer asked, and each call lands 3 ms under to 5 ms over its control.
`acme/deny`'s deny reached the agent on all ten calls on the change.

## The record

On the change, after calls 1 to 3 (log positions as the record holds them):

```
17 handler.failed     core {"extension":"acme/hang","hook":"tool.before","call":"toolu_c822f4dd8596331b11651","reason":"acme/hang missed the hook's deadline of 500 ms"}
21 handler.failed     core {"extension":"acme/hang","hook":"tool.before","call":"toolu_fe253f5549d6879462f72","reason":"acme/hang missed the hook's deadline of 500 ms"}
25 handler.failed     core {"extension":"acme/hang","hook":"tool.before","call":"toolu_89771cc48a7d676bf3963","reason":"acme/hang missed the hook's deadline of 500 ms"}
26 handler.set_aside  core {"extension":"acme/hang","hook":"tool.before","call":"toolu_89771cc48a7d676bf3963","failures":3,"last":"acme/hang missed the hook's deadline of 500 ms"}
```

## The sessions' readings

One `session.reading` on each session whose calls the handler would have judged, at its first such call:

```
28 S1 acme/hang's tool.before handler is set aside after 3 failures in a row (the last: acme/hang missed the hook's deadline of 500 ms), so DeepBuild no longer asks it: this session's calls go on without it until it is restarted, updated or turned on again, or the hub starts.
37 S2 (the same words)
```

## The doctor, and the restart

`deep doctor --json` with the handler set aside shows one item for it:

```json
{"item":"extensions.hooks","agent":"deepbuild","code":"handler_set_aside","level":"warn","evidence":"acme/hang's tool.before handler is set aside after 3 failures in a row, so DeepBuild no longer asks it; the last: acme/hang missed the hook's deadline of 500 ms","fix":"Install acme/hang again, or a fixed version, with `deep install <its folder>`, or restart the hub (`deep hub stop`, then `deep hub start`): either gives its handler a fresh try."}
```

`extension.restart {"id":"acme/hang"}` on the cli role answers `{"status":"restarted","id":"acme/hang","version":"1.0.0"}`.
The doctor then shows no item naming `acme/hang`, and the next call in S1 is asked again: it waits 506 ms, and the
record holds its `handler.failed`, the first of a fresh count.

## The planted host

`DEEP_HUB_PLANT=failures-never-cleared`, `acme/flaky` alone, its scene in one session:

| Call | Command | Wait (ms) | Asked |
|---|---|---|---|
| c1 | `./build.sh flaky-hang-1` | 510 | yes |
| c2 | `./build.sh flaky-hang-2` | 506 | yes |
| c3 | `./build.sh in-time-3` | 5 | yes |
| c4 | `./build.sh flaky-hang-4` | 507 | yes |
| c5 | `./build.sh flaky-hang-5` | 5 | no |
| c6 | `./build.sh in-time-6` | 5 | no |

The planted host never clears the count, so the reply in time at c3 leaves it at two, and c4 sets the handler aside
(`handler.set_aside`, failures 3). The suite's AC2 judge fails on it, naming `flaky-hang-5`, the one call the count
would have stopped asking about; on the change the same scene is asked about every call (`set-aside.test.ts`, AC2).

## The budget

`tests/acceptance/2402/budget.test.ts` against the merge base, four handlers replying at once, 200 requests a side a
run: the change gains 0.0001 to 0.0003 ms in the hub and 0 to 0.007 ms in the sandbox, against 0.1 ms. The judge reads
INCONCLUSIVE, not PASS: the load (21 to 23) was above the 18 cores. The reference Mac's quiet run is owed.
