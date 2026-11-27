# Acceptance tests for #3529: a logic item's program is compiled once a process

Written first, blind, from issue #3529 as it reads on November 27, 2026 (its opening paragraph, Scope, four acceptance
criteria, `Runs on:` and Proof lines; no comments), the two design sections it links (canvas primitives: Logic:
sandbox; technical design: Sandbox and budgets), the issues it names (#3445 with its report's compile table, #3612,
#3531, #2662, #1172, #310, #171) and base commit `11404f91002549703d3eed81d16f6a988923b7b7` (`origin/main`, whose
last merge is #3639), by a job that never saw an implementation; none existed. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test a
criterion, and for criterion 1 one more for the canvas core and one for its planted runner.

## The redraft

The suite was drafted at `de00a9c64` and redrafted at `11404f910`, 134 commits later, by the same job, before it
landed anywhere. The job never saw an implementation at either base. What changed, and why:

- **No comments.** AGENTS.md at this base has acceptance tests written with no comments, and the comment ratchet
  counts a new suite from zero (`docs/adr/0001-code-carries-no-comments.md`). The draft's 287 comment lines are
  gone: what each said is in a helper's name, a test's title, a failure's message or this file. The one comment
  kept is the `// deadline:` marker on the timer that bounds a reply. The two programs `wasm.mjs` writes are byte
  for byte the draft's.
- **22 shipped packs.** #3604 added `packs/circuit-2.0.0`. The issue's 48 and 109 were read on 21 packs, so
  criterion 1's numbers are held on those 21, and the newer pack by its own check (A pack the issue didn't read).
- **`base.json` recorded again** at this base. Every hash in it is the one recorded at `de00a9c64`.
- Nothing an implementer provides changed: the same four names, shapes and behaviours.

**Read this first: the issue was written before the base.** Its numbers are #3445's, read on main at `aafef3131`.

- **109.** The base holds #3612, which took the second check of a fixture's piece out, and with it the second
  compile. By reading, this base compiles once for each piece its checks make: 57 for the 48 programs of the 21
  packs the issue read, and 51 more for `circuit-2.0.0`. No binary of the base answers a compile count, so those
  are read, not run.
- **500 ms.** On the packs the issue read, the repeats the base still makes are 9 compiles, about 117 ms by the
  mean time a compile in #3445's table, where the 500 ms was drafted against 61 repeats and 862 ms. No test here
  judges a time; the number is the owner's to draft again.

## Files

| File | Criterion | What it runs |
|---|---|---|
| `ac1-core.test.mjs` | `#3529.1f362433` | one fresh `deep-show canvas` with the 22 shipped packs: its first call, `packs`, then its compile count, which less the newer pack's own must be 48 |
| `ac1-logic.test.mjs` | `#3529.1f362433` | `deep-logic`: each shipped pack's check with the count read around it, each library fixture's piece baked twice, two items of one program; then the same on the planted merge base's runner, which must fail, naming a program, and count 109 on the issue's packs with the base's own planted fixture run |
| `ac2-goldens.test.mjs` | `#3529.cc8f3bb2` | `deep-logic`: #531's fixtures and the two kept logic goldens against the merge base's recording; then the control on the base's `replay_changes_step_37` |
| `ac3-items.test.mjs` | `#3529.be72c1ed` | `deep-logic`: two items of one program baked together and each alone; then the same on the planted runner that shares one instance |
| `ac4-budget.test.mjs` | `#3529.50c3d51b` | nothing: it reads `benchmarks/budgets.json` for the task that names the criterion |
| `common.mjs` | | the criteria's IDs, the issue's two counts, `must`, where a binary is taken from, the line driver |
| `logic.mjs` | criterion 1 | the shipped packs as the core hands them to the pack check, the 21 the issue read, a library fixture's piece as the check makes it, the count, the judge |
| `core.mjs` | criterion 1 | the canvas core's driver |
| `goldens.mjs` | criterion 2 | the fixtures and the goldens, what each reaches, the judge |
| `items.mjs` | criterion 3 | the piece of two items of one program, the judge |
| `wasm.mjs` | criteria 2 and 3 | the two programs this suite writes itself, as bytes |
| `record.mjs`, `base.json` | criterion 2 | the merge base's recording and the script that made it |
| `twins.json`, `twins/` | criterion 2 | its wrong program, as its wrong line |
| `lane.json` | | the suite runs alone: its files build and run binaries from the checkout's `target/` |
| `BASE-FAILURE.txt` | | each file run at the base |

