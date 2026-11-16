# Acceptance tests for #2574, AC1: Shards are made on Linux

A blind job wrote this test before any fix for #2574 existed, from issue #2574's AC1 only (AC2 to AC4 are out of
scope here), AGENTS.md, the design's Dogfooding section, `docs/parallel-proof.md` section 7a, and base commit
`1e3b798c5`'s `scripts/shards.mjs`. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

`shards-linux.test.mjs` (AC1, all four bullets) builds a scratch git repository with a committed file, an untracked
file that isn't ignored, `node_modules/`, `packages/p/package.json` with `packages/p/dist/`, and `target/`, then calls
`claimShards(root, want, say)` in a child node with `HOME` a temporary folder and `DEEP_TEST_SHARD_FLOOR=0`. It checks:

- `want` (2) shards come back, `say` gets `SHARD <k> <dir>: made, at tree <hash>, node_modules cloned` for each, and no
  `not used` line;
- each shard holds the committed and untracked files with the worktree's bytes, `node_modules/` and
  `packages/p/dist/`;
- after an edit in `root`, a second claim of the same shard says `reused` and holds the edited bytes;
- the new shard holds no `target/` file of the worktree's (skipped on macOS, where the clone stays `cp -c`).

Run: `node --test tests/acceptance/2574/*.test.mjs` (Node 24 reads a bare directory argument as a file). It takes seconds and removes its temporary folders.
`BASE-FAILURE.txt` is its output at the base, where it fails as expected (`cp -c` is macOS-only).
