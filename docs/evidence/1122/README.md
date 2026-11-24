# Evidence for #1122 (remote lanes)

Runs of 2026-11-22/23 on the MacBook Pro (Mac18,1, 12 cores, not a reference Mac; 1-minute load 60–145 throughout,
from other sessions) and the Spark (`spark-c89f`, Linux aarch64, 20 cores). Paths under the home folder read `~`.

| File | What it is |
|---|---|
| `mac-1122-a.out.txt` | The blind suite's 13 merge, ship and `--only` tests on the change: 13 pass |
| `mac-1122-planted.out.txt` | The two planted-bug tests on the change: both pass (each plant makes the merged verdict FAIL) |
| `mac-1122-twins.txt.txt` | Each of the eight twins laid over a scratch copy, the suite's three fast files run there: every twin fails the tests its criterion names |
| `mac-1122-1115.out.txt`, `mac-1983-ac07.txt` | #1115's record tests (21) and #1983's merge test on the changed `lanes.mjs`: all pass |
| `spark-catalogue-drift-4f760c0c.json` | A real record fetched back from the Spark: the `catalogue drift` lane on a composite tree, commit `c1ae84eb5` plus a bundle plus the untracked files (the then-untracked `scripts/lane-remote.mjs` among them), verified there and named by host, platform, tree, bundle and recipe. Its FAIL is main's own catalogue drift (12 event kinds) |
| `spark-catalogue-drift-64dbf5f4.json` | The same lane's first shipment, before the far worktree named an origin: INCONCLUSIVE, the open issues couldn't be fetched there |
| `spark-noop-no-grant-20e1c10d0.txt` | The `noop` lane shipped from a fresh GitHub clone at `20e1c10d0`: the Spark's throttle gave no build grant in 30 min (2 build grants held, 9 build requests and a timed one queued ahead), so no record came back and the near end read BLOCKED |

The blind suite's own base run is `tests/acceptance/1122/BASE-FAILURE.txt`.