## What was read

- The issue and the issues it names, for the words it cites: #3445 and its report (the table "Each shipped pack's
  programs", where "109 for 48" comes from), #3612 (a fixture's piece checked once; its planted runner), #3531's
  closing comment, #2662 (the compile counter, `Item.compiled`), #1172 (`Runner::sized`).
- `docs/canvas-primitives.md`: Logic `logic@1`, Logic: sandbox, Logic: linked libraries, Logic: library interfaces,
  Logic: checkpoints and bake. `docs/technical-design.md`: Sandbox and budgets, How we know version 0 works, Numbers
  version 0 has to hold. `docs/parallel-proof.md`: sections 5 to 7 and 12a. AGENTS.md, `GLOSSARY.md` and
  `docs/adr/0001-code-carries-no-comments.md` at this base.
- At the base, for surfaces only: `crates/deep-sandbox-wasmtime/src/lib.rs`, `crates/deep-logic/src/` (`lib.rs`,
  `fixtures.rs`, `interfaces.rs`, `piece.rs`, `world.rs`, `world/world_impl.rs`, `planted.rs`, `main.rs`, `live.rs`),
  `crates/deep-show/src/` (`sandbox.rs`, `hub.rs`, `main.rs`, `canvas_side.rs`), `scripts/proof-runs.mjs`,
  `scripts/benchmark.mjs`, `scripts/budget-window.mjs`, `scripts/comment-ratchet.mjs`, `benchmarks/budgets.json`, the
  suites `3612/`, `2662/`, `2324/`, `531/`, `3548/`, `2854/` and `3440/`, and `git log de00a9c64..11404f910` under
  `packs/`, `crates/deep-logic/`, `crates/deep-sandbox-wasmtime/`, `crates/deep-canvas-sandbox/` and the kept
  fixtures. The last three didn't move; `packs/` gained `circuit-2.0.0` and nothing else.

## Run them

Node 24, and `deep-logic` and `deep-show` built in this checkout's `target/debug` (each file builds what it drives,
`cargo build --locked --bin <name>`, unless the proof run supplies `DEEP_BIN_DIR`; with the lanes' profile, which the
helpers default to, a build made that way is found fresh and compiles nothing):

```sh
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node --test tests/acceptance/3529/ac1-core.test.mjs      # deep-show and deep-logic
node --test tests/acceptance/3529/ac1-logic.test.mjs     # deep-logic
node --test tests/acceptance/3529/ac2-goldens.test.mjs   # deep-logic
node --test tests/acceptance/3529/ac3-items.test.mjs     # deep-logic
node --test tests/acceptance/3529/ac4-budget.test.mjs    # nothing built
```

No test starts a hub, an app or a browser, uses the network or a GPU, or reads a clock: every number judged is a
count, a hash, a value a program wrote or a verdict. Each test carries its own limit (10 to 20 minutes; the budget
test one), each reply its own (8 minutes), and a program that doesn't answer in time is stopped by its PID and reads
`INCONCLUSIVE`. The core's evidence folder, under the system's temporary folder, is removed.

As readings at the base on this Mac (Mac17,10, 18 cores), at one-minute loads of 8 to 16: `ac1-core.test.mjs` 6 to 8 s
(the core's first answer with the 22 packs, then the refused count), `ac1-logic.test.mjs` 0.2 s (it fails at its
first reading there; about 15 s once both tests run whole, read on a stand-in for the count, `BASE-FAILURE.txt`),
`ac2-goldens.test.mjs` 0.3 s, `ac3-items.test.mjs` 0.2 s, `ac4-budget.test.mjs` 0.1 s. `record.mjs` takes 0.1 s.
The whole suite ends within a minute here.

## The surface under test

Two binaries, both as the base has them:

- **`deep-show canvas`**, the canvas core: one JSON line in, one answer out. `{"world": {"evidence", "sessions": {},
  "record": {}, "docs": {}, "packs": [{"id", "dir"}]}}` gives it the release's packs, each folder of `packs/` that
  holds a `pack.json`, in the hub's order, as `deepbuild/<name>`; `{"call": {"call": "packs"}}` is the hub's own
  first call of a core, answered with one row a pack once every pack is checked.
