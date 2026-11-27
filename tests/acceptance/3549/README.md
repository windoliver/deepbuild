# Acceptance tests for #3549: a build outside a run takes a turn on the machine's pool

Drafted blind, before any implementation, from these inputs only:

- issue #3549 (its Why, Scope, seven acceptance criteria, Proof and Not in scope) and its one comment, which records
  the owner's answer as (a): the ceiling as drafted, 4 on the Mac and 6 on the Linux machine, and a build's memory at
  a run's, 8 GiB on the Mac and 24 GiB on the Linux machine. The suite holds (a);
- the two design sections the issue links, as the base has them: `docs/parallel-proof.md` section 6 (Scheduling) and
  section 13 (Capacity), and of section 12a the bullet that says what `throttle.mjs window` runs;
- the issues #3549 names, for the words it cites: #2673, #3221, #3238, #3478, #3510, #3534, #2744 and #3334;
- `AGENTS.md` and `CONTRIBUTING.md`;
- the base commit `2edb19ff4`, for call shapes and conventions only: `scripts/throttle.mjs` (the CLI, `acquire`, the
  log's entries, tables of a test's own, the load sampler), `scripts/lease`, `scripts/wait-ratchet.mjs`, the start of
  `scripts/repo-rules.mjs`, `scripts/budget-window.mjs` and `scripts/lanes-lists.mjs`, how `scripts/proof-change.mjs`
  and `scripts/proof-runs.mjs` read tags and twins, `tests/takes-timed.test.mjs`, and for shape the suites `3221`
  (whole), `3238` (README, helpers and its four throttle tests), `2924` (helpers), `2902` (`queue.test.mjs`), `1116`
  and `2674` (how each runs a window) and `1832` (the line form of a twin). `2980`, `2744` and `3334` I only listed.

No test imports the code under test: `scripts/throttle.mjs` and `scripts/lease` run as processes, found from the test
files' own place in the tree, so the suite runs in any copy of the tree. Per AGENTS.md the implementing agent doesn't
edit these files; a dispute goes to a blind redraft. The suite needs no line anywhere else in the tree, and no
`lane.json`: every test has a table and a sandbox of its own.

## Run

```sh
node scripts/throttle.mjs test --wait 600 -- node --test tests/acceptance/3549/*.test.mjs
```

The files must run under `node --test`: only inside a test run does a table of a test's own exist (section 6). The
suite needs no `node_modules`. `compiles.test.mjs` needs cargo and a Rust toolchain (it adds `~/.cargo/bin` and
`/opt/homebrew/opt/rustup/bin` to its PATH itself) and works offline; without cargo it fails, saying `BLOCKED`.

With the files side by side the suite took 80 s here on a throwaway guess at the change, all 15 tests passing, and
97 s on the base, at a 1-minute load of 17 to 37 on 18 cores. One file after another it would be about two and a half
minutes, by the tests' own times; it wasn't run so. `turn.test.mjs`'s first test takes 73 s, which the criterion's own times set (30 s, then a build of 40 s).
The others took 1 to 21 s each: `log.test.mjs` 21 s, most of it a stall bound of 12 s, and `compiles.test.mjs` 17 s
(33 s beside fifteen other runs). A test whose program leaves a request waiting adds its bound, 60 or 120 s.

**The machine's table at `~/.deepbuild/throttle/` is never read or written.** Every process a test starts gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's sandbox under the system's temporary folder, a `HOME`
and `TMPDIR` there, and no `DEEP_` variable of the test run's, nor its `NODE_TEST_CONTEXT`, `CARGO_MAKEFLAGS`,
`MAKEFLAGS` or `MFLAGS`, unless the test sets one. Each request starts in a process group of its own. At a test's end
every stub is told to stop by a file, and 5 s later what is left is stopped by its process group's ID; the 400 s build
of criterion 1 ends that way. A load sampler is stopped by its PID once its sample is in. Nothing is stopped by name
or port. Failure messages write the checkout `<checkout>`, the sandbox `<sandbox>` and every home folder `~`.

## The surface

What the tests drive, and what they assume where the issue is silent:

- **A build** is `node scripts/throttle.mjs build --wait <min> -- node stub.mjs <name> <mode>`, asked by a process
  under no grant. The stub notes its start, with the `DEEP_THROTTLE` and `CARGO_MAKEFLAGS` it was given and whether the
  jobserver those name is a named pipe, and its end; it ends at once, holds until a stop file, runs for a number of
  seconds, runs a real `cargo build --offline`, or starts other commands when the test says. A command "starts" when
  its stub notes its start; "A starts when B ends" is read on the two stubs' own notes.
