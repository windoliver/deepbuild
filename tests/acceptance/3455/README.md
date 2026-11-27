# Acceptance tests for #3455: blind suites hold no comments, and a new suite enters the comment ratchet from zero

Drafted blind from issue #3455, `docs/technical-design.md` (Repo guards, Dogfooding), `docs/adr/0001-code-carries-no-comments.md`, `AGENTS.md` and the base commit `345c9ae26`. The implementing agent doesn't edit them; a dispute goes to a blind redraft by this job. As the issue asks, the suite's own source files hold no comment: what a test is for is its title, what a helper does is its name. The comments written into scratch fixture files are string data.

Run with Node 24, after `npm ci` (the ratchet loads the `typescript` package):

```
node --test 'tests/acceptance/3455/*.test.mjs'
```

No cargo is needed: the Rust and WGSL fixtures are only read. Nothing waits on a timer, and no spawn has a timeout. On the base all 6 tests fail at an assertion, as `BASE-FAILURE.txt` shows (the checkout's path written as `<checkout>`).

## Surfaces

- The lint lane's comment-ratchet command, `[process.execPath, 'scripts/comment-ratchet.mjs']`, found in `scripts/lanes.mjs`'s exported `checks` (lane `lint`) and run as a process with cwd at a scratch git repository.
- `--write`, given as one more argument after the lane's own.
- `scripts/comment-ceilings.json`: the scratch repository's copy after each run, and this checkout's copy.
- `AGENTS.md`'s `## Proof` section and the design's `- **Repo guards.**` item, read from this checkout.

## Scratch repositories

Each lives under the realpathed system temp folder and is removed in `t.after`. It holds a copy of every flat file in this checkout's `scripts/` and a `node_modules` symlink to this checkout's, both hidden by `.git/info/exclude`; one listed file, `packages/fixture/src/note.ts`, with one comment line and a ceiling of 1 in a force-added `scripts/comment-ceilings.json`; and whatever the test commits in its base. `origin/main` points at that base commit, so the merge base is the base. Git runs with a fixture identity, no signing and no hooks.

A suite is four files: `double.test.mjs`, `helpers.ts`, `fixture/src/lib.rs` and `fixture/src/half.wgsl`. A planted comment is one `//` line.

## Readings where the issue leaves a choice

1. **"Fails the lint lane, naming the file".** Exit 1 and a line starting `FAIL ` that holds the file's repo-relative path. No count or ceiling is asked for. A pass is exit 0, a `PASS ` line, and no `FAIL`, `INVALID`, `BLOCKED` or `INCONCLUSIVE` line.
2. **"A planted new suite".** A folder (`tests/acceptance/9002/`) the merge base doesn't hold, tested both untracked and committed on top of the base. Each of its four files gets the plant in turn, with the other three clean; the FAIL names the planted file and none of the clean ones. The run with no comment passes before the plants and again after.
3. **"A suite the merge base holds".** `tests/acceptance/9001/`, committed in the base, every one of its four files with one comment line, and no ceiling. The counter-plant is the new suite `9002` beside it with one comment in `helpers.ts`: the run fails naming that file and no `9001` file; with that comment gone it passes.
4. **"No entry in `scripts/comment-ceilings.json`".** No key starting `tests/acceptance/`: in the scratch copy after a plain run, after `--write` with the new suite's comment in place (the plain run after it still fails naming the file), and after `--write` with the new suite clean (the plain run after it passes); and in this checkout's copy. `--write` must also keep the listed file outside the folder at its ceiling of 1. `--write`'s own exit and output are left open.
5. **"A file under a new suite's `twins/` folder".** New suite `tests/acceptance/9003/` with three twins: `twins/drops-check/packages/fixture/src/sum.ts` (two comment lines), `twins/drops-check/crates/fixture/src/lib.rs` (a two-line block and a comment after code) and `twins/first.mjs` (one line), all untracked. The counter-plant is one comment in `9003/double.test.mjs`: the run fails naming it and no twin; with it gone the run passes with the twins' comments.
6. **Criterion 4, what is matched.**
   - AGENTS.md: the text between `## Proof` and the next `## ` heading, split into bullets (lines starting `- `). Some bullet must match both `/\bno comments?\b|\bwithout (?:any )?comments?\b|\bcomment-free\b/i` and `/\bsuites?\b|\bsuite's\b|tests\/acceptance\/|\bblind\b|\bdraft/i`.
   - Design: the line starting `- **Repo guards.**`, split into sentences at `.`, `!` or `?` followed by whitespace and a capital, a backtick, `*` or `(`. Some one sentence must match `/\bsuites?\b|\bsuite's\b/i`, `/\bcomments?\b/i` and `/\bzero\b/i`. On the base the comment-ratchet sentence names `tests/acceptance/` and zero but no suite, and the sentence on suites names zero but no comment, so neither matches.
7. **Out of scope here.** That landed suites drafted with comments go to redraft, and that criterion tags stay in test names; neither has a planted check.

## Criteria and tests

| Tag | Criterion | Tests (file: name starts) |
|---|---|---|
| `#3455.1e33643c` | A planted new suite with one comment fails the lint lane, naming the file; with none it passes | ratchet: *… its files untracked*; *… committed on top of the merge base* |
| `#3455.7da213af` | A suite the merge base holds passes with its comments and has no ceilings entry | ratchet: *#3455.7da213af a suite the merge base holds …* |
| `#3455.868c2194` | A planted file under a new suite's `twins/` passes with its comments | ratchet: *#3455.868c2194 a planted file under a new suite's twins/ …* |
| `#3455.b793fb52` | AGENTS.md's Proof and the design's Repo guards say so | docs: *… AGENTS.md's Proof says …*; *… the design's Repo guards says …* |

## On the base

The base ratchet leaves all of `tests/acceptance/` out, so every planted new-suite comment passes: criteria 1, 2 and 3 fail at `no FAIL line naming tests/acceptance/900…`. Neither document holds the statement, so both criterion-4 tests fail at their match.
