# #533 manual end-to-end evidence

Each run went through the surfaces the issue names: `deep-logic` as a JSON-lines process, and `deep-show run` as a scenario. The programs are the acceptance suite's (`tests/acceptance/533/programs.ts`), assembled by its wat helper. The scenarios' evidence store held the flock and quiz programs by sha256. Its path is redacted to `<evidence>`, scratch paths to `<scratch>` and the checkout to `<repo>`. Builds are named by features: `full,test-leave-out-physics` is the binary `deep-show-full+test-leave-out-physics`. `e2e/outputs.sh <scratch>` regenerates every `*.out.json(l)` from its input through the built binaries. The `ms` and `frame_ms` timing fields differ from run to run. The `deep-logic` outputs (`*.out.jsonl`) were made on head `6e3a2e3bc`, where `full` holds physics (#1920), and reruns since give the same bytes. The four `deep-show` outputs with a registry (`seal-shipped`, `seal-shipped-planted`, `seal-patch`, `no-physics`) were last committed from the run on `862df4e73`, after main's merges added the `export` and `net` modules, the 3D axes and new text and motion operators to every registry and schedule reply; logic's parts and arrays didn't change, and its digest changed once, with the forms #1973 asks of its params. A rerun differs from the committed files in the timing fields and, in `no-physics.out.json`, in the node keys the second review's section explains.

## Criterion 1 (`#533.1487ce3d`): readings recorded at the first step not yet run

`deep-logic < readings.in.jsonl` gives `readings.out.jsonl`.

- **Before step 0:** a value (7, as_of 1000) is stamped at t 0.
- **After step 2:** the same value arrives twice (7, as_of 2000). It becomes two entries, seq 1 and 2, both at t 35280000, which is step 3. Step 3 reads count 2, values [7, 7] and as_of [2000, 2000].
- **The session's track** holds exactly those three entries.
- **A reading from an undeclared source** (`reading:nope`) is refused as `bad_input`.

## Criterion 2 (`#533.cbdc85ec`): every player's entries, by player and seq

Two players each press at step 3 with the same seq. The piece's `first` item writes the first player in its read region (`first.first`) and the count (`first.n`).

| Run | Arrival | `first.first` at step 3 | `first.n` |
|---|---|---|---|
| `players-2-then-1` | 2, then 1 | 1 | 2 |
| `players-1-then-2` | 1, then 2 | 1 | 2 |
| `--planted read_region_orders_by_arrival` | 2, then 1 | 2 (twin caught) | 2 |
| `--planted read_region_drops_player` | 2, then 1 | 0 (twin caught) | 2 |

## Criterion 3 (`#533.40063163`): the logic@1 seal

`seal.in.json` is the registry, the schedule and the kit call `{"call":"kit","modules":["logic"],"sequences":100,"param_sets":50}`.

| Build | Result |
|---|---|
| `full` (`seal-shipped.out.json`) | logic@1, digest `ef1f7274…`, implementation logic 1.0.0, bit, canonical, wasmtime `=49.0.5` (sandbox@1's pin since #2324; the issue's `=49.0.2`). Kit PASS on every part that ran. `contribution` and `migration` run no case for logic, and the kit reports `interface: {truth: false, missing: ["logic@1"]}`: no logic fixture has an outside expected value (`expected_from`). This is the kit's interface-truth report, not a failed part. |
| `full,test-logic-patch` (`seal-patch.out.json`) | Implementation 1.0.1 seals with the same digest `ef1f7274…`. Kit PASS, including the `bit` part. |
| `full --planted digest_covers_version` (`seal-shipped-planted.out.json`) | Implementation 1.0.0, the reference's own version, still seals. Every interface digest changes, since the twin hashes the version, and logic@1's becomes `9ac613af…`. |
| `full,test-logic-patch --planted digest_covers_version` (`seal-patch-planted.out.json`) | Exits 2: `seal_refused`, `interface_digest`, naming logic@1 ("version differs from the reference"). |

## Criterion 4 (`#533.6d69e833`): logic before physics, and builds without physics

This evidence does not show the time order of logic and physics steps. The issue says that order is #137's, and the acceptance README lists it under "Not tested". The full build's schedule lists `logic.step` in simulate and no physics operator there.

`full,test-leave-out-physics` with `no-physics.in.json` gives `no-physics.out.json`.

- **Modules:** the registry lists no physics module and does list logic.
- **Presented:** the flock and the quiz are presented with no error issue.
- **Refused:**
  - A logic item reading `lab.occurrences` is refused with `module_missing` at `items/watcher/params/reads/0`.
  - One firing `lab`'s input is refused at `items/launcher/params/fires/lab`.
  - Both texts name the physics module.
  - Each also carries `logic_refused`, and the full build refuses both items the same way:
    - `lab.occurrences names no control or logic item of this piece`: logic@1's read rule doesn't accept a world's list yet.
    - `fires isn't built yet in logic@1`: #531's.
  - So no version of these documents would be presented with physics either. What the build without physics adds is the `module_missing` issue naming physics, which is what the criterion asks.
  - Limit: a logic item that reads a world which exists, presented with physics and refused without it, needs logic@1 to accept world reads first. That is not in #533's scope.
- **Eval:** `eval` arrays give `flock.cx` 4.5349…, 5.1016… and 5.9648…, and `quiz.question` 3, 1 and 4, at 0.5 s, 2.5 s and 4.5 s. The acceptance suite checks these steps against deep-logic's bake and its own mirror.

`full,test-leave-out-physics,test-logic-needs-physics` with `seal.in.json` gives `needs-physics.out.json`. It exits 2 with `seal_refused`, `missing_dependency`, naming logic and physics.

## Documents that don't name the logic module

`requires-exemption-before.txt` is that run. A `logic@1` item needs no `requires.modules` entry (Document envelope: `requires`), so #544's documents, which name no module, check. Before the exemption, #544's acceptance suite failed 7 tests on #533's merge with `out_of_range`: "kind `logic@1` is the `logic` module's, and `requires.modules` does not name it". #533's own suite names `logic` and passes either way.

## The scheduler fix's failing output

`scheduler-restart-before.txt`: the logic kit's `clean_rebuild` failed before simulate restarted the steps on a new revision. After the fix, the kit passes on every part that ran (see criterion 3).

## Screenshots, and the agents' check of them

`screens/` holds the end-to-end screenshots, made by the scripts in `e2e/` and last run on `862df4e73` (main merged through `c56fe5407`), on binaries rebuilt from it; `screens-run.txt` is that run's. Against the run on `93cec98a8` only the four seal captures differ, in logic@1's digest: main's #1973 makes each structured param declare the forms its reader takes, the logic kind now declares its ten, and the digest covers them (`1ebdcefc…` became `ef1f7274…`; the planted control's `9ac613af…` became `24c85eff…`). The patch build still seals with the shipped build's digest. Before that, the reviews' fixes changed no capture: against the run on `f88878caf` (committed as `5cf61d523`) only `c1-replay` and `c2-orders-and-twins` differed, by their scripts' stricter text. The run on `f88878caf` left the eleven captures that don't print the seal byte-identical, changed the four seal captures only by the two fields round 9 added, added `c1-replay` and `c2-orders-and-twins`, and gave the same six frames; `manifest.json`'s module lists gained main's `export` and `net`. The history before it: first made on head `6e3a2e3bc`. After the #2324 merge `capture.sh` ran again: the four captures that print the pin (`c3-seal-shipped`, `c3-seal-patch`, `c3-seal-planted-control`, `c4-no-physics-seal`) changed, and the other eleven came out byte-identical. `screens.test.ts` ran again on wasmtime 49.0.5 and passed, and its six frames and manifest came out byte-identical. Paths print as `<scratch>` and `<evidence>`.

