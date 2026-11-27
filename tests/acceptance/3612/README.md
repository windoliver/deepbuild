# Acceptance tests for #3612: a fixture's piece is checked once for its bake and its determinism run

Written first, blind, from issue #3612 as it reads on November 26, 2026 (its opening paragraph, Scope, three acceptance
criteria, `Runs on:` and Proof lines; no comments), the two design sections it links (canvas primitives: Logic: linked
libraries, Logic: sandbox), the issues it names (#3531 with its closing comment, #3529, #2662, #310, #171) and base
commit `fd2899677b778284ddc6e860010b8831823b3901` (`origin/main`, whose last merge is #3614), by a job that never saw
an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding). Lean: one test a criterion, and one more for criterion 1's canvas
core and one for its planted runner, each of which needs its own run.

## Files

| File | Criterion | What it runs |
|---|---|---|
| `ac1-core.test.mjs` | `#3612.77719146` | one fresh `deep-show canvas` with the 21 shipped packs: its first call, `packs`, then the count of piece checks, which must be 57 |
| `ac1-logic.test.mjs` | `#3612.77719146` | `deep-logic`: each shipped pack's check with the count read around it, and each shipped library linked alone; then the same on the planted runner, which must count 109 and fail, naming a fixture |
| `ac2-fixtures.test.mjs` | `#3612.0873686d` | `deep-logic`: each shipped pack's check and each library fixture's piece baked and held to logic.determinism, compared with the merge base's recording |
| `ac3-planted.test.mjs` | `#3612.5bdaac1f` | `deep-logic --planted <runner>`: each planted fixture run that failed logic.determinism on the merge base, asked again; then the control |
| `common.mjs` | | the criteria's IDs, `must`, where a binary is taken from, the line driver |
| `logic.mjs` | | the shipped packs as the core hands them to the pack check, a fixture's piece as the check makes it, the count, the three judges |
| `core.mjs` | | the canvas core's driver |
| `record.mjs`, `base.json` | criteria 2 and 3 | the merge base's recording and the script that made it |
| `twins.json`, `twins/` | criteria 2 and 3 | the two wrong programs, as their wrong lines |
| `lane.json` | | the suite runs alone: its files build and run binaries from the checkout's `target/` |
| `BASE-FAILURE.txt` | | each file run at the base |

## What was read

- The issue and the issues it names, for the words it cites: #3531's closing comment (109 piece checks for 57 pieces,
  52 for a bake, 52 for its determinism run, 5 for an interface kit's twins), #3529 (the compiles, which are not this
  task), #2662 (how the sandbox's compile count is read).
- `docs/canvas-primitives.md`: Logic: linked libraries, Logic: sandbox, Logic: library interfaces, Pack.
  `docs/technical-design.md`: How we know version 0 works (Criteria to tests, Criteria in a checked shape, Wrong
  programs, the edit guard), Dogfooding. `docs/parallel-proof.md`: sections 5 to 7. AGENTS.md.
- At the base, for surfaces only: `crates/deep-logic/src/lib.rs` (`handle`, `check`, `bake`, `baked`, `determinism`),
  `fixtures.rs` (`fixtures`, `verify`, `run_fixtures`, `pack_check`, `claim`), `interfaces.rs` (`judge_interface`, `kit`,
  `interface_fixtures`, `fixture_call`, `interface_fixture`, `imported`), `judge.rs`, `checks.rs` (`determinism`),
  `planted.rs`, `main.rs`, `links.rs` (`packs`, `resolve`), `first_party.rs`, `piece/checks.rs` (`check`, `check_in`),
  `world.rs` (`report`, `changed`) and `world/world_impl.rs` (where a planted runner acts);
  `crates/deep-show/src/sandbox.rs` (`vet_libs`), `packs.rs` (`lib_check`, `rows_reply`), `canvas_side.rs`, `hub.rs`
  (the calls), `main.rs` (a scenario's `planted`); `crates/deep-sandbox-wasmtime/src/lib.rs` (`compiles`);
  `crates/deep-show/tests/pack_vet_once.rs` and `canvas_packs.rs`; `packages/hub/src/packs.ts` (`readPack`,
  `releasePacks`) and `canvas.ts` (`checkPacks`); `scripts/proof-change.mjs`, `proof-runs.mjs` (`before`, `atAssertion`,
  `twinsOf`, `twinOverlay`), `proof-binaries.mjs` (`selectBinaries`), `lanes.mjs`, `twins-lint.mjs`; the suites
  `2662/`, `2694/`, `3262/`, `1720/`, `3108/`, `531/` and `1832/` (READMEs and helpers).

## Run them

Node 24, and `deep-logic` and `deep-show` built in this checkout's `target/debug` (each file builds what it drives,
`cargo build --locked --bin <name>`, unless the proof run supplies `DEEP_BIN_DIR`; with the lanes' profile, which the
helpers default to, a build made that way is found fresh and compiles nothing):

