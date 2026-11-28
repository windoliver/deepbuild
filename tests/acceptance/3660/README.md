# Acceptance tests for #3660: an admitted build's wait for its pool turn runs on its caller's bound

A blind job wrote these tests before any work on #3660 existed, from these inputs only:

- issue #3660 (its Why, the owner's decision for option A on 2026-11-27, its surface paragraph and its six criteria),
  and for the words it cites #3549, #3588, #3510, #3334 and #3221;
- `docs/parallel-proof.md` section 6 (the grant-wait table, "Builds on the pool", stall waits), section 7a's "The hour"
  and section 13; `docs/technical-design.md` Dogfooding; `AGENTS.md`; `CONTRIBUTING.md`;
- the base `3359cc775` (PR #3591's head), for call shapes only: `scripts/throttle.mjs` (the CLI, `acquire`, the log's
  entries, the table file, `DEEP_THROTTLE_TABLE`, `DEEP_THROTTLE_READINGS`), `scripts/affected.mjs` (its jobs, `ready`,
  the timed phase), `scripts/lanes-lists.mjs` (`redrafted`, `byHand`), `scripts/lease`, the ratchets, and the suites
  `3549`, `3588`, `3588-redraft-3549`, `3567`, `2820`, `3334` for their helpers and conventions.

No test imports the code under test but `lanes.test.mjs`, which imports `scripts/lanes.mjs`, the lists' public entry.
`scripts/throttle.mjs` and `scripts/affected.mjs` run as processes. The helpers reuse older blind suites' helpers by
relative import and never edit them: #3549's sandbox, stub and request helpers (criteria 1 to 3, 5, 6), and #3588's
fixture, #3567's run, holder, readings and process-group listing (criterion 4). Per AGENTS.md the implementing agent
doesn't edit these files; a dispute goes to a blind redraft.

## Run

```sh
node --test tests/acceptance/3660/*.test.mjs
```

They must run under `node --test`: only inside a test run does a request keep a table of its own (section 6).
`hour.test.mjs` needs cargo and a Rust toolchain (#3588's fixture builds a one-crate workspace offline) and the
checkout's `node_modules` (#1115's tree links them). On the Linux machine (20 cores, 1-minute load about 30) the six
files side by side took 262 s on the base and about 185 s on the throwaway right program below; `hour.test.mjs` is the
long one (183 s right, 261 s base, where its run goes to its 4 min 20 s limit). The others take 25 to 100 s.

**The machine's table at `~/.deepbuild/throttle/` is never read or written.** Each test has its own table folder
(`DEEP_THROTTLE_TABLE`), `HOME` and `TMPDIR` in a sandbox (#3549's or #3567's), and readings of its own through
`DEEP_THROTTLE_READINGS`. Every request and run starts in a process group of its own and is stopped after its test by
that group's ID (or, for #3549's stubs, first by a stop file); nothing is stopped by name or port. Failure messages
write the sandbox `<sandbox>`, the checkout `<checkout>` and home folders `~`. No `lane.json`: every test has its own
table, and the line test held its 8 s turns with over 3 s to spare beside the rest of the suite.

## The surface, and what I assumed where the issue is silent

- **A pool of 1 token** is readings of 2 cores (`{"memory": 1 TiB, "load": 0, "cores": 2}`): the pool is a core less
  one of a test's own readings (section 6). The memory leaves room for every build, so build slots stay free.
