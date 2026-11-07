# #1328 proof: real blind jobs through a real hub

Each run started `deep hub run` from this branch's build, with real Claude Code 2.1.308 signed in to the owner's plan, and a scratch clone of this repo. It called `acceptance.start` with a real GitHub issue of this repo, read through the forge, and a base commit. The plan window reading was handed in by hand, as a status line would send it. Nothing else stood in. The account ID is redacted.

| Issue | Base | Result | Cost |
| --- | --- | --- | --- |
| #910 design links lane | `2f43a669`, before its blind tests | **ready**: 3 tests, each failing on the base at an assertion in its file, committed as `deep/attempt/910`'s first commit | $0.66 |
| #1327 lane.json | `ed83819d`, today's main | INVALID: every test runs `git`, and the command check counts no run that starts an untraced program | $1.77 |
| #86 budget ledger | `c9891b33`, before its blind tests | INVALID: the tests import `packages/record/src`, which needs other workspace packages built into `dist/`, and a fresh checkout of this repo has none | $2.87 |

- `910-result.json`: `acceptance.status` once judged, the job's `job.recorded` data with its input record, the job's record, and the `attempt.started` event.
- `910-first-commit.txt`: the attempt's first commit. Its parent is the base, and it touches only `tests/acceptance/910/`.
- `1327-result.json`, `86-result.json`: the two runs that weren't ready, and why. After the #1327 run, the job's prompt says the hub counts only Node runs.

What the #910 run shows:

- **Inputs on the record.** `job.recorded` lists exactly the issue's body by hash, `AGENTS.md` and `docs/technical-design.md` by hash at the base, and the base commit.
- **Base failures.** The hub ran each test on the base itself. `base` names each test, its criterion's tag and the line where it failed at its assertion. The job's own word was not used.
- **The commit.** It was made through a temporary index, so the clone's own checkout and HEAD never moved.

A fourth run, also on #86 at `4a56f895`, was refused by a bug in the hub's reading of `git status`, which clipped the first path. Commit 2341547c fixed it, and the next run on #86 got past it.