- **A top-level build's command** is given `DEEP_THROTTLE=build:<id>`, and the log's `granted` entry of that ID has
  `class: "build"` and `grant: "top-level"`, as on the base (section 6, Inherited grants). Assumed.
- **A turn** is read from what the issue's Scope gives it, a jobserver of the build's own: `CARGO_MAKEFLAGS` naming
  `--jobserver-auth=fifo:<path>`, as section 6 words a job's (assumed for a build), a named pipe, another for each
  build. Where a test needs a turn to wait, it holds every token of the pool. The log's `turn` entries are read only
  for a run's jobs (criterion 4), where the base writes them.
- **The pool** is a core less one of the test's own readings (`DEEP_THROTTLE_READINGS`), as section 6 has it for a
  run's jobs. **The ceiling** is 4 on macOS and 6 elsewhere, and **a build's memory** 8 GiB on macOS and 24 GiB
  elsewhere, by `process.platform`. **The memory rule** is section 6's with a build in a run's place: one more build
  is admitted while the readings' memory, less a build's for each held build still settling, leaves a build's.
- **No grant** is the throttle's own reading, as on the base: its output's `INCONCLUSIVE no grant: ` line, exit 3, the
  command never started, and the log's `timeout` entry.
- **A request in line** is read from the throttle's own count (section 6, #3240): `node scripts/throttle.mjs load`
  appends a sample to `load.log` in the table's folder, whose `waiting.build` counts the build requests in line.
  Assumed: a build that waits for its admission is such a request. The table's file is not read.
- **A plain timed request pending, or a timed grant held**, is read from what it does (section 6, Drain): a top-level
  `bay-pair` request with a wait of 0, a class no test here holds, is refused then and runs otherwise. **A window's
  request pending** is read from the sampler's `waiting.timed`: a wait doesn't run down while a window is pending
  (section 12a), so a request with no wait would wait there and never be refused.
