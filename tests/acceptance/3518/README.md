# Acceptance tests for #3518: each web player set's compressed size is a ceiling that only moves down

Written first, blind, from the issue as saved for this job (its opening, its Scope, its five criteria, its `Runs on:`
line and its Proof line), the two design sections it links, the issues it names (#2665, #2891, #2685, #1490, #172,
#1300 and #310, for the words it cites) and the base commit `b134dd38f` ("Merge pull request #3646"), by a job that
never saw an implementation. It was first written at `d303e2b64` and taken to this base when main moved (Readings).
No other worktree, branch, pull request or plan was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

At the base `web-export` has `"limits": {}` and its command throws where no `deep-show` is built, so all five tests
fail there, each at an assertion (`BASE-FAILURE.txt`).

## What was read

- The issue and the issues it names, as saved. `AGENTS.md`, `CONTRIBUTING.md`.
- `docs/canvas-primitives.md`: Export: web player. `docs/technical-design.md`: Numbers version 0 has to hold; Later, as
  extensions (the R4 line on ceilings); How we know version 0 works (Criteria to tests, Criteria in a checked shape,
  Wrong programs, The edit guard, Dogfooding, Tests written first). `docs/parallel-proof.md`: sections 5 to 7a and 12a.
- At the base, for call shapes only: `benchmarks/web.mjs`, `benchmarks/budgets.json` (`web-export`, and `hub-idle`,
  `command-check-count` and `phone-reads`, which hold `report.<name>` ceilings), `scripts/benchmark.mjs`
  (`validateBudgets`, `judgeCount`, `judgeTask` and how it reads a report), `scripts/perf.mjs`,
  `scripts/budget-window.mjs`, `scripts/player-wasm.mjs`, `crates/deep-player/web/dist/sets.json`, `scripts/lanes.mjs`,
  `scripts/affected.mjs` (which files a suite's literals reach, and its runners), `scripts/proof-runs.mjs` (what a
  failure at an assertion is), `scripts/proof-change.mjs` (a test's tag), `scripts/proof-guard.mjs` (the guard's
  list), `scripts/throttle.mjs` (its use), and the suites `2665/`, `1490/` (`record.test.ts`, the README's size
  record), `172/` (`budgets.test.ts`: 12 MB is 12,000,000 B), `169/` (`none`), `tests/benchmark.test.mjs` and `2661/`;
  `reports/2332/closure.md` and `reports/2068/README.md`, for how the repository uses "the pinned base".

Code was read only to learn the surfaces. Every expected value comes from the issue, the design, or the base's own
committed size record. The only module imported from outside this folder is `scripts/benchmark.mjs`, for the two
exports the lanes judge with, as `tests/benchmark.test.mjs` and `tests/acceptance/1555/`, `2661/` and others import it.

## Run them

From the checkout's root, with Node 24 on PATH. Nothing is installed or built for it: no cargo, no `npm run build`,
no binary. It imports Node's built-ins and `scripts/benchmark.mjs`.

```sh
node --test tests/acceptance/3518/ceilings.test.mjs
```

One file, five tests, eight runs of the task's command in planted trees. Over its two bases it took 2.5 to 7.1 s
here against the base and 1.2 to 10.9 s against a throwaway guess at the change, on a Mac17,10 (18 cores) at
one-minute loads of 64 to 225 from other sessions. Each test has its own limit, 600 s, and each run of the command is
stopped after 120 s. Every temporary folder is removed when its test ends; the only processes started are those
runs, each a child that has ended or been stopped by its PID before the test goes on.

**Lanes.** The file belongs on no list of `scripts/lanes-lists.mjs`: it builds nothing, reads no `target/`, shares no
resource (each run has its own home, cache and temporary folder), gates on no clock or load, and runs in seconds. It
needs no `lane.json`. It imports `node:test`, so `scripts/affected.mjs` runs it with `node --test` in its parallel
block. Its helper imports `scripts/benchmark.mjs` and names `benchmarks/web.mjs`, `benchmarks/budgets.json` and the
size record each by its own path, so a change to any of the four, or to a file the bench imports, selects it
(`node scripts/affected.mjs --list benchmarks/web.mjs` lists the file).

## The surface under test

What the issue names stays as it is at the base: the `web-export` task of `benchmarks/budgets.json` and its command
(`node benchmarks/web.mjs`), the size record `crates/deep-player/web/dist/sets.json`, and what #2665 settled: a
`report.<name>` key of a task's `limits` is a ceiling on the number `<name>` in the task's report, its command's last
stdout line that is a JSON object; `judgeCount({limit, runs})` judges it on any machine; and
`validateBudgets(current, base, approved)` refuses a loosening no approved proposal names. **Every name marked
*(chosen)* is this job's**, shaped like its neighbours at the base; the implementer builds exactly these, or a dispute
goes to a blind redraft.

### The ceilings *(chosen names)*

Three keys of the `web-export` task's `limits`, one for each set, each holding the set's compressed size on the pinned
base (Readings):

```json
"limits": { "report.figure_brotli_bytes": 2556890, "report.game2d_brotli_bytes": 4977487, "report.full_brotli_bytes": 7973566 }
```

### The report *(chosen fields)*

The command's last stdout line that is a JSON object. For each set `<set>` of `figure`, `game2d` and `full`:

| Field | Holds |
|---|---|
| `<set>_brotli_bytes` | the set's compressed bytes as the tree's size record gives them, its `compressed`: a number, or missing, absent or `null`, when it can't be read |
| `<set>_ceiling_bytes` | the set's ceiling: the value of `report.<set>_brotli_bytes` in the `web-export` task of the tree's own `benchmarks/budgets.json` |
| `<set>_share` | the set's share of #172's 12 MB limit: `<set>_brotli_bytes / 12000000`, a fraction, not a percent, exact to within half a byte (`share × 12,000,000` is within 0.5 of the bytes); missing when the bytes are |

The report in this suite's tree for the fifth criterion, as the throwaway guess printed it:

```json
{"task":"web-export","player_brotli_bytes":null,"player_bytes":null,"bundle_bytes":null,"figure_brotli_bytes":3508,"figure_ceiling_bytes":4508,"figure_share":0.00029233333333333336,"game2d_brotli_bytes":5608,"game2d_ceiling_bytes":7608,"game2d_share":0.0004673333333333333,"full_brotli_bytes":8708,"full_ceiling_bytes":11708,"full_share":0.0007256666666666667}
```

`task`, `player_brotli_bytes`, `player_bytes` and `bundle_bytes` are the base's. The tests read the last three only to
hold that none is 0 in a tree with no built binary.

### With no build

A planted tree holds no `target/`, so no `deep-show`. There the command exits 0 and prints the report with every set's
fields: a set's bytes come from committed files, with no build (the issue's opening; its first criterion). At the base
the command throws there (`deep-show run exited null`), which is why every test that runs it fails at the base.

