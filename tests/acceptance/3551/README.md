# Acceptance tests for #3551: a budget window opens when the machine is empty and drains only when it is overdue

A blind job wrote these tests before any work on #3551 existed, from these inputs only:

- issue #3551: its owner decision (option (a), as its one comment records it), its Why, its Scope, its six acceptance
  criteria and its Not in scope;
- the issues it names, for the words it cites: #2673, #1116, #2674, #3478, #2744 and #3534;
- the design sections it links: `docs/parallel-proof.md`, sections 12a and 6; the Dogfooding part of
  `docs/technical-design.md`; `AGENTS.md` and `CONTRIBUTING.md`;
- the base commit `2edb19ff4`, which has no work on #3551. There I read `scripts/throttle.mjs` and
  `scripts/budget-window.mjs`, to learn how a window is asked, what it prints, what it logs and what it records;
  `fingerprint` in `scripts/benchmark.mjs`; `scripts/wait-ratchet.mjs`, the secrets patterns of
  `scripts/repo-rules.mjs`, the lane lists, `tests/takes-timed.test.mjs` and how `scripts/proof-runs.mjs` reads a
  failure as one at its assertion and lays a twin, to learn what a new suite is held to; and the suites `1116`,
  `2674`, `2744`, `3334` and `3567`, the drain and design tests of `3221` and the design test of `3239`, for
  conventions.

