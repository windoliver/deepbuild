# #1824 proof

From this branch's `scripts/fetch-lock.mjs`, on macOS arm64 with Node 24.22.0, every process with a temporary `HOME`.

| File | What it shows |
|---|---|
| `blind-suite.txt` | The blind suite (`tests/acceptance/1824/`: written first at f38d2b39 in 4df496da, its plants redrafted blind in 3e2d4b48 and 37beb00c) on this branch: 5 of 5 pass. On the base all 5 fail at their assertion (the suite's `BASE-FAILURE.txt`). |
| `proof.txt` | **The issue's Proof**, against a recording server on 127.0.0.1 with a 3-row lock. A cold fetch makes 3 requests and a warm fetch makes 0. With one flipped byte in `lib/b.txt` and the network not allowed: 0 requests, exit 1, one `BLOCKED` line with the path and both hashes, and one `Unblock:` line. With the network allowed it refetches that file alone, and the cache then holds the pinned bytes. The lint fails four planted rows (a branch, a tag, no size, no sha256), each named by its path. A URL the lock doesn't list fails, named, with 0 requests. |
| `mutants.txt` | Nine hand-made wrong copies of `scripts/fetch-lock.mjs`. Each makes at least one test of its criterion fail. |
| `twins.txt` | The blind redraft's seven twins (`tests/acceptance/1824/twins/<name>/scripts/fetch-lock.mjs`), each laid over a copy of this branch: each fails exactly its own criterion's tests, at their assertion, and passes the rest. |
| `proof-lanes.txt` | `node scripts/proof.mjs guard trace`, which runs `before` with trace. Trace PASS: each of the 3 criteria has a tagged test that ran, passed and failed on the merge base at its assertion. `before` PASS on all 5 tagged tests. The guard's 22 FAIL lines are two commits that need the owner's signed approval tag: 032b3e27, the lint-lane command in `scripts/lanes.mjs`, and 37beb00c, the swap of the plant tests for the blind redraft. |
