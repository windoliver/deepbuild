# Acceptance tests for #1116: scheduled budget windows (T10)

I drafted these tests blind from these sources:

- issue #1116, as saved verbatim for this job
- `docs/parallel-proof.md`, sections 6, 10, 10a, 11, 12, 12a and 13
- `docs/technical-design.md`: Dogfooding, How we know version 0 works, Every task carries its own budgets, The reference Macs
- AGENTS.md
- the base commit `c12a65bb`, which has no implementation

At the base I also read `scripts/throttle.mjs`, `perf.mjs`, `benchmark.mjs`, `lanes.mjs`, `proof-guard.mjs`,
`proof-change.mjs` and `proof.mjs`, and `tests/acceptance/1113/` and `1115/` for their shape. The helpers are written
here, never imported from another suite. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes
to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing (proof-change.mjs imports typescript)
node --test 'tests/acceptance/1116/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. There are 12 tests. All are
offline and run on real processes: the real `throttle.mjs`, the real `budget-window.mjs`, real git, a real benchmark
timed by `/usr/bin/time` and the instruction counter, and the real `proof.mjs guard`. The suite took about a minute at
a load of 90 to 220 on 18 cores, with two other copies of it running. `window.test.mjs` plays one scene and six tests
read it, so it takes its time on the first test.

Stand-ins, all at boundaries the repo doesn't own:

- **`gh`**, first on `PATH`. Issues are JSON files in the sandbox; every call is recorded. Nothing touches GitHub.
- **`sysctl`, `pmset`, `osascript`, `sw_vers`**, first on `PATH`: what `fingerprint()` reads. They report a Mac15,7, M3
  Pro, 36 GB, on mains, Low Power Mode off, thermal state nominal, so the suite reaches a PASS on any Mac. Any other
  `sysctl` goes to the real one.
- **The load.** The OS's load is shared with every session on the machine, so a test can't lower it, and a top-level
  timed grant waits for a load below the cores. Each node process starts with `--import` of a small module that pins
  `os.loadavg()` to `$T1116_LOAD`, 2 by default. The `sysctl` stand-in answers `-n vm.loadavg` the same way. `cpus()`
  stays the machine's.
- **`npm` and `cargo`**, first on `PATH`, exit 0, for the warm-up builds a fixture has nothing for.

**Every test points `HOME` at a temporary folder**, so the lock table, the log, the records and the window's own state
are the sandbox's, never the real `~/.deepbuild`. `TMPDIR`, `XDG_CACHE_HOME`, `RUSTUP_HOME` and `CARGO_HOME` are in the
sandbox too. The sandbox unsets `DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PREFLIGHT`,
`DEEP_OPEN_ISSUES`, `CARGO_TARGET_DIR`, `DEEP_PROOF_ISSUES`, `DEEP_APPROVERS`, `DEEP_BIN_DIR` and
`DEEP_PROOF_VITEST_REPORT`. Each process a test starts gets its own process group, and the test stops that group by its
PID. Nothing is killed by name or port.

No assertion rests on an absolute time except the minute AC5 names. Everything else is an ordering, or a ratio the
window itself judges.

## The surface (my choice where the issue leaves it open)

### Opening a window

- **`node scripts/throttle.mjs window [--wait <min>]`** opens one. The default wait is 60 minutes, section 6's row for a
  measured run's top-level timed. No flag is added to anything else.
- **The window is a top-level `timed` grant.** So it stops new grants, drains, and waits for a load below the cores, as
  section 6 has it. Under the grant `throttle.mjs` runs `scripts/budget-window.mjs`, the file beside it, with no
  arguments, gives the grant back, and exits with that script's status.
- **No grant.** As any throttle timeout: the first line starts `INCONCLUSIVE no grant`, the exit is non-zero, and the
  script doesn't run.
- **The log.** `~/.deepbuild/throttle/log` gets two new JSON lines beside the `granted` and `released` lines it has at
  the base: `{"event":"window-open"}`, written once the drain is over and before the script starts, and
  `{"event":"window-close"}`, written after the script ended. Other keys are free.
- **The script alone.** `node scripts/budget-window.mjs` outside a window exits non-zero and measures nothing, whatever
  `DEEP_THROTTLE` says: section 6 verifies that variable and never trusts it. `holds('timed')` is that check.

The tests run a copy: the fixture's checkout holds this checkout's `scripts/`. So **the repository a window measures is
the one its script sits in**, found from `import.meta.url` as `perf.mjs` finds its root. No path is passed to it.

"A few times a day" is the schedule's, and no criterion names it. No test looks at what starts a window.

### What a window measures