### How a run is read

As perf and a budget window read one through `judgeTask`:

- A run that exits non-zero gives no count: `judgeTask` throws on it, and the lanes read the task BLOCKED with the
  run's output.
- Otherwise each ceiling is `judgeCount({ limit, runs: [reading] })`, where `limit` is the ceiling in the tree's
  manifest and `reading` the number the report gives under the ceiling's name, or `null` when it gives none. One run
  stands for the five a lane takes, since the command's count is the same on every run.

Only the ceilings this checkout's own `web-export` task holds are judged, each against the tree's value for it, so a
checkout whose task has no limit judges nothing, as the merge base does.

### A set over its ceiling (the first criterion)

The command exits 0, the report gives the set's bytes, the set's ceiling reads FAIL and the other two PASS. One line
names the set, both sizes and the difference *(chosen: where the line is read, and its parts)*. The line is any one of:

- the ceiling's verdict as the lanes print it, `web-export: report.<set>_brotli_bytes: <judgeCount's reason>`;
- a line of the run's stderr;
- a line of its stdout, the report's own line included.

It names the set where the set's name stands with no letter or digit beside it (`game2d`, or inside
`game2d_brotli_bytes`), and a number where its digits stand with no digit or decimal point beside them, with or without
separators between thousands (`,`, `_`, or a thin or no-break space). The numbers are the set's bytes, its ceiling,
and the bytes less the ceiling. One line that passes, on stderr:

```
web-export: game2d is 105,608 B, 100,000 B over its ceiling of 5,608 B
```

At the base `judgeCount`'s own reason gives `web-export: report.game2d_brotli_bytes: every reading is over 5608:
105608`: the set and both sizes, and no difference. A report with one more field holding 100000 passes too.

### A record that differs from its files (the second criterion)

A set's Brotli 11 size is what `scripts/player-wasm.mjs` writes into the record: each of the two files the record names
for the set, `wasm.path` and `glue.path` from the tree's root, compressed alone at quality 11 with its length as the
size hint, the two sizes summed. When a set's `compressed` differs from that by any amount, the run fails *(chosen:
what failing is)*: the command exits non-zero, and one line of its stderr or stdout names the set and both numbers,
the record's and the files', read as above. One line that passes:

```
web-export: full: sets.json records 8,707 B, but its two files are 8,708 B at Brotli 11
```

### A count that can't be read (the fourth criterion)

When a file the record names for a set isn't there, the command still exits 0 and prints its report. That set's
`<set>_brotli_bytes` and `<set>_share` are missing from it, absent or `null`, never 0 and never another value, so
`judgeCount` reads the set's ceiling INCONCLUSIVE. A set whose two files are there is reported as before.

### A change to a ceiling (the third criterion)

`validateBudgets(change, base, approved)` with this checkout's manifest as `base`: a `change` that raises one of the
three ceilings by 1 B throws with `approved` empty, in a message that names `web-export` and the ceiling's key, each
whole. With #2665's item for it in `approved`, `benchmarks/budgets.json › web-export › report.<set>_brotli_bytes
<before> → <after>`, the same change doesn't throw. A `change` that lowers the ceiling by 1 B doesn't throw.

## The planted tree

Every test but the third runs the implementer's code in trees of its own, so that code must run there unchanged. A
tree is a folder `tree/` in a temporary folder the test makes and removes. It holds, and nothing else:

| Path in the tree | What it is |
|---|---|
| `benchmarks/` | a copy of this checkout's folder, `web.mjs` included, but for `benchmarks/windows/`, the budget windows' records |
| `scripts/` | a copy of this checkout's folder, whole |
| `benchmarks/budgets.json` | written over the copy: this checkout's manifest with the three ceilings of `web-export` set to the tree's own values, and nothing else changed |
| `crates/deep-player/web/dist/sets.json` | this checkout's committed record with, for each of the three sets, `wasm` and `glue` naming the two paths below with the SHA-256 of the planted bytes, and `compressed` as the test plants it; `compression`, `modules` and `module_set_digest` are as committed |
| `crates/deep-player/web/dist/<set>/player_bg.wasm`, `crates/deep-player/web/dist/<set>/player.js` | each set's two files: seeded bytes Brotli can't shrink, 3,000 and 500 B for `figure`, 5,000 and 600 B for `game2d`, 8,000 and 700 B for `full`; they are no WebAssembly and no script |

There is no `target/`, `node_modules/`, `packages/`, `.git` or `package.json`, so the command can import only Node's
built-ins and files under the tree's `benchmarks/` and `scripts/`. The checkout's own sets are never read or
compressed: a record names its own two files, so the suite's are small.

**How the command runs there.** The test reads the task's `command` from the tree's manifest and starts it once, with
the tree's root as the working directory: `node benchmarks/web.mjs`. `HOME`, `XDG_CACHE_HOME` and `TMPDIR` are empty
folders beside the tree, the Node running the test is first on `PATH`, and `NODE_TEST_CONTEXT`, `DEEP_BIN_DIR` and
`CARGO_TARGET_DIR` are unset, so nothing a run keeps reaches the next one and no binary built elsewhere is found. The
run is stopped after 120 s. `benchmarks/web.mjs` finds its tree from its own path, as at the base.

**The trees.** With `f`, `g` and `u` the three sets' Brotli 11 sizes as the test measures its own files (3,508, 5,608
and 8,708 B on Node 24.22.0):

| Tree | Files | Record's `compressed` | Ceilings | For |
|---|---|---|---|---|
| level | the planted files | `f`, `g`, `u` | `f`, `g`, `u` | the control of AC1, AC2 and AC4 |
| larger | `game2d`'s WebAssembly lengthened until the set measures `g + 100,000` | `f`, `g + 100,000`, `u` | `f`, `g`, `u` | AC1's plant |
| shaved | the planted files | `f`, `g`, `u − 1` | `f`, `g`, `u` | AC2: the smallest difference |
| edited | as larger | `f`, `g`, `u` | `f`, `g`, `u` | AC2: a record edited down to its ceiling |
| holed | the planted files, without `figure`'s `player_bg.wasm` and `full`'s `player.js` | `f`, `g`, `u` | `f`, `g`, `u` | AC4's plant |
| roomy | the planted files | `f`, `g`, `u` | `f + 1,000`, `g + 2,000`, `u + 3,000` | AC5 |

No planted program is used: the criteria's plants are records, made in test code.

## Criteria to tests

Each criterion's ID is `#3518.` and the first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the issue's saved body). Each test's name starts
`AC<n> #3518.<h8>`. All five are in `ceilings.test.mjs`.