- **Terminal captures:** `e2e/capture.sh <scratch>` runs each criterion's command through the built binaries and saves `$ command`, its output and its exit status (`bash -o pipefail`) as a PNG.
  - Criterion 1: `c1-readings.png`, and `c1-replay.png`: `e2e/replay.sh` opens a second process on the track the live run recorded, appends nothing, and gets the same arrays and step hash at every step. The source here is the test writer's `append` calls, as in the acceptance suite; no hub runs in these captures.
  - Criterion 2: `c2-players-2-then-1.png` and `c2-players-1-then-2.png`, plus the planted twins `c2-planted-arrival.png` and `c2-planted-drops.png`; `c2-step-seq-order.png` shows order by step and seq.
    `c2-orders-and-twins.png` is the criterion's own check: `e2e/orders.sh` runs both arrival orders through one build and names the first step where `first` isn't 1 or the two orders' hashes differ. The real build passes with six equal step hashes and the script exits 0; each planted twin fails at step 3 and it exits 1. The pictured command checks each of those exit statuses and would end non-zero on a twin that passed; `capture.sh` itself doesn't stop on that, so the check is read in the picture. Step 3 is where the fixture's presses are, as in the acceptance test. `deep-logic` itself replies `ok` under a twin, since a twin is a wrong build and not an error; the failure is the check's, as it is in `ac02-players.test.ts`.
  - Criterion 3: `c3-seal-shipped.png` and `c3-seal-patch.png`. Both print the implementation's `equivalence: bit` and `state: canonical`. The planted twin is `c3-seal-planted.png`, with its control `c3-seal-planted-control.png`.
  - Criterion 4:
    - `c4-no-physics-seal.png`: the build without physics seals.
    - `c4-no-physics.png`: that build's documents and arrays.
    - `c4-full-control.png`: the full build on the same documents. It refuses the two world-touching items for the reasons above (`logic_refused`, shown as `why`), with no `module_missing`.
    - `c4-no-physics-vs-full.png`: the flock's and the quiz's arrays are the same in both builds.
    - `c4-needs-physics.png`: the planted logic module that needs physics is refused at the seal.
