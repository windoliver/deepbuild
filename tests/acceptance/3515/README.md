# Acceptance tests for #3515: a shard reused from a repository whose objects it can't reach

A blind job wrote these tests before any fix for #3515 existed, from issue #3515's text and acceptance criteria only,
AGENTS.md, the design's Dogfooding section, `docs/parallel-proof.md` section 7a and base commit `b134dd38f`'s
`scripts/shards.mjs`. The expected values are the issue's. The implementing agent does not edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Each claim runs `claimShards(root, want, say)` from `scripts/shards.mjs` in a child node whose `HOME` is a temporary
folder, so `~/deepbuild-shards` is the test's, with `DEEP_TEST_SHARD_FLOOR=0`; its `say` lines and returned dirs come
back on stdout, its stderr apart. Repository A (a commit, an ignored `node_modules/`) claims shard 1, which makes it, so
its alternates name only A's objects. B is a real separate clone of A (`git clone --no-local`) with a commit and an
untracked file of its own, so B's HEAD and exact tree (`exactTree(B)` from `scripts/lanes.mjs`: HEAD plus uncommitted
and untracked files) are only in B's objects; the helper checks that A has neither. `GIT_CONFIG_PARAMETERS` is
removed from the environment for git and every child. No mocks; temporary folders are removed after each test.

| test | criterion |
|---|---|
| `alternates.test.mjs` `#3515.c4b78856 a shard another repository made is claimed from a fresh clone ...` | 1: B's claim says `SHARD 1 <dir>: reused, at tree <exactTree(B)>` (optionally followed by `, ...`), returns the shard, and the shard's HEAD is B's HEAD |
| `alternates.test.mjs` `#3515.e9ecd1ad the same claim holds once the repository that made the shard is deleted` | 2: the same, with A removed before B claims |
| `alternates.test.mjs` `#3515.d46e20be the alternates keep every line they had, ...` | 3: after B's claim every line the alternates had is still there and exactly one line names B's objects (compared by real path); a second claim from B leaves the alternates unchanged |
| `none.test.mjs` `#3515.0d44293c claimShards asked for shards that claims none says so on stderr, ...` | 4: with `DEEP_TEST_SHARD_FLOOR=1e18` no shard has room; asked for 3, it claims none, and exactly one stderr line matches `unsharded` or `worktree` (case-insensitive) and names `3`. The line's wording is left to the fix |

Run from the checkout with Node 24, after `npm ci` (scripts/proof-change.mjs imports `typescript`):
`node --test tests/acceptance/3515/*.test.mjs`. It takes about 10 seconds.

`BASE-FAILURE.txt` is its output at the base: all four fail at their assertions for the issue's reason. Criteria 1
and 2 get `SHARD 1 not used: fatal: <an object only B has> is not a valid object`; criterion 3's alternates name only A's objects;
criterion 4's stderr is empty.