- **A stub build** is `node scripts/throttle.mjs build --wait 10 -- node stub.mjs <name> sleep <s>` (#3549's stub). It
  "holds the pool's token" from its command's start: a build's command starts only once it has its turn.
- **"Asked 10 s later"** (criteria 1, 2) is 10 s after the holder asked, once its command has started.
- **Admitted** is read from the log's `granted` entry of the request's process, class `build`.
- **Exits as an admission timeout does**: exit 3, a line starting `INCONCLUSIVE no grant: `, the command never started,
  and a `timeout` entry in the log after the `granted` one, carrying `wait: 0.5` or `stall: 0.5`.
- **"The deadline set when the request asked still holds"** (the decision's words): the `--wait 0.5` and `--stall 0.5`
  builds may not give up before 30 s after asking (for the stall, its own admission is the last change of hands).
- **"The table holds no grant or request of its process"** is read from `table.json` the moment the build's throttle has
  exited, and then from the log for 3 s: a leftover admission the table only drops once it finds its holder gone shows
  as a `released` entry with `reason: "holder gone"` of that process (the holder's turn looks at the table each second).
- **Criterion 3's line**: the first holder is under way before the second asks, each next one is admitted before the
  next asks, and the build under test asks last; "after them" is read on the stubs' own notes (its command starts no
  sooner than the third's ends). The test also checks that the build under test waited more than its 12 s stall,
  else the scene proved nothing.
- **Criterion 4's moment** "once the run has given back its test grant and before its timed phase". With one token
  for the whole run, the run's ~30 lint jobs and its untimed job take their turns one at a time, and the untimed file
  (which waits for the test's go file) can hold the only token while lints wait behind it; and a newly admitted stub
  build, whose run has had no time on turns, goes before them all (section 6), stopping the run in its untimed phase.
  So the readings give a pool of 63 while the untimed jobs run, and are replaced (by a rename, so no reader sees half a
  file) with the pool of 1 once the untimed file's job is the only job of the run left and holds its turn. That is read
  from the run's process group: the job throttles (`throttle.mjs <class> --wait 30 -- …scripts/lease …`, the base's
  job shape) and the table's turns. Then the stub build (#3567's `hold`) asks and is admitted, its command not started;
  then the go. When the untimed file's job gives the token back the stub build takes it and holds it to the test's end
  (longer than 10 minutes' worth of the run); the run gives back its test grant, and its rebuild is admitted (the log's
  `granted` build of the process that released the test grant) and waits for its turn.
- **Criterion 4's outputs** are #3588's: the untimed file's `FAIL` line naming its planted failure, the timed file's
  `INCONCLUSIVE` line with `not started: the run reached its bound of 3 min` and no other state, no `timed-ran` note,
  the binary never put back in the watched `DEEP_BIN_DIR`, a `FAIL affected:` summary and exit 1, within 4 minutes of
  the run's start (its own limit stops it at 4 min 20 s).
- **Criterion 5** is held through `scripts/lanes.mjs`' `redrafted` and `byHand` (it re-exports lanes-lists'). The file
  was redrafted blind on 2026-11-28 on the base `9bbe0f24c`, which holds #3694. There the lists already keep 3549's
  `passes`, `timed` and `window` files by hand with `tests/acceptance/3549-redraft-3694/` in their place, so the first
  draft's "every other file is neither redrafted nor by hand" failed on the base's own lists. It now holds:
  - `turn`, `window` and `compiles` of `tests/acceptance/3549/` map to `tests/acceptance/3549-redraft-3660/` and are by
    hand. Each redraft file is there, is not by hand and is mapped no further.
  - `passes` and `timed` map to `tests/acceptance/3549-redraft-3694/` and are by hand, and that folder's `passes` and
    `timed` files are not by hand, as on the base.
  - `admission`, `log` and `design` are neither redrafted nor by hand, as on the base.
  - `tests/acceptance/3549-redraft-3694/window.test.mjs` is by hand, and if `redrafted` names it, it names
    `tests/acceptance/3549-redraft-3660/`. **This is my choice.** `redrafted` gives a file one folder, so 3549's
    `window` file now names the #3660 redraft and no longer the #3694 one. But the #3694 folder's window file is a
    test file the lanes would still run. Its third test has a build asked with `--wait 0.05` wait for its turn past
    that wait, which option A reverses: the criterion's own reason for the three originals. So it must not run as it
    is. It is kept as written, by hand only, as the originals are, and `3549-redraft-3660/window.test.mjs` holds its
    three tests under both #3694 and option A. The folder as a whole can't go by hand: its `passes` and `timed` files
    still run.

  Not tested: that the redrafts, `3334`, `3221` and `3588-redraft-3549` pass (their own runs show that) or what the
  redrafts hold.
- **Criterion 6** is matched by words, clause by clause (backticked code is not split): the grant-wait row "An
  admitted build, for its turn" gives no `no limit`/`unbounded`-like wording and names the caller's `--wait`/`--stall`,
  a bound, a deadline or a stall; "Builds on the pool" has no turn clause with such wording, no "a stall … bounds only
  the wait for admission", a turn clause naming `--wait`, `--stall`, a stall, the caller or a deadline, and names
  #3660; 7a's "The hour" has no turn clause with such wording and one that bounds the turn by the hour, the bound or
  the time left. It is a check for the diff review, not a substitute.

## The tests

| Criterion | File and test | What it holds |
|---|---|---|
| 1 `#3660.5e80dd70` | `wait.test.mjs` | Pool of 1, a stub build of 300 s holds it; 10 s later a build `--wait 0.5` asks. Within 90 s of asking it has exited 3 with `INCONCLUSIVE no grant: `, not before 30 s, its command never started, the holder still under way; the log has its `granted` (class build, `wait: 0.5`) then its `timeout` (`wait: 0.5`, no stall); the table holds nothing of its pid, and no `holder gone` release of it follows. |
| 2 `#3660.85d33ca3` | `stall.test.mjs` | The same with `--stall 0.5`: the line `INCONCLUSIVE no grant: no build grant changed hands within 0.5 min`, the `timeout` entry's `stall: 0.5`. |
| 3 `#3660.79e21baf` | `line.test.mjs` | Pool of 1, three stub builds of 8 s each in line, then a build `--stall 0.2` (12 s). It ends with 0, never INCONCLUSIVE, its command started after the third's ended and ran; each holder exited 0 in turn; it waited more than 12 s. |
| 4 `#3660.e8808b70` | `hour.test.mjs` | #3588's fixture, `affected.mjs --timed`, `DEEP_AFFECTED_MIN=3`, the scene above. The run exits within 4 min with 1; untimed `FAIL`, timed `INCONCLUSIVE … not started: the run reached its bound of 3 min`, the timed test never ran, the binary absent. |
| 5 `#3660.a7f3d0fa` | `lanes.test.mjs` | The lists, as above (redrafted 2026-11-28 on a base that holds #3694). |
| 6 `#3660.388d9ec0` | `design.test.mjs` | The three places' wording, as above. |

## Wrong programs

Each is the right program with one fault, to plant from; the twins (`twins.json`, `twins/`) are the implementer's.

| Criterion | Wrong program | The test that fails, and its message |
|---|---|---|
| 1 | Once admitted, the build waits for its turn with no limit (the base). | `wait.test.mjs`: "the build asked with --wait 0.5, `node throttle.mjs build --wait 0.5 -- node stub.mjs asker exit` (throttle pid …), was still waiting 90 s after it asked: admitted, it waits for its turn of the pool past its own --wait 0.5". |
| 1, 2 | At the turn wait's deadline the turn request goes but the admission is left in the table. | `wait.test.mjs` and `stall.test.mjs`: "the table still held the grant or request of `…` once it had exited: its admission wasn't given back". |
| 2 | The base, as for 1. | `stall.test.mjs`: "… was still waiting 90 s after it asked: admitted, it waits for its turn of the pool past its own --stall 0.5". |
| 3 | The stall doesn't start again when a turn changes hands: in the turn wait its clock runs from the last change before admission. | `line.test.mjs`: "the build asked with --stall 0.2, `…` (throttle pid …), ended INCONCLUSIVE before its turn came, though a turn of the pool changed hands about every 8 s: its stall didn't start again when a turn was taken or given back". |
| 4 | The rebuild's turn wait has no bound (the base); or one of 30 min whatever time is left. | `hour.test.mjs`: "affected.mjs was still running 260 s after its start, past the 4 minutes it must exit within at a bound of 3 min: its rebuild, admitted, was still waiting for its turn of the pool behind the stub build". |
| 5 | The three files stay as they are in the lists. | `lanes.test.mjs`: "scripts/lanes-lists.mjs maps tests/acceptance/3549/turn.test.mjs to nothing, not to its redraft tests/acceptance/3549-redraft-3660/" (the base `9bbe0f24c` fails so). |
| 5 | The three files are mapped and by hand, and `3549-redraft-3694/window.test.mjs` is left to run. | `lanes.test.mjs`: "scripts/lanes-lists.mjs doesn't keep tests/acceptance/3549-redraft-3694/window.test.mjs by hand only: …". Not run as a plant. |
| 6 | The doc as the base has it. | `design.test.mjs`: "section 6's grant-wait table still gives an admitted build's turn no bound: \| An admitted build, for its turn (#3549) \| no limit \|". |

## What I ran

All on the Linux machine, each run in a `systemd-run --user` unit (MemoryMax=24G for whole-suite runs), in detached
worktrees of the base under `/var/tmp`, since removed.

- **The base**, the whole suite: 5 fail at their own assertions, `line.test.mjs` passes (it must: the base's turn wait
  has no bound). `BASE-FAILURE.txt` is that run.
- **A throwaway right program**, from the issue alone, in a copy of the base: `acquire` keeps the deadline it set when
  the request asked once the build is admitted (no `Infinity`); with `--stall`, the turn wait's hands are the build and
  turn grants, so a turn taken or given back starts the stall again; at the deadline in the turn wait it takes the turn
  request out and the admission grant with it, logs `timeout` as for admission and returns no grant, so the CLI exits 3
  and `affected.mjs`' `ready` (unchanged) reaches its bound. Plus the three doc rewordings, the lanes-lists mapping and
  a stand-in redraft file. The whole suite passed, 6 of 6 (the line's build had its turn at +26.1 s, turns 8.4 to 8.7 s
  apart; the wait and stall builds exited 3 at 31 s after asking; the affected run took 183 s).
- **Wrong versions of it**, each one fault, against their files:
  - the stall not started again in the turn wait: `line.test.mjs` fails, the build INCONCLUSIVE at 14 s;
  - the admission left in the table at the turn wait's timeout: `wait.test.mjs` and `stall.test.mjs` fail at the table;
  - the stall started again only when build grants (admissions) change hands, not turns: `line.test.mjs` **passes**
    (see Gaps).
- **`design.test.mjs`** also passed on a scratch copy of the doc with only the rewording, before the throwaway.
- **Lints**: `node scripts/wait-ratchet.mjs`, `node scripts/comment-ratchet.mjs` and `node scripts/repo-rules.mjs`
  report nothing in this folder (on the Mac; they report findings elsewhere in the tree that predate this suite).

- **`lanes.test.mjs`, redrafted** (2026-11-28, on the Mac, node v24.22.0, once each). On the base `9bbe0f24c` it fails
  with "scripts/lanes-lists.mjs maps tests/acceptance/3549/turn.test.mjs to nothing, not to its redraft
  tests/acceptance/3549-redraft-3660/". It passes on a copy of the base's `scripts/` whose `lanes-lists.mjs` adds the
  three mappings, puts them by hand and puts `tests/acceptance/3549-redraft-3694/window.test.mjs` by hand. The other
  files of this folder were not run again and are as first drafted, on the base `3359cc775`.

The throwaway program and its wrong versions were deleted. **Not run**: the suite on the Mac (its disk hold forbids
the cargo build); a lane, `affected.mjs` over this folder, a twin in its line form, or a preflight.

## Gaps

- **Criterion 3 can't tell a stall that restarts on turns from one that restarts on admissions.** A build's turn and its
  admission go back in one write, and the next build takes its turn as the token frees, so in a line of stub builds
  every turn change is also a change of build grants. A plant that watches only build grants passes `line.test.mjs`;
  the plant that fails it is one whose stall doesn't restart at all in the turn wait. A run's jobs' turns would tell
  them apart, but the criterion's line is of builds.
- **"The deadline set when the request asked"** can't be told from a deadline set at admission: the build is admitted
  at once. The 30 s floor holds only that the build doesn't give up early.
- **Criterion 3's margin is timing**: turns changed hands every 8.0 to 8.7 s against a 12 s stall at load about 30. A
  machine where a stub build's handover takes over 4 s would fail the right program; the test prints the timeline.
- **Criterion 4's pool switch** and its reading of the run's process group are this suite's (The surface); the
  criterion's pool of 1 holds from before the stub build asks to the run's end.
- **Criterion 5** checks the lists, not that the redrafts or the other suites pass. It states the lists for 3549's
  other files as `9bbe0f24c` has them, so a later change to those lists is a dispute here.
