# Acceptance tests for #2569: #1477's tests fail on main on the Mac, and its bench waits with no deadline when its window gets no frames

Written first and blind, from issue #2569 (its "What was seen", "The bench has no deadline once its warm-up frames are
drawn" and three acceptance criteria), the design and the base commit `212f16d09`, by a job that never saw a fix; none
existed at the base. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

What was read:

- `AGENTS.md`; `docs/technical-design.md`: Criteria to tests, both ways; Wrong programs; The edit guard (known failures);
  Tests written first; The reference Macs.
- At the base: `crates/deep-app/lists_1477.rs` (`arm`, its one 30 s timer, `print_and_exit`, `measure`),
  `tests/acceptance/1477/` (README, helpers.ts, the three test files, probe.swift, the redraft), `scripts/affected.mjs`,
  `scripts/lease`, `scripts/lanes.mjs` (`alone`, `timed`, `slow`, `reportResults`), `scripts/proof-vitest-reporter.mjs`,
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`), `scripts/known-failures.json`, `scripts/proof-change.mjs`
  (the criterion ID rule), and the suites `2635` and `1015` for style.

**Nothing here was run by this job**: it may not start cargo, open a window or run the tests. The TypeScript was
type-checked and `cover.swift` passed `swiftc -typecheck`; the base run comes after.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/2569 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2569/tsconfig.json   # type-check
```

Every test and hook carries its own timeout, so no `--testTimeout` is needed and `scripts/affected.mjs` runs them as
they are.

- **Builds.** `deadline.test.ts` and `outlives.test.ts` build the bench once per file as #1477's tests do (its
  `useBench`: `cargo test --release --locked -p deep-app --test lists_1477 --no-run`, the executable copied to a temp
  folder). `deadline.test.ts` compiles `cover.swift` with `swiftc` into the run's temp folder.
- **Real windows.** The bench opens its real window. `deadline.test.ts` then puts a black window over it for up to
  50 s (cover.swift); it reads no pixels, posts no input and needs no permission, and goes when the test ends or dies.
- **Machine.** macOS only; elsewhere every test fails with a message starting `INCONCLUSIVE:`. `main.test.ts` counts
  only on a reference Mac left alone, by the lane's rule (`scripts/benchmark.mjs`'s `judgeLimit`, through #1477's
  `laneProblem`): any other machine, battery power, Low Power Mode, a thermal state other than nominal, or a one-minute
  load above the core count before the run or at its start or end reads INCONCLUSIVE, never a pass.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/2569/` in `alone` (real windows, a release build) and all three
  test files in `timed` (they judge wall-clock deadlines, and `main.test.ts` runs timed files; under a timed grant its
  own timed request passes through). `main.test.ts` takes well over two minutes, so by `slow`'s own rule it joins
  `slow` too. This README is the instruction; the implementer makes that edit.
- **Time.** `deadline.test.ts` about 1 min after the build; `outlives.test.ts` about 1 min; `main.test.ts` as long as
  #1477's three files, with a deadline of 90 min.
- **Processes.** Each wait has its own deadline. Whatever a test started and is still there at its end is stopped by
  its PID, found in the process table by PID, start time and command; nothing is stopped by name or port.
- **Cache.** A run leaves Vitest's cache in `tests/acceptance/2569/node_modules/.vite`; delete it.

## The surface under test

The issue names the bench `lists_1477` and its `arm <name>` call, the command `node scripts/affected.mjs --timed` on
#1477's three files, and the process table. It names no time, no wording and no way to keep frames from a window.
**Each name and number below is this job's choice**, the smallest that fits what the base has. The implementer builds
exactly this.

### An arm whose window gets no frame (`#2569.aedf09ed`)

- **The stated time is 10 s.** From the moment its real window opens until its last frame, whenever an arm has waited
  10 s for its window's next frame and got none, it prints its one JSON line and exits 0:

  ```json
  { "arm": "blank", "status": "INCONCLUSIVE", "reason": "the real window got no frame for 10 s …" }
  ```

  `reason` starts with exactly `the real window got no frame for 10 s` and may go on (the frames drawn until then,
  what covers or hides a window). Other fields, as the `load` every arm line carries at the base, may be there. This
  holds in the warm-up, in the counted seconds and in a list arm's frames back, for every arm name.
- Only waiting counts: time the arm itself spends building its rows or drawing a frame is not time without a frame.
- The base's reading for a window that draws too few frames (`the real window drew N frames in 30 s`) is not judged
  here and may stay; a window that draws none now ends at 10 s, by the rule above.
- **How the test keeps frames from the window.** Nothing is added to the bench for it. `cover.swift` finds the arm's
  window in the window list by the arm's PID and, 3 s after it is first on screen (past the 60 warm-up frames, inside
  the 8 counted seconds), covers it, 40 pt past each edge, with an opaque black borderless window above every other
  window. That is what the issue's runs had ("the bench's windows were covered for part of it"; "the same executable
  measured in 13 s when its window was the topmost"): macOS gives a fully covered window no frames.
- **The deadline the test holds the arm to**: its line and its exit within 20 s of the cover going up, the stated 10 s
  and 10 s more for a loaded Mac.

### A bench whose starter dies (`#2569.b4a750e6`)

- A test run that dies can't stop what it started, and the issue's orphan was such a process. So: **when the process
  that started a `lists_1477` call ends, however it ends, that call is out of the process table within 5 s**, whatever
  its window is doing. For `measure`, that holds for it and for every arm it started.
- 5 s is this job's stated time for "outlives"; the criterion gives none, and none at all can't be read from a table.
- `starter.mjs` starts the bench as #1477's helpers do (`spawnSync` from the checkout's root, pipes, a SIGKILL
  timeout). The test waits for the bench's processes in the process table (`ps`), kills the starter by its PID with
  SIGKILL, and reads the table 5 s later.

