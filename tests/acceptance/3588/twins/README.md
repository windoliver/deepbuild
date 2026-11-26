# Twins for the 3588 tests

Each twin is kept as its wrong lines (`lines.json`, the line form the twins lint asks for), applied by the before lane
to `scripts/affected.mjs` as the change holds it. No implementation existed when these tests were drafted, so the
`find` lines are the base's (`914bd5f29`): if the change rewrites the line they match, the twin goes stale and is
written again against the change's file by a blind redraft of this suite, never by the implementer.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3588.704a8c75` | `skips-the-rebuild` | `scripts/affected.mjs` (one line) | The timed phase builds nothing again before a timed job: the check of the run's binaries before each timed job (`ready(root)` in the timed jobs' loop) is gone, so a binary a cleanup removed stays removed. Nothing else changes: the untimed jobs, the alone block's check, the grants and the lines are the base's | `granted.test.mjs`: "no build grant was granted to the run once the holders let go: nothing was built again of what the cleanup removed" |

`#3588.7a8aaa71` has no twin: its wrong program is the merge base, whose rebuild waits 30 minutes for its build grant,
so its run is still going at 4 minutes and the test fails at its assertion (`../BASE-FAILURE.txt`).