- **Order by step and seq:** the acceptance fixture puts both presses at one step, each with seq 1, so it shows only the player tie-break. `c2-step-seq-order.png` adds the rest. Its input is `seq-order.in.jsonl`, and its program `e2e/order.wat` writes the [player, value] pair of the first four entries in its read region; no step here has more than three. The suite's assembler (`tests/acceptance/533/wat`) turned order.wat into the asset `9a8f204c…`.
  - Arrival order is: step 4 player 1 seq 3 (value 13), then step 3 player 1 seq 2 (12), then step 3 player 2 seq 1 (21), then step 3 player 1 seq 1 (11).
  - Step 3's region reads [1, 11, 1, 12, 2, 21], and step 4's reads [1, 13].
  - `read_region_orders_by_arrival` gives [1, 12, 2, 21, 1, 11].
  - `read_region_drops_player` gives players of 0.
- **Rendered frames:** `e2e/screens.test.ts` (`npx vitest run --root docs/evidence/533/e2e --testTimeout=3600000`, output in `screens/screens-run.txt`) draws #533's flock through a `marks@1` set whose x reads `flock.cx`. It records frames at 0.5, 2 and 3.5 s in the full build and in the build without physics: `full-t*.png` and `no-physics-t*.png`, with `manifest.json`. It asserts that:
  - each build's registry holds physics or lacks it;
  - `flock.cx` matches the independent mirror (`flockCx`) to 9 decimals;
  - the red square's centre is at `cx × 64` px and y 96 px;
  - the square moves right;
  - both builds give the same frame bytes at each time.

**The agents' check.** Separate agents reviewed every screenshot, with only the images, the inputs and the binaries to go on, never this README's conclusions. They re-ran the commands unfiltered, and each round's problems were fixed before the next round.

- **Round 1:** two agents.
  - The frames' white border was invisible on the white page; it is now black.
  - The square's position and the mirror were never asserted. Both are now asserted, the manifest records each build's modules, and it is written only after every check passes.
  - Two proofs were missing: the planted seal's control, and the build without physics against the full build. Both were added.
- **Round 2:**
  - The full build's control and the build without physics's seal were added.
- **Round 3:**
  - The README credited the refusals to #544's bake. The real reasons are now shown and the limit is stated.
- **Round 4:**
  - A jq filter hid every `module_missing` issue. It was fixed and the images recaptured.
- **Round 5:**
  - Order by seq wasn't visible in the read region. `order.wat` now shows it, and both twins are run.
- **Round 6:**
  - The committed outputs predated #1920. They were regenerated by `e2e/outputs.sh`, and the seal captures now show the kit's `interface` report.
- **Round 7:** one agent, over all 21 images, every input and output, and the README.
  - It found nothing blocking.
  - It reproduced the outputs, apart from the timing fields.
  - It found no personal paths or secrets.
  - Its cosmetic notes are fixed here, or are the stated limit of criterion 4.