No test imports the code under test, and the helpers are written here. Per AGENTS.md the implementing agent doesn't
edit these files; a dispute goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/3551/*.test.mjs'
```

They must run under `node --test`: only inside a test run does a request keep a table of its own
(`docs/parallel-proof.md`, section 6). There are 14 tests in 6 files: 9 carry a criterion's ID and 5 hold a Scope line
no criterion states. All are offline, on real processes: the real `throttle.mjs`, the real `budget-window.mjs` and real
git, in a fixture checkout.

With the files side by side the suite took 44 to 46 s on a program that held the criteria (the throwaway guess,
below) and 43 to 47 s on the base, at 1-minute loads from 46 to 128 on 18 cores. One file at a time it is the sum of
the tests' own times: 57 to 65 s there, and 87 to 99 s on the base, where criterion 1's build request waits out its
30 s. The longest test is criterion 3's, 43 to 45 s, 40 of them the criterion's own. Each test has its own limit, and each wait inside it is
bounded: a run past its bound is stopped by its own process group and the test fails with the output so far.

**No test reads or writes the machine's table at `~/.deepbuild/throttle/`.** Every process a test starts gets
`DEEP_THROTTLE_TABLE` set to a fresh folder in the test's sandbox, a temporary `HOME` and a `TMPDIR` there, with
`DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PROOF_VITEST_REPORT`, `DEEP_THROTTLE_READINGS`,
`DEEP_THROTTLE_RUN`, `DEEP_WINDOW`, the `GIT_` variables and others unset, so a process that outlived its test run
would refuse the machine's table, not use it. **No window runs with this checkout as its root**: every
`throttle.mjs window`, and every class request beside it, runs from a copy of this checkout's `scripts/` in a fixture
checkout, whose `origin` is a bare repository on disk, with a `gh` stand-in first on `PATH`. Each process starts in a
process group of its own; after the test, each group whose process still runs is stopped by that group's PID. Nothing
is stopped by name or port, and the sandbox is removed.

**Every window is asked with both spans set**, `DEEP_WINDOW_APART_MIN=6` and `DEEP_WINDOW_OVERDUE_MIN=12`, as each
criterion states them. No test decides what a window does on a test's own table with neither set: the suites of
#1116, #2665, #2674 and #3239 open such windows seconds apart, and they are never edited.

No `lane.json`: the suite needn't run alone. Its two numbers are read on a process's own clock or against a pair of
moments (below), not against how busy the machine is. No line is needed anywhere else in the repository.

## The setup (`helpers.mjs`)

- **A sandbox** (`sandbox`): a `HOME`, a table folder, a `TMPDIR`, a notes file and the fixture, removed after the
  test, or after the file's last test when several tests read one scene (`wholeFile`).
- **The fixture**: `origin.git`, a bare repository, and `mac`, a checkout of its `main` that holds this checkout's
  `scripts/` and an empty `benchmarks/budgets.json`. The sandbox `HOME` holds no mark, so a window that opens there is
  the first on its machine: it fetches `origin`, marks `main`, writes its own record and closes, in a second or two,
  measuring nothing. That is all these criteria need of an open window.
- **Stand-ins**, first on `PATH`, at boundaries the repo doesn't own: `gh` (every call recorded, exit 1; no window here
  has anything to ask it); `sysctl`, `pmset`, `osascript` and `sw_vers`, which report a reference Mac on mains, so a
  record holds nothing of this machine; `npm` and `cargo`, which exit 0, so nothing a wrong program might start
  builds anything.
- **The load.** A top-level timed request waits for a 1-minute load below the cores, and this machine's is far above
  them. Every node process of a sandbox loads `preload.mjs` first (`NODE_OPTIONS=--import`), which pins `os.loadavg()`
  at 2. The same module makes each `throttle.mjs` process note, on its own clock, the moment its script starts to run
  and the moment it exits.
- **A request's command** (`ask`): `node scripts/throttle.mjs <class> -- node command.mjs <name> [exit]`, as a session
  asks, with no `--wait`. The command notes its start with the grant it runs under (`DEEP_THROTTLE`) and holds until
  the test ends it by a stop file; with `exit` it exits at once.
- **A window** (`askWindow`): `node scripts/throttle.mjs window`, no flag, in the fixture checkout, as section 12a's
  crontab line asks it.
- **An earlier window in the log** (`logWindow`): four lines appended to `<table>/log` before any request, as the base
  writes a window: `granted` (class `timed`) and `window-open` two minutes before a `window-close` of the stated age
  and its `released`, each `{"at": <ISO time>, "event": ..., "id", "pid"}`. Where a criterion states one age, the log
  holds an older window before it (40 or 50 minutes old), so the close read must be the newest.
- **What the tests read**: the window's stdout and exit status; `<table>/table.json` (its `grants` and `requests`),
  looked at every 20 ms while a window runs; `<table>/log`; the window's own record under the sandbox's
  `~/.deepbuild/lanes/`; and the notes.

## The surfaces assumed where the issue is silent

1. **"A `window-close` N minutes old in its log"** is a line whose `at` is N minutes before the test wrote it, the
   last `window-close` in the file and the one with the newest `at`. The window is asked within seconds, so its age
   is N minutes and some seconds: 5, 7 and 13 stay on their sides of 6 and 12.
2. **"Leaves"** (criteria 1 and 2): the window's process ends by itself, and the log gains no `window-open` from the
   moment it was asked.
3. **"The table holds no request of its own"**: at no look of the test, from the window's asking to its end, does
   `table.json` hold a request made by the window's process, a request marked `window`, or a `timed` request (only
   the window asks for `timed` here); and none is left once it ended. This reads the Scope's "joins no line".
4. **"A `build` request made beside it is granted"**: `throttle.mjs build -- <command>` is started the moment the test
   first sees the window's request in the table, or the moment the window has ended, whichever comes first. So a
   window that drains has the request behind its drain, and one that leaves, which shows no request to time it by,
   has it milliseconds after its end. Granted means its command ran under `DEEP_THROTTLE=build:<id>`, within 30 s.
5. **"The first line is `INCONCLUSIVE window:`, naming 1 grant"**: the first line of stdout starts
   `INCONCLUSIVE window:` and holds `1 grant` or `1 grants` as a word.
6. **The Scope's line and exit** (untagged test): the first line starts `INCONCLUSIVE window: 1 grants held; the last
   window closed <h> h ago` (`1 grant held` too), `<h>` a number from 0 to 1, since 7 minutes are 0.12 h however they
   are rounded; and the exit is 3, a window with no grant's today. Nothing is stopped: the held grant's entry in the
   table is as it was, its holder still runs, the log gained no `timed` grant, and no window record was written.
7. **"Opens at once and the log holds `window-open`"** (criterion 2): the log gains a `window-open`, then a
   `window-close` naming the same grant, and the window's script left its own record for that grant ("as now"). No
   time is held: "at once" has no number, and nothing is there to wait on.
8. **"It leaves"** on an empty table (criterion 2): as 2 and 3 above, no window record, and, since the issue gives
   this case no line of its own, only this of its words: the first line of stdout starts `INCONCLUSIVE`, and the exit
   is not 0. A window that didn't run never reads as one that did (invariant 2), and no test here passes on a run
   that prints nothing. The line `INCONCLUSIVE window: 0 grants held; ...` and exit 3 fit.
9. **"Two grants held that end 20 s and 40 s on"**: a `build` grant and a `test` grant, each held by a command the
   test ends 20 s and 40 s after it started the window's process. Two classes, so criterion 5's "by class" is seen.
10. **"The window opens when the second ends"**: by the log's order, each held grant's `released` comes before the
    window's `window-open`. How soon after isn't held, beyond the 120 s the test gives the window to end.
11. **"No top-level grant starts between its request and its close"**: from the line the log held when the window was
    asked to the `window-close` of its grant, the log holds no `granted` entry but the window's own (one marked
    `grant: "nested"` wouldn't count; none is made). A `build` and a `test` request are made as soon as the window's
    request is in the table: the `test` class has a free slot then, the `build` class from 20 s on. Each must run its
    command under a grant the log holds after the `window-close`.
12. **"Drains as the overdue one does"** (criterion 4): the same checks as criterion 3's, by the same function
    (`drainProblems`), on a log that holds the held grants' own lines and no `window-close`. Two `test` grants are
    held and ended 6 s after the window is asked, and a `build` request is made in the drain.
13. **The window's record** (criterion 5) is the JSON object under `~/.deepbuild/lanes/` with `start`, `end` and a
    list of `commits` whose `grant` is the id the log's `window-open` names (section 12a).
14. **`drain`** is a top-level number of that record, in milliseconds. See "The 2 s and the 1 s" for what it is
    held against.
15. **"The grants it waited on, by class"**: the issue names no key, so any key of the record but the base's own
    (`lane`, `grant`, `start`, `end`, `machine`, `cores`, `loadStart`, `loadEnd`, `from`, `tip`, `commits`,
    `records`, `state`, `ran`, `notReached`, `longest`, `note`) and `drain` may hold them, at the top or up to two
    objects down, in either shape: an object whose keys are all classes (`build`, `bay-pair`, `test`, `timed`, or
    `turn`, which the table holds as one) and whose values are each a count or a list, counted by its length; or a
    list whose items each name a class, as an object with `class`, or a string `<class>` or `<class>:<id>`. One such
    reading must give exactly the scene's grants: `{"build":1,"test":1}` after criterion 3's scene and `{"test":2}`
    after criterion 4's, a class at 0 left out or not. Ids aren't compared. For a window that waited on none,
    nothing is read.
16. **A wait of 720 minutes** (Scope, untagged tests): the log's `granted` entry of the draining window's own grant
    carries `wait: 720`, as #3478's first criterion reads a wait from the log. The window is asked with no `--wait`.
17. **A log that can't be read** (Scope, untagged test): `<table>/log` at mode 0200, which a request can still append
    to. The first line of stdout starts `BLOCKED throttle`, the exit is not 0, and nothing opens. A line that can't
    be parsed isn't decided here.
18. **Criterion 6**: see below.

## The 2 s and the 1 s

Both numbers are held as the criteria state them, with nothing added for a busy machine.

- **"A window leaves within 2 s"** is measured from the moment the window's script starts to run in its process to
  that process's exit, both noted by the process itself on its own clock (the preload's note before the script's
  first line, and its `exit` handler). The time this machine takes to start a node process, which can pass a second
  here, and the time the test takes to see the exit are outside it. On the base a request that gave up at its first
  look took 140 to 265 ms by that measure at a load of 141 on 18 cores, and 200 to 360 ms from its start to its exit
  as the test saw them. A window still running when the build request's 30 s are over has not left.
- **"`drain` within 1 s of the time the test read"**: `drain` is the milliseconds from the window's request to its
  grant. The grant's moment is the time the log's `window-open` of that grant carries. The request's moment can't be
  read from outside to the millisecond, so the test reads the two moments it lies between: its own clock as it
  starts the window's process, and its own clock at its first sight of the window's request in the table. `drain`
  must be no more than 1 s under the shorter of the two times and no more than 1 s over the longer. A window granted
  at its first look is never seen waiting; its shorter time is 0. In the scenes here the two times were 150 to 220 ms
  apart.

## Criteria to tests

The ID is `#3551.<first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed>`, as
`scripts/proof-change.mjs` works it out. Each wrong program is the work with a single fault, named so the implementer
can plant it as a twin; the one in bold is its criterion's own. I planted each in a throwaway guess (below) and saw the
test fail with the message quoted, ids and times apart.

| Criterion | Test (file) | What it holds | Wrong program, and the test's message on it |
|---|---|---|---|
| 1 `#3551.8190b19e` | `not-yet.test.mjs`, first | One `test` grant held, a `window-close` 7 minutes old. The window's script ends within 2 s of starting to run; the test never sees a request of its own in the table; a `build` request made beside it runs its command under a build grant; the first line starts `INCONCLUSIVE window:` and names 1 grant | **`drains`**: a window asked while a grant is held always joins the line and waits for every held grant, whatever the last close's age, as the base does. "the window didn't leave: it still waits 30.4 s after it was asked, its timed request `<id>` of pid `<n>` in the table", "the table held a request of the window's own: the timed request `<id>` of pid `<n>`", "the build request made beside it was not granted: 30.2 s after it was made its build request `<id>` of pid `<n>` still waits in the table, behind the window's timed request `<id>` of pid `<n>`". It names both requests |
| 2 `#3551.6d0f6876` | `empty.test.mjs`, first | No grant held, a `window-close` 7 minutes old. The log gains `window-open` and the `window-close` of the same grant, and the window's script left its record | `leaves-until-overdue`: on an empty table the window opens only once the last window closed the overdue span ago, the apart span never read. "the window didn't open: the log holds no window-open since it was asked (exit 3, its first line "INCONCLUSIVE window: 0 grants held; the last window closed 0.1 h ago")" |
| 2 `#3551.6d0f6876` | `empty.test.mjs`, second | No grant held, a `window-close` 5 minutes old. The window ends by itself; the log gains no `window-open`; the test never sees a request of its own; no record; the first line starts `INCONCLUSIVE` and the exit is not 0 | **`opens-when-empty`**: the window opens whenever the table holds no grant, `DEEP_WINDOW_APART_MIN` never read. "the window opened 5 minutes after the last window closed, less than the 6 of DEEP_WINDOW_APART_MIN: the log holds a window-open for grant `<id>`" |
| 3 `#3551.aa2e13ce` | `overdue.test.mjs`, first | A `window-close` 13 minutes old, a `build` grant ended 20 s on and a `test` grant ended 40 s on, a `build` and a `test` request made in the drain. The window opens; both held grants are released before its `window-open`; no `granted` entry but its own lies between its asking and its `window-close`; both requests run after that close | **`leaves-at-once`**: a window asked while a grant is held leaves, whatever the last close's age, `DEEP_WINDOW_OVERDUE_MIN` never read. "the window never opened: the log holds no window-open since it was asked; it ended 0.2 s after it was asked, exit 3, its first line "INCONCLUSIVE window: 2 grants held; the last window closed 0.2 h ago"" |
| 4 `#3551.9147d91b` | `no-close.test.mjs`, first | A log with the held grants' lines and no `window-close`, two `test` grants ended 6 s on, a `build` request made in the drain. Criterion 3's checks | **`no-close-reads-as-now`**: a log that holds no `window-close` is read as a window that closed just now, so with a grant held the window leaves. "the window never opened: the log holds no window-open since it was asked; it ended 0.1 s after it was asked, exit 3, its first line "INCONCLUSIVE window: 2 grants held; the last window closed 0.0 h ago"" |
| 5 `#3551.84e18eb8` | `overdue.test.mjs`, second | The record of criterion 3's window holds `drain` within 1 s of the 40 s the test read, and `{"build":1,"test":1}` by class | **`drain-in-seconds`**: the record's `drain` is in whole seconds, not milliseconds. "the record's drain, 40 ms, isn't within 1 s of the time the test read from the window's request to its grant, 40200 to 40371 ms" |
| 5 `#3551.84e18eb8` | `no-close.test.mjs`, second | The record of criterion 4's window holds `drain` within 1 s of the 6 s the test read, and `{"test":2}` by class | `count-not-by-class`: the record holds how many grants the window waited on as one number. "the record doesn't hold the grants the window waited on, by class, {"test":2}: no key of it reads as grants by class". `drain-in-seconds` fails here too: "the record's drain, 6 ms, ... 6084 to 6257 ms" |
| 5 `#3551.84e18eb8` | `empty.test.mjs`, third | The record of the window that opened at once holds `drain`, a number within 1 s of the time the test read, which starts at 0 | On the base: "the record holds no drain, a number of milliseconds: its drain is undefined". `drain-in-seconds` passes this one, 0 s being within 1 s of a few milliseconds; the two tests above catch it |
| 6 `#3551.0d50f746` | `design.test.mjs`, first | Sections 6 and 12a each state the three cases; one of them states each span as drafted; 12a's crontab line asks each hour and none asks at fixed hours | **`four-fixed-hours`**: the design page states the cases and spans but keeps section 12a's crontab line as it is. "section 12a holds no crontab line that asks `throttle.mjs window` each hour (a minute, then `* * * *`): it holds `0 3,9,15,21 * * * zsh -lc ...`", "a crontab line still asks the window at fixed hours: ..." |

Seen failing too, on the guess: a window that waits for the held grants but stops no new one (`overdue.test.mjs` and
`no-close.test.mjs`, first: "a top-level grant started between the window's request and its close: test grant `<id>`
of pid `<n>` at `<time>`, build grant ..."); one that reads the oldest `window-close` (`not-yet.test.mjs`, which
drains, and `empty.test.mjs`, second, which opens); a `drain` counted to the window's close; a design page whose
section 6 is the base's; and a `window` that prints nothing and exits 0, on which all 12 tests that run one fail.

Three tagged tests pass on the base, since the base already does what their sentences say: criterion 2's first
(the base opens whenever the table is empty), criterion 3's and criterion 4's (the base drains whatever is held). Each
needs its twin: `leaves-until-overdue`, `leaves-at-once` and `no-close-reads-as-now`.

| Scope line | Test (file) | What it holds | Seen failing on |
|---|---|---|---|
| Not yet: the line it prints, and "exits as a window with no grant does today" | `not-yet.test.mjs`, second | Surface 6 | the base, and `drains` |
| Overdue: "with a wait of 720 minutes" | `overdue.test.mjs` and `no-close.test.mjs`, third | Surface 16 | the base (`wait: 60`), and a guess that left the wait at 60 |
| When it closed: "a log that can't be read is `BLOCKED throttle`" | `log.test.mjs` | Surface 17 | the base, which opens, and a guess that read such a log as holding no window |
| Design: "and the trust given up"; The schedule: "still installed by hand, on a reference Mac only" | `design.test.mjs`, second | Section 6 or 12a holds a paragraph or bullet with "trust", "given up" (or "gives up", "give up") and "window"; 12a holds one with "by hand" and "reference Mac" | the base, whose only trust paragraph is #3221's |

## Criterion 6

The wording is the writer's, so each fact is matched by the issue's own words for it, loosely. A section runs from
its heading (`## 6. ` or `### 12a. `) to the next heading of its level or above, so section 6 includes 6a.

- **The three cases, in each of the two sections** (the Scope's Design line names both for them), each as one
  sentence may state it. Empty: a sentence that names a window, says "at once" (or "immediately") and says no grant is
  held, as "no grant", "holds no", "nothing is held", "none is held" or "empty". Not yet: a sentence that says "leaves
  at once", "joins no line", "stops no grant", "stops nothing" or `INCONCLUSIVE window`. Overdue: a sentence that
  says "overdue", or one that says "12 hours", "or more" and "waits" or "drains".
- **The two drafted spans, in either section**: a paragraph or bullet that holds "6 hours" (or "6 h", "six hours",
  "6 and 12 hours") and "drafted", and one that holds "12 hours" (or "12 h", "twelve hours") and "drafted".
- **The hourly schedule, in section 12a**: a line that holds `throttle.mjs window` after five crontab fields, the
  first a minute, the second `*` (or `*/1`, `0-23`), the rest `*`; or after `@hourly`. No such line in either section
  may ask at fixed hours.

## On the base

`BASE-FAILURE.txt` holds `node --test tests/acceptance/3551/*.test.mjs` at `2edb19ff4`, on the Mac. Eleven tests
fail, each at an assertion of the suite's own and for the expected reason; three pass.

- Criterion 1 fails as the criterion says: the window joins the line and drains, so its `timed` request is in the
  table and the `build` request made beside it waits behind it, still there 30 s on. The window has printed nothing.
- Criterion 2: the 7-minute test passes, since the base opens whenever the table is empty. The 5-minute test fails:
  the base opens there too.
- Criteria 3 and 4 pass: the base drains whatever is held, opens when the last grant ends, and starts no top-level
  grant meanwhile.
- Criterion 5's three tests fail: the base's record holds no `drain` and no grants by class.
- Criterion 6 fails on every fact: neither section states a case or a span, and 12a's line asks at 3, 9, 15 and 21.
- The five Scope tests fail: no `INCONCLUSIVE window:` line; `wait: 60` in both draining windows' grants; a window
  that opens on a log it can't read; no trust given up for a window.

To tell a test's fault from a program's, I wrote a throwaway guess at the change in the inputs folder's `scratch/`,
outside the checkout: a mirror of `scripts/` with the three cases in `throttle.mjs`'s `window` and `drain` and the
grants by class in the window's record, and a copy of `docs/parallel-proof.md` with the cases, the spans, the trust
and an hourly line. It ran only as the fixture's copy under a test's sandbox, through this folder's files copied
beside it. All 14 tests passed on it. With each single fault named above planted in it, the test named beside it
failed with the message quoted. `BASE-FAILURE.txt` ends with those runs' result lines. The guess is deleted and
proves nothing about the real change.

## What the tests can't see, and what I left out

- **The drafted 6 and 12 hours.** Only 6 and 12 minutes are asked, through the two variables. What a window does with
  neither set, on the machine's table or a test's own, is not asserted.
- **The boundaries.** 5, 7 and 13 minutes are asked; nothing at exactly 6 or 12 ("or more").
- **The machine's table, and what starts a window.** No test touches `~/.deepbuild/throttle/` or a schedule. That the
  crontab line is installed by hand is read from the design page only.
- **The Scope's "Unchanged" line** has no new test: what a window measures, its mark, its lack of a cap, a held
  grant's bound, and a caller's wait that doesn't run down while a window is pending or open are held by the suites
  of #1116, #2665, #2674, #2744 and #3239, which run unchanged. I did not run them.
- **The signed approval tag** for `scripts/throttle.mjs` and `scripts/budget-window.mjs` has no test.
- **"At once" and "when the second ends" as times.** Only criterion 1's 2 s and criterion 5's 1 s are clock checks.
  A window that opened a minute after the second grant ended would pass criterion 3, as long as it had ended within
  the 120 s the test gives it.
- **A window that leaves, between its start and its exit.** The build request of criterion 1 is made as the test
  sees the window's end, not during its run. A window that held a request for less than the 20 ms between two looks
  would not be seen.
- **Ids and holders.** The grants a record holds by class are counted, not matched to the held grants' ids.
- **Other holders.** The held grants are `build` and `test` grants of stub commands. A `bay-pair` grant, a nested
  request, an admitted run's turns, a holder past its bound, a second window pending or open, and a load at or above
  the cores when the window is due are not played.
- **A log with a line that can't be parsed**, and a table with no log file at all: not decided here.
- **The hours a leaving window prints** are held only to lie from 0 to 1 for 7 minutes.
- **Linux.** Drafted and run on macOS (arm64, 18 cores, node 24). The scenes allow for Linux's limits (two `test`
  grants and a free `build` or `test` slot fit both), but nothing ran there.
- **Not run**: `scripts/affected.mjs`, the proof lanes, a preflight, and the lint lane as a whole. I ran the wait
  ratchet's own `findings` function over these files, cut from `scripts/wait-ratchet.mjs` so that it read no git ref
  (no finding), and the studied-names check the job named (no finding).
- **Fixed waits**, each marked `// deadline:`: the 20 s and 40 s of criterion 3 and the 6 s of criterion 4's scene,
  which are the scenes' schedules, each cut short when the window has already ended; the 20 ms between two looks; and
  the bounds that turn a hang into a failure. The 2 s and the 1 s are the criteria's own.

## Files

- `helpers.mjs`: the sandbox, the fixture, the stand-ins, the preload, requests and windows, the readers, a drain's
  scene and its checks, the record's checks.
- `not-yet.test.mjs`: criterion 1 and the Scope's Not yet.
- `empty.test.mjs`: criterion 2, and criterion 5 on a window that opened at once.
- `overdue.test.mjs`: criteria 3 and 5, and the Scope's 720 minutes.
- `no-close.test.mjs`: criteria 4 and 5, and the Scope's 720 minutes.
- `log.test.mjs`: the Scope's unreadable log.
- `design.test.mjs`: criterion 6, and the Scope's trust given up and schedule by hand.
- `BASE-FAILURE.txt`: the run on the base, and the result lines of each planted fault.

No fixture holds a secret or personal data. The fixture's machine is made up, and its commits name no issue.
