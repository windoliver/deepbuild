# Acceptance tests for #3264: a playtest holds rules over every step of every run

Written first, blind, from issue #3264 ("A playtest holds rules over every step, not only where a run ends": its opening
paragraph, Scope, six acceptance criteria, `Runs on` line and Proof line; no comments), the three design sections it
links and the base commit a7ae0e804 (its last merge is #3696), by a job that never saw an implementation; no other
worktree, branch, pull request, plan or session was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test file per criterion, with one
more test where a clause needs its own run.

## What was read

- The issue as saved for this job, and the issues it cites (#219, #193, #555, #184, #940) for the words it uses. Its six
  criteria are tagged by `scripts/proof-change.mjs`'s rule (`#3264.` and the first 8 hex of SHA-256 of the text, white
  space collapsed).
- `docs/canvas-primitives.md`: Check input: playtest; Play interface `game.play@1`; Check input: `rules.legal`; The
  closed function list. `docs/technical-design.md`: How we know version 0 works (Criteria to tests, Wrong programs,
  Dogfooding, Tests written first), the Playtest bullet of Checks for work beyond code, Every task carries its own
  budgets. `docs/parallel-proof.md`, sections 5 to 7. `docs/adr/0001-code-carries-no-comments.md`. AGENTS.md,
  CONTRIBUTING.md, GLOSSARY.md.
- At the base, read only for the surfaces these tests use: `tests/acceptance/3265`, `555`, `556`, `184`,
  `184-redraft-ac7-2`, `1048`, `1518` and `3569` (how a budget is judged), `533/helpers.ts`;
  `packages/checks/playtest` (every file) and `packages/checks/test/playtest.test.ts`; `packages/conformance`
  (`slot-types.ts`); `packages/extension-host/src` (`host.ts`'s `runCheck`, `judgeCheck` and `deep.canvas.play`,
  `plays.ts`, `digest.ts`, `sources.ts`'s `ask`); `packages/verdicts/src`; `crates/deep-logic/src` (`play.rs`,
  `grid_bot.rs`, `point.rs`); `crates/deep-replica/src/drive/play.rs`; `benchmarks/playtest.mjs`;
  `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`), `scripts/lanes-lists.mjs`, `scripts/proof-runs.mjs`.

What the base does, which these tests don't credit: the playtest reads no `always` and no `order`, so a run whose `hp`
reads −3 passes, a door that opens before its key passes, a rule whose `then` never happened passes, and a rule on a
name the interface doesn't declare is played and passes; its manifest lists neither code and its kit plants neither
check. What it already does, which they rely on: #184's replica and replay, #555's play interface, explorer and goal
expressions, #1048's model bot (whose prompt already leaves out the names an interface lists as `hidden`), and the
plug-in's manifest holding its files' digest, so the hub installs the folder as it ships (#3265's hub installed a
corrected copy; this base needs none).

## Run them

```sh
npm ci                          # once, in a fresh worktree
npm run build --workspaces      # once
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs test --wait 10 -- npx vitest run --root tests/acceptance/3264 --testTimeout=600000 --no-file-parallelism ac01-always.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/3264/tsconfig.json
```

One file at a time, the file's name last (`ac01-always`, `ac02-order`, `ac03-one-step`, `ac04-never-happened`,
`ac05-hidden-and-undeclared`, `ac06-budget`); without a name the folder's six files run in turn. Every test carries its
own limit of 30 minutes, above `--testTimeout`.