| Criterion | What its test holds | Fails on |
|---|---|---|
| AC1 `#3518.df764765` Each of the three sets has a ceiling equal to its compressed size on the pinned base, read from the committed files with no build. A planted `sets.json` whose `game2d` is 100,000 B larger fails, naming the set, both sizes and the difference. On the merge base the task has no limit, and the same plant passes | In this checkout's manifest each of the three ceilings is its set's size on the pinned base, or lower with the committed record's size for the set within it. The level tree stands: exit 0 with no built binary, each set's bytes as recorded, each ceiling PASS. On the larger tree: exit 0, `game2d_brotli_bytes` is `g + 100,000`, `game2d`'s ceiling reads FAIL and the others PASS, and one line names `game2d`, `g + 100,000`, `g` and 100000 | The merge base: the task has no limit, so nothing fails the plant, and the message says so for each set. The work with a ceiling 0.3% up (`full` at 8,000,000): names the key, 8000000 and 7973566. The work naming no difference: names `game2d`, both sizes and 100000 |
| AC2 `#3518.d99171b8` A planted record whose size for a set differs from the Brotli 11 size of the two files it names fails, naming the set and both numbers, so a ceiling can't be met by editing the record | The level tree stands. On the shaved tree and on the edited tree the command exits non-zero, and one line it prints names the set and both numbers: `full`, `u − 1` and `u`; `game2d`, `g` and `g + 100,000` | The merge base: the level tree doesn't stand, and no line names a set and its numbers. The work reporting the record without compressing the files, or allowing 1% as #1490's test does: "exited 0", naming `full`, 8707 and 8708. The work that leaves the count out and exits 0: the same |
| AC3 `#3518.9de0d983` A change that raises a ceiling with no approval is refused, naming the task and the field, as #2665's second criterion has it for any limit | For each set: the raise by 1 B is refused naming `web-export` and the key; with its approved proposal it isn't; a lowering by 1 B isn't. The manifest unchanged isn't refused | The merge base, and the work that keeps a ceiling anywhere but the task's `limits`: there is no ceiling to raise, and a change that sets one 1 B over the pinned size isn't refused; names the key and the number |
| AC4 `#3518.fd5b7a48` A count that can't be read, such as a set whose file is missing, is missing and never 0, and its ceiling reads INCONCLUSIVE | The level tree stands. On the holed tree: exit 0; `figure`'s and `full`'s bytes and shares are absent or `null`, and their ceilings read INCONCLUSIVE; `game2d`'s bytes are `g` and its ceiling PASS; none of `player_brotli_bytes`, `player_bytes` and `bundle_bytes` is 0 | The merge base: the command exits 1, so the ceilings would read BLOCKED, and there is no ceiling. The work reading a missing file as 0: names the field and "never 0", and the ceiling reads PASS. The work that throws: "BLOCKED, not INCONCLUSIVE". The work that reports the record without looking for the files: names the field and the number |
| AC5 `#3518.3c8c36bf` The report lists each set's bytes, its ceiling and its share of the 12 MB limit | On the roomy tree the run stands, and for each set the report's ceiling is the tree's and its share is its bytes over 12,000,000 | The merge base: no report. The work whose share is of the ceiling, of 12 MiB, a percent, or rounded to three places: names the field, its value and `bytes / 12000000`. The work listing the bytes as the ceiling, or no ceiling: names the field and the tree's ceiling |

