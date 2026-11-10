# #1824 proof

From this branch's `scripts/fetch-lock.mjs`, on macOS arm64 with Node 24.22.0, every process with a temporary `HOME`.

| File | What it shows |
|---|---|
| `blind-suite.txt` | The blind suite (`tests/acceptance/1824/`, commit 4df496da, written first at f38d2b39): 8 of 8 pass. On the base all 5 tests of the real surface fail at their assertion (`BASE-FAILURE.txt` in the suite). |
| `proof.txt` | **The issue's Proof**, against a recording server on 127.0.0.1 with a 3-row lock. A cold fetch makes 3 requests and a warm fetch makes 0. With one flipped byte in `lib/b.txt` and the network not allowed: 0 requests, exit 1, one `BLOCKED` line with the path and both hashes, and one `Unblock:` line. With the network allowed it refetches that file alone, and the cache then holds the pinned bytes. The lint fails four planted rows (a branch, a tag, no size, no sha256), each named by its path. A URL the lock doesn't list fails, named, with 0 requests. |
| `mutants.txt` | Nine hand-made wrong copies of `scripts/fetch-lock.mjs`. Each makes at least one test of its criterion fail. |