The builds, each once a file and honoring `CARGO_TARGET_DIR`: `deep-drive` debug with `env-plants` (#184's helper),
`deep-logic` (#533's: the layout probe) and #533's assembler from a copy (#555's). `ac01` to `ac05` need all three and a
Mac. `ac06-budget` builds nothing, starts no replica and runs on any machine. The folder runs alone by its own
`lane.json`, reason `timing`, with `ac06-budget.test.ts` a timed file.

Gates. Off macOS every test of `ac01` to `ac05` fails `INCONCLUSIVE:` first thing (the replica's binaries exit on any
other OS), never a pass. Cargo that can't run is `BLOCKED:`. `ac06-budget` fails `INCONCLUSIVE:` wherever its five
readings don't count: off the reference Macs, off mains power, in Low Power Mode, at a thermal state that isn't
nominal, or at a load above the cores (`scripts/benchmark.mjs`, `judgeLimit`). At the base on this Mac it stops
before its clock; a probe of its readings read INCONCLUSIVE here (thermal state fair, load 17).
Folders are temporary and deleted; processes are #184's helpers' children, stopped by PID. No test waits for time.

Time. With the binaries built, at the base on this Mac at a load of 17 to 18: `ac01` 22 s, `ac02` 8 s, `ac03` 6 s,
`ac04` 8 s, `ac05` 6 s, `ac06` under 1 s, about a minute in all, each after a wait of up to 40 s for its grant. A run and
its replay take about 4 ms at 60 steps. After the work `ac06` adds its six pairs of timed checks, and the two tests
that stop at a missing planted runner at the base play 6 and 80 short runs more.

## The surface

The issue names `always: [{name, when}]` and `order: [{name, first, then}]` in the playtest's input, the codes
`playtest.always {run, step, name, values}` and `playtest.order`, INCONCLUSIVE for an `order` whose `then` is true in no
run, and `play.missing` before any run for a name the interface doesn't declare. It leaves open the words of each
failure, how the replay's step is shown, how INCONCLUSIVE is reported, and where the two planted checks live.
**Everything below that the issue or the design doesn't give is this job's choice**, the least the criteria need; the
implementer builds exactly these, or a dispute goes to a blind redraft. #184's, #555's and #1048's surfaces stay as
they are.

### The input

In the playtest's input (the check spec's `play`), beside `goals`:

- **`always: [{name, when}]`**, for example `[{"name": "never_negative", "when": "hp >= 0"}]`.
- **`order: [{name, first, then}]`**, for example `[{"name": "key_before_door", "first": "has_key", "then":
  "door_open"}]`.

Each `when`, `first` and `then` is an expression over the play interface's names with the closed function list's
operators, true when non-zero, as a goal's `when` is. A unit's field reads the self unit's row. A name may be one the
interface lists in `hidden`.

### What a failing rule reports

- **`playtest.always`**: the outcome is `failed`. For each run in which the rule is false at some step, one failure
  whose **`test` is `bot <b> run <i>`** and whose message
  - starts **`playtest.always`**;
  - holds the rule's `name` as a whole word;
  - holds **`step <k>`**, the first step the rule is false, before any word `replay`: the first `step <n>` in the
    message is the run's;
  - holds, for each name the rule reads, **`<name> <value>`**, its value at that step (`=`, `:` or `is` may stand
    between, and a quote or bracket around either; every value the message gives for that name is that value);
  - holds the word **`replay`** and, after it, **`step <k>`** again: the step at which the run's track, played again
    without its bot, first breaks the rule. The first `step <n>` after the word `replay` is the replay's.

  For example: `playtest.always: bot 0 run 3 (seed 77): never_negative is false at step 12, where hp is -3; its replay
  is false at step 12 too`. A run that keeps the rule gets no such failure. The rest of the wording is free.
- **A replay that doesn't break the rule at the run's step.** The run still fails the check (the outcome is `failed`),
  and the failure above isn't reported with the same words: of a replay whose `hp` never reads below 0, the check says
  nothing that it says of one that fails at step k. What it says instead is free.
- **`playtest.order`**: the same shape. The outcome is `failed`; for each run in which `then` is true at a step and
  `first` hasn't been true at an earlier step, one failure whose `test` is `bot <b> run <i>` and whose message starts
  **`playtest.order`**, holds the rule's `name`, **`step <k>`** (the first step `then` is true) before any word
  `replay`, and after the word **`replay`**, **`step <k>`** again. For example: `playtest.order: bot 0 run 1 (seed 9):
  key_before_door: door_open is true at step 6 and has_key has not been true; its replay breaks it at step 6 too`.
  Once `first` has been true at an earlier step of the run, `then` may be true at any later step, whatever `first`
  reads then.
- **Every step of every run is read**: the steps after a run reached its goals too, to the span's last step, and a
  model bot's runs as the others.
- The plug-in's manifest lists both codes in `codes`, and holds its files' digest.

### INCONCLUSIVE

An `order` rule whose `then` is true in no run of the check: the outcome is **`uncounted`**, with one failure whose
message starts **`INCONCLUSIVE:`** and holds the rule's `name` as a whole word, as `grid.reach` reports a depth one
seed generated (#3265). `judgeCheck` reads that outcome INCONCLUSIVE, and the verdict engine never counts it as a
pass. With nothing else wrong, nothing else is reported, and `testsRun` counts the runs played. For example:
`INCONCLUSIVE: key_before_door: door_open was true in no run, so the rule proves nothing`. The failure's `test` is
free.

### Refused before any run

A rule that reads a name the interface doesn't declare (a plain identifier, such as `mana`): the outcome isn't
`passed`, `testsRun` is 0, every replica call the check made is an error or a play of no step (the owner's ruling on
#184), and one failure's message starts **`play.missing`** and holds the name as a whole word. An `always` rule's `when`
and an `order` rule's `first` and `then` are all read.

### The two planted checks

Each is a planted runner of the plug-in's kit, beside `ignores-stuck` and the others:
**`playtestKit(replica).planted` holds fills named `goal-steps-only` and `unseen-then-passes`** (`kit.ts`). This suite
reaches a fill as the base's kit has it, `fill.play({maze: "maze", play: <the playtest's input>, plant: null})`, with
`replica(null)` playing in this suite's replicas, and reaches the kit's own check as `playtestKit(replica).clean()[0]`.

- **`goal-steps-only`** is the playtest, but it reads each `always` and `order` rule only at the steps where a goal is
  judged: the first step each of the input's goals is true in the run. (This suite's twin keeps `hp` at 0 or above at
  each of those steps and at the run's first and last step, so a planted check that reads a run's ends too passes it.)
- **`unseen-then-passes`** is the playtest, but an `order` rule whose `then` is true in no run passes.

### The plug-in's entry and a recorded replica

`ac05`'s first test and `ac06` call the plug-in's entry as the hub does, with no hub between: the default export of
`packages/checks/playtest/index.ts`, `register(deep)`, given `{registerCheck, canvas: {play}, source: {ask}}`, the three
members the base's entry reads, and then the runner it registers for the kind `playtest`, on a check spec. In `ac05`,
`canvas.play` is this suite's replicas and `source.ask` records each prompt and answers `pass`. In `ac06`,
`canvas.play` is a recorded replica (`recorded.ts`): it answers each play from memory, with a value for every path the
play names in `values` (or `changes`) at every step, a track, one checkpoint and a final hash that its replay answers
alike. The issue's `Runs on` line: the rules read recorded values, so their own tests run on any machine.

## The crawler and its twins (`crawler.ts`, `programs.ts`)

One logic item, `crawler`, at 60 Hz, of class figure, in WebAssembly text assembled by #533's assembler, reading `aim`
(a point control) and `wait_key` (an actions control with the one action `wait`). Its grid is 18 × 3: rows 0 and 2 are
walls, row 1 is a corridor from x = 0 to the exit at x = 16, with the key at x = 9, a locked door at x = 12 and a trap
at x = 14 (a value of class open). `init` reads two things from its seed (each run's own, with `piece_seed: run`): the
unit starts at x = 0, 2, 4 or 6, with 2, 7, 12 or 17 hit points.

Each step, a press on `aim` at a cell next to the unit that it may enter moves it there. Entering the key's cell takes
the key (`has_key` 1). Entering the locked door, which needs the key, opens it (`door_open` 1) and uses the key up
(`has_key` 0 again). Entering the trap takes 5 hit points, never below 0. Entering the exit wins (`won` 1), and the
crawler then lists no row. An entry on `wait_key` is refused. It publishes the grid, the unit's cell and `hp`, `turn`,
`has_key`, `door_open`, `won`, the legal rows (each move) and the accepted and refused counts.

Its interface (`crawlerPlay`): the grid with `locks {3: 4}`, `units {cell, hp, self: 0}`, `turn`, `values {has_key,
door_open, won}`, `actions {move: aim (cell), wait: wait_key}`, `legal`, `accepted`, `refused`, and `hidden` when a test
gives it. The playtest (`playtest`): 20 runs of the explorer, seed 3264, `span: {steps: 60}`, `piece_seed: run`, the
goals `door` (`door_open >= 1`) and `out` (`won >= 1`), each run reaching each.

The explorer walks east one cell a step, so by the crawler's rules a unit that starts at x reaches the key at step
9 − x, the door at 12 − x, the trap at 14 − x and the exit at 16 − x. No test takes those steps on trust: each plays the
20 run seeds itself, with the explorer and asking for `hp`, `has_key`, `door_open` and `won` at every step, and reads
the failing runs and steps from that; it plays each failing run's recorded track again without its bot and reads the
same step. The check's own answer is never the source of an expected value.

| Twin | What differs | What this suite reads from its own plays |
|---|---|---|
| `spikes` (AC1) | the trap takes 5 with no floor | in each run that starts with 2 hit points, `hp` reads 2 and then −3 at the trap's step; the others stay at 2 or above; every run opens the door and reaches the exit |
| `timer` (AC2, AC5) | the door also opens at step 6 if it is still shut | in each run that starts at x = 0 or 2, `door_open` reads 1 at step 6 with `has_key` not yet 1; the others took the key at step 5 or 3 |
| `blip` (AC3) | every unit starts with 9 hit points, and at step 811 alone `hp` is published 5 lower | in every run `hp` reads 4, −1, 4 at steps 810 to 812 and is below 0 at no other step; both goals are reached by step 16 |

On the check seed 3264 some of the 20 runs start with 2 hit points and some start at x = 0 or 2, and not all: each test
holds that before it judges.

## How the fixture was checked

Before any test ran, a scratch probe that isn't part of the suite assembled the four programs with the built assembler,
read their layout from `deep-logic check` and played them in the base's debug `deep-drive`, each run with its replay, on
the run seeds hash(3264, i). What it read, which each test reads again for itself:

- `clean`, the explorer, 20 runs of 60 steps: the unit walks one cell a step from x = 0, 2, 4 or 6; the key, the door
  and the exit come at 9 − x, 12 − x and 16 − x; `hp` never reads below 0 and ends at 0 in runs 6, 8, 12 and 13, which
  start with 2; `has_key` reads 1 for three steps and 0 again from the door's step; no entry is refused; every replay
  reaches the run's checkpoints and final hash.
- `spikes`: runs 6, 8, 12 and 13 read `hp` 2 and then −3, at steps 10, 14, 14 and 8, to the span's end, and their
  replays at the same steps; the other 16 stay at 2 or above; all 20 open the door and reach the exit.
- `timer`: `door_open` reads 1 from step 6 in every run; in the 11 runs that start at x = 0 or 2 (0, 4, 5, 7, 8, 10,
  12, 15, 16, 17, 19) the key comes later, at step 9 or 7, and their replays read the same; in the other 9 it came at
  step 5 or 3.
- `blip`, 3 runs of 900 steps: `hp` reads 4, 4, −1, 4, 4 at steps 809 to 813 and is below 0 once; the exit comes at
  step 14, 10 and 12.
- `clean` with the idle policy and with the explorer that moves once every 4 steps, 20 runs of 20 steps each: no run
  opens the door; the slow explorer takes the key in 9 runs, at step 9 or 17.
- `timer` with an idle unit, 6 runs of 40 steps: the door opens at step 6 with no key in each.

## Criteria to tests

| ID | Criterion (short) | Test, what it holds and the wrong program it fails on |
|---|---|---|
| AC1 #3264.03648b56 | `always: hp >= 0` passes over 20 runs; the twin whose trap takes 5 from a unit at 2 fails `playtest.always`, naming the run, the step and `hp` −3, its replay at the same step; the twin passes on the merge base | `ac01-always.test.ts`, test 1: the twin with no rule passes, 20 runs; with the rule it fails, one `playtest.always` for each run this suite read below 0 and no other, each naming its run, its own step, `hp -3` and that step again for its replay; nothing else fails; the fixture, where a unit at 2 ends at 0, passes over 20 runs; the manifest lists the code. Fails on the merge base (the twin passes), a check that reads `>` for `>=`, one that names one step for every run, one that fails every run. Test 2: through a hub whose replica answers each replay with `hp` never below 0, the check still fails and no failing run keeps the words it had. Fails on the merge base and on a check that names a replay step it never read |
| AC2 #3264.4ae0accd | `order: {first: has_key, then: door_open}` passes on the fixture; the twin whose door also opens on a timer fails `playtest.order`, naming the first step `door_open` is true with `has_key` still 0 | `ac02-order.test.ts`: the twin fails, one `playtest.order` for each run whose door opened first and no other, naming the run, step 6 and step 6 for its replay; the fixture passes over 20 runs though `has_key` reads 0 while `door_open` reads 1 once the door used the key up; the manifest lists the code. Fails on the merge base, a check that asks `then && !first` at each step (it fails the fixture), one that names the step the key was taken, one that fails the runs whose key came first |
| AC3 #3264.b18bc0a2 | a twin whose `hp` reads −1 at step 811 alone, with 4 either side, fails `always: hp >= 0` there; a planted check that reads only the steps where a goal is judged passes it and fails this test | `ac03-one-step.test.ts`, test 1: 3 runs of 900 steps; each fails `playtest.always` naming step 811, `hp -1` and step 811 for its replay. Fails on the merge base, a check that samples steps, one that stops reading where the run reached its goals. Test 2: the kit's `goal-steps-only` passes the twin, this criterion's judge (`alwaysWrong`) faults that result, and the kit's own check fails the twin as test 1 asks. Fails on the merge base (no such runner) and on a planted check that finds the fault |
| AC4 #3264.941ee22d | with bots that never open the door the order rule reads INCONCLUSIVE, naming it; a planted check that passes a rule whose `then` never happened fails | `ac04-never-happened.test.ts`, test 1: an idle policy and an explorer that moves once every 4 steps, 20 runs each of 20 steps, under the one goal `alive` (`hp >= 1`, which each run reaches at step 0): no run opens the door, some take the key; the outcome is `uncounted` with one failure, `INCONCLUSIVE:` naming the rule, 40 runs counted, the verdict never PASS. Fails on the merge base (passed), a check that fails it, one that is INCONCLUSIVE only when `first` never happened either. Test 2: the kit's `unseen-then-passes` passes, this criterion's judge (`unseenWrong`) faults that result, the kit's own check reads INCONCLUSIVE. Fails on the merge base (no such runner) |
| AC5 #3264.aa75cf53 | a rule may read a hidden name, and no bot receives its value; a rule on a name the interface doesn't declare fails `play.missing`, naming it, before any run | `ac05-hidden-and-undeclared.test.ts`, test 1: under an interface that lists `hidden: [has_key]`, a model bot and the explorer, 6 runs each: the timer twin fails `playtest.order` in each run whose door opens first, every model run among them; the fixture passes; the model was asked, no prompt holds `has_key`, each holds `door_open`. Fails on the merge base (the twin passes), a check that skips or refuses a rule on a hidden name, one that skips a model bot's runs, one that shows the model what its rules read. Test 2: an `always` rule and an `order` rule on `mana`, through the hub: never passed, `play.missing` naming `mana`, no run counted, no step played. Fails on the merge base (played, passed), a check that plays first, one that refuses with another code |
| AC6 #3264.bb05cf1b | budget: eight rules over 20 runs of 14,400 steps add under 100 ms to the check | `ac06-budget.test.ts`: on a recorded replica, four `always` and four `order` rules over 20 runs of 14,400 steps: a recording whose last run reads `hp` −1 at its last step alone fails `playtest.always` naming `bot 0 run 19`, step 14399 and `hp -1`; the recording that keeps all eight passes. Then a warm-up and five readings of the check's time with the rules less its time without, each at least 0, judged against 100 ms by `judgeLimit` with the load at each reading's start and end. Fails anywhere on the merge base and on a check that doesn't read every step of every run; fails on a reference Mac at rest when all five are over by more than the margin; INCONCLUSIVE, never a pass, anywhere else |

## Readings where the issue and the design leave a choice

- **"Naming the run"** is the failure's `test`, `bot <b> run <i>`, as every run's failure at the base.
- **"Naming … `hp` −3"** is the name and its value in the message, as JavaScript prints the number; the typographic
  minus is read too.
- **"The run's replay fails at the same step"** (AC1, the Scope's fourth line, the Proof line): the failure's message
  says so, with the replay's own step after the word `replay`, and this suite's own replay of the run's track reads the
  same step. AC2's twin is held to it too, since the Scope and the Proof line give it to both kinds of rule. What the
  check reports when a replay doesn't break the rule there is free, but the run still fails and its words differ.
- **"The twin passes on the merge base, and that run is shown"** is BASE-FAILURE.txt's part. AC1's first test also
  holds, before and after the work, that the twin passes with no rule; on the base it then fails at the assertion that
  the twin fails under the rule, whose message holds the base's result.
- **"A unit at 2"** is the self unit, the only unit this crawler has, starting with 2 hit points.
- **"Every step of every run"** includes the steps after a run reached its goals: AC3's fault comes at step 811, long
  after the exit at step 16 or before. The issue's opening names "a won board stays won" among the facts no rule
  holds, which only such steps can break.
- **"The steps where a goal is judged"** is the first step each goal is true in the run, which is where the base
  judges a goal reached.
- **"Bots that never open the door"** are an idle policy, which never moves, and an explorer too slow to reach the
  door inside the span, which takes the key in the runs that start nearest it. So `first` is true in some run and
  `then` in none. Their playtest has one goal, `alive` (`hp >= 1`), which every run reaches at its first step: the
  host refuses a pass whose plays read no values, so with no goal the base fails this input for a reason that isn't
  the criterion's.
- **"No bot receives its value"** is read where the plug-in hands values to a bot: a model bot's prompt, at the
  plug-in's source. The first-party bots run in the replica and read the grid, the unit's cell and the legal rows,
  none of which this suite hides.
- **The budget** is the time the check takes with the eight rules less the time it takes without them, on the same
  recorded plays, so no replica's time is in it. "Drafted" is read as the value being an estimate. "In the local
  preflight" names where it runs: this suite adds no `benchmarks/budgets.json` task, as #3569's didn't.

## Not covered (scope with no criterion here, or left open)

`first` and `then` first true at one step; an `always` or `order` rule that reads a logic array path with a dot in
place of an interface name; a rule on a name the interface declares and the piece doesn't publish (#555's
`play.missing`); several rules failing in one run; an `order` rule that is INCONCLUSIVE beside a failure; a run from a
save; a model bot's run that breaks a rule its replay keeps; a `hidden` name withheld from the first-party bots or from
a logic bot's `reads` in the replica; rules on a game project's build; who may write the rules (the brief or the
definition); the codes' meaning and fix in `codes.ts`; that the kit's own cases catch each planted runner
(`packages/checks/test/playtest.test.ts` holds every planted runner to that); the design's lines for the new fields and
codes.

## What the implementer adds outside this folder

- In `packages/checks/playtest`: `always` and `order` in the input and their judging over every step of each run and
  its replay; `playtest.always` and `playtest.order` in `deepbuild.json`'s `codes`; the manifest's `digest` refilled;
  `goal-steps-only` and `unseen-then-passes` among `playtestKit(…).planted`.
- Nothing in `scripts/lanes-lists.mjs`: the folder's `lane.json` says how it runs. No `benchmarks/budgets.json` task
  and no design line is read by these tests.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `lane.json`, `helpers.ts` (the replicas, the hub, this suite's own
plays, the kit's fills and the plug-in's entry; it imports #556's and #184's helpers, which import #555's and #533's,
for the pool, the hub, the assembler and the verdict), `judges.ts` (what this suite reads from its own plays and from a
result; no import), `crawler.ts` (the crawler's text, its twins, its interface, the bots and the rules; no import, so a
plain node script reads it), `programs.ts` (the crawler assembled at the layout `deep-logic check` gives it),
`recorded.ts` (the recorded replica), and one test file per criterion.