## Wrong programs

The first criterion names the merge base, and every test fails there at an assertion of `none` in `helpers.mjs`
(`BASE-FAILURE.txt`). The other criteria name no planted program, so the suite has no `twins.json`. Each row above
names the work with one fault; I ran each as a throwaway guess at `benchmarks/web.mjs` and the manifest, laid over a
copy of `benchmarks/`, `scripts/` and the record outside the checkout and deleted since. The guess passed all five;
each of 23 single faults failed the test of its criterion, naming what the row says, and one variant, the difference
given only as a field of the report, passed (`BASE-FAILURE.txt` lists them). That was at `d303e2b64`. At `b134dd38f`
the guess was written again with its ceilings at this base's sizes and passed all five; with its ceilings left at
`d303e2b64`'s sizes it failed the first criterion's test, naming each key, its value and the record's size, as it did
with `full` at 8,000,000. That guess is deleted too.

## Readings where the issue and the design leave a choice

- **The pinned base** is main at `b134dd38f7a628c15a0764e299b77809fd5be230`, main's head and the commit the change is
  made on, and each set's size on it is what its committed record gives: 2,556,890, 4,977,487 and 7,973,566 B
  (`git show b134dd38f:crates/deep-player/web/dist/sets.json`), written into `helpers.mjs` as `PINNED`. The issue
  names no commit as its pinned base, where #2891 and #2685 each name theirs in a Scope line, and this repository's
  reports use the words for the commit of main a change's proof is pinned to (`reports/2332/closure.md`,
  `reports/2068/README.md`). The first criterion says the size is "read from the committed files", not from the
  issue's table, whose numbers the issue would have quoted as #2891 quotes its targets, and that on the merge base
  the task has no limit: the change is made on this commit, so this is its merge base.

  **The base moved once while the suite was being written.** It was first written at `d303e2b64`, where the record
  gave 2,553,123, 4,974,280 and 7,968,686 B. This base is four first-parent merges after it, and the third of them,
  the merge of #3578 (`2daec1c4b`), rebuilt all three sets, 3,767, 3,207 and 4,880 B larger, while the task still had
  no limit, so nothing was there for it to raise. Of what this README says was read, nothing else differs between
  the two bases (`git diff --stat d303e2b64 b134dd38f`). The suite keeps its reading, the commit the change is made
  on, and takes that commit's sizes: a ceiling at `d303e2b64`'s sizes is one main's head is already over for each
  set, so every commit judged after the change lands would fail it, and the task can't end that, since making a set
  smaller is #2891's and a raise needs an approved proposal. The same holds against the issue's own `5a81b58de`,
  where its table was read (2,580,017, 4,987,394 and 7,833,409 B): `figure` and `game2d` are under those sizes now
  and `full` is 140,157 B over, grown in the merges of #3597 and #3578.

  The record's sizes are true at this base: Brotli 11 of the committed files gave 2,556,890 B for `figure`,
  4,977,487 B for `game2d` and 7,973,566 B for `full` on Node 24.22.0, in a probe of this job's at `b134dd38f`. If
  main's record moves again before the change lands, the ceilings the suite holds are still these, and they aren't
  the implementer's to move: taking the suite to another base is this job's, as it was this once.
