# Twins for the 3433 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. Each twin is the merged
implementation with exactly one rule broken as below, and nothing else changed: same lines, same record fields, same
exit statuses. A twin replaces product files only, never a file under `tests/`: it goes at `twins/<name>/scripts/<file>`
for each file it replaces. Where the merged change puts the stop in a helper of its own (a new `scripts/proof-*.mjs`, or
`throttle.mjs`), the twin breaks the rule in whichever of `scripts/benchmark.mjs`, `scripts/lanes.mjs`, that helper or
`scripts/throttle.mjs` holds it, and replaces just the files it changes. Each fault was planted in a throwaway
implementation in this job's scratch folder (or is the merge base's own behavior) and failed the test named at its
assertion (`../BASE-FAILURE.txt`).

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3433.bf4b249a` | `stop-lead-only` | `scripts/benchmark.mjs` (and the stop helper, if the kill is there) | At `measureOnce`'s timeout the stop kills only the lead process: the measured command's own process (or its process group, as the merge base does), never the processes in a group of their own. The error is still `ETIMEDOUT` and still names what it stopped | `measure-stop.test.mjs`, `#3433.bf4b249a`: "2 s after ETIMEDOUT these processes the command started still run" lists the grandchild. The merge base fails here the same way |
| `#3433.0ced7c1d` | `stop-names-nothing` | `scripts/benchmark.mjs` (and the stop helper, if the names are made there) | The stop ends the whole tree as the merged change does, but the `ETIMEDOUT` error's message is the one spawnSync gave (`spawnSync /usr/bin/time ETIMEDOUT`), naming no process; so perf's `BLOCKED perf` line names none either | `measure-stop.test.mjs`, `#3433.0ced7c1d`: "the ETIMEDOUT error names the lead it stopped"; and `perf-line.test.mjs`, `#3433.0ced7c1d`: "perf's BLOCKED perf line names the lead the stop ended". `#3433.bf4b249a` passes on it |
| `#3433.46eec7ed` | `lanes-as-main` | `scripts/lanes.mjs` | `runLanes` runs each command as main does today (`spawnSync`, no stop): `scripts/lanes.mjs` at the merge base `16dd75036`, unchanged. A SIGTERM to the lanes.mjs process ends only that process, and no record is written | `lane-term.test.mjs`: "15 s after SIGTERM to lanes.mjs, processes its command started still run" lists the runner, its test file's process and the grandchild. The merge base fails here the same way |
| `#3433.d424696d` | `stop-in-lane-group` | `scripts/lanes.mjs` (and the stop helper, if it starts itself there) | The lane's stop runs inside the lane's own process group: the process that lists the run's tree and stops it is started without a group of its own (no `detached`, no `setsid`), or the stop runs in the lanes.mjs process itself; so a SIGKILL to that group ends it too | `lane-group-kill.test.mjs`: "15 s after SIGKILL to lanes.mjs's group, processes its command started still run" lists the grandchild, and no record is written |
| `#3433.cd15df63` | `stop-outlives-run` | the stop helper (or `scripts/lanes.mjs`, wherever it is told the run ended) | The stop keeps running after a lane run ends by itself: the run's end is ignored, and the stop process goes on listing the tree (it may stop on its own after a minute or more, never within 5 s). The record is written by the tests as before | `lane-ends.test.mjs`: "processes of the run are still running 5 s after it ended" lists the stop's process |
| `#3433.7e03e656` | `affected-as-main` | `scripts/affected.mjs` | The run's stop passes the signal only to each job's direct child, its `throttle.mjs`, as main does: `scripts/affected.mjs` at the merge base `9bbe0f24c`, unchanged (the folder holds that file). It still prints `BLOCKED affected: stopped by SIGTERM` | `affected-term.test.mjs`: "15 s after SIGTERM to affected.mjs, processes its job started still run" lists the grandchild. The merge base fails here the same way |

`#3433.bf4b249a`, `#3433.46eec7ed` and `#3433.7e03e656` fail on the merge base at their assertions too (the base is `stop-lead-only`'s,
`lanes-as-main`'s and `affected-as-main`'s behavior), but the issue asks for those planted programs, so they keep their twins.
`#3433.cd15df63` passes on the merge base, which starts no stop at all; its twin is its only proof of failing first.
`affected-as-main` is main's whole stop for an affected.mjs run: if the merged change ends a job's tree in
`scripts/throttle.mjs` or a stop helper rather than in `scripts/affected.mjs` alone, the twin replaces those files with
the merge base's too, so it still passes the stop only to each job's direct child and nothing below it ends the tree.