```sh
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node --test tests/acceptance/3612/ac1-core.test.mjs       # deep-show and deep-logic
node --test tests/acceptance/3612/ac1-logic.test.mjs      # deep-logic
node --test tests/acceptance/3612/ac2-fixtures.test.mjs   # deep-logic
node --test tests/acceptance/3612/ac3-planted.test.mjs    # deep-logic
```

No test starts a hub, an app or a browser, uses the network or a GPU, or reads a clock: every number judged is a
count, a hash or a verdict. Each test carries its own limit (10 or 12 minutes), each reply its own (5 minutes), and a
program that doesn't answer in time is stopped and reads `INCONCLUSIVE`. Every process is stopped by its PID, and the
core's evidence folder, under the system's temporary folder, is removed.

As readings at the base on this Mac (Mac17,10, 18 cores), three runs of each file at one-minute loads of 30 to 89:
`ac1-core.test.mjs` 12 to 19 s (the core's first reply with the 21 packs took 6 s at a load of 56),
`ac1-logic.test.mjs` 2 s (it fails at its first reading there; about 21 s once both tests run whole, read on a
stand-in, `BASE-FAILURE.txt`), `ac2-fixtures.test.mjs` 8 to 10 s, `ac3-planted.test.mjs` 4 to 6 s. The whole suite
ends within a minute here. `record.mjs` takes 7 to 9 minutes: it tries 65 planted runners at 13 places each.

## The surface under test

Two binaries, both as the base has them:

- **`deep-show canvas`**, the canvas core: one JSON line in, one answer out. `{"world": {"evidence", "sessions": {},
  "record": {}, "docs": {}, "packs": [{"id", "dir"}]}}` gives it the release's packs, each folder of `packs/` that
  holds a `pack.json`, in the hub's order, as `deepbuild/<name>` (`releasePacks`, `readPack`); `{"call": {"call":
  "packs"}}` is the hub's own first call of a core (`checkPacks`), answered with one row a pack once every pack is
  checked.
- **`deep-logic`**, the logic module's binary: one JSON line in, one reply out. `pack_check` (`{"call", "pack",
  "assets"}`) is the module's check of a pack's libraries and interfaces, given here exactly what the core gives it
  (`vet_libs`: the pack's name, version, origin `first_party`, `libs` and `interfaces`, and every asset its
  `pack.json` lists, by hash). `check`, `bake`, `determinism`, `claim` and `about` are read as they are. `--planted
  <name>` runs a planted runner, and several names apply together.

Three names are this job's. The issue gives none, and each is the least its criterion needs.

### The count (yours to provide)

The Scope says "the logic module counts the pieces it checked, as the sandbox counts compiles, so a test reads the
count from the binary". The sandbox's count (`deep_sandbox_wasmtime::compiles()`, #2662) is one number for the
process, which only a Rust test can read. The count of piece checks is the same kind of number, and both binaries
answer it:

1. **`deep-logic`: `{"call": "piece_checks"}` answers `{"ok": true, "piece_checks": 57}`.**
2. **`deep-show canvas`: `{"call": {"call": "piece_checks"}}` answers `{"ok": true, "reply": {"piece_checks": 57},
   …}`**, beside whatever else an answer line carries.

`piece_checks` is a whole number: how many times a `Logic` of this process has checked a piece so far, one for each
check (at the base, each run of `Logic::check` in `crates/deep-logic/src/lib.rs`, which resolves and links the
piece's programs, subset-checks and rewrites them), whoever asked: a `check`, `bake`, `determinism`, `judge` or
`claim` call, or the module's own run of a fixture or a kit twin at a pack's check or a library's link. That is the
check the issue's opening paragraph counts twice a fixture. It is the process's, not one `Logic`'s: the core makes a
`Logic` for each pack. It only rises, and asking for it checks nothing and changes nothing. How the module keeps it
is the implementer's. The tests read it only where every piece check is a `Logic`'s: `deep-logic`'s calls, and a core
that holds packs and no document.

The merge base answers neither call (`{"ok": false, "code": "bad_input"}`), so both of criterion 1's first tests fail
there at the assertion that reads the count, saying so. Nothing at the base lets a test read a count of piece checks
from a binary: the 109 of the issue is #3531's reading of a build it made for the purpose.

### The planted runner (yours to provide)

Criterion 1 names its wrong program, the merge base, which "counts 109 and fails, naming a fixture whose piece was
checked twice". The merge base keeps no count, so the sentence is held on the work, by a planted runner that does
what the merge base does:

**`deep-logic --planted fixture_checks_piece_twice`**: every fixture run of the logic module (a library's own fixture
and an interface's fixture on a library under test or on a planted library; at a pack's check, at a library's link
and for a claim) makes and checks the fixture's piece a second time for its logic.determinism run, as the merge
base's `Logic::determinism` does on the fixture's call. The count rises by two for a fixture run. It changes nothing
else: every verdict, record, hash and reply is the one given without it, a kit twin's piece is still checked once,
and the `check`, `bake`, `determinism`, `judge` and `claim` calls check what they check without it. On the shipped
packs' checks it counts 109 for the same 57 pieces. It is one more name in `crates/deep-logic/src/planted.rs`, reached
as the others are; the core needn't know it.

### One fixture alone

"Naming a fixture whose piece was checked twice" needs one fixture's checks apart from the rest, and a pack's check
runs all its fixtures in one call. A link does it. In a `deep-logic` process of its own, for one shipped library:

1. `{"call": "claim", "piece": {"packs": [pack], "assets"}, "library", "interface"}` for each interface the library
   implements, which must answer `PASS`: the interface's fixtures have then run on the library, and this process
   doesn't run them again.
2. the count is read;
3. `{"call": "check", "piece"}`, the piece of the library's own fixture as `run_fixtures` makes it: a piece that links
   the library, so the check runs the library's own fixtures, which haven't run. Its receipt must say so: the
   library's own fixtures `ran`, its interfaces' didn't (else `BLOCKED`);
4. the count is read again.

The rise is one for the piece that was given, and what the library's own fixtures' pieces cost. Each shipped library
ships one fixture of its own, so a rise of 2 is that fixture's piece checked once, and a rise of 3 is it checked
twice, by name. This is the Scope's "at a library's link".

### Existing surfaces read

`pack_check`'s reply (`libraries[]: {name, hash, fixtures: [{fixture, verdict, ran, deep_hashes}], interfaces:
[{interface, fixtures}]}`, `interfaces[]: {name, label, digest, judged: [{planted, fails}], kit: [{planted, example,
expect, raised}]}`, or `{ok: false, code: "pack_refused", refusals}`), `check`'s (`items.fixture.libraries`, or
`link_refused`), `bake`'s (`steps[].step`, `steps[].items.fixture.hash`, `checkpoints.fixture[]: {step, deep_hash}`,
`traps`), `determinism`'s (`verdict`, `failures`), `claim`'s (`verdict`), a refusal's `fixture`, `step`, `what` and
`failures`, the core's `packs` rows (`pack`, `version`, `state`, `issues`), and the planted runners the base's
`planted.rs` names.

## The pieces a check makes

The issue counts 57 pieces: 52 fixture runs and 5 kit twins. `piecesOf` reads them from each check's own reply: a
record that `ran` is a fixture run on a library; a planted library ran the interface's fixtures in order up to the one
`judged` says it failed; a `kit` row is a twin. `ac1-logic.test.mjs` holds each check's count to the pieces of its own
reply, and the seven checks' pieces to the issue's 57.

## The recording

Criterion 2's expected values are the merge base's own, and criterion 3's runners are the ones that fail a fixture
there. Both are in `base.json`, written by `record.mjs` from the merge base's `deep-logic` through the functions the
tests read this build with:

```sh
node tests/acceptance/3612/record.mjs            # writes base.json; refuses unless HEAD is the merge base
node tests/acceptance/3612/record.mjs --check    # records again and compares; writes nothing
```

- `fixtures`: for each of the seven packs, what its check answered (each fixture's verdict and full-state hashes by
  step, each planted library's first failed fixture, each kit twin's rules), and for each of the 28 fixtures a shipped
  library runs (22 of its interfaces' and 6 of its own), the piece baked as the check makes it: the hash of every step,
  each checkpoint's full-state hash, each trap, and the logic.determinism verdict with its failures (`at_times: [0]`,
  as the check asks).
- `planted`: `record.mjs` tries every planted runner `planted.rs` names on every pack's check and every library's
  link, and keeps each one that is refused there for a fixture failing logic.determinism, with the refusal: the
  fixture and the failures, which are what the run compared. Each kept entry was asked three times, each in a process
  of its own; `varies` marks one whose failures differ between them (none does). At the base, 2 of the 65 runners
  fail a fixture's logic.determinism run, at 7 places: `restore_keeps_regions_only` at the checks of `circuit`,
  `lanes` and `process` and at the links of their three libraries (`fault.json`, `straight.json` and `steady.json`,
  by a seek or a probe from the checkpoint at step 0), and `logic_reads_wall_clock` at the link of
  `separation_ref@1.0.0` (`crossing.json`, by the playback and the second run). The other 63 fail no fixture's
  logic.determinism run: most change nothing a fixture reaches, and one that fails a fixture's expected values first
  (`replay_changes_step_37` among them) isn't refused for logic.determinism.
- `control`: one kept entry, with the base's own `check_compares_step_hashes` beside its runner:
  `restore_keeps_regions_only` at the check of `circuit`.

A second recording at the base (`--check`) gave the same file.

A reader makes it again by checking out the merge base, building `deep-logic` there and running the first command;
the second, in any checkout, prints each difference between that build and the recording.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId`, computed from the issue's body. Each test's title starts `AC<n>
#3612.<id>`, and so does each failure message.