- **A timed request and a window are asked under a test grant of the test's own**, since a top-level one also waits for
  the machine's load below its cores, which a test can't set (#3221's README says the same). A nested one drains all
  the same. It waits on a grant outside its chain that the test lets end.
- **A window** is `node <copy>/scripts/throttle.mjs window --wait 10`, from a copy of the whole `scripts/` folder whose
  `budget-window.mjs` is the stub (section 12a: a window runs `scripts/budget-window.mjs`). It "opens" when that stub
  starts or the log reads `window-open`.
- **`scripts/lease`** runs from that copy, which has no `packages/` beside it, with a `PATH` that holds `node` and the
  system's tools and no `deep` (else the test is `BLOCKED`), so it runs its command under the throttle alone;
  `DEEP_LEASE_WAIT` sets its wait. Assumed from the issue's title and Scope (A turn; What passes through): outside a
  run, a build the script asks for is admitted and takes a turn like any other, though the script asks `--turns 0`.
- **The log's `waited`** is a number of milliseconds on a top-level request's `granted` and `timeout` entries; an
  entry is its request's by `pid`, the throttle process's.
- **"Within 1 s of the test's own clock"** (criterion 6). A test can't see the moment a request asks: it is after the
  request's process starts and before a sample counts it in line. So each wait is known between two readings of the
  test's clock, and `waited` must lie within 1 s of that span. A request that timed out on `--wait` waited its limit,
  so only there does the span's low end come from the limit.
- **Sections 6 and 13** are read as each stating all four facts (the issue's criterion says "sections 6 and 13 ...
  state", as #3221's said "each"), matched loosely: `#3549`; that a build is admitted (`admitted build`, `a build ...
  is admitted`, `admission of a build`); that an admitted build takes or waits for a turn; the ceiling, in one clause
  with builds; the trust given up, with the issue's own words `what a build produces`. Section 6's class table gives
  `build` 4 and 6. The capacity table's build row gives 4 and 6 and says `ceiling`, `at most`, `up to` or `no more than`.

## The tests

| Criterion | File and test | What it holds |
|---|---|---|
| 1 `#3549.b6b01435` | `turn.test.mjs`, the first | A pool of 4 (readings of 5 cores, at load 50, which an admission doesn't read). A stub build of 400 s is under way; a second, of 40 s, asks 30 s after the first asked. The second's request ends within 60 s of its asking, with 0, having run its 40 s beside the first. Each ran under a build grant of its own that the log shows granted, and a jobserver of its own, a named pipe. Then, so that a throttle that grants everything fails: three more builds get under way, a fifth asked beside the four hasn't started once two requests asked after it have run and ended, and it starts when one of the four ends. Its diagnostic prints the timeline. |
| 1 `#3549.b6b01435` | `turn.test.mjs`, the second | A pool of 1. A build holds the token. Two more ask with a wait of 0.05 min, one by `throttle.mjs build` and one through `scripts/lease`. A test request asked after them waits out its own 0.1 min (kept out by a load above the cores). Neither build has started, and neither has left the line. When the token goes back each runs, ends with 0, never read INCONCLUSIVE, and had a build grant and a jobserver of its own. |
| 2 `#3549.13a91455` | `compiles.test.mjs` | A pool of 2. Two real `cargo build --offline`s, each of its own copy of a fixture workspace of 10 crates (one that every other needs, 8 independent leaves, a binary), every crate seeded fresh so each must compile, asked at once. The process table is read once a second. Each build exits 0 and compiled all 10 crates, each build's compilers were seen, no look counts more than 2 compiler processes, and some look saw both builds compile. A third build, asked with a wait of 0.05 min once both are under way, starts only when one of the two has ended, and never reads INCONCLUSIVE. |
| 3 `#3549.349bc6a3` | `admission.test.mjs`, the first | The ceiling: 4 builds held on macOS, 6 elsewhere, on readings with memory for all, two tokens more than the ceiling, and a load of 1000. All of them are admitted. One more with a wait of 0 is refused at once (`INCONCLUSIVE no grant`, exit 3, never started, a `timeout` in the log). Two more that wait stand in line, one after the other, by `throttle.mjs load`'s count. When a held build ends the first asked starts, not before that end, and the second still stands in line; when another ends the second starts, not before that end. |
| 3 `#3549.349bc6a3` | `admission.test.mjs`, the second | The memory rule: 3 builds held, under the ceiling on either machine, on readings of three and a half builds' memory. All three are admitted. The rest is as above: a fourth has half a build's memory left; when a build ends, one has room. |
| 4 `#3549.c607aa63` | `passes.test.mjs`, the first | Every build slot held: builds asked with a wait of 0 until one is refused, the first of them the caller's, whose pool has as many tokens as the ceiling. A second caller holds a test grant. Each caller's command then asks `throttle.mjs build --wait 0`. Each request starts and ends with 0, holds its caller's grant as `DEEP_THROTTLE`, shows `passed` through that grant in the log and no `granted`, `timeout` or `turn` of its own, and has no jobserver but its caller's. |
| 4 `#3549.c607aa63` | `passes.test.mjs`, the second | A pool of 1. An admitted run (`DEEP_THROTTLE_RUN=0 throttle.mjs test`) whose job holds the token. A build request of the run asks (the log's second `passed`), then `scripts/lease node stub.mjs lint exit`. The lint starts while the job holds the token and the build request hasn't started; it holds the run's grant; the log shows a third `passed`, one `turn` of the run and no build grant or timeout. When the token goes back the build request runs, and the run ends with 0. |
| 5 `#3549.7ba8246d` | `timed.test.mjs`, the first | No build held, 4 tokens free. A timed request, pending behind a test grant outside its chain: a build with a wait of 0 is refused, and one that waits is asked. The grant outside ends and the timed command holds the grant: a build with a wait of 0 outside the chain is refused, a build request of the timed command runs, and the build that waits has not started. When the timed command ends, that build starts, not before that end. |
| 5 `#3549.7ba8246d` | `timed.test.mjs`, the second | A pool of 1. A build holds the token and a second, admitted, waits for it. A timed request is pending when the first build ends. Three more probes are refused, one after the other, and the second build has not started. When the grant outside the chain ends, the timed command runs and ends, and then the build starts, not before that end. |
| 5 `#3549.7ba8246d` | `window.test.mjs`, the first | A build is under way and a window is asked. Two samples of `throttle.mjs load`, one after the other, count its request in line, and the window has not opened. When the build ends the window opens, not before that end, and the log reads `window-open`. |
| 5 `#3549.7ba8246d` | `window.test.mjs`, the second | A pool of 1. A build holds the token and a second, admitted, waits for it. A window is asked and its request stands in line (two samples) when the first build ends. The second build is dealt the token and starts while the window has not opened; two more samples count the window's request in line and it still has not opened. When the second build ends the window opens, not before that end. |
| 5 `#3549.7ba8246d` | `window.test.mjs`, the third | A pool of 1, at a load of 1000. A build holds the token; a second asks with a wait of 0.05 min, and a test request asked after it waits out its own 0.1 min: the second build is still there and has not started, so it was admitted and waits for its turn. The build that holds the token then asks for the window itself, with a wait of 0.05 min: the waiting build can't have its turn while that request stands, so it can't end. The window's request runs out its wait (exit 3, `INCONCLUSIVE no grant`), the window never opens, and the waiting build starts only when the token's holder ends. |
| 6 `#3549.98c012e3` | `log.test.mjs` | Every build slot held (builds asked with a wait of 0 until one is refused). The refused one's `timeout` entry carries `waited`, no more than its process lived. Then a build with a wait of 10 min and one with a stall bound of 0.2 min stand in line, each by `throttle.mjs load`'s count; one with a wait of 0.05 min times out; a held build is let end. The `timeout` entry of the 0.05 min request, the `granted` entry of the 10 min request and the `timeout` entry of the stall request (12 s after the grant changed hands) each carry `waited` within 1 s of the span the test's clock gives the wait. |
| 7 `#3549.bf86e1ad` | `design.test.mjs`, two tests | Section 6, then section 13: each names #3549 and states that a build is admitted, that an admitted build takes a turn, the ceiling of builds, the trust given up and none in what a build produces. Section 6's class table gives `build` 4 and 6; the capacity table's build row gives 4 and 6 and reads as a ceiling. |

## Wrong programs

Each is the work with one fault, in a sentence to plant from. The twins are the implementer's to add
(`twins/<name>/lines.json` and `twins.json`).

| Criterion | Wrong program | The test that fails, and what its message names |
|---|---|---|
| 1 | The ceiling of builds is 1 on both machines: top-level builds are served one at a time (the criterion's). | `turn.test.mjs`, the first: "the second build, `node throttle.mjs build --wait 10 -- node stub.mjs second sleep 40` (throttle pid …), had not ended: not within 60 s of asking. It waited behind the first, of 400 s". The second fails too, naming the build that left the line. |
| 2 | A turn's jobserver is filled with the pool's whole count when it is made, a token less the turn's own, and is never taken back or counted as lent (the criterion's). | `compiles.test.mjs`: "at look … (+… s): 4 (first 2, second 2), 4 compiler processes ran at once, more than the pool's 2 tokens; … of … looks were above 2", naming each look. |
| 3 | A build request is admitted whatever the ceiling and the memory rule say (the criterion's). | Both tests of `admission.test.mjs`: "the build request `node throttle.mjs build --wait 0 -- node stub.mjs no-wait exit` (throttle pid …), past the ceiling of 4 builds, started: it was admitted at once"; the second says "for which the memory rule leaves no room". |
| 4 | Inside an admitted run a request made with `--turns 0` waits for a turn like any other. | `passes.test.mjs`, the second: "the command scripts/lease runs inside the admitted run, `scripts/lease node stub.mjs lint exit` (throttle pid …), didn't start at once while the run's job held the pool's one token: it waits". For the first test: a build request under a caller's grant asks for an admission of its own; it names that request and "it ended with 3". |
| 5 | A turn is dealt though a timed request is pending. | `timed.test.mjs`, the second: "the admitted build `node throttle.mjs build --wait 10 -- node stub.mjs waits-its-turn exit` (throttle pid …) was dealt the freed token while the timed request was pending". Two more: a build is admitted though a timed request is pending (`timed.test.mjs`, the first: the build request asked with a wait of 0 "wasn't refused at once …: it still waits, admitted or in line"); a window takes an admitted build that waits for its turn as waiting, as a plain timed request does (`window.test.mjs`, the third: "the window opened while the admitted build … still waited for its turn: an admitted build had not ended"). |
| 6 | `waited` is the request's wait limit in milliseconds, its `--wait` or `--stall` (the criterion's). | `log.test.mjs`: "the log's granted entry for the top-level request `node throttle.mjs build --wait 10 -- node stub.mjs granted-after-a-wait hold` (throttle pid …) carries waited 600000 ms, not within 1 s of this clock: the request waited between … and … ms". A limit written in minutes wasn't run: 0.05 and 10 lie more than 1 s under the spans of the 0.05 min request and of the granted one. |
| 7 | The two sections are left as the base has them. | Both tests of `design.test.mjs`: "section 13 doesn't state: this issue, #3549; the admission (a build is admitted, an admitted build); the turn (an admitted build takes or waits for a turn); the ceiling (of builds); none in what a build produces", and the same of section 6. |

No test that drives the throttle passes on a throttle that grants everything at once or on one that prints nothing and
starts nothing: each holds something that must wait or be refused, and something that must run.

## On the base

`BASE-FAILURE.txt`: the whole suite in one run on the base, `2edb19ff4`, under the machine's test grant, on the
Mac. Of 15 tests 10 fail and 5 pass. Every test of criteria 1, 2, 3, 6 and 7 fails, at an assertion of its own:

- **Criterion 1.** The first test: 60 s after asking, the second build had not started; the first was under way. That
  is the criterion's base claim, as far as the bound lets it be seen. The second test: a build asked beside the one
  that holds the base's one slot left the line when its 0.05 min was over. On the Linux base, whose count is 2, the
  second build starts at once, and both tests fail later: the first where a build's command has no jobserver, the
  second where a build started beside the one that holds the pool's token (not run).
- **Criterion 2.** 8 compiler processes at once at look 8 on a pool of 2: the base gives a build's cargo no jobserver.
- **Criterion 3.** Only 1 of the ceiling's 4 builds, and 1 of the 3 the readings have memory for, was admitted.
- **Criterion 6.** The `timeout` entry of the request refused at once carries no `waited`.
- **Criterion 7.** Neither section states any of the facts but that a trust is given up, which each says of runs.

Criteria 4 and 5 read "as on the merge base". What the base already meets, and where it can't:

- **Criterion 4**, both halves: `passes.test.mjs`'s two tests pass on the base.
- **Criterion 5, "with a timed request pending, no build is admitted" and "with a timed grant held, no build outside
  its chain runs":** `timed.test.mjs`'s first test passes on the base.
- **Criterion 5, "no turn is dealt":** the base deals turns to a run's jobs only. `timed.test.mjs`'s second test
  passes on the Mac base, where the one build slot keeps the second build out as a turn would. On the Linux base the
  second build has a slot and runs at once, so the test fails at "it took no turn" (not run).
- **Criterion 5, "a window opens only once every admitted build has ended":** for a build that is under way the base
  meets it, and `window.test.mjs`'s first test passes. For a build admitted and waiting for its turn the base has no
  such build: a build asked while the slot is held isn't admitted, and a pending window keeps it out. So the second
  test fails on the base ("the window opened before the build … had had its turn") and the third ("the build … left
  the line … it wasn't admitted"). Those two fail on the base by its nature, not by a fault of it.

## What I ran

Three grants of the machine's `test` class, each `node scripts/throttle.mjs test --wait 600 -- node <a script>` that
made the runs below one beside the other. The first waited about 5 h 7 min and ran 8 min; the second waited about
1 h 32 min and ran 3.7 min; the third was granted at once and ran 1.6 min. `BASE-FAILURE.txt` is the third's base run.

**A throwaway guess at the change**, in a copy of the tree outside the checkout: the base's `throttle.mjs` with a
ceiling of 4 and 6, a top-level build admitted by section 6's memory rule without the load and then given a turn of
the pool as a run of one job, `waited` on the two log entries, and the two sections reworded. The suite passed on it:
its 14 tests twice in the second grant, and all 15 in the third. The first grant found two faults of the first draft,
since corrected: a window's pending request was read from a probe that can't be refused while a window is pending, and
the fixture's leaves each evaluated the first crate's constant again, so a build took minutes. The second found a
third: the wrong version that takes a build waiting for its turn as waiting passed both window tests, by a race the
second test leaves open (once the token frees, the build can look before the window does). `window.test.mjs`'s third
test was added for it, and that version fails it. One wrong version was itself planted wrong in the first grant (the
admission that ignores the ceiling sat behind the base's own check of a request's limit) and was planted again.

**Wrong versions of the guess**, each one fault, each run against the file it is for; every one failed:

| Fault | Fails |
|---|---|
| the ceiling is 1 | both tests of `turn.test.mjs` |
| a turn's jobserver is filled with the pool's count less one and never taken back | `compiles.test.mjs`, at look 14: 4 (first 2, second 2) |
| a build is admitted whatever the ceiling and memory say | both tests of `admission.test.mjs` |
| a build's admission reads the load | `admission.test.mjs`, the first: only 1 of 4 admitted |
| the newest request in line is served first | both tests of `admission.test.mjs` |
| `--turns 0` is ignored inside a run | `passes.test.mjs`, the second |
| a build request under a caller's grant asks for an admission of its own | both tests of `passes.test.mjs` |
| a top-level build asked with `--turns 0` takes no turn | `turn.test.mjs`, the second |
| a turn is dealt though a timed request is pending | `timed.test.mjs`, the second |
| a build is admitted though a timed request is pending | `timed.test.mjs`, the first |
| a window waits for no build | all three tests of `window.test.mjs` |
| a window deals no turn | `window.test.mjs`, the second |
| a window takes a build that waits for its turn as waiting | `window.test.mjs`, the third; the first two pass |
| `waited` is the wait limit, in milliseconds | `log.test.mjs`, at the granted entry: 600000 |
| every request is granted at once | all 13 tests that drive the throttle |
| `throttle.mjs` prints nothing and starts nothing | all 13 tests that drive the throttle |
| the two sections as the base has them | both tests of `design.test.mjs` |

The guess, its wrong versions and the runs' outputs were deleted when the job ended. They are no part of the suite:
the twins are the implementer's.

**Lints**, each with no finding in this folder: `node scripts/wait-ratchet.mjs` (it reads the merge base with
`origin/main` to list what has landed), `node scripts/repo-rules.mjs`'s secrets check, and the studied-names check.

**Not run:** the suite on the Linux machine; `scripts/affected.mjs`, `scripts/proof.mjs`, a lane or a preflight; a twin
in its line form.

## Gaps and assumptions

- **Stub builds**, but for criterion 2. A stub build takes no token from its jobserver, so a lone build's lent tokens
  go back within a second of another's asking. A real cargo that has work for every lent token keeps them until its
  own work thins (section 6, A turn's compiles), so beside such a build a second can wait longer than criterion 1's
  60 s. The criterion says stub builds; nothing here holds that time for real ones.
- **"Asks 30 s later"** (criterion 1) counts from the first build's asking, once its command has started; the 60 s,
  from the second's asking to its request's end, both on the test's clock.
- **The fifth build of criterion 1's test** waits for its admission on the Mac (the ceiling is the pool's 4) and for a
  turn on the Linux machine (the ceiling is 6). That it "has not started" is read after two requests asked later have
  run and ended, not from a count of the line.
- **Criterion 2's pool is 2**, not 4: with two builds under way neither has a token to lend, so a jobserver that holds
  more shows at once, and a third build must wait. The look is once a second, as #3221's: a count above the pool
  that lasts less than a second can be missed. cargo's own probes of rustc hold no token and aren't counted.
- **The memory rule** (criterion 3) is tested through the settling reserve alone: on a test's own readings nothing
  else makes room when a build ends. A build older than 5 minutes, and readings that change, aren't tested.
- **"In order"** (criterion 3) is two requests.
- **Criterion 4's first test** holds a caller's build grant and a caller's plain test grant. A request under a turn of
  an admitted run is #3221's and isn't tested here.
- **Criterion 5** uses nested timed requests and windows only (The surface). "No turn is dealt" and "every admitted
  build" are tested for a build's turn; a run's jobs are #3221's. That a build was admitted before the timed request
  or the window asked is taken, in `timed.test.mjs`'s second test and `window.test.mjs`'s second, from two requests
  asked after it having run and ended first: were it not, those tests would still pass on a right program and would
  show less. `window.test.mjs`'s third shows it: the build is still there once a longer wait than its own has run
  out. The window that "opens" is a stub in the place of `budget-window.mjs`.
- **Criterion 6** is tested for build requests. Its 1 s is held about a span, not a point (The surface): on the
  Mac the spans were 0.2 to 1.6 s wide, so a `waited` wrong by up to that much more than 1 s would pass. A `--wait`
  request that timed out waited its limit, so a throttle that wrote the limit only there would pass that entry; the
  stall request's entry and the granted entry both fail it.
- **Criterion 7** is matched by words, not meaning, and takes "sections 6 and 13 state" as each.
- **Not tested**, as no criterion names them: the order of turns between two waiting builds, or a build and a run's
  job (Scope: a build is a run of one job); a held grant's bound (#2744) for a build under a turn; `bay-pair`, but as
  the probe's class; a `test`, `bay-pair` or `timed` request's `waited`; the load sampler's counts of an admitted
  build that waits for a turn; a build's turn given back when its holder is killed.
- **The Linux machine.** Every number that differs is read from `process.platform`, but the suite ran only on the Mac.
- **The issue's Proof** asks for each planted program failing first, and a 24-hour reading on the Mac. The twins are
  the implementer's; the reading is no test.