- **Merged** means on the first-parent line of `origin/main`. The script runs `git fetch origin main` once, before its
  first sample. In the fixture, `origin` is a bare repository on disk.
- **Since the last window.** The script keeps a mark, anywhere under `HOME`. The first window on a repository has no
  last window, so it marks the tip and measures nothing. The next measures the first-parent commits after the mark. The
  mark moves only past a commit that was measured, so a window that dies or gets no grant loses nothing. Every test
  starts with that first window.
- **The two sides.** For a merge commit `M`, the change side is `M^2` and the merge base is `git merge-base M^1 M^2`, the
  comparison `perf.mjs` makes on a branch. `M` itself isn't measured: when branches overlap, its tree holds other
  branches' changes (Readings, below). A commit with one parent, as a squash leaves, is its own change side, against
  its parent.
- **The budgets.** `benchmarks/budgets.json`, its `tasks`, read from the merge base for the numbers. The fixture's
  file has no `preflight` key, and one task. Each side runs in a tree of its own commit, with the task's `command`
  relative to that tree's root. 20 samples a side, by `measure` in `benchmark.mjs` or anything taking as many.
- **The verdict.** As `perf.mjs` judges: `compare` for the 50% p50, `judgeInstructions`, and `judgeLimit` for a limit.
  A regression is `FAIL`. Off the reference Macs a limit is INCONCLUSIVE, so the record is. A commit that changes its
  own budget gets any state but `PASS`.

### What a window leaves

- **One record per commit**, a JSON file anywhere under `~/.deepbuild/lanes/`, in T9b's shape with two fields added:
  `{ lane, state, host, platform, tree, tests: [{ id, state, note? }], commit, base }`. `commit` is the commit on main's
  first-parent line, and `base` the merge base. `tree` is the tree measured, `git rev-parse <change side>^{tree}`. Each
  task of `budgets.json` is one test, by its `id`. A JSON file there with no `tests` list isn't read as a record.
- **The issue** is the `#n` of `Part of #n` in the commit's message. The fixture's merge commits and branch commits both
  carry it, and a real one can come from either.
- **"Its other criteria are already proven"** means every line under `### Acceptance criteria` in the issue's body is
  ticked, `- [x]`, except its budget criteria, which are the window's own to prove. The fixture's budget criterion reads
  `` `fixture-bench` stays within its budget on a reference Mac, in the local preflight ``, so a rule on `budget`,
  `reference Mac` or section 12a's `in the local preflight` all find it. The body comes from `gh issue view <n> --json …`.
- **A pass** on such an issue runs `gh issue close <n>`. On any other it leaves the issue alone, or comments.
- **A miss** runs `gh issue comment <n> --body …` holding the commit and the task's `id`, leaves the issue open, and
  runs `gh issue create --title … --body …` once, holding `#<n>`, the commit, the task's `id` and the word budget. A
  commit is named by at least its first 7 characters. `--comment`, `-b` and `--body-file` work too, and `-q .field`.
  Anything else the `gh` stand-in doesn't know exits 1.

## Criteria to tests

Each criterion's ID is `#1116.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test carries its tag at the start of its
name. The Scope tests carry no tag, since no criterion holds them.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#1116.8a08ae16` A window drains every slot before its first sample and reopens after its last | `window.test.mjs` | Every slot of build, test and bay pair is held for 6 s when the window opens. Every holder ends before the first sample. Requests of each class made in the drain start after the last sample. The log agrees: all grants released before `window-open`, none granted before `window-close`, all samples between them |
| AC2 `#1116.8e06730a` Three commits merged between windows get three records, each against its own merge base | `window.test.mjs` | Exactly three records, one per merge commit. Each names its own merge base and the tree measured, in T9b's shape. The three bases differ, and two of them aren't the commit before theirs on main. Every side took at least 20 samples on the right tree, by what each sample read from its tree |
| AC3 `#1116.dead61b9` A planted 2× regression in one of them leaves only that issue open, naming that commit | `window.test.mjs` | The regressed commit's record is FAIL, the others PASS. Only its issue is open, with a comment naming the commit and the budget. One follow-up, still one after the next window |
| AC4 `#1116.5aa02a5a` A commit merged during a window is measured in the next one | `window.test.mjs` | Two commits land after the first sample. The window has no record or sample of them and their issues stay open. The next window records them, once each, and closes the one whose other criteria are proven |
| AC5 `#1116.96a59f57` An agent's build requested during a window starts within a minute of the window ending | `window.test.mjs` | A `build` asked for after the first sample starts after the last sample, within 60 s of `window-close` |

