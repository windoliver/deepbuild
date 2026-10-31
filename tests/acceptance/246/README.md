# Acceptance tests for #246: repo rules in the lint lane

These tests were drafted blind from issue #246 (its text as of October 18), `docs/technical-design.md` and the base commit `dcfd7b8`, which has no implementation. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with:

```
node --test 'tests/acceptance/246/*.test.mjs'
```

`node --test tests/acceptance/246/` doesn't work on Node 23: it treats the folder as one test file. The whole suite should take well under a minute. On the base all 43 tests fail, each for the expected reason, as `BASE-FAILURE.txt` shows (local paths redacted).

The issue's Proof names `tests/repo-rules.test.mjs`, a lane-state test in `tests/preflight.test.mjs` and a perf test in `tests/perf.test.mjs`. AGENTS.md puts acceptance tests in `tests/acceptance/<issue>/`, so they're here instead. The implementing agent may still add those three tests.

## Surfaces

The tests reach the code only through what the issue names:

- `node scripts/repo-rules.mjs`, run as a process. Each run happens in a scratch git repository under the system temporary folder (realpathed), with this checkout's `scripts/repo-rules.mjs` copied to its `scripts/`, and cwd at the scratch root. One test runs it read-only in this checkout.
- `scripts/lanes.mjs`'s exported `checks` and `runLanes`. The lint lane runs through `runLanes` in a child `node --input-type=module -e` process with cwd at a scratch repository. The script is passed with `-e`, so no file holding this checkout's path lands in the scanned folder.
- `node scripts/perf.mjs '<observation>'`, run as a process in a scratch repository whose `origin/main` holds a `scripts/checks.mjs` that calls `git ls-files`.
- `benchmarks/budgets.json`, read.
- `scripts/repo-rules.json`, written in each scratch repository in the layout below.

Scratch git commands run with `-c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null`. Everything is removed in `t.after`. Nothing is written into this checkout.

No secret-shaped literal appears in these files. Every planted value and home path is built from parts at runtime, so the finished check scans this repo and needs no `allowedFindings` entry. Each test that plants a value asserts the output never contains it.

## Readings where the issue leaves a choice

1. **The rules file.** The issue names `allowedFindings` entries (`path`, `kind`, `sha256`, `why`) but not the layout of the dependency list. It says the list holds, "for each manifest path, the dependencies in each section, each with its exact `spec` and a `why`". The closest layout, used by every test:

   ```json
   {
     "deps": {
       "package.json": {
         "devDependencies": {
           "@types/node": { "spec": "22.20.5", "why": "…" },
           "typescript": { "spec": "5.9.3", "why": "…" },
           "vitest": { "spec": "5.0.5", "why": "…" }
         }
       },
       "crates/fx/Cargo.toml": { "dependencies": { "serde": { "spec": "^1", "why": "…" } } }
     },
     "allowedFindings": [{ "path": "…", "kind": "GitHub token", "sha256": "…", "why": "…" }]
   }
   ```

   Section keys are the npm section names and, for Cargo, the section word the FAIL line prints (`dependencies` for `[dependencies]`). A scratch repository whose manifests declare nothing gets `{ "deps": {}, "allowedFindings": [] }`.