- **"Equal to"** (AC1) is equal, or lower with the committed record's size for the set at or under it: the issue's
  Scope lets a change that makes a set smaller lower its ceiling. A ceiling above the pinned size fails, and so does
  one lowered under what the record gives. An approved raise later moves this assertion by its own approved proposal.
- **"With no build"** is held on the report: the command gives every set's bytes, exiting 0, in a tree with no built
  binary. It could be read as a word on how the ceilings' values were taken and no more. The issue's opening says the
  bytes come from committed files "with no window and no build" and are judged on any machine, and a lane judges a
  count only on a run that exits 0.
- **The ceilings' values in a tree are the tree's own.** The suite holds the checkout's values in its manifest and
  the mechanism in trees whose files are small, so the plant is 100,000 B over a ceiling of 5,608 B, not of
  4,977,487 B. Files of the real sizes would be 15 MB of seeded bytes compressed in every run.
- **"A planted `sets.json` whose `game2d` is 100,000 B larger"** (AC1) is the record of a tree whose `game2d` truly
  is that much larger: the set's WebAssembly is lengthened until its two files measure 100,000 B more, and the record
  says so. The same record over unchanged files differs from its files, which is the second criterion's failure, not
  a set past its ceiling (Scope: "a change that raises a set past its ceiling").
