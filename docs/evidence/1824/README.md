# #1824 proof

From this branch's `scripts/fetch-lock.mjs`, on macOS arm64 with Node 24.22.0, every process with a temporary `HOME`.

| File | What it shows |
|---|---|
| `blind-suite.txt` | The blind suite (`tests/acceptance/1824/`, commit 4df496da, written first at f38d2b39): 8 of 8 pass. On the base all 5 tests of the real surface fail at their assertion (`BASE-FAILURE.txt` in the suite). |
| `proof.txt` | **The issue's Proof**, against a recording server on 127.0.0.1 with a 3-row lock. A cold fetch makes 3 requests and a warm fetch makes 0. With one flipped byte in `lib/b.txt` and the network not allowed: 0 requests, exit 1, one `BLOCKED` line with the path and both hashes, and one `Unblock:` line. With the network allowed it refetches that file alone, and the cache then holds the pinned bytes. The lint fails four planted rows (a branch, a tag, no size, no sha256), each named by its path. A URL the lock doesn't list fails, named, with 0 requests. |
| `mutants.txt` | Nine hand-made wrong copies of `scripts/fetch-lock.mjs`. Each makes at least one test of its criterion fail. |
| `proof-lanes.txt` | `node scripts/proof.mjs trace`, which runs `before` first. Trace PASS: each of the 3 criteria has a tagged test that ran, passed and failed on the merge base at its assertion. `before`: the 5 tests of the real surface PASS, each failing on the merge base at its assertion. The 3 plant tests FAIL there because the lane reads `twins.json`'s names as folders under `twins/`, while this suite keeps them as `twins/<name>.mjs` files its judges load. These tests only run the twins, which pass on the base as they do here, so they prove no criterion. |