- **`deep-logic`**, the logic module's binary: one JSON line in, one reply out. `pack_check` (`{"call", "pack",
  "assets"}`) is the module's check of a pack's libraries and interfaces, given here exactly what the core gives it
  (`vet_libs`). `about`, `bake` and `golden` are read as they are. `--planted <name>` runs a planted runner, and
  several names apply together.

Four names are this job's. The issue gives none, and each is the least its criterion needs.

### The count (yours to provide)

The Scope says "the compile counter counts each program once a process in a pack's check", and criterion 1 reads that
counter in a canvas core, a process a test reaches only by its lines. The counter is the base's
(`deep_sandbox_wasmtime::compiles()`, #2662): one number for the process, which only a Rust test can read. Nothing at
the base lets a test read it from a binary; `piece_checks` (#3612) is the nearest call, and the count is read the
same way:

1. **`deep-logic`: `{"call": "compiles"}` answers `{"ok": true, "compiles": 48}`.**
2. **`deep-show canvas`: `{"call": {"call": "compiles"}}` answers `{"ok": true, "reply": {"compiles": 48}, …}`**,
   beside whatever else an answer line carries.

`compiles` is a whole number: what `deep_sandbox_wasmtime::compiles()` returns when the call is answered, the
modules this process has compiled so far, whoever needed them. It only rises, and reading it compiles nothing and
changes nothing. A new call was chosen over a field on an existing reply (`sandbox`'s, `packs`'s) so no suite that
compares one of those whole can break on it. The tests read it only where every compile is a logic item's program:
`deep-logic`'s calls, and a core that holds packs and no document.

The merge base answers neither call (`{"ok": false, "code": "bad_input"}`), so criterion 1's tests fail there at the
assertion that reads the count, saying so.

### The planted runners (yours to provide)

Two more names in `crates/deep-logic/src/planted.rs`, reached as the others are, by `deep-logic --planted <name>`.
The core needn't know them. Neither costs a build of its own.

**`item_compiles_own_program`**, criterion 1's wrong program: the merge base's runner. A world's runner of an item
compiles the item's program for that item, once an item and kept on the item, as the merge base's `World::runner`
does with `Item.compiled`; it neither takes nor leaves a compile of the same bytes made for another item. So two
items of the same bytes, in one piece or in two, are two compiles. It changes nothing else: every step, hash,
record, verdict and reply is the one given without it, and bytes that aren't an item's own program are compiled as
without it. Three readings pin it:

- alone, the checks of the 21 packs the issue read count more compiles than their 48 different programs (57 by
  reading: one for each piece), each bake of a library fixture's piece counts one more, and this suite's piece of
  two items of one program counts 2, and 2 more when it is baked again;
- with the base's own `fixture_checks_piece_twice` (#3612), which checks a fixture's piece again for its
  `logic.determinism` run and so makes its item again, the checks of those 21 packs count **109**: the merge base
  the issue read.

**`items_share_instance`**, criterion 3's wrong program, which the criterion names ("a planted runner that shares one
instance"): in a world, an item whose program's bytes are those of an earlier item of the same piece runs on that
item's instance, the base's `Runner::shared` between two items, so the two have one memory, one set of globals and
the rewrite's one fuel and trap counter. It changes nothing else: a piece whose items' bytes all differ, or that
holds one item, runs as without it, and every bake still answers.

### The budget's task (yours to provide)

Criterion 4 is the budget window's to judge, and the window measures a criterion once a task of
`benchmarks/budgets.json` names it (`docs/parallel-proof.md`, 12a). The task:

```json
{ "id": "canvas-core-first-reply", "command": ["node", "benchmarks/<name>.mjs", …], "margin": 0.5, "limits": {},
  "criteria": ["#3529.50c3d51b"], "initialReason": "…" }
```

`ac4-budget.test.mjs` reads exactly this: the id `canvas-core-first-reply`; `criteria` holding `#3529.50c3d51b`; a
command that is `node` and a benchmark file of the checkout under `benchmarks/`; a margin from 0 to 0.5; `limits`,
an object; and an `initialReason`. What the command must do isn't run by any test here, since it needs a release
build (The budget criterion): each run starts a fresh release `deep-show canvas`, gives it the shipped packs as the
hub stages them, sends one call and waits for the whole reply line, so the command's own time is the first reply's
and its peak memory the core's after that reply; it fails unless every pack is installed.

