# #533 manual end-to-end evidence

Each run went through the surfaces the issue names: `deep-logic` as a JSON-lines process, and `deep-show run` as a scenario. The programs are the acceptance suite's (`tests/acceptance/533/programs.ts`), assembled by its wat helper. The scenarios' evidence store held the flock and quiz programs by sha256. Its path is redacted to `<evidence>` and scratch paths to `<scratch>`.

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
| `full` (`seal-shipped.out.json`) | logic@1, digest `ca35f4cd…`, implementation logic 1.0.0, bit, canonical, wasmtime `=49.0.2` (sandbox@1's pin). Kit PASS on every part. |
| `full,test-logic-patch` (`seal-patch.out.json`) | Implementation 1.0.1 seals with the same digest `ca35f4cd…`. Kit PASS, including the `bit` part. |
| `full --planted digest_covers_version` (`seal-shipped-planted.out.json`) | The reference alone seals; its digest changes to `1f097c48…`. |
| `full,test-logic-patch --planted digest_covers_version` (`seal-patch-planted.out.json`) | Exits 2: `seal_refused`, `interface_digest`, naming logic@1 ("version differs from the reference"). |

## Criterion 4 (`#533.6d69e833`): logic before physics, and builds without physics

`full,test-leave-out-physics` with `no-physics.in.json` gives `no-physics.out.json`.

- **Modules:** the registry lists no physics module and does list logic.
- **Presented:** the flock and the quiz are presented with no error issue.
- **Refused:**
  - A logic item reading `lab.occurrences` is refused with `module_missing` at `items/watcher/params/reads/0`.
  - One firing `lab`'s input is refused at `items/launcher/params/fires/lab`.
  - Both texts name the physics module.
  - #544's occurrence bake refuses each of them as well (`logic_refused` on the item's params), before the `module_missing` issue.
- **Eval:** `eval` arrays give `flock.cx` 4.5349…, 5.1016… and 5.9648…, and `quiz.question` 3, 1 and 4, at 0.5 s, 2.5 s and 4.5 s. The acceptance suite checks these steps against deep-logic's bake and its own mirror.

`full,test-leave-out-physics,test-logic-needs-physics` with `seal.in.json` gives `needs-physics.out.json`. It exits 2 with `seal_refused`, `missing_dependency`, naming logic and physics.

## Documents that don't name the logic module

`requires-exemption-before.txt` is that run. A `logic@1` item needs no `requires.modules` entry (Document envelope: `requires`), so #544's documents, which name no module, check. Before the exemption, #544's acceptance suite failed 7 tests on #533's merge with `out_of_range`: "kind `logic@1` is the `logic` module's, and `requires.modules` does not name it". #533's own suite names `logic` and passes either way.

## The scheduler fix's failing output

`scheduler-restart-before.txt`: the logic kit's `clean_rebuild` failed before simulate restarted the steps on a new revision. After the fix, the kit passes on every part (see criterion 3).
