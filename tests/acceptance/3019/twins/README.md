# Twins for the 3019 tests

The base has no build cache. AC1 (`reuse.test.mjs`), AC3 (`tamper.test.mjs`), AC4 (`verdicts.test.mjs`) and AC5
(`ceiling.test.mjs`) fail there at their assertions (`../BASE-FAILURE.txt`). AC2's three tests (`fresh.test.mjs`)
pass there: a program with no cache always builds fresh and gives the verdicts of no cache. So AC2 is proven only
through the twins `../twins.json` names for it. The before lane runs the other twins only for a test that stops failing
on the merge base at its assertion.

No implementation existed when these tests were drafted, so the twin folders aren't here yet. Each twin is to be
`twins/<name>/scripts/...`: the merged implementation's lane files (`bays.mjs`, and `proof-runs.mjs` if the cache is
wired there), with exactly one rule broken as below and nothing else changed (same lines, same cache folder, same
`DEEP_BUILD_CACHE_BYTES`). A twin folder holds only those files. The lane code is guarded, so laying the twins needs
the same signed approval tag as the change.

Each was checked against a throwaway planted cache (`../BASE-FAILURE.txt`, "The planted program"), and failed the
tests listed. That planted cache was kept in a scratch folder and deleted. It is not committed.

| Criterion | Twin | The one rule it breaks | Tests it fails |
|---|---|---|---|
| `#3019.abf36a2d` (AC2) | `install-key-only` | The key holds the bay's role, the lockfile and the toolchain but not the tree: the tree hash (and, for the change, its uncommitted and untracked hashes) is left out, as npm ci's install marker leaves it out. | `fresh.test.mjs` merge base: after main edits `packages/w/src/note.txt`, the run reuses the old merge base's build and builds the new merge-base tree 0 times |
| `#3019.abf36a2d` (AC2) | `no-toolchain-key` | The key holds the tree and the lockfile but not the toolchain (the node, and its npm, that the build runs with) | `fresh.test.mjs` toolchain: run under another node, the run reuses the build made under the first node and builds 0 times |
| `#3019.abf36a2d` (AC2) | `packages-only-key` | The key is a hash of the files under `packages/` and the toolchain, not the whole tree. The root `package.json` and `package-lock.json` are left out | `fresh.test.mjs` lockfile: after main edits only `package.json` and `package-lock.json`, the run reuses the old build and builds 0 times |
| `#3019.117a4707` (AC3) | `unchecked-files` | A cached entry whose key matches is used without checking that its stored files still hold the bytes they were stored with | `tamper.test.mjs`: the run builds the merge-base tree 0 times. Its `BUILD` line says reused. C1 passes on the tampered base, so the verdicts change. |
| `#3019.a73b4639` (AC4) | `change-build-for-twin` | The key leaves out what is laid over the tree before the build (the twin's files), so a twin is served the change's build | `verdicts.test.mjs`: C2 passes on `wrong-label`, so the runs with the cache print `FAIL before: … fails on neither the merge base nor its planted wrong program`, where the run with no cache prints `PASS … failed on wrong-label at its assertion`. |
| `#3019.2e0b1f52` (AC5) | `evicts-newest` | Once a store takes the cache past its ceiling, entries are removed newest first, starting with the one just stored, until it fits | `ceiling.test.mjs`: after the second run the cache holds the first run's three builds and none of the second run's |