2. **Where lines go.** Check lines are read from stdout, which is what the lanes capture first.
3. **Several findings in one check.** "Each check prints one line" doesn't say how two findings print. When a run has one finding, the test asserts the issue's exact line followed by its exact `  Fix:` line. When a run has many (the per-kind runs, the twins' contrast, the property test), the test collects every `path:line:column: kind` in stdout, whatever the layout, and compares the set. It also requires a `FAIL secrets:` line and the secrets Fix line.
4. **Lines and columns** are 1-based. A column counts characters from the start of the line to the first character of the matched text. The fixtures are ASCII, so characters and bytes agree.
5. **Unshown wordings.** The issue shows `has a hooks key` only for `.claude/settings.local.json`. The tests expect the same words for `.claude/settings.json` and `packages/cli/.claude/settings.json`. For Cargo's `[dev-dependencies]` and `[target.'cfg(unix)'.dependencies]`, the tests require only that the FAIL line names `dev-dependencies` or `cfg(unix)` where the `[dependencies]` line says `dependencies`. A path dependency's spec is whatever its FAIL line prints. The test requires that it holds `../helper` and no absolute path, then lists it back and expects a pass.
6. **Fix lines the issue doesn't word** (INVALID and BLOCKED lines, an allowedFindings entry that matches nothing): the next line must start with `  Fix: `.
7. **"The lint lane's second command, after `cargo fmt --check`"**: `checks`' lint lane has the fmt command first and `[node or process.execPath, 'scripts/repo-rules.mjs']` second. No lint command uses `-e`, `--eval`, `-p` or `--print`. "Its fix text points to the Fix lines" is read as the lane's `fix` containing `Fix line`.
8. **"On this branch's clean checkout"**: `node scripts/repo-rules.mjs` runs in this checkout as it is, and its `git status --porcelain` must not change. Exactly five lines must print, in the issue's order. The workflows and agent-hooks lines must match exactly, since they have no counts. The secrets, deps and size lines are matched by shape. The size line may take any of its three forms, depending on whether `origin/main` exists and how big the change is. `PASS lint (… s)` is proven in a clean scratch checkout with a fixture crate instead, so clippy's `target/` lands in the scratch folder and not in this checkout.
9. **Twins beyond the AC list.** The issue's scope also excludes placeholders containing `$` or `{` and an `sk-` preceded by a letter, digit, `_` or `-`, so those are twins too. A NUL at byte 7,999 is binary. A file whose NUL comes at byte 8,100 is text, so a value after it is reported: this contrast catches a scan that skips every file holding a NUL. Each twin run is followed by a contrast run in the same repository, with real values added, which must report exactly those.
10. **Counts in the twins run.** "Files scanned" is what `git ls-files --cached --others --exclude-standard` lists, less the lockfiles and binary files.
11. **"A scratch repository whose only files are lockfiles"**: the copied script sits in `scripts/`, which `.git/info/exclude` hides, so git lists only `package-lock.json` and `Cargo.lock`.
12. **"Names the parse error"**: the INVALID deps line for a malformed rules file holds `JSON`, `Unexpected`, `Expected` or `position`, the words of Node's JSON parse errors.
13. **"The existing lane tests pass unedited"**: the base's `tests/preflight.test.mjs`, taken from `dcfd7b8` byte for byte, runs against a copy of this checkout's `scripts/`. It sits in the same test as the BLOCKED summary, since on its own it would pass on the base and prove nothing.
14. **"Most severe first"** is checked where it matters to the lane: with a FAIL and a BLOCKED in one run, the FAIL line prints first and the summary is `FAIL lint: workflows: .github/workflows/ci.yml`.
15. **Perf's throwaway repository.** The merge base's `checks.mjs` records its own cwd. It requires `git rev-parse --show-toplevel` to be that cwd, so the repository can't be this checkout's or a worktree of it, and requires `git ls-files` to list the base's files. The test then requires that folder to be gone, and the scratch checkout's `git worktree list --porcelain` and `git for-each-ref` to be unchanged. To prove the throwaway commit skips the user's own hooks and signing, perf runs with `GIT_CONFIG_GLOBAL` pointing at a config whose `core.hooksPath` hooks and `gpg.program` leave a trace file and fail. A commit without `core.hooksPath=/dev/null` and signing turned off leaves a trace or fails.
16. **Budgets on the reference Mac** are a manual preflight run. The test checks only the `repo-rules` task in `benchmarks/budgets.json`: the exact command, margin 0.5, exactly the three limits and a non-empty `initialReason`.
17. **"No dependency is added"**: every `package.json` that git lists keeps the base's five dependency sections, or has none if it's new. No listed `Cargo.toml` has a dependency table, since #12's have none. The import specifiers in `scripts/repo-rules.mjs` (static `import … from`, bare `import '…'`, `import('…')`, `require('…')`) all start with `node:`, and none is computed.
18. **The property test** uses a seeded mulberry32 written in the test (seed `0x246`), with 1,000 cases, 200 per kind. Random text comes from a wide ASCII alphabet that includes `/`, `\`, `_`, `-` and capitals. A line is redrawn while it matches any of a set of patterns wider than the five kinds, so the text holds none of them. A planted value has a space on each side unless it starts or ends its line, so the text around it can't extend or shift the match. All planted files go in one scratch repository and their clean twins in another, so each side takes one run.

## Criteria and tests

| Acceptance criterion | Tests (file: name) |
|---|---|
| Clean checkout: exit 0, `git status` unchanged, one line per check; lint prints `PASS lint (… s)` | repo-rules: *on this checkout, every check passes on one line saying what it read, and git status is unchanged*; lanes: *a clean scratch checkout passes the lint lane, with each rule saying what it read* |
| `.github/workflows/ci.yml` fails with its Fix; lane summary; no inline check in lanes.mjs | repo-rules: *a file at .github/workflows/ci.yml fails the workflows check with its fix*; lanes: *a workflow file makes the lint summary FAIL lint: workflows: .github/workflows/ci.yml*; lanes: *the lint lane runs scripts/repo-rules.mjs second, after cargo fmt --check, holds no inline check, and its fix points to the Fix lines* |
| agent-hooks: six cases fail on their own with the Fix; the permissions-only settings pass | repo-rules: *agent-hooks fails on its own for …* (6 tests); *a .claude/settings.json with permissions and "disableAllHooks": false passes, and node_modules/ and target/ are not read* |
| Each kind, tracked and untracked, fails with path:line:column: kind, never the text, with the Fix | repo-rules: *a value of each kind in a tracked file fails with its path, line, column and kind, never its text*; *a value of each kind in a new untracked file fails with its path, line, column and kind, never its text* |
| Clean twins pass | repo-rules: *the clean twins pass: excluded paths, near misses, lockfiles, binary files and ignored files* |
| allowedFindings: skips exactly its value, counted; other file and other value still fail; an entry that matches nothing; an entry without why | repo-rules: *an allowedFindings entry skips exactly its value in its file and is counted*; *an allowedFindings entry that matches nothing fails*; *an allowedFindings entry without why is INVALID* |
| Property test: ≥ 1,000 seeded cases, exact line and column with kind; the clean text reports nothing | secrets-property: *property (seed 582): each of 1000 planted values is reported at exactly its line and column, with its kind*; *property (seed 582): the same 1000 texts without the planted values report nothing* |
| npm deps: left-pad, alias swap, vitest removed, with the Fix; packages/x fails, then passes; five sections read | repo-rules: *with #12's three devDependencies listed, an unlisted, re-specified or undeclared one fails*; redraft/deps: *a new packages/x/package.json with a dependencies entry fails, and one with none passes*; repo-rules: *package.json {dependencies, devDependencies, optionalDependencies, peerDependencies, overrides} is read* (5 tests) |
| Rust deps: serde ^1; dev and target sections; listed ^1 passes; relative path dependency | redraft/deps: *a Rust dependency fails in each section that declares it, and passes once listed with spec ^1*; *a path dependency is listed relative to its manifest, and no absolute path is printed or listed* (redrafted blind with carded fixtures after #879's dispute; see redraft/README.md) |
| INVALID and BLOCKED cases exit 1 with no PASS for that check | repo-rules: *a scratch repository whose only files are lockfiles is INVALID secrets: 0 files scanned*; *a checkout with no package.json or Cargo.toml is INVALID deps*; *a missing scripts/repo-rules.json is INVALID deps, and a malformed one names the parse error*; *a tracked file with mode 000 is BLOCKED secrets, and a tracked file deleted from the tree is skipped*; *a Cargo.toml with only git on PATH is BLOCKED deps: cargo metadata could not run* |
| Lint summary BLOCKED alone and FAIL beside it; existing lane tests pass unedited | lanes: *a lane takes its state from a diagnostic line that starts with FAIL, INVALID or BLOCKED, and drops the word*; *an unreadable file alone makes the lint summary BLOCKED, and the base's lane tests pass unedited*; *an unreadable file beside a FAIL makes the lint summary FAIL, with the FAIL printed first* |
| Size never fails the run: 450 + lockfile over the guideline; 120 under it; uncommitted and untracked counted; no origin/main | repo-rules: *a 450-line handwritten file beside a 1,000-line lockfile change is over the guideline, and the run still exits 0*; *committed, uncommitted and new untracked lines all count, under the guideline*; *without origin/main, size is not measured and the run still exits 0* |
| perf measures a merge base whose checks call `git ls-files`; throwaway repo removed; worktrees and refs unchanged | perf: *perf measures a merge base whose checks call git ls-files, in a throwaway repository of its own* |
| Budgets on the reference Mac (manual); the `repo-rules` task as specified | perf: *benchmarks/budgets.json gains the repo-rules task with its limits, margin and first-measurement reason* (the timings themselves are a manual preflight run) |
| No dependency added; repo-rules.mjs imports only `node:` modules | repo-rules: *no dependency is added: manifests keep #12's sections and repo-rules.mjs imports only node: modules* |

## Not covered here

- The p50, p95 and peak-memory readings on the reference Mac, and "the preflight workload still passes perf against the merge base". Both come from a manual `scripts/preflight` run.
- The Proof's end-to-end preflight runs in disposable clones, and the README sentence. The issue asks for those as pasted evidence, not as tests.