### Existing surfaces read

`pack_check`'s reply (`libraries[]: {name, fixtures: [{fixture, ran}], interfaces: [{interface, fixtures}]}`,
`interfaces[]: {name, label, judged: [{planted, fails}], kit: [{planted, example}]}`), `bake`'s (`items.<id>.{program,
hash}`, `steps[].{step, items.<id>.{hash, fuel, failed, pages}, arrays}`, `checkpoints.<id>[]: {step, deep_hash}`,
`traps[]: {item, step, kind}`, `peeks[]`), `golden`'s (`golden.{bake_key, step_hashes, checkpoint_hashes}`), `about`'s
(`interface`), the core's `packs` rows (`pack`, `version`, `state`, `issues`), and the base's planted runners
`fixture_checks_piece_twice` and `replay_changes_step_37`.

## A pack the issue didn't read

`logic.mjs` lists the 21 pack folders of the commit the issue's numbers were read on
(`PACK_FOLDERS_THE_ISSUE_READ`: every folder of `packs/` with a `pack.json` at `de00a9c64`, where `packs/` was as at
`aafef3131`). A missing one reads `BLOCKED`. Any other shipped pack is a newer one: at this base, `circuit-2.0.0`.
The issue gives no count for it, and this job can't count its different programs from outside: 40 of its 51 pieces
run on planted libraries, which link only inside the check. So it is held three ways, none by a number of this
job's:

- **Its own check compiles no program twice.** A piece's rewritten program is made from its fixture's program and
  the library it links, so a check's different programs are at most its different pairs of the two, read from the
  check's own reply and the pack's fixtures (45 for `circuit-2.0.0`). A check of a newer pack that counts more
  compiles than that compiled a program more than once, and fails, naming the pack. The base, by reading, counts 51.
- **Its library fixtures' pieces, baked twice, compile nothing the second time**, as every pack's (Naming a program).
- **On the core, its share is taken off.** The core's count is one number for all 22 packs. `deep-logic` of the
  same build checks the same packs in one process, and its count for the newer packs' checks is subtracted; what
  is left must be 48. No two shipped packs' checks run one program (no fixture's program and library are in two
  packs), so the order a core checks its packs in changes neither count. A `deep-logic` that answers no count
  where the core does fails there, naming the call.

## Naming a program

Criterion 1 wants a failure to name a program compiled twice, and the count is one number. So the judge finds one by
a second item. In the `deep-logic` process that has checked the packs, each library fixture's piece is baked as the
check made it, and then baked once more (39 pieces: each shipped library's interfaces' fixtures on it, and its own;
28 of them in the packs the issue read). The second bake's item is a second item of bytes the process has compiled,
so the count must not rise. Where it does, the program is named: the hash of its rewritten bytes (the bake's
`items.fixture.hash`), the file it is rewritten from and the fixture whose item it is, "compiled twice: this process
had compiled it, …, and compiled it again for a second item of the same bytes". The first of the two bakes is
printed and not judged: it counts 0 where the piece made here is byte for byte the check's own, which can't be seen
from outside the check. At the base the 28 pieces of the issue's packs run 22 different rewritten programs, and each
is, by the first 12 digits of its hash, one of the 48 in #3445's table of the bytes compiled, so a right program
should count 0 there too. The other pieces a check makes run on planted libraries; they are held by the count.

The same process then bakes this suite's piece of two items of one program, twice: 1 compile, then none (the
Scope's "a second item of the same bytes gets a fresh instance of the program already compiled").

`ac1-core.test.mjs` takes these readings from `deep-logic` of the same build only when the core's count is wrong, to
name a program in its failure.

## The programs

The base's suites assemble their programs with a crate of their own, which costs a build. This suite writes its two
as bytes (`wasm.mjs`):

- **`twinProgram`**, criterion 3's, 225 bytes. `init` does nothing. Its state is the i32 at 8192 of its memory and
  one mutable i32 global, both 0 at the start. A step reads the first entry of the item's first read control, when
  the step has one (the read region's count at 0, the entry's value at 16), as a whole number: 1 adds 1,000 to the
  memory's i32 and 7 to the global; 2 loops for ever, so the step runs out of fuel; 3 traps (`unreachable`). Then
  every step adds 1 to both and writes them as the item's one write, `state`, an i32 array of 2. So what an item
  holds at step k is known without a run (`twinStateAtStep`).
- **`mixerProgramOf2662`**, the program of #2662's golden, as `tests/acceptance/2662/goldens.rs` writes it in text:
  the bytes the `wat` crate gives that text, names section included. At the base the piece made of them has the
  golden's own three bake keys, which cover each item's rewritten program, so they are the bytes it was recorded on.

## Two items of the same bytes

`a` and `b` are two items of `twinProgram` in one piece of seed 3529, each reading a slider of its own (`poke_a`,
`poke_b`) and writing `state`, with a checkpoint every 10 steps, over 30 steps. `a` is told 1 at step 5 and 2 at
step 14; `b` is told 1 at step 9 and 3 at step 20. So each writes once, `a` runs out of fuel at step 14 and `b`
traps at step 20. An entry keeps its place in the whole track's order as its `seq`, alone or beside the other's.
The piece is baked, and then a piece of `a` alone and one of `b` alone, on that item's own entries. Each item beside
the other must be what it is alone: its `state` at every step (its memory and its global), each step's hash, fuel
and `failed`, its traps (step and kind), its checkpoints' full-state hashes, and its memory's i32 at the end. A
difference names the item, the step and what differs. Before that, each item alone is held to what its program says
and the two to one rewritten program; a reading that fails there is `BLOCKED`, since nothing of one item would be
there to show in the other.

## The fixtures and the goldens

- **Every fixture of #531** is the 14 programs of #531's suite that its check admits (`spin`, `tally`, `recurse`,
  `quiz`, `nine_fills`, `table_copy`, `lookup`, `start_forever`, `touch_pages`, `quiet_pages`, `src`, `aim`, `work`,
  `rules`), each as the item #531's tests build it, in one piece of seed 2324 over 60 steps of one track, with four
  traps among them. The base keeps them assembled in `tests/acceptance/2324/fixtures/base-bake.json` (#2324's
  reading of the same words), and they are read there, read only: it is the one place the base keeps them as bytes,
  and assembling #531's text again costs a build. `bake` gives each item's hash at every step and its checkpoints.
- **Every kept logic golden** is the two logic goldens the base keeps as files, the two #3445 replayed:
  `tests/acceptance/2324/fixtures/base-golden.json` (`table_copy`, 120 steps, with its piece) and
  `tests/acceptance/2662/fixtures/golden.json` (three items, 240 steps; its piece is written here as its
  `goldens.rs` writes it). `golden` records each on this build.

## The recording

Criterion 2's expected values are the merge base's own. They are in `base.json`, written by `record.mjs` from the
merge base's `deep-logic` through the functions the test reads this build with:

```sh
node tests/acceptance/3529/record.mjs            # writes base.json; refuses unless HEAD is the merge base
node tests/acceptance/3529/record.mjs --check    # records again and compares; writes nothing
```

- `files`: the SHA-256 of each of the three files above; a file that moved since reads `BLOCKED`.
- `reached`: each item's hash at every step and each checkpoint's step and full-state hash.
- `kept`: for each golden, whether the merge base reaches what the golden's own file holds, and whether its bake
  keys are the file's. `record.mjs` writes nothing while a golden's own hashes differ from what the merge base
  reaches, so "the step hashes it reached on the merge base" is one value.

It was recorded on November 27, 2026 from this base's debug `deep-logic`: 14 fixtures of #531 over 60 steps (695 of
the 840 steps have a hash; an item that has failed has none), #2324's golden (120) and #2662's (720), and 79
checkpoints. Both goldens reach on the merge base exactly what their own files hold. #2662's bake keys are its
file's; #2324's aren't, since a bake key names the engine's version and that golden was recorded on an earlier one.
A second recording (`--check`) gave the same file, and every hash is the one this job recorded at `de00a9c64`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId`, computed from the issue's body. Each test's title starts `AC<n>
#3529.<id>`, and so does each failure message.

