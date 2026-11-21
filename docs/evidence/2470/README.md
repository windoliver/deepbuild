# #2470 evidence: deep-contracts compiles on main, and a second generate leaves no diff

Runs on the owner's Mac (Node 24.22.2, cargo 1.99.1), 2026-11-20. The fix is #2475 (`778a011ef`, on main since 2026-11-13). It regenerated `crates/deep-contracts/src/generated.rs`, where two merged regenerations had left `RULE_340` and `RULE_341` defined twice. The closed-issue sweep (#2047) reopened #2470 because no test on main named its criterion IDs. This change adds the blind suite `tests/acceptance/2470/` and these captures; it changes no code. Load was high: the captures that record it give 140 to 183 on their first line. `<export>` stands for a `git archive` export in a temporary folder, `<worktree>` for this worktree.

## Requirement → change → proof

| Criterion | Change | Proof |
|---|---|---|
| AC1 `#2470.16c0da75`: `cargo check --locked -p deep-contracts` passes on main | None here. #2475 regenerated `generated.rs`; its diff is six lines of that file and nothing else | `cargo-check-base.txt`: at `e0c90a5a5` the command exits 101 with the issue's E0428 for `RULE_340` (lines 84003 and 86396) and `RULE_341` (84005 and 86398). `cargo-check-fix.txt`: the same command on `778a011ef`'s tree exits 0. `criteria-on-main.txt`: exit 0 on main `4bf2fc7ad`. The blind test `AC1 #2470.16c0da75` passes at the merged head (`suite-head.txt`). It fails at its assertion on the base (`tests/acceptance/2470/BASE-FAILURE.txt`) and on its twin `defined-twice` (`proof-lanes.txt`) |
| AC2 `#2470.296a591a`: a second `npm run generate -w @deepbuild/contracts` leaves no diff | Same | `criteria-on-main.txt`: on main `4bf2fc7ad` the generate exits 0 and `git status --porcelain` prints nothing. The blind test `AC2 #2470.296a591a` passes at the merged head (`suite-head.txt`). It fails at its assertion on the base, where the generate rewrites `generated.rs` from line 86396, and on its twin `slot-digest-by-hand`, where it rewrites a digest edited by hand in `hub-slots.json` (`proof-lanes.txt`) |

## The captures

- `cargo-check-base.txt`: the issue's command in an export of `e0c90a5a5`, its whole output.
- `cargo-check-fix.txt`: the same export with `generated.rs` written from `778a011ef`. That is the fix's one changed file, so the tree is the fix's.
- `criteria-on-main.txt`: on main `4bf2fc7ad`, `npm ci`, the cargo check, the generate and `git status --porcelain`, each with its exit and the tail of its output. The status printed nothing.
- `suite-head.txt`: the blind suite once at the merged head.
- `proof-lanes.txt`: `node scripts/proof.mjs guard before trace` at `67814edc4`, the merged head with these captures, exit 0 in 6,080 s.
  - guard passes on 3 commits.
  - before: main `8e7b6ca88`, the merge base, holds both criteria, so the lane proves each test on its twin. AC1 fails on `defined-twice` and AC2 on `slot-digest-by-hand`, each at its assertion.
  - trace passes `Closes #2470`: each of its 2 criteria has a tagged test that ran, passed and failed on a wrong program.

  Home-folder paths in its bay lines read `~`.

The blind job's own runs, on the base and on each twin laid over a fix it made by regenerating at the base, are in `tests/acceptance/2470/README.md`.

## Timing

Not timed. No criterion sets a budget. At load 183 the suite took 144 s at the merged head: AC1 106 s, AC2 38 s. On main `4bf2fc7ad`, run straight in the worktree, the cargo check took 8 s and the generate 2 s (`criteria-on-main.txt`).