| ID | Test | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|
| `#3612.77719146` | `ac1-core.test.mjs`: "a fresh canvas core with the shipped packs answers its first call having checked each fixture's piece once: 57 piece checks for 57 pieces" | A fresh core with the 21 packs answers `packs` with every pack installed (else `BLOCKED`), then `piece_checks`: 57. On another count it links each shipped library alone on `deep-logic` and names a fixture whose piece was checked twice | the base (no count: it fails naming the call and its answer); a core whose fixture runs check their piece again (109, naming a fixture); a core that checks any piece again |
| `#3612.77719146` | `ac1-logic.test.mjs`: "the logic module checks each shipped fixture's piece once: 57 piece checks for the 57 pieces the shipped packs' checks make, and one for a fixture's piece at its library's link" | Each of the seven checks makes as many piece checks as its reply lists pieces; 57 pieces and 57 checks in all; each of the six libraries' links checks 2 pieces, the one given and its own fixture's | the base (no count); the planted runner (next row); a check that skips a piece (a count under the pieces) |
| `#3612.77719146` | `ac1-logic.test.mjs`: "the merge base's fixture run, planted, counts 109 piece checks for the same 57 pieces and fails, naming a fixture whose piece was checked twice" | The same readings on `--planted fixture_checks_piece_twice`: 109 for 57; the same judge reports problems; one names a fixture, by hash and file, whose piece was checked 2 times at its library's link | the base (it knows no such runner, and says so); a planted runner that isn't the merge base's fixture run (another count); a judge that passes it or names no fixture |
| `#3612.0873686d` | `ac2-fixtures.test.mjs`: "every fixture of every shipped pack reaches the step hashes and the logic.determinism verdict it reached on the merge base" | Every pack's check and every library fixture's piece equal `base.json`: verdicts, full-state hashes by step, first failed fixtures, kit rules, every step's hash, checkpoints, traps, logic.determinism's verdict and failures. Each difference names the fixture (hash and file) and the step | `step_37_hash_moves` (below): each fixture of 38 steps or more fails, naming itself and step 37; any change of a step's bits, a checkpoint or a verdict |
| `#3612.5bdaac1f` | `ac3-planted.test.mjs`: "each planted runner that fails a fixture's logic.determinism run on the merge base still fails it, naming the fixture, by what the run compared there" | Each entry of `base.json`'s `planted`, in a process of its own: refused with the same code, for the same fixture, as failing logic.determinism, with the same failures. Then the control must fail the same judge | `compares_step_hashes_only` (below); a fixture run whose logic.determinism is skipped, or compares another piece, another track or fewer runs |