| ID | Test | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|
| `#3529.1f362433` | `ac1-core.test.mjs`: "a fresh canvas core with the shipped packs answers its first call having counted as many compiles as it compiled different programs: 48 for the 48 of the packs the issue read, beside what a newer pack's own check counts" | A fresh core with the 22 packs answers `packs` with every pack installed (else `BLOCKED`), then `compiles`. Less what `deep-logic` of the same build counts for the newer packs' checks, it must be 48. On another count it names a program compiled twice, found on `deep-logic` | the base (no count: it fails naming the call and its answer); a core whose runner compiles a program for each item (57 left, naming a program); any repeat left |
| `#3529.1f362433` | `ac1-logic.test.mjs`: "the logic module counts as many compiles as the shipped packs' checks compile different programs: 48 for the 48 of the packs the issue read, no more for a newer pack than its fixtures' different programs, and none for a second item of the same bytes" | The checks in one process count 48 on the 21 packs the issue read, and on a newer pack no more than its different pairs of program and library; each of the 39 library fixtures' pieces, baked and then baked again, counts 0 the second time; two items of one program count 1, then 0 | the base (no count); the planted runner (next row); a cache a check doesn't share with the next; a counter that doesn't rise |
| `#3529.1f362433` | `ac1-logic.test.mjs`: "the merge base's runner, planted, counts more compiles than different programs and fails, naming a program compiled twice, and with its fixture run that checks a piece twice it counts the issue's 109 for 48 on the packs the issue read" | `--planted item_compiles_own_program`: more than 48 on the issue's packs, the judge reports problems, one names a program compiled twice by hash, file and fixture; with `--planted fixture_checks_piece_twice` too, on the issue's 21 packs: 109 | the base (it knows no such runner, and says so); a planted runner that isn't the merge base's (another count); a judge that passes it or names no program |
| `#3529.cc8f3bb2` | `ac2-goldens.test.mjs`: "every fixture of #531 and every kept logic golden reaches the step hashes it reached on the merge base, and a hash that moves fails, naming the golden and the step" | Every item's hash at every step and every checkpoint's full-state hash equal `base.json`. Then the control: on `--planted replay_changes_step_37` the judge must name step 37 of a fixture of #531, of #2324's golden and of #2662's | `step_37_hash_moves` (below); `replay_changes_step_37` (the control, no build); any change of a step's bits or a checkpoint |
| `#3529.be72c1ed` | `ac3-items.test.mjs`: "two items of the same bytes in one piece keep their own memory, globals, fuel and trap, and a planted runner that shares one instance fails, naming the item" | `a` and `b` beside each other are each what they are alone. Then on `--planted items_share_instance` the same judge must fail, naming the item | the base (it knows no such runner, and says so); `items_share_instance`; a runner whose items share memory, a global, a fuel budget or a trap |
| `#3529.50c3d51b` | `ac4-budget.test.mjs`: "a task of benchmarks/budgets.json, canvas-core-first-reply, names the criterion, …" | The task above is in `benchmarks/budgets.json` with a command, a margin of at most 0.5, limits and a reason | the base (no task names the criterion); a task with a wider margin or no command |

