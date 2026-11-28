# Acceptance tests for #3528: the two .orig files leave crates/, and the repo rules refuse the next one

Issue #3528: two files a merge tool left behind, `crates/deep-gpu-layer/src/view3d.rs.orig` and `crates/deep-scene3d-render/src/lib.rs.orig`, leave the tree, and `scripts/repo-rules.mjs` refuses a tracked file whose name ends in `.orig` or `.rej` outside `vendor/`, naming it. The five `vendor/**/Cargo.toml.orig` are Cargo's own and stay.

Written first, blind, on November 26, 2026, at the base `f0a816405` (origin/main), by a job that saw only the issue, `docs/technical-design.md` (Dogfooding, and Built to be hard to get wrong with its Repo guards bullet) and the base commit. Per AGENTS.md, the implementing agent doesn't edit these files. A dispute goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/3528/*.test.mjs'
```

Plain `node:test` and Node built-ins, with Node 24, git, and a checkout with git history and `origin/main`. The suite takes 70 to 120 s: three runs of the repo rules, started together, each awaited to its exit. Nothing is written in the checkout. Temporary index files live in a folder under the system's temporary folder (`deep-3528-*`), realpathed, removed after the suite. The folder runs alone (`lane.json`): every test reads the whole working tree.

On the base 4 of the 5 tests fail, each at its assertion, as `BASE-FAILURE.txt` shows. One passes there: see On the base.

## Surfaces

- **`git ls-files`, `git ls-tree`, `git grep --untracked` and `git diff --name-status`** in this checkout.
- **The lint lane's repo rules**, `node scripts/repo-rules.mjs`, run as a process with cwd at this checkout, as `scripts/lanes.mjs`'s lint lane runs it: its exit code and its lines in a state. A failing line is one that starts with `FAIL `, `INVALID ` or `BLOCKED `.
- **A tree other than the work tree's index** is handed to the repo rules as an index file in `GIT_INDEX_FILE`, which git reads for `ls-files`: the merge base's tree, read with `git read-tree <merge base>`, or a copy of this checkout's index with the plant added by `git update-index --add --cacheinfo`. Git's other `GIT_*` variables are removed from every git and repo-rules process.
- **The merge base** is `git merge-base HEAD origin/main`.

## Criteria and tests

Each ID is `#3528.` and the first 8 hex digits of the SHA-256 of the criterion's text from the issue, trimmed, with white space collapsed (`criterionId` in `scripts/proof-change.mjs`). Each test's name starts with its ID.

| ID | Criterion | Tests (file: name after the ID) | On the base |
|---|---|---|---|
| `#3528.6d9e9cc1` | `git ls-files` on the change holds neither path, and no file in the tree names either | tree: *git ls-files on the change holds neither path, and no file in the tree names either* | fails |
| `#3528.10044f94` | `node scripts/repo-rules.mjs` on the merge base fails on the new check, naming both files. On the change it passes, with the five `vendor/**/Cargo.toml.orig` still tracked. A planted `crates/deep-app/src/main.rs.rej` in the index fails it, naming the file | repo-rules: *the repo rules over the merge base's tree fail, naming both .orig files under crates/ and none of the five under vendor/* | fails |
| | | repo-rules: *on the change the repo rules pass, with the five vendor/\*\*/Cargo.toml.orig still tracked* | passes |
| | | repo-rules: *a crates/deep-app/src/main.rs.rej planted in the change's index fails the repo rules, naming the file* | fails |
| `#3528.36ac6187` | Both crates build and their tests run as on the merge base: the change's diff holds two deletions under `crates/` and the check, and nothing else | tree: *the change's diff against the merge base holds the two deletions under crates/ and the check in scripts/repo-rules.mjs, and nothing else* | fails |

## Readings where the issue leaves a choice

1. **"No file in the tree names either".** A file names one when it holds its path or its own name (`view3d.rs.orig`, `lib.rs.orig`), as a literal string. The tree is the tracked files and the new ones git doesn't ignore, as the working tree has them; binary files are left out. This folder names them by design and is left out. So the check's own source and comments, and any twin outside this folder, must not name them either.
2. **"On the merge base it fails on the new check".** The check is new, so the merge base's own `scripts/repo-rules.mjs` has nothing to fail on. The test reads it as: the change's repo rules, run over the merge base's tree, fail, naming both files. The merge base's tree is its index (`git read-tree`), so the files are tracked there while the change's working tree no longer holds them: a tracked name is refused whether or not the working tree has the file, as `git ls-files` lists it. "On the new check" is read as a failing line that names each path; the check's name is the implementer's. The same run must not name any of the five vendored files, which the merge base also tracks: that is the rule's "outside `vendor/`". Without a merge base, or with one that doesn't track both files, the test throws `BLOCKED: …`.
3. **"On the change it passes".** The whole run exits 0 with no failing line and a PASS line, as the lint lane needs, and `git ls-files` lists exactly the five vendored `Cargo.toml.orig`.
4. **"A planted `.rej` in the index".** The plant is an index entry only, in a copy of this checkout's index; the working tree has no such file. Its content is `crates/deep-app/src/main.rs`'s blob at HEAD. The run exits 1 with a failing line naming it.
5. **"Both crates build and their tests run as on the merge base".** Covered by the diff's shape, not by building: no test runs cargo on the two GPU crates. Cargo compiles no `.orig` file, so a diff that deletes only the two `.orig` files and changes only `scripts/repo-rules.mjs` can't change what either crate builds or tests. The diff is the working tree against the merge base (`git diff --name-status --no-renames`, so uncommitted edits count) plus the untracked files git doesn't ignore, as additions. It must be exactly `D` of the two files and `M scripts/repo-rules.mjs`.
6. **"And nothing else".** This folder (tests, helpers, twins, `twins.json`) is the change's proof and is left out of the diff. Nothing more is: a change to `scripts/repo-rules.json`, another test file or a doc fails the test.

## On the base

- `#3528.6d9e9cc1` fails: `git ls-files` still lists both files. No other file names them on the base (the `git grep` half finds nothing).
- `#3528.10044f94`, merge base's tree: the base's repo rules exit 0 over it, naming neither file. Planted `.rej`: exit 0, naming nothing.
- `#3528.10044f94`, on the change: passes on the base, as it must. The base's repo rules pass and the five vendored files are tracked. It is a regression check, and the before lane needs a planted twin to fail it, such as a check that also refuses `vendor/**/Cargo.toml.orig`. This job writes no twin and no `twins.json`: both need the change.
- `#3528.36ac6187` fails: the diff against the merge base is empty.

## Not covered here

- Building either crate or running its tests (reading 5).
- The wording of the check's line and its Fix line, beyond naming the file.