| Scope line | Test (file) | What it requires |
|---|---|---|
| A pass closes its issue "when its other criteria are already proven" | `window.test.mjs` | A PASS on an issue with another criterion unticked leaves it open |
| A commit "not yet measured leaves its issue open, never closed" | `traps.test.mjs`, two tests | With no grant at a load above the cores, and with the window SIGKILLed mid-sample: nothing closed, the next build starts, and the next window measures the commit and closes its issue |
| "On the reference Mac" (design: The reference Macs) | `traps.test.mjs` | On a Mac17,10 the record is INCONCLUSIVE and the issue stays open |
| "Agents never run … the window" | `traps.test.mjs` | The script run alone, with a forged `DEEP_THROTTLE`: non-zero, no sample, no record, nothing closed |
| "With budget numbers unchanged" | `traps.test.mjs` | A 2× regression whose own commit raises its margin to 10 isn't PASS, and its issue stays open |
| "`budget-window.mjs` joins the guard regex" | `guard.test.mjs` | An unsigned change to it fails `proof.mjs guard`, and one to `guide.mjs` in the same commit doesn't |

## The scene

The fixture has `origin`, a bare repository, `work`, a clone the tests merge in, and `mac`, the checkout the window runs
in, which holds this checkout's `scripts/`. Each commit adds one file under `tags/`, so every tree is a different set
of tags and each sample reports the tree it ran on.

```
r0 ─ r1 ─ Ma ─ Mb ─ Mc ─ d ─ Me          main; the first window marks r1
 └ a ─────┘              │
      └ b ──────┘        │               b doubles work.sh: the planted 2×
           └ c ──────┘   │               c forks from Ma, before b merges
                ... └ e ─────┘           e forks from Mc; d and e land during the window
```

| Commit | Merge base | Why that fork |
|---|---|---|
| `Ma` (a) | `r0` | It predates the last window, and isn't `Ma^1` |
| `Mb` (b) | `r1` | Not `Mb^1`, and the regression |
| `Mc` (c) | `Ma` | `Mc` holds b's regression and c doesn't, so a window that measures main's tree, or against the wrong base, opens c's issue too |
| `d` | `Mc` | One parent, as a squash leaves, on a tree that holds the regression on both sides |
| `Me` (e) | `Mc` | `Me^1` is `d`; its issue has another criterion unproven |

**The benchmark** is `node bench.mjs`, which runs `/bin/sh work.sh`, a loop. Doubling the loop's count is the regression,
so it lands in a child process, as #1404 warns: a count of the parent alone reads no change. The parent's startup isn't
doubled, so the whole run reads 1.8× on p50 and +81% on instructions retired, at a load of 90, past both the 50% margin
and the 2% one. A run takes about 200 ms. Budgets are real numbers: margin 0.5 and a `p50Ms` limit of 60 s, which only a
window off the reference Macs doesn't pass.

## Readings where the issue leaves a choice

- **"Each against its own merge base" and overlapping branches.** The issue doesn't say which tree is the commit's. I
  read it as `perf.mjs` reads it on the branch: the branch's tip against where it left main. Measuring the merge commit
  would blame c for b's regression, and "only that issue open" could not hold whenever agents' branches overlap.
- **"Other criteria already proven".** The design names no store for this. Nothing at the base keeps what a merged PR
  proved: `proof.mjs trace` prints its open list and writes no record. Ticks in the issue's body are the one thing that
  outlives a merge. A tick is a person's or an agent's word, so this is the weakest line of the surface, and a dispute
  should start here.
- **"Naming the regression and the commit".** Read as a comment on the issue, since the issue is what stays open. The
  record names them too.
- **"Drains every slot".** Section 6 lets a top-level timed request treat a build or test holder with a descendant
  blocked in a throttle wait as idle. The holders here have no descendants, so these tests don't decide whether a window
  keeps that rule.
- **A load that rises after the grant.** Section 11 says a budget at a load above the cores is never PASS. These tests
  hold that at the grant. `perf.mjs` reads no load after its grant either, and instructions retired don't move with
  load, so no test raises the load mid-window.
- **A record that isn't PASS or FAIL.** No test says whether the next window measures an INCONCLUSIVE commit again.
- **"A commit merged during a window".** Read as merged after the fetch. A commit that lands in the drain, before the
  fetch, is measured in that window, and no test depends on it.

## Files

- `helpers.mjs`: the sandbox, the stand-ins, launching, the fixture repository, and readers for the records, the log,
  the samples and the issues.
- `window.test.mjs`: the scene, AC1 to AC5, and the unproven criterion.
- `traps.test.mjs`: five Scope lines, each on one merged commit.
- `guard.test.mjs`: the guard regex.
- `twins.json`, `twins/`: the planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base, and which test caught each planted program.

No fixture holds a secret or personal data. Issues 9101 to 9205 and 9116 are made up.