## The wrong programs

| Criterion | Wrong program | How it is reached | The test that fails, and what it names |
|---|---|---|---|
| `#3529.1f362433` | the merge base | its own run | both first tests, naming the `compiles` call and its answer |
| `#3529.1f362433` | `item_compiles_own_program` | `deep-logic --planted`, in the test | the second test of `ac1-logic.test.mjs` has the judge fail it, naming a program compiled twice |
| `#3529.cc8f3bb2` | `step_37_hash_moves` | the twin `twins/step_37_hash_moves/lines.json`, one build | `ac2-goldens.test.mjs` fails, naming each item that runs step 37 and step 37: "#2662's golden (…), item a: step 37's hash was … on the merge base and is …" |
| `#3529.cc8f3bb2` | `replay_changes_step_37` | `deep-logic --planted`, in the test (the base has it) | the control has the judge name step 37 of each of the three |
| `#3529.be72c1ed` | `items_share_instance` | `deep-logic --planted`, in the test | the test has the judge fail it, naming the item: "item b: at step 0 its memory holds 2 beside a and 1 alone, …" |
| `#3529.50c3d51b` | the merge base | its own run | `ac4-budget.test.mjs`, naming the criterion no task names |

Criterion 2 says what stays as it is, so its test passes on the merge base, and the before lane needs a wrong
program it can lay over the work: `twins.json` names `step_37_hash_moves`, kept as its wrong line (#1832's form, the
line #3612's suite uses). It is the work where step 37's hash of every item has its lowest bit flipped: in
`crates/deep-logic/src/world.rs` `report`, the row's `hash` is `h ^ 1` when `k == 37`. Its `find` matches this base's
file at exactly one place; this job built neither it nor the work. If its line no longer applies to the work, make
the same one-place change in the file as the work holds it and write its `lines.json` again; the test stays as it
is. The control inside the test runs a wrong program of the same kind without a build.

Criterion 3's first sentence holds on the merge base, where each item compiles and instantiates its own program.
Its test still fails there, at the planted runner the criterion names and the base lacks, so it needs no twin.

## Readings where the issue leaves a choice

- **Where the count is read.** A call each binary answers, as `piece_checks` is, since criterion 1 speaks of a
  canvas core. One number, the counter's own: the issue wants a count, not a table.
- **"As many compiles as it compiled different programs"** is 48 for the 21 packs the issue read: the issue's count
  of their different programs. The count is not read from the binary beside the compiles, since a right program
  would answer one number twice, and the test can't count the programs itself: 29 of those packs' 57 pieces run on
  planted libraries, which link only inside the check. Those 21 packs are as they were at the commit the issue's
  numbers were read on, so the 48 stands. A redraft is needed when one of them gains or loses a fixture; a new pack
  needs none.
- **"Naming a program compiled twice"** is a program the process has compiled, compiled again for a second item of
  the same bytes (Naming a program). A program is named by the hash of its rewritten bytes, the bytes that are
  compiled, with the file it is rewritten from and its fixture.
- **The core's first call** is `packs`, the hub's own first call of a core, and the count is the call after it: the
  core checks every pack before its first answer, and reading the count compiles nothing.
- **"With the shipped packs"**: the core is given every folder of `packs/` that holds a `pack.json`, 22 at this
  base, in the hub's order and under the hub's IDs, as #3612's suite gives them. At the base it installs all 22; a
  core that doesn't reads `BLOCKED`.
- **A missing count is a failure, not `BLOCKED`.** A core or a `deep-logic` that answers the call without a count
  fails the assertion that reads it, naming the call and the answer. A program that can't be built or started, a
  pack the core didn't install, or a call that gets no answer in time is `BLOCKED` or `INCONCLUSIVE`, naming it.
- **"The step hashes"** are each item's hash at every step, as a bake's step rows and a golden's `step_hashes` hold
  them. Each checkpoint's full-state hash is held too: a golden keeps both (the Proof's "the goldens' hashes"), and
  a state that moved without moving a write shows only there. A failure names the step either way. A golden's bake
  keys aren't held: #2324's names the engine version it was recorded on. Each fixture of #531 is named by its item.
