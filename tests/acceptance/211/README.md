# Acceptance tests for #211: world pages

Written first, from issue #211 (its Scope, Fields, ten acceptance criteria and Proof line: "The walk with its seeks and
probes; the evict-and-return, spill and late-disk runs; each trap with what it names; the save's size and its
continuation; the match's rollback report; the provider-filled pages; and each planted pager's failure"), the design
sections it names and base commit `531da1ef0` ("Merge pull request #2910 …"), by a job that never saw an
implementation; none existed, and no other worktree, branch, pull request, stash, plan or session was read. The Oracle
line says no upstream test checks these criteria, so there is no Oracle lane. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per
criterion, one test per criterion plus one for each planted twin the criteria name.

## What was read

- The issue, live with `gh issue view 211 --repo windoliver/deepbuild`; for scope only its epic #219, its dependencies
  #532, #534, #172, #546, #547, #192 and #415, and #179 and #212, which hold what the issue says is not in this task.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Saves; Data layouts;
  Saves across changes; World pages; Provider); Dogfooding; Tests written first. AGENTS.md, CONTRIBUTING.md,
  `docs/parallel-proof.md` section 6.
- `docs/canvas-primitives.md`: Carried state; Logic: work across steps; Logic: sandbox; Logic: data layouts (pages@1);
  Logic: checkpoints and bake; Logic: saves; Logic: saves across changes; Logic: world pages; Provider `gen@1` and its
  links, meshes and the library form (`out: pages`); Net: rollback; Export: web player; Check input: logic kinds.