### #1477's three files (`#2569.97a55309`)

- The command is the issue's: `node scripts/affected.mjs --timed tests/acceptance/1477/built.test.ts
  tests/acceptance/1477/record.test.ts tests/acceptance/1477/redraft/record.test.ts`, run in this checkout.
- **"Its cause named"** is read where the repo already names why a test fails on main: an entry for that test in
  `scripts/known-failures.json`'s `failures`, which the run prints as `KNOWN <test>: <entry>`. The entry must say more
  than `fails on main` and a commit: what is left after those words is the cause, and it may not be empty. What else
  the design asks of an entry (an open issue, its date, an approval) is the edit guard's to check, not this test's.
- A test printed `NEW FAIL` fails with no cause named. The test reads the run's own lines (`NEW FAIL`, `KNOWN`,
  `INCONCLUSIVE`, `BLOCKED`, `INVALID`, `LISTED`, and the summary's count of passed tests); it reads no log file.
- The number of tests is counted from the three files' `it(` lines (14 at the base, the issue's "14 tests"); every one
  must be among the passed or the KNOWN.

## Criteria and tests

Every test is a test of a fix, so its wrong program is the merge base (`212f16d09`).

| Criterion | Test | Fails on the merge base because |
|---|---|---|
| `#2569.aedf09ed` An arm whose window gets no frame for a stated time prints INCONCLUSIVE with the reason and exits; it never waits without a deadline | `deadline.test.ts`: `arm blank` in its real window, covered 3 s after it opens: within 20 s of the cover it has printed one line reading INCONCLUSIVE for arm `blank`, whose reason starts `the real window got no frame for 10 s`, and exited 0 | past its warm-up frames `arm` has no timer, so it waits in the app's run loop: no line and no exit in 20 s, and the test stops it by its PID. Covered before 60 frames, the base prints its 30 s line, which is late and worded otherwise |
| `#2569.b4a750e6` No `lists_1477` process outlives the test run that started it | `outlives.test.ts`, first test: `arm blank` under the starter; 5 s after the starter is killed the arm is not in the process table | an arm nobody waits for runs on through its warm-up and its 8 counted seconds at least, and for good when its window gets no frames |
| the same | `outlives.test.ts`, second test: `measure --out <file> --arms blank` under the starter; 5 s after the starter is killed neither `measure` nor its `arm blank` is in the process table | `measure` waits for its arm, which runs on as above |
| `#2569.97a55309` On a reference Mac left alone, #1477's three test files pass on main, or each failing test has its cause named | `main.test.ts`: the issue's command, here; the run ends within 90 min and leaves no `lists_1477` process; none of #1477's tests is a NEW FAIL; each KNOWN one has its cause in `scripts/known-failures.json`; passed and KNOWN together are all of them | the issue's table: of #1477's 14 tests 11 fail on main, 6 of them `Test timed out in 5000ms`, and `scripts/known-failures.json` names none of them, so they print as NEW FAIL |

## Readings where the issue leaves a choice

- **"Gets no frame"** is a real window that macOS stops drawing, made the way the issue saw it happen, by covering it.
  The test adds no switch to the bench and nothing stands in for the window.
- **"A stated time"** is one number for the whole arm, 10 s: longer than any gap between two frames of a window that
  is drawing, on a loaded Mac too, and short of the base's 30 s.
- **"The test run that started it"** is the process that started the bench. The issue's orphan outlived a vitest run
  whose worker had started it; a killed starter is that case made on purpose.
- **"Pass on main"**: the test runs in the checkout it is in. Before the fix that is the merge base, which is main;
  after it, the change that becomes main.
- **"Left alone"** is the lane's rule on the machine and its load. `main.test.ts` checks it before it starts the run,
  so a run of well over a quarter of an hour isn't started where it can't count, and again with the load at the run's
  start and end.
- **A run that leaves a bench behind** is not a run whose files passed: `main.test.ts` follows every process the run
  starts in the process table and fails when a `lists_1477` among them is still there 5 s after the run ended, naming
  `#2569.b4a750e6`. On a Mac left alone the base may leave none, so this check is not that criterion's proof; the
  starter tests are.

## What these tests can't judge

Each of these reads INCONCLUSIVE or BLOCKED, or is left unproven and said so. None is a pass.

- **Whether the cover kept frames from the window.** No process can read another's frames. If the covered arm still
  reads `measured` or `missed`, the cover kept nothing from it and the test fails `INCONCLUSIVE: the cover kept no
  frame from the window`. So does an arm that ends before the cover is up, and a window the cover never finds.
- **`swiftc` missing**, or `ps` unreadable: `BLOCKED: …`.
- **A locked or sleeping screen** during `deadline.test.ts`: the window draws no frame from the start, and the test
  then judges the same rule from the window's opening; it can't tell that case apart from the cover's.
- **Arms other than `blank`** under the cover, and the calls `access`, `sort`, `soak`, `offsets`, `back` and
  `remeasure` under a dead starter: not run here. `arm blank` and `measure` are the ones the issue saw.
- **`scripts/affected.mjs` held by an orphan's pipes** (the issue's 53 minutes): not made on purpose here. It is read
  through its cause, a bench that outlives its starter, and through `main.test.ts`'s deadline.
- **Whether the Mac was in use or the bench's windows were covered during `main.test.ts`'s run**: only the machine and
  its load are read. A covered arm reads INCONCLUSIVE in #1477's own tests, which this test then reads as INCONCLUSIVE
  or as a NEW FAIL, never as a pass.
- **A run with no grant, stopped, or with no summary line**: INCONCLUSIVE or BLOCKED by what it printed.
- **Whether a named cause is the true cause**: the entry's words are read, not checked against the failure.