- **Round 8, after the #2324 merge:** one agent, over the four recaptured captures and their earlier versions.
  - All four are legible and complete, and match a fresh run of their commands, filtered and unfiltered.
  - Pixel-diffed against the earlier captures, each differs in one character cell, the pin's "2" → "5"; every logic digest is unchanged.
  - The unfiltered kit reports hide no failing part; their only FAIL verdicts are planted twins the kit caught.
  - It found no personal paths or secrets.

- **Round 9, on head `f88878caf`:** one agent, over all 21 images, with the binaries, the inputs and `capture.sh`, and without this section. It recaptured all 15 terminal images (byte-identical), ran every command unfiltered, and checked the frames against the manifest.
  - Every image was legible, complete and matched a fresh run; the filters hid no failing part, issue code or refusal; it found no personal paths or secrets.
  - Criterion 1's replay was in no picture. `c1-replay.png` adds it.
  - Criterion 2's equal step hashes were filtered out, and the twins only gave another number. `c2-orders-and-twins.png` shows the hashes and the check failing at step 3.
  - Criterion 3's `bit` and `canonical` were filtered out. The seal filter now prints them, which changed the four seal captures.
  - `manifest.json` was modified and uncommitted, and `screens-run.txt` was from the first run. Both are committed from this run.
  - Stated, not changed:
    - The kit reports `interface: {truth: false, missing: [logic@1]}`, visible in the seal captures. It means no logic fixture carries an expected value set outside the implementation; the issue's oracle page says no upstream test checks these criteria. `cells` and `media` report the same on main, and it is not part of the kit's verdict.
    - The schedule lists 14 kit parts for `logic@1` and the kit reports 11 (12 with `bit`): `contribution` and `migration` report nothing for a module with no contribution and one version, as for other modules.
    - In the patch build the kit row's `version` is the module's (1.0.0); the implementation's is 1.0.1.
    - The build without physics reports `build_set: full`: it is the full set with a test feature.
    - Criterion 4's two refused documents are also refused by the full build, for another reason (`c4-full-control.png`), and they name `lab` without declaring a world.
- **Round 10, on `5cf61d523`:** one agent, over the six new or changed images, the two new scripts and round 9's entry.
  - It recaptured all 17 terminal images: byte-identical. It showed no statement of round 9's entry false, and confirmed the `cells`, `media` and physics comparisons on this branch's build (not on main).
  - `replay.sh`'s diff does catch a replay that reads otherwise: five planted changes to the track each failed it.
  - Both scripts printed their success line, with exit 0, on a binary that printed nothing. They now run under `set -euo pipefail`, require the five and six steps, and `orders.sh` exits 1 on FAIL; the capture checks each exit status. On a fake failing binary both now exit 1.
  - It saw the review fixes below land in the worktree under its run, so the pictures were made again on binaries with them (round 11).
  - Stated, not changed: the `bit` part runs one case and the `fixtures` part one fixture.
- **Round 11, on `b93bf9603`:** one agent, over all 23 images, on binaries built from `444eef90d`, with the worktree untouched during its run.
  - It recaptured all 17 terminal images: byte-identical. The six frames' hashes equal the manifest's, each full and no-physics pair is byte-identical, and the square's centre is within 0.27 px of `cx × 64`.
  - Unfiltered, no run hides a failing part, an issue code or a refusal. Both proof scripts fail on four fake binaries, and the pictured loop ends non-zero when a twin passes.
  - It judged criteria 2 and 3 shown, and 1 and 4 shown with their stated limits: no hub runs here, and criterion 4's two refused documents are also refused, for another reason, by the full build.
  - It found no personal paths or secrets, and nothing blocking. Its three notes on this file are fixed here: the opening paragraph's account of when the outputs were made, `screens-run.txt` being from the run before the fix commit, and the wording on what checks the exit statuses.