- At the base, read only for the surfaces these tests extend: `tests/acceptance/531/`, `532/`, `534/`, `546/`, `547/`
  (the `deep-logic` protocol, its pieces, bakes, restores, logic.determinism, logic.budget's ceiling rule, saves and
  `open_save`, checkpoint rings, `--planted`, the web runner in headless Chrome), `213/` (between-step additions: how it
  chose surfaces, `region` on a determinism failure, the budget test's pattern), `192/` (providers in packs, `provided`,
  deep_query's logic read), `415/` (pages@1's bytes), `172/` and `190/` (the web export and the web player), `544/wat`
  (the assembler, read only); `crates/deep-logic` (`lib.rs`'s calls and planted names, `piece.rs`'s fields and write
  layout, `checks.rs`), `crates/deep-show/src/sandbox.rs` and `sandbox/providers.rs` (a provider's outputs),
  `crates/deep-show/src/export/web.rs` (the web export's refusals), `crates/deep-canvas-sandbox/src/trap.rs` and
  `layouts.rs`.

What the base already does, which these tests don't credit: sandbox@1 lists the trap kinds `pages` and `pages_full`;
pages@1 is a first-party layout whose validator refuses a repeated page number at its offset (#415); a pack's provider
may declare `out: pages {count ≤ 4,096}`, and at check its output is read from `out_at` as a pages@1 asset of
12 + count × 65,540 bytes, validated and listed by `provided` as `out.data {layout: "pages@1", asset, size}`;
`deep-logic` refuses a logic item's `pages` ("pages isn't built yet in logic@1") and deep-show's document check with it;
logic.budget holds each step to its class's app ceiling (#546); saves, restores, logic.determinism with `region`, the
web runner and the web export's `refused` all exist. There is no page store, page region, slot table, page map, move
queue, page trap, `pages.late`, test store, `orders`, page part of a checkpoint or save, page refusal at web export, or
any of this suite's planted names.

## Run them

```sh
npm ci && npm run build --workspaces    # once, in a fresh worktree
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
  npx vitest run --root tests/acceptance/211 <file> --testTimeout=600000 --hookTimeout=600000
npx tsc -p tests/acceptance/211/tsconfig.json
rm -rf tests/acceptance/211/node_modules/.vite
```

One file at a time. Each file builds what it drives once, in `beforeAll` (its own timeout: 90 minutes a build), honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set, the pinned toolchain's folder
and Homebrew's rustup put on PATH when present, and copies each binary into a temporary folder:

| File | Builds | Also starts |
|---|---|---|
| `ac1-walk-seeks.test.ts`, `ac2-dirty-write-back.test.ts`, `ac3-spill-late.test.ts`, `ac5-save-pages.test.ts`, `ac9-version-by-hash.test.ts`, `ac10-visit-order.test.ts` | `cargo build --locked --bin deep-logic` | |
| `ac4-traps.test.ts` | `deep-logic` | headless Chrome |
| `ac6-provider-fuel.test.ts` | `cargo build --locked -p deep-show --bin deep-show` and `deep-logic` | |
| `ac7-web-export.test.ts` | `deep-show` and `deep-logic` | headless Chrome |
| `ac8-budgets.test.ts` | `deep-logic`; on a reference Mac at rest only, `cargo build --locked --release --bin deep-logic` | |

Programs are WebAssembly text (`programs.ts`) assembled by #544's assembler (`tests/acceptance/544/wat`, read only) into
`target/acceptance-544-wat/`. Every test passes a 60-minute timeout (criteria 6 and 8 two hours); folders (binaries,
saves, the test store's disk, evidence stores, packs, bundles, Chrome profiles) are temporary and deleted. Node
built-ins and vitest only, and `scripts/benchmark.mjs` and `scripts/lanes.mjs` imported for criterion 8. No process is
started but cargo, the assembler, `deep-logic`, `deep-show` and Chrome (its own process group, stopped by its PID), each
waited for; none is stopped by name or port. Chrome is `CHROME_BIN`, else `/Applications/Google Chrome.app`, run with
`--headless=new --disable-gpu` and a fresh profile, as #532's suite runs it.

Gates, none of them a pass: no cargo, an assembler that doesn't build, or no Chrome is `BLOCKED:`; criterion 4 off
macOS arm64 is `INCONCLUSIVE:`; criterion 8's timings are judged only where the perf lane's rule holds (`judgeLimit`
given five zero readings against a limit of 1 must read PASS: a reference Mac on mains power, Low Power Mode off,
thermal state nominal, the load at each run's start and end under the core count), else the test fails `INCONCLUSIVE:`
after every reading that doesn't depend on the machine has passed, and is never retried. Nothing else depends on load.

## The surface under test

The issue names fields, a page region, a page map with its root hash, a move queue, trap kinds, a meter, a provider's
`out: pages`, logic.determinism's `orders`, the web player's store and its export's refusal, but no call. **Every call,
field, reply field, scenario name and planted name below that the issue or the design doesn't give is this job's
invention**, the smallest the criteria need, extending #531's, #532's, #534's, #546's and #547's `deep-logic` and
#172's and #192's `deep-show run`; their READMEs' surfaces stand as written. The implementer builds exactly these, or a
dispute goes to a blind redraft.

**Which binary.** A criterion about a logic item's pages alone is driven through `deep-logic`, which carries bakes,
restores, saves, logic.determinism, logic.budget, the web runner (the web player's logic runtime, run in headless Chrome
on `web_plan`'s request, as #532's and #190's suites read "the web player") and `--planted`. A provider runs only at a
document's check, and the web export is deep-show's `export`, so criterion 6's provider clause and criterion 7's export
are driven through `deep-show run`.

### A logic item's `pages` (Logic: world pages)

`pages: {max, slots, moves, lead, init: "zero" | {asset: sha256} | {gen: "<pack>.<name>", params}, written_max: MiB,
web_max: MiB}`, every key given in these tests, and the program's immutable i32 export `pages_at`, 64 KiB aligned
(65,536 in every program here). In a `deep-logic` piece an init asset's bytes are in the piece's `assets` by SHA-256, as
a program's are; in a document, `{gen, params}` names a pack's provider.

### The page region

Little-endian. At `pages_at`: `moves` requests of 8 bytes, `{page: u32, slot: u32}` (the program's; page 0xFFFFFFFF asks
for nothing), then the slot table, `slots` entries of 8 bytes, `{page: u32, fresh: u32}` (the module's), both inside the
region's first 64 KiB page (at most 16 × 8 + 512 × 8 = 4,224 bytes); **page slot s is the memory page at pages_at +
65,536 × (1 + s)** (README: Readings). So request i is at `pages_at + 8i`, slot s's entry at `pages_at + 8 × moves +
8s`, and a program's memory holds at least `pages_at + 65,536 × (1 + slots)` bytes. The module never clears the
requests: the programs here write 0xFFFFFFFF into each request they don't use, every step. After init and after each
step k it reads them in order and queues each valid one for step k + lead (lead − 1 after init); before step k, ahead
of the read region fill, it runs step k's moves in queue order (write back the slot's page when written since it
loaded, load the page as the map gives it, set the slot's entry, `fresh` 1 for a page with no entry when init gives
zeros), as the design says.

### `deep-logic`: what this suite adds

| Call or field | Meaning |
|---|---|
| `bake`, `determinism`, `web_plan` gain `"store"?: {"dir", "memory", "read_delay_ms"}` | **the test store**: the item's page store keeps at most `memory` bytes of page versions in memory and spills the rest by hash to files under `dir` (standing for the folder beside the evidence store), each read from there taking `read_delay_ms` more; without `store` it keeps everything in memory with no delay (the unlimited run). A host's knob, never a piece's or a document's field |
| step records' `items[id].fuel` | the program's own fuel plus 65,536 for each move run before the step (Logic: world pages) |
| step records' `items[id].pages_ns` | the CPU time the module spent running the moves before step k; 0 for a step without moves and for an item without pages |
| checkpoints' (a bake's and a restore's) `map` | for an item with pages, the page map at that checkpoint: `{<page number>: sha256 hex}` for every page written or loaded from init, each by the SHA-256 of its 64 KiB as they stand there (a page resident in a slot by its slot's bytes) |
| checkpoints' `map_changed`, `map_bytes`, `map_ns` | the number of map entries changed since the checkpoint before, the bytes those changes add to the checkpoint (the move queue's apart), and the CPU time adding them took; an item without pages has none of `map`, `map_changed`, `map_bytes`, `map_ns` |
| a bake's `meters` | `{<logic ID>: {"pages.late": n}}`: the moves whose page was still on the store's disk when their step came, which held the step |
| `traps[]` of kind `pages` | #531's LogicTrap plus `request: {"index", "page", "slot"}` (the request's index among that step's, its page and slot) and `why` (a string); `step` is the step whose requests the module read |
| `traps[]` of kind `pages_full` | plus `written`: the count of written pages the step would leave; `step` is the step that wrote past `written_max` |
| a `check` refusal of an init asset | `{"ok": false, "item", …}` holding, in a refusal, `asset` (its SHA-256), `layout: "pages@1"` and `offset` (the validator's first bad byte) |
| `determinism` gains `"orders"?: [[Entry]]` | logic.determinism's `orders`: each track played from step 0 for `steps` steps; for every page two of them generated (it arrived fresh and the program wrote it), the bytes it holds at the end are compared; each that differs gives a failure `{"item", "run": "orders", "page": n, "orders": [i, j], …}` (i < j, indices into `orders`; the other DetFailure fields null) |
| a determinism failure's `region` (#213's) | may be `"slot_table"`: the slot table that step read differs (named before the page slots' own bytes) |
| `bake` with `saves_dir` (#534's): each save's `pages` | `{<logic ID>: {"entries", "bytes"}}`: the map entries the save holds (those that differ from init) and the bytes of page versions it holds beside its memory pages, each distinct version once |
| `web_plan` and the web runner | carry pages; the web runner keeps the page store in memory up to `web_max`, counted as written pages (web_max ÷ 64 KiB), and an item whose step would leave more stops there (any trap kind), while `web_plan` refuses nothing for its sizes (the export does) |

### `deep-show run`: what this suite adds

- A document's logic item may give `pages.init: {gen: "<pack>.<name>", params}`. The provider runs at the document's
  check once per content key, its output a pages@1 asset at `out_at` as the base decodes it, and `provided` lists it with
  `item` the logic item's ID (the base's row `{item, provider, key, trap, out: {data: {layout: "pages@1", asset, size}}}`);
  deep_query's logic read (#548) plays the item with those pages.
- `export` with `video.codec: web` (#172's call) refuses a piece whose logic item's `written_max` passes its `web_max`:
  outcome `refused`, writing nothing, its `refused` list holding `{"item": <logic ID>, "field": "written_max", …}`.

### Planted twins

Each is one criterion's wrong program, reachable only through its switch, and changes nothing else; the judge that
passes the real program must fail on it. A `deep-logic` twin that changes a save applies to the process that writes it
and the one that opens it (the tests pass it to both).

| Switch | Criterion | The wrong program |
|---|---|---|
| `deep-logic --planted pager_restores_without_queue` | 1 | a restore loads a checkpoint's memory, globals and page map but not its move queue: the moves queued there never run |
| `deep-logic --planted pager_skips_dirty_write_back` | 2 | a move whose slot's page was written since it loaded loads the new page without writing the old one back |
| `deep-logic --planted pager_applies_moves_as_reads_finish` | 3 | the store never holds a step: before each step it runs the queued moves whose reads have finished, in the order they finished, and a move whose page is still on the disk runs before the first later step by which its read has finished |
| `deep-logic --planted save_drops_page_map` | 5 | a save holds no page map entries and no page bytes; opening one leaves the map empty |
| scenario `planted: "web_export_checks_init_only"` | 7 | the web export compares only an init asset's size with `web_max`, never `written_max` |
| `deep-logic --planted store_keeps_one_copy_per_page` | 9 | the store keeps one copy per page number, which each write-back overwrites, and a load by hash returns that page number's copy |
| the walker in `tree` mode (programs.ts) | 10 | a program: the generator that also writes a tree into the page east of each page it generates whenever that page is resident |

## Programs

`programs.ts`, each with a comment saying what it does: `walker` (rounds of 8 steps, one page a round, asking only at
step 8j + 3 so its move lands at 8j + 7; on a torus, steered by the control `steer`, or on a ring; `visit` writes
hash(seed, page, step) into the page it is in each step, `generate` fills each page that arrives fresh from init's seed
and its number alone; it copies the slot table into `slots` each step), `script` (exactly the requests and writes its
script names, at the steps it names), `flood` (batches of fresh pages a step, each written as it lands, counted in
`written`), `toucher` (300 incompressible pages, a save, then each read back), `reader64` (pages 0 to 63, each one's
FNV-1a as it lands), `pagegen` (the provider, and its run in Node's own WebAssembly), `mover` (8 requests that ask for
pages or for nothing with the same instructions, and an optional spin) and `idle` (an item without pages).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each `describe` and `it` title starts with `AC<n>` and its ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#211.53478a94` | `ac1-walk-seeks.test.ts` (2) | The walker on a 32 × 32 torus, pages {max 1,024, slots 64, moves 8, lead 4}, 3,600 steps, a checkpoint every 60: 20 seeded times (mulberry32 seeded 211,011 over [8, 3,540)), 3 whose state holds a queued move (by the straight bake's `walk.asked`) and 17 whose state holds none; logic.determinism at them is PASS with no failure. `pager_restores_without_queue`: FAIL, with a seek failure from the first checkpoint c = 60m (m odd) whose step c − 1 asked for a page, naming step (c − 1) + 4 and the slot table (`region: "slot_table"`, or the array `walk.slots` holding it). Fails: a checkpoint or deep hash without the queue, moves landing at another step, a check that never compares after a seek |
| 2 `#211.4818ef34` | `ac2-dirty-write-back.test.ts` (2) | Page 5 written 0xAB at offset 7 at step 100, replaced by a request at step 200, asked for again at step 300: no trap, and step 304 reads 0xAB there. `pager_skips_dirty_write_back` reads 0 and the judge fails, naming page 5 and step 304. Fails: a write-back skipped or lost, a load that ignores the map |
| 3 `#211.aee9d8a7` | `ac3-spill-late.test.ts` (2) | The ring walk (100 pages, 64 slots, 4.5 laps) with `store {memory: 1,048,576, read_delay_ms: 50}`: every step hash and array and every checkpoint's deep hash equal the unlimited run's, and `meters.walk["pages.late"]` is above 0. `pager_applies_moves_as_reads_finish`: the first step whose slot table (`walk.slots`) differs from the unlimited run's is named, the unlimited run's table naming a page the planted one lacks there, and the comparison fails first at that step. Fails: a value or step the disk's timing changes, a store that never spills or never holds |
| 4 `#211.c8b345d9` | `ac4-traps.test.ts` (1) | Page 1,024 asked with max 1,024 at step 5: one trap `{kind: pages, step: 5, request: {index 0, page 1024, slot 0}, why}`. Page 7 asked twice at step 5: `{kind: pages, step: 5, request: {index 1, page 7, slot 1}, why}`. The flood (16 a step, 128 slots, written_max 256): 4,096 written by step 258, then one trap `{kind: pages_full, step: 259, written: 4097}` on macOS arm64 and the same in the web runner in headless Chrome. Fails: a request clamped or dropped, a trap that names nothing, a cap counted in resident bytes or on another step on one host |
| 5 `#211.0993eba9` | `ac5-save-pages.test.ts` (2) | The toucher, pages {max 2,048, slots 64}, saved at step 49 by a process that exits: one save, `pages.world` = {entries 300, bytes 19,660,800}, its file at least 19,660,800 bytes and at most 1 MiB more; another process opens it at step 49 with the deep hash recorded when it was written, every checkpoint to 100 equal to a never-stopped bake's, and every page it reads back equal. `save_drops_page_map`: pages 0 to 7 open zeroed at step 54 and the judge fails, naming page 0 first. Fails: a save without the map or its bytes, bytes kept twice, a migration of every page |
| 6 `#211.aaf0f08b` | `ac6-provider-fuel.test.ts` (1) | test/pagegen@1.0.0 installs; a figure whose `world` names `pages.init: {gen: pagegen.region, params: {tone: 9}}` is presented; `provided` lists world's row from `pagegen.region` with a 64-hex content key, no trap and `out.data {layout: pages@1, asset: sha256 of the provider's own bytes}`; deep_query's logic read at step 19 gives the FNV-1a of each of pages 0 to 63 as the provider wrote it. A pages@1 init asset of pages 0, 3, 3 is refused at check, `item: world`, a refusal naming the asset, `pages@1` and offset 131,092. The mover's fuel with 8 moves landing at step 7 is the same as without them at every step but 7, which records 524,288 more. logic.budget (class data_view, app) passes the spin step without its moves and fails it with them, one ceiling failure `[busy, 20, app]`. Fails: provided pages not loaded or loaded zero, an init asset unvalidated, moves free of fuel, a ceiling that leaves moves out |
| 7 `#211.0a8cf256` | `ac7-web-export.test.ts` (2) | The figure with the flood, pages {written_max 512, web_max 256}: deep-show's web export is refused with a `refused` entry `{item: world, field: written_max}` and writes nothing. `web_export_checks_init_only` exports it; deep-logic's bake of the item plays 300 steps with no trap, writing past 4,097 pages; the web runner's bake of web_plan's request first differs from it at step 259, where its 256 MiB store runs out, and the app's step 259 hasn't failed. Fails: an export that checks only the init asset, a browser store that grows past web_max |
| 8 `#211.c0b6687b` | `ac8-budgets.test.ts` (1) | On any machine: the flood of 8 a step reads `pages_ns` above 0 at each of steps 3 to 199; each of its checkpoints 30 to 200 holds `map_changed` 50 and `map_bytes` in (0, 2,048); an item without pages reads `pages_ns` 0 at every step and carries no map fields. `benchmarks/budgets.json` holds `logic-world-pages` (below), valid by the lane's validator, and `scripts/lanes.mjs` times this file. Gated: a release build, a warm-up and five runs; `moves_8_ms` (the median `pages_ns` of steps 11 to 199) under 0.3 and `checkpoint_50_ms` (the median `map_ns` of checkpoints 30 to 200) under 0.1 by `judgeLimit` |
| 9 `#211.4d368ad6` | `ac9-version-by-hash.test.ts` (2) | Page 9 written V1 at step 150, replaced at step 200, loaded again at step 300, written V2 at step 350, replaced at 400; a 480-step bake and a restore of checkpoint 240 for 120 steps: no trap; the straight run reads [V1, 0] at step 300 and [V1, V2] by step 399; checkpoint 240's `map["9"]` is the SHA-256 of the step-200 bytes; the restore reads [V1, 0] at step 300 and reaches checkpoints 240, 300 and 360 with the straight run's deep hashes. `store_keeps_one_copy_per_page`: the restore reads [V1, V2] at step 300 and the judge fails, naming page 9 and step 300. Fails: a store keyed by page number, a write-back that changes bytes a checkpoint names |
| 10 `#211.15f6aeb8` | `ac10-visit-order.test.ts` (2) | The walker generating on a 64 × 64 torus, pages {max 4,096, slots 64, moves 8, lead 4}, along two seeded tracks of `steer` entries (mulberry32 seeded 211,101 and 211,202): their first-visit orders differ, their checkpoint-3,600 maps share pages and every shared page has one hash, and logic.determinism with both as `orders` is PASS with no failure. The tree generator: logic.determinism with both as `orders` fails with `{run: orders, page, orders: [0, 1]}`, and that page is in both final maps with different hashes. Fails: generation that reads residency, a check that never compares orders |

Test count: 2 + 2 + 2 + 1 + 2 + 1 + 2 + 1 + 2 + 2 = 17.

## Readings where the issue leaves a choice

- **Where the page slots start.** The design says the page region is 64 KiB aligned and a world page is "the size of a
  memory page", and a move finds a slot "written since it loaded … as the rollback ring finds written pages", which is
  per 64 KiB memory page. A slot is one memory page only when the slots start on a 64 KiB boundary, so the requests and
  the slot table fill the region's first memory page and page slot s is the memory page at pages_at + 65,536 × (1 + s):
  the requests the program writes every step, and the module's slot table, never mark a slot written. (#534's
  criterion-6 fixture, moved to #2099, packs its slots right after the slot table; that criterion isn't this task's.)
- **"The restored step plus 4"** (criterion 1). A checkpoint labelled c (#531) holds the state after step c − 1, the
  step it restores; a request read after step k lands at k + lead. The walker asks only at steps 8j + 3, so a checkpoint
  c = 60m with m odd (60m mod 8 = 4) follows an asking step; when that step asked, the move it queued is the only one in
  the checkpoint, and losing it changes first the slot table of step (c − 1) + 4. **"Three landing while a move is
  queued"** is three sampled steps whose state holds a queued move; logic.determinism's seeks restore every checkpoint
  before each sampled step (#532), so the twin is caught wherever a restored checkpoint holds one. **"Naming the first
  step … whose slot table differs"**: the failure's `step`, and `region: "slot_table"` or the array the program copies
  the slot table into.
- **"Moved out at step 200"** (criterion 2) is the request at step 200, read as "asked for again at step 300 … in step
  304" reads its request; in criterion 9 "moved out at step 200, loaded again at step 300" are the steps the moves land
  at (asked at 196 and 296), since "loaded again at step 300" names a landing.
- **The test store** (criterion 3): "forcing the store's memory to 1 MiB and a test disk that delays every read" is the
  `store` field of the call, a host's knob as the disk is the host's. **"Every step hash, deep hash and array … at
  every step"**: step hashes and arrays at every step, and deep hashes at every checkpoint (every 60 steps), where the
  bake has them. **The planted pager** ("applies moves in the order reads finish") is one that never holds a step, so a
  late page lands at a later step than its queued one; "naming the first step whose slot table differs" is the
  comparison's first step and the slot table the program copied there.
- **Traps** (criterion 4). "Naming the request" is `request: {index, page, slot}`; "a page asked for twice in one step"
  traps on the second request (a page already in the queue). "Naming the count" is `written: 4097`; "at the same step"
  is the step that writes the 4,097th distinct page, the flood writing exactly one new page at that step so the count
  is exact. **"In the web player"** is the logic module's web runner in headless Chrome, as #532's and #190's suites
  read it.
- **The page map in a reply** is the design's: every page written or loaded from init, by the SHA-256 of its bytes.
  A page loaded fresh (no entry, init zeros) and never written has no entry. The root hash over (page, hash) and the move
  queue are covered by the deep hash and aren't on the reply; no criterion reads them apart.
- **The save** (criterion 5): "300 map entries and about 18.75 MiB of page bytes beside its memory pages" is the save's
  `pages` (300 entries, 300 × 65,536 bytes, each page distinct) and its file's size between 18.75 MiB and 1 MiB more
  (two memory pages hold a nonzero byte, and the header): the toucher moves every touched page out before the save, so
  the map holds them all and no slot holds a written page. "Opens, and plays on with the same deep hashes" is the opened
  state's deep hash equal to the one recorded at writing, and every checkpoint after it equal to a never-stopped run's.
  "Naming the first page that differs" is the first page the opened run reads back differently, page 0.
- **Provided pages** (criterion 6): "by its content key" is the `provided` row's `key`; the output's form is the
  base's. "Naming it" (the refused init asset) is the asset, the layout and the offset, as Logic: data layouts says a
  refusal of an asset named in a world's `init` names them. "Records 524,288 more fuel" is the landing step's `fuel`.
  "Past the ceiling" is #546's app ceiling for the piece's class, read from logic.budget's report: the data view class,
  as #546's suite holds a search to it, since the figure class's ceiling at the base's measured ns per fuel unit
  (12,000,000) lies past the fuel budget's cap of 10,000,000 and no step could pass it without trapping fuel. The spin is
  sized from two calibration bakes so the step's own fuel fits the ceiling by less than its moves' 524,288.
- **The web export and store** (criterion 7): "refused at web export" is deep-show's `export` with `video.codec: web`,
  and "naming written_max" its `refused` entry's `field`. The web player's store counts written pages as `written_max`
  does (else "no browser runs out of store before the trap every host shares" couldn't hold), so with web_max 256 it runs
  out at the step that writes the 4,097th page, 259. "Fails the web comparison, naming the step" is the step-by-step
  comparison of the web runner's bake with the app's naming its first differing step; the export twin lets the piece
  out, and the web runner, which plays the item's logic in the browser, shows the store running out.
- **Budgets** (criterion 8), as #213's: "8 moves a step add under 0.3 ms" is the median `pages_ns` of steps with 8
  moves (5 of them writing a page back); "a checkpoint with 50 changed map entries adds under 0.1 ms and 2 KB" is its
  `map_ns` and `map_bytes` (the design's 36 B an entry is 1,800 B); the bytes are judged on any machine, the time on the
  reference Mac. "An item without pages gains no work" is `pages_ns` 0 and no page fields, beside the budget task's
  merge-base comparison. "Compared with the merge base" is the perf lane's and the budget window's run of the task; the
  test runs no git.
- **A seek to step 240** (criterion 9) is #531's restore of checkpoint 240 after the straight run has passed step 400,
  played 120 steps; "by the hash checkpoint 240 names" is checkpoint 240's `map` entry for page 9, the SHA-256 of its
  step-200 bytes.
- **Visit order** (criterion 10): "generated" pages are those that arrived fresh and the program wrote; "both page maps"
  are the two tracks' maps at checkpoint 3,600; "naming the page and both tracks" is the failure's `page` and `orders`.
  The planted generator is a program, as the criterion says, not a switch in the module.

## Not tested, because no criterion reaches it here

A match's rollback ring with page-map entries and replaced versions kept for `window` + 1 steps (the Proof line's
"match's rollback report"; the issue leaves rollbacks in a match to the net module's task, #179); migrations run once
per distinct old page hash; an init asset larger than `web_max` at export; `init: {asset}` loading (only its refusal is
tested); a slot at or past `slots` and a slot named twice; versions freed when only a dropped checkpoint named them;
the carried state kind `pages` in a registry listing; the field ranges (`max ≤ 65,536`, `slots ≤ 512`, `moves ≤ 16`,
`lead` 1 to 8, `written_max ≤ 4,096`, `web_max ≤ 256`). They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `'tests/acceptance/211/'` in `alone` (the files build `deep-logic` and `deep-show`, start Chrome,
  and hold stores of hundreds of MiB), and `'tests/acceptance/211/ac8-budgets.test.ts'` in `timed`.
- `benchmarks/budgets.json`: the task `logic-world-pages`, `command: ["node", "benchmarks/canvas.mjs", "world-pages"]`,
  `margin: 0.5`, `targets: {"moves_8_ms": 0.3, "checkpoint_50_ms": 0.1, "checkpoint_50_bytes": 2048, "idle_work": 0}`,
  `criteria` naming `#211.c0b6687b` and an `initialReason` naming #211; with `benchmarks/canvas.mjs world-pages`
  measuring what the task names.

`BASE-FAILURE.txt` is the run at the base.