- **"Fails"** (AC1) is the ceiling's FAIL from `judgeCount`, on a run that exits 0: the Scope makes each ceiling a
  count ceiling as #2665 has one. A command that exits non-zero on a set over its ceiling would read BLOCKED in the
  lanes and would judge a commit by its own ceiling, not its merge base's.
- **Where the line that names the set, both sizes and the difference is read** (AC1): the ceiling's verdict as perf
  prints it, or any line of the run. The base's verdict names no difference, and `scripts/benchmark.mjs` is on the
  guard's list, so the suite also takes a line the command itself prints.
- **What a differing record fails** (AC2) is the task's own command. The criterion's reason is that a ceiling can't
  be met by editing the record, and the ceiling is judged on what the command reports; a budget window runs the
  tasks and no test, so a check kept anywhere else would let an edited record pass there.
- **"Fails"** (AC2) is a run that exits non-zero. The issue says "fails" here and "reads INCONCLUSIVE" in the fourth
  criterion, so a record that differs isn't a count that can't be read; and the lanes print a failed run's output, so
  the line reaches a person, where they print none of a run that exits 0.
- **"Differs"** is any difference: 1 B. In both plants only `compressed` is wrong and each file's SHA-256 is true, so
  it is the size that is checked.
- **"A set whose file is missing"** is either of its two files, one case of each, in one tree. The record still names
  the file. The share of such a set is missing with its bytes. The export's own numbers are held to "never 0" only.
- **"Refused, naming the task and the field"** is `validateBudgets` called as perf and a window call it, on this
  checkout's manifest. #2665's suite holds the same refusal through a real window for any limit; this one holds that
  the three ceilings are such limits.
- **"Its ceiling"** in the report (AC5) is the tree's manifest's value, which a lowering commit's own report gives
  while the lanes still judge it by its merge base's (#2665).
- **"Share"** is a fraction of 12,000,000 B, as `tests/acceptance/172/budgets.test.ts` reads 12 MB and as the issue's
  "65%" for `full` at 7,833,409 B does.
- **"On the merge base the task has no limit, and the same plant passes"** names the wrong program. No test fetches a
  merge base: at the base this suite's own run is that reading.

## Not asserted, and why

- The report on the checkout's own tree. Running the command there compresses the three committed sets, 76 MB at
  quality 11 (132 s for `figure`, 297 s for `game2d` and 631 s for `full` here, at loads of 61 to 121), so no test
  does, and none holds that the committed record is true: the command holds it on every run a lane makes, and
  #1490's `record.test.ts` within 1%.
- How long the command takes on the committed sets, and anything it keeps between runs. `judgeTask` runs it 27 times
  on the change's side and 21 on its merge base's.
- `player_brotli_bytes`, `player_bytes` and `bundle_bytes` with a built binary, and the export itself: no criterion
  names them, and no binary is built.
- What a window's record or perf's lines hold for these ceilings, a lowering commit judged by its merge base's value,
  and an approval's signed tag: #2665's suite holds them for any limit.
- "With what the bytes are for" (Scope): no surface is named for it.
- The task's `criteria`, `initialReason`, `command` and `margin`.
- A record that can't be read at all, a set the record lacks, and a file that is there but unreadable: the fourth
  criterion gives one case.
- Making a set smaller, the 12 MB limit and the first frame, and a bundle's own bytes: not in this task.

## What the implementer meets outside this folder

- No line is needed in `scripts/lanes.mjs` or `scripts/lanes-lists.mjs`.
- `benchmarks/web.mjs` and `benchmarks/budgets.json` aren't on the guard's list at the base; `scripts/benchmark.mjs`
  is. Nothing here needs a change to it.
- Adding a limit to `web-export` isn't a loosening, so `validateBudgets` takes it with no approval. Changing its
  `command` is one.
- `judgeTask` also holds the task's p50 and peak memory within its 50% margin of the merge base's, and its
  instructions retired within 2%, on what the command now does for three sets. This suite's trees say nothing of that.
- `tests/acceptance/1490/record.test.ts` reads the committed record's shape. The planted records keep it.

## Files

- `ceilings.test.mjs`: the five tests.
- `helpers.mjs`: the checkout's manifest and record, the planted files and trees, the run, and the judges.
- `BASE-FAILURE.txt`: the run on the base, and the throwaway's runs.

No fixture holds a secret or personal data. The planted files are bytes from a seed.