- **After the third review's fix (`93cec98a8`):** the binaries were rebuilt and the 17 captures and the six frames made again; every image came out byte-identical. The outputs were rerun too and differed only in timing fields and node keys, so the committed ones stay.
- **Round 12, on `a3441bd63`:** one agent, on those binaries, with the worktree untouched during its run.
  - It recaptured all 17 terminal images: byte-identical. The frames' hashes equal the manifest's and each pair is byte-identical. No image changed after `b93bf9603`.
  - The six `deep-logic` outputs and the two refused seals rerun to the same bytes. The three seal outputs differ only in `ms`, and `no-physics.out.json` in `ms`, `frame_ms` and twelve node keys.
  - It ran the seek test's scenario through the full binary: a seek equals a play at three times, the trap after the checkpoint among them, so that binary holds the fix. Which commit the other four binaries were built from rests on their times alone.
  - It found no personal paths or secrets. Its four notes on this file are fixed here: the commit the outputs were last made on, the outputs not being recommitted, a pointer to a round that wasn't written yet, and the second review's sentence on seeks.
  - Its review of `93cec98a8` found the checkpoints and their errors kept, cleared and reset together, and a checkpoint taken after its own flick's step. It found the seek test would pass on a build whose seek never touched the errors; the test now also seeks to a flick after the start, where the checkpoint holds none, and fails on that mutant. An unreachable fallback is gone. Those two changes came after the pictures and change no behaviour: the binaries were not rebuilt for them.
- **After merging main through `c56fe5407` (`862df4e73`):** the merged tree didn't compile until the logic kind's params declared their forms (#1973). The binaries were rebuilt and everything made again: 13 terminal captures and the six frames byte-identical, the four seal captures changed in the digest alone, and the four registry outputs recommitted. The assembler's lock file is fixed in this head (`f7592bd99`, approved by the owner), so the committed suite passes 10/10 with nothing added locally. Round 13 checks the four changed captures.

## The second code review, and its failing output

A separate agent reviewed the branch's diff against main after the merges of #539, #540, #522 and #503, reading the hand-resolved code in full. `review-round-2-before.txt` holds each new test's failing output before its fix.

- **Fixed, each with a test that failed first:**
  - A slow item's step sorted its entries by player and seq without their time, so a 15 Hz item could read a later entry before an earlier one (`a_slow_items_step_reads_its_entries_by_time_then_player_and_seq`). `c2-step-seq-order.png` runs at 60 Hz, where a step holds one stamp, so it never showed this.
  - A trapped item's `logic.trap` vanished on a frame where no step was due (`a_trapped_item_stays_failed_on_frames_between_its_steps`). The scheduler keeps a step's error until that step succeeds or the steps restart; a seek restores the errors its checkpoint held (the third review, below).
  - An item on a turn clock never woke for a reading it reads (`a_reading_wakes_the_turn_clock_item_that_reads_it`).
  - A reading two items read at different rates was refused once the slower had run ahead (`a_reading_two_rates_read_is_stamped_after_what_both_have_read`).
  - A 64-byte `program` that isn't hex crashed deep-show (`a_program_name_that_is_no_hash_is_an_issue_and_no_crash`).
- **A third review, of the fix commit `444eef90d` alone,** confirmed four of the five fixes as written and found:
  - A seek back onto a checkpoint cleared a step's error without running that step again, so a seek and a play to the same time disagreed (`a_seek_back_onto_a_checkpoint_shows_the_trap_playing_there_shows`, failing first). A checkpoint now keeps its steps' errors.
  - The hash test's second case passed on the old code; it is gone, and the test now asks for an issue naming the item.
  - Readings waiting past `max_per_step` had no test of the step they ask a turn clock for; `readings_still_waiting_ask_a_turn_clock_item_for_its_next_step` fails on a mutant without that line.
- **Not reproduced:** stale checkpoints after a seek back and an append. A test of that sequence gave the same deep hash as a fresh run of the recorded track, so nothing was changed and the test wasn't kept.
- **Left, outside #533:**
  - `each` readings past four steps' worth are not dropped with `reading.overflow`; that rule is #210's.
  - Export, the film viewer and the film audit inline vectors but not logic programs.
  - A second `eval` at the same time returns no issues; seen while testing the trap fix, not traced.
  - `logic.step`'s node key in an `eval` reply differs from run to run, and with it the key of what reads its arrays; the arrays and hashes don't. #538 inlines each bake's compare timings into the drawn form, and `logic.step` reads the whole form. So a rerun of `outputs.sh` differs from the committed `no-physics.out.json` in its timing fields and in those keys.
