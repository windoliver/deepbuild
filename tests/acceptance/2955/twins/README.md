# Twins for the 2955 tests

`../twins.json` names them. Each replaces `packages/conformance/src/gate-play.ts` with the change's own, one rule
changed and marked `Planted:`. The implementing session wrote them, not the blind job.

| Twin | What it gets wrong | The test that fails on it |
|---|---|---|
| `reflink-everywhere` | GNU cp's `-R --reflink=auto` on every platform, so macOS's cp refuses the copy | `installs.test.ts`, the macOS test |

The Linux test fails on the merge base itself on Linux (`../BASE-FAILURE.txt`): `/bin/cp: invalid option -- 'c'`. It
needs no twin there, and on macOS it is skipped, naming the platform.