- **"Two items of the same bytes in one piece"** is two items that name one program and so run one rewritten
  program, each with a control of its own, so one can be told to write while the other isn't.
- **"Their own memory, globals, fuel and trap"**: memory is the i32 the program keeps outside its regions, globals
  its mutable global, both written out every step; fuel is what each step took, and one item's step that runs out
  of fuel leaves the other's steps their own; trap is the step an item fails at and its kind, one item's by fuel
  and the other's by `unreachable`, six steps apart. "Never shows in the other" is each item beside the other
  equal to itself alone.
- **"A planted runner that shares one instance"** is one of its own. The base's `forks_share_store` (#2662) shares
  a store between a world's forks of one item, has no `--planted` name and does nothing to a bake of two items.
- **One test for criterion 3.** Both of its sentences are in one test, so it fails on the merge base at the planted
  runner and needs no twin, which would cost a build.

## Readings where the issue and the base disagree

- **"The shipped packs"** (criterion 1) were 21 when the issue's numbers were read and are 22 at this base. The
  first sentence is held on all 22: the core is given every one, and no program may be compiled twice in any
  check. Its number, 48, is the 21's, and is held on them. What isn't held: one number for "as many compiles as
  different programs" on all 22, since neither the issue nor anything a test can read from outside gives
  `circuit-2.0.0`'s different programs. It is held to "no more than 45" there (A pack the issue didn't read).
- **"The pack check makes each item again for the fixture's `logic.determinism` run, so every fixture's program is
  compiled twice"** (opening paragraph) no longer describes the base. Since #3612 a fixture's run checks its piece
  once and gives that piece to its bake and its `logic.determinism` run (`fixtures.rs` `fixture_runs`), and
  `World::runner` keeps the compile on the item, so the second run finds it. What is left is "a program two
  fixtures link is compiled for each", and a kit twin's piece that runs a fixture's program.
