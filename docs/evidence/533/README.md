# #533 manual end-to-end evidence

Each run went through the surfaces the issue names: `deep-logic` as a JSON-lines process, and `deep-show run` as a scenario. The programs are the acceptance suite's (`tests/acceptance/533/programs.ts`), assembled by its wat helper. The scenarios' evidence store held the flock and quiz programs by sha256. Its path is redacted to `<evidence>`, scratch paths to `<scratch>` and the checkout to `<repo>`. Builds are named by features: `full,test-leave-out-physics` is the binary `deep-show-full+test-leave-out-physics`. `e2e/outputs.sh <scratch>` regenerates every `*.out.json(l)` from its input through the built binaries. The `ms` and `frame_ms` timing fields differ from run to run. They were last made on head `6e3a2e3bc`, where `full` holds physics (#1920).

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
| `full` (`seal-shipped.out.json`) | logic@1, digest `1ebdcefc…`, implementation logic 1.0.0, bit, canonical, wasmtime `=49.0.2` (sandbox@1's pin). Kit PASS on every part that ran. `contribution` and `migration` run no case for logic, and the kit reports `interface: {truth: false, missing: ["logic@1"]}`: no logic fixture has an outside expected value (`expected_from`). This is the kit's interface-truth report, not a failed part. |
| `full,test-logic-patch` (`seal-patch.out.json`) | Implementation 1.0.1 seals with the same digest `1ebdcefc…`. Kit PASS, including the `bit` part. |
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

`screens/` holds the end-to-end screenshots, made on head `6e3a2e3bc` by the scripts in `e2e/`. Paths print as `<scratch>` and `<evidence>`.

- **Terminal captures:** `e2e/capture.sh <scratch>` runs each criterion's command through the built binaries and saves `$ command`, its output and its exit status (`bash -o pipefail`) as a PNG.
  - Criterion 1: `c1-readings.png`.
  - Criterion 2: `c2-players-2-then-1.png` and `c2-players-1-then-2.png`, plus the planted twins `c2-planted-arrival.png` and `c2-planted-drops.png`; `c2-step-seq-order.png` shows order by step and seq.
  - Criterion 3: `c3-seal-shipped.png` and `c3-seal-patch.png`. The planted twin is `c3-seal-planted.png`, with its control `c3-seal-planted-control.png`.
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