Criteria 2 and 3 say what stays as it is, so their tests pass on the merge base, and each names a wrong program.

## The wrong programs (twins)

`twins.json` names one twin for each of criteria 2 and 3, kept as its wrong lines (`twins/<name>/lines.json`,
#1832's form). Each edits one line of a file the issue doesn't name, so it should lay over the work as it is. This
job checked that each `find` matches the base's file at exactly one place and built neither, since it may edit
nothing outside this folder. The second twin's program was run at the base without a build, as `--planted <runner>
--planted check_compares_step_hashes` on each of the 7 kept entries: the judge fails all 7, each naming its fixture
(`BASE-FAILURE.txt`). The first twin's program was not run: the judge was given the recording with step 37's hash
moved in every fixture of 38 steps or more, and failed each of the 10, naming it and step 37.

| Criterion | Twin | The wrong program | The test that fails, and what it names |
|---|---|---|---|
| `#3612.0873686d` | `step_37_hash_moves` | The work, where step 37's hash of every item has its lowest bit flipped: in `crates/deep-logic/src/world.rs` `report`, the row's `hash` is `h ^ 1` when `k == 37`. Every run moves alike, so logic.determinism and every pack's check still pass | `ac2-fixtures.test.mjs` fails, naming each fixture of 38 steps or more (10 of the 28) and step 37: "…'s fixture `<hash>` (`packs/…/fixtures/….json`): step 37's hash was … on the merge base and is …" |
| `#3612.5bdaac1f` | `compares_step_hashes_only` | The work, where logic.determinism compares step hashes alone: in `crates/deep-logic/src/checks.rs` `determinism`, `hashes_only` is `true` (the base's planted `check_compares_step_hashes`, always on). No full-state hash, array, region or playback is compared | `ac3-planted.test.mjs` fails, naming the fixture each planted runner no longer fails, or fails by other failures than on the merge base |

If a twin's lines no longer apply to the work, or it doesn't build beside it, make the same one-place change in the
file as the work holds it and write the twin's `lines.json` again; the tests stay as they are. The control inside
`ac3-planted.test.mjs` runs the second twin's program without a build (`--planted <runner> --planted
check_compares_step_hashes`), so every run of the file shows its judge failing a run that compares less.

## Readings where the issue leaves a choice

- **Where the count is read.** "From the binary" is read as a call each binary answers, since criterion 1 speaks of
  a canvas core, a process a test reaches only by its lines. A new call was chosen over a field on an existing reply
  (`sandbox`'s, `packs`'s) so no suite that compares one of those whole can break on it. One number, as the
  sandbox's compiles are one number: the issue asks for a count, not a table.
- **"Having checked each fixture's piece once: 57 piece checks for 57 pieces"** is the count after the core's first
  answer, 57, the issue's value. That the pieces are 57 is read from the checks' own replies on `deep-logic`, where
  every check's count is held to its own pieces, and one fixture a library is held to once by a link.
- **The core's first call** is `packs`, the hub's own first call of a core, and the count is the call after it: the
  core checks every pack before its first answer, and a read checks nothing.
- **"With the shipped packs"**: the core is given each pack's own folder under `packs/`, in the hub's order and under
  the hub's IDs, not the copy the hub stages of it; the core reads either the same way, as
  `crates/deep-show/tests/pack_vet_once.rs` gives it one. At the base it installs all 21.
- **"The merge base counts 109 and fails, naming a fixture"**: the merge base has no count to read, so its own run of
  these tests fails at the count (`BASE-FAILURE.txt`), and the sentence is held by the planted runner on the work. A
  twin laid over the work was not chosen: only the implementer can write its lines, and it costs a build.
- **A missing count is a failure, not `BLOCKED`.** A core or a `deep-logic` that answers the call without a count
  fails the assertion that reads it, naming the call and the answer, as #2694's suite reads its `held`. A program
  that can't be built or started, a pack the core didn't install, or a call that gets no answer in time is `BLOCKED`
  or `INCONCLUSIVE`, naming it.
- **"Step hashes"** are the hashes a bake's step records carry (`steps[].items.<item>.hash`), the ones a golden
  keeps. A pack's check answers with a fixture's verdict and its checkpoints' full-state hashes, not its step
  hashes, so each library fixture's piece is baked as the check makes it and its steps read from that bake, with
  the check's own reply held beside it. Both are compared.
- **"Every fixture of every shipped pack"** is the 32 fixtures the seven packs name. The 28 a shipped library runs
  are baked. The four of `interfaces` (and every interface's fixtures on its planted libraries) run only on planted
  libraries, whose pieces link only inside the check that judges them, so they are held by the check's reply: which
  fixture each planted library fails first, and each kit twin's rules. One of the 32 reaches nothing on the merge
  base: `packs/interfaces-1.0.0/fixtures/fall.json` is the second fixture of `physics2d.lib@1`, whose one planted
  library fails the first, and no shipped library implements that interface, so no check runs it. It is held the
  same way: the planted library still fails `slide.json` first.
- **"The `logic.determinism` verdict it reached"** is read twice: at the pack's check, where a record's `PASS` means
  the fixture's expected arrays held and logic.determinism passed, and from `determinism` on the fixture's piece
  with the check's own `at_times`, with its failures.
- **"Each planted runner that fails a fixture's `logic.determinism` run on the merge base"** is found by running
  every planted runner of `planted.rs` at the base, at both places the Scope names (a pack's check, a library's
  link). A runner that fails a fixture's expected arrays first, or that the check refuses for another reason, is not
  one: the refusal must name a fixture as failing logic.determinism.
- **"Still fails it, naming the fixture: the run compares what it compared before"** is the same refusal: the same
  fixture, and the same `failures` (each one's run, checkpoint, step, field and array), which are what the run
  compared. A runner whose failures vary from run to run on the merge base is held to the fixture alone.
- **"On the piece the bake checked"** isn't read apart from the count: a run on another piece would check it
  (criterion 1) or compare otherwise (criterion 3).

## Not asserted

- Times. The issue's 87 ms and 704 ms are readings and set no budget; no test reads a clock.
- Compiles (#3529), a check's result kept across starts, and `logic.determinism` as a document's own check, which the
  issue leaves out. The `determinism` call is read only on fixtures' pieces, to compare with the merge base.
- Rewrites, links and subset checks apart from the piece check they are part of: the Scope's "one resolve, link,
  subset check and rewrite a fixture" is one piece check.
- The count's value for a piece the check refuses, whether it counts a piece checked outside a `Logic` (a document's
  own check in the core, which no test here makes), and how the module keeps it.
- A hub: the core is driven directly, as the hub drives it.

## What the implementer adds outside this folder

- The count's two calls and the planted runner, as above.
- Nothing in a `Cargo.toml`: the suite holds no Rust test. `lane.json` is here already.
- Nothing in `scripts/lanes.mjs`: no file's run came near two minutes here.

## What the base does

`BASE-FAILURE.txt` has each file's run at the base and the probes' readings.