- **"The merge base counts 109 for 48"** (criterion 1). By reading, this base counts one compile for each piece its
  checks make: 57 on the 21 packs the issue read (9 of them a program the process has compiled) and 51 on
  `circuit-2.0.0`, 108 in all. This job could not read that by running the base: no binary of the base answers a
  compile count. What the base does answer agrees: its checks make 57 and 51 piece checks, and with
  `fixture_checks_piece_twice` 109 on the 21 packs, split by pack as #3445's compile table (`BASE-FAILURE.txt`).
  What is held of the sentence: the count equal to the different programs (48 on the issue's packs, both first
  tests); the merge base failing (it fails both, at the missing count); a failure naming a program compiled twice,
  and 109 for 48 (the second test of `ac1-logic.test.mjs`, on the work, on the issue's 21 packs, where
  `item_compiles_own_program` is the merge base's runner and the base's own `fixture_checks_piece_twice` puts back
  the second check the issue's merge base still made). What isn't held: "counts 109" as the base's own run; 57,
  51 and 108 are asserted nowhere, only that the planted runner alone counts more than 48 on the issue's packs.
- **"At least 500 ms less (drafted)"** (criterion 4) was drafted on 61 repeated compiles, 862 ms of a 3,854 ms first
  reply. On the packs the issue read the base repeats 9, about 117 ms by the mean time a compile of each of those
  six programs in #3445's table; what it repeats in `circuit-2.0.0` no table gives. No test here judges the number,
  which is drafted and the owner's; it is said here because the budget window will read it against this merge base.

## The budget criterion

The comparison with the merge base is the budget window's, on a reference Mac: it runs a task on the commit and on
its merge base, 20 samples a side. A checkout can't run its own merge base, a debug build's time is no budget's
(`docs/parallel-proof.md`, 12a: none timing a debug build), and the `Runs on:` line draws the same line: any machine
for the count, a reference Mac in a budget window for the time. So `ac4-budget.test.mjs` judges no time and no
memory: it holds that a task names the criterion, so the window measures it, with no more room than the design's
50%. A pass of it is not a pass of the budget. This job read no time and no memory at the base either: it was
given no release build, and takes no timing.

Two things the lanes leave open, for the pull request to say:

- A task the merge base lacks has no base side in its own commit's window (`scripts/benchmark.mjs` `judgeTask`: an
  initial measurement). So this change's "at least 500 ms less" is the Proof line's reading, "the first reply's time
  on both", taken by the implementer on both sides as AGENTS.md, Delivery, says a budget is read under load.
- The 500 ms itself (Readings where the issue and the base disagree).

## Not asserted

- Times and memory. The issue's 1,568 ms, 862 ms and 3,854 ms are readings and set no budget; no test reads a clock
  or a process's memory.
- How a program is kept: by its bytes on a thread as `Runner::sized` keeps a provider's, for how long, and what
  happens past the 256 programs a thread keeps. The Scope says how; the criteria hold the count and each item's own
  state.
- Compiles off the checking thread, in a second core thread or in the web player, and compiles of a provider's, a
  validator's or a counted rewrite's bytes. The checks of the packs the issue read make none (#3445's table).
- A compiled module kept across starts, `parallel-compilation`, and the rest of a pack's check, which the issue
  leaves out.
- Each pack's own count among the 21, and how many different programs `circuit-2.0.0`'s check compiles. Only the 48
  is the issue's; a pack's count is printed.
- Piece checks (#3612's count), `logic.determinism`'s verdicts and the fixtures' own expected values, which #3612's
  suite holds. That suite pins 57 piece checks on every folder of `packs/`; it is not this job's to change.
- A hub: the core is driven directly, as the hub drives it.

## What the implementer adds outside this folder

- The count's two calls, the two planted runners and the budget's task, as above.
- Nothing in a `Cargo.toml`: the suite holds no Rust test. `lane.json` is here already and names no timed or slow
  file: no file of the suite reads a clock, and none is slow.
- Nothing in `scripts/lanes.mjs` or `scripts/lanes-lists.mjs`.

## What the base does

`BASE-FAILURE.txt` has each file's run at the base and the probes' readings: the five tests of new behaviour fail
there at their own assertion, and criterion 2's passes.
