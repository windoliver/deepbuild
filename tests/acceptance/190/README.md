# Acceptance tests for #190: linked logic libraries

Written first, from issue #190 (its Scope, Fields, ten acceptance criteria and Proof line: "The two pieces and
grid_path@1 with its fixtures; the merged programs from both machines; the refusals with what each names; the planted
corner-cutting library's refusal; and deep_query's reply naming the library"), the design sections it names and the
base commit, by a job that never saw an implementation; none existed, and no other branch, worktree or pull request was
read. The base is this worktree's HEAD, `6042ef5a` (it holds #531's and #532's logic module). The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

**The Oracle page wasn't reachable.** The issue says upstream tests, pinned by commit, cover 2 of the 10 criteria
(`doneright/oracles/issues/190.md` in DeepBuildAI/deepbuild, branch `doneright`). From this machine
`gh api repos/DeepBuildAI/deepbuild/contents/doneright/oracles/issues/190.md?ref=doneright` and
`gh api repos/DeepBuildAI/deepbuild` both answer 404 (the account here can't see that repository), so no upstream
test is ported and none of these tests is an oracle test. Per the issue, that lane is BLOCKED until its tests can be
read and run against the output; the one unblock ask is access to DeepBuildAI/deepbuild for this account (or the
page's pinned tests handed over), after which the two criteria's upstream tests are added beside these.

## What was read

- The issue, live with `gh issue view 190 --repo windoliver/deepbuild`.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Saves; Linked
  libraries; Library interfaces), Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Logic `logic@1` (`links`, exports, "imports: none once its libraries are linked");
  Logic: sandbox (the subset, the 4 MiB limit, program roles: a library "importing only `lib:` functions of libraries
  before it; linked, never called alone"; the linker first, then the subset check); Logic: linked libraries; Logic:
  library interfaces (context only: `implements` isn't tested); Pack (`libs`, a pack never runs one, a version's
  check runs each library's subset check and fixtures); Pack: programs; Pack: dependencies.
- At the base: `crates/deep-logic` (the `deep-logic` JSON-lines binary: `about`, `check`, `bake`, `web_plan`,
  `web_runner`, `determinism`, `budget`, `golden`, `golden_verify`, `view`, `frame`, `open`, `step`, `--planted`),
  `crates/deep-canvas-sandbox` (the subset check, its refusals' `import: {module, name}` and `limit: {name, max,
  actual}`), `crates/deep-sandbox-wasmtime`, `crates/deep-show` (`deep_query` lives in `src/query.rs`; the build set
  holds no logic module yet, main.rs: "`full` holds no logic module yet"), `scripts/proof-change.mjs` (criterion IDs),
  and the suites `tests/acceptance/531/`, `532/` and `238/` (the pattern this one follows; copied and cut down, nothing
  imported).

What the base does, which these tests don't credit: it checks, rewrites and steps whole logic programs, bakes with keys,
records goldens, runs the web runner and the live view. It refuses an item's `links` field ("links isn't built yet in
logic@1"), has none of this suite's calls (`query`, `pack_check`, `claim`), no `packs` on a piece, no `linked`,
`libraries` or `link_ns` in a receipt, no `library` on a trap, and none of this suite's planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once: the Linux x86_64 host (rust-toolchain.toml's channel)
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/190 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/190/tsconfig.json
rm -rf tests/acceptance/190/node_modules
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
helpers.ts puts Homebrew's rustup and `~/.cargo/bin` on PATH when present):

- **The assembler** `tests/acceptance/190/wat/` (crate `acceptance-190-wat`, #532's plus an object writer; `wat
  =1.263.0`, `wasmparser =0.263.0`; outside the workspace, its own `Cargo.lock`) into `target/acceptance-190-wat/`.
  It turns `programs.ts`'s text into whole modules and relocatable objects (below).
- **`deep-logic`** for this host: `cargo build --locked --bin deep-logic` in the checkout.
- **`deep-logic` at the merge base** (criteria 7 and 10): `git merge-base HEAD main`, its tree exported with `git
  archive` into a temporary folder (no worktree is added), built with `CARGO_TARGET_DIR=target/acceptance-190-base`.
- **`deep-logic` for Linux x86_64** (criteria 4 and 5): the same command in `docker run --platform linux/amd64` with
  `rust:<channel>-slim-bookworm`, the checkout mounted read-only, caches under `target/acceptance-190-linux/`. Nothing
  is pulled.
- **Headless Chrome** (criterion 4) at `CHROME_BIN`, else `/Applications/Google Chrome.app/Contents/MacOS/Google
  Chrome`, `/usr/bin/google-chrome` or `/usr/bin/chromium`, as #532's suite runs it: a page on `127.0.0.1` imports the
  web runner's source and runs `web_plan`'s request through its `bake`; Chrome gets a temporary profile and is stopped
  by its PID (its own process group).

Every test passes an explicit timeout (90 minutes). Temporary folders (binaries, the merge base's tree, Chrome profiles,
assembler output) are deleted. Node built-ins and vitest only. **`scripts/lanes.mjs` needs
`alone.push('tests/acceptance/190/')`** beside 531's and 532's: the files build cargo binaries (twice: here and at the
merge base), start Docker and Chrome, and criterion 10 reads CPU and wall times. This README is the instruction; the
implementer makes that edit.

Gates: a missing host is `BLOCKED:` (a failed test, never a pass). Criteria 4's first test and both of 10's need macOS
arm64 (`process.platform` darwin, `process.arch` arm64: "the reference Mac"); anywhere else they fail with `BLOCKED:`
naming this host. The Linux x86_64 leg (criteria 4 and 5) is BLOCKED without Docker, without the linux/amd64 image
(naming the `docker pull`), or when that image can't run here (`uname -m` in it isn't `x86_64`: no amd64 emulation).
No Chrome names `CHROME_BIN`. An assembler that doesn't build names cargo's error. Each test calls first what the base
lacks, so at the base it fails on the missing surface before any gate or slow leg. "In the local preflight" (criterion
10) isn't something a test can see: the README reads it as this suite run on the reference Mac.

**This machine** (where `BASE-FAILURE.txt` was run) is Linux aarch64: no Mac, so criterion 4's first test and
criterion 10 are BLOCKED here once the surface exists; Docker is reachable but has no `rust:1.99.1-slim-bookworm`
image and can't run linux/amd64 (`exec format error`: no binfmt), so criterion 5 and criterion 4's first test are
BLOCKED on Linux x86_64 too; Chrome 156 is at `/usr/bin/google-chrome` and runs headless here. The suite is meant to
run in full on the reference Mac with Docker's amd64 image.

The harness was checked against real components before the base run (a temporary file, deleted): every object this
suite writes links with LLVM's own linker (LLD 23.1.1's `wasm-ld`, from rustup's 1.99.1 toolchain, with
`--global-base=0 --stack-first -z stack-size=0 --no-gc-sections`, which places the program's data at 0 and each
library's after it, this README's rule), and node's WebAssembly runs the result: grid_path@1 on the fixture grid
gives bfsRoute's 10-move route, the corner-cutting twin bfsRoute's 8-move one, pathing's plan, turns' 1, 2, 0,
ping-pong's 0, bulk's 97 and big_a's `top` all as `programs.ts` works them out; the base's `deep-logic` admits
wasm-ld's merged 5 × 5 route program as a whole module and bakes `moves` 10 with that route (10,576 fuel), and traps
`fuel` at step 0 in the merged 160 × 160 program; the 1 MB program and the 500 KB libraries assemble to 1,074,513 and
532,997 bytes. Not checked: anything through a linker of the logic module's own (none exists), Linux x86_64 (no
emulation here) and the Mac.

## The surface under test

The issue names `links`, libraries in packs with `needs` and fixtures, a pack version's check, refusals, receipts,
`deep_query`, `logic.trap` and planted twins, but no command line. As in #531's and #532's suites, the surface is
`deep-logic`: **every call, field, refusal code, naming field and planted name below that the issue or the design
doesn't give is this job's invention**, the smallest surface the criteria need, extending #532's JSON-lines protocol
(its README and #531's: deep-logic); the implementer builds exactly these, or a dispute goes to a blind redraft. Calls
and fields of #531's and #532's protocol not named here stay as those READMEs define them. "The app" is the logic
module through `deep-logic` on this host; "the web player" is its web runner.

### `deep-logic`: what this suite adds

- **`--planted`** names below; more than one may be given, as in #532.
- **Piece** gains `"packs": [Pack]`: the packs installed in the document's store. A logic item's params gain
  `links: [{"name": "<name>@<version>", "asset": sha256}]` (at most 16). Every asset (programs, libraries, fixtures,
  their programs) is in the piece's `assets` by sha256, base64, as #531's programs are.

| Call | Reply |
|---|---|
| `{"call": "check", "piece"}` (#531's) | `{"ok": true, "items": {<logic ID>: Checked}}`, or a refusal (Refusals) |
| `{"call": "bake", …}`, `web_plan`, `golden` (#531's, #532's) | as before, every item linked first; a bake's `items` are Checked and its traps LogicTrap |
| `{"call": "query", "piece"}` | `{"ok": true, "items": {<logic ID>: {"kind": "logic@1", "program", "hash", "libraries": [{"name", "hash"}]}}}`: deep_query's row for each logic item (below), or the check's refusal |
| `{"call": "pack_check", "pack": Pack, "assets": {sha256: base64}}` | `{"ok": true, "pack": "<name>@<version>", "installed": true, "libraries": [LibRecord]}`, or `{"ok": false, "code": "pack_refused", "pack", "refusals": [Refusal]}` |
| `{"call": "claim", "piece", "library": "<name>@<version>"}` | `{"ok": true, "verdict": "PASS" \| "FAIL" \| "INCONCLUSIVE", "asks": [{"kind": "approval", "library", "why"}]}`: the claim "this library is right", decided from its fixtures |

```text
Pack      = {"name", "version": semver, "origin": "installed" | "agent", "libs": {"<name>@<version>": LibEntry}}
LibEntry  = {"asset": sha256 of the library's object, "exports": [function name], "fixtures": [asset ID],
             "needs"?: [{"name": "<name>@<version>", "asset": sha256}]}
Fixture   = the asset's bytes, UTF-8 JSON: {"item": {"kind": "logic@1", "params": LogicParams that link only this library},
             "track": [Entry], "steps": n, "expect": {"arrays": {"<step>": {<write name>: [value]}}, "deep_hashes"?: {"<step>": 16 hex}}}
Checked   = #531's {"program", "hash", "layout"} plus
            "linked": {"sha256", "size", "bytes": base64} | null   // the merged module before the rewrite; null without links
            "libraries": [LibRecord]                               // in link order; [] without links
            "link_ns": number                                      // the link's time at this check, ns; 0 without links
LibRecord = {"name": "<name>@<version>", "hash": sha256, "pack": "<name>@<version>",
             "fixtures": [{"fixture": asset ID, "verdict": "PASS" | "FAIL", "ran": bool, "ns": number, "deep_hashes": {"<step>": 16 hex}}]}
LogicTrap = #531's, plus "library": {"name": "<name>@<version>", "hash", "function": export name} | null
```

What each field means:

- **Linking.** At check (and so at every bake, plan and golden), before the subset check and the rewrite, an item
  with `links` has its program and the libraries it reaches merged by the linker into one module, which is what the
  subset check, the rewrite, bakes, goldens, the web player and `linked` see. The libraries it reaches are its links
  and, transitively, their pack entries' `needs`, at most 16 in all, in dependency order (each after every library it
  needs), ties broken by name. Each link and need must be carried by an installed pack under that name@version with that
  hash. An item without `links` is never linked: its program is checked and rewritten as at the base (`linked` null,
  `libraries` [], `link_ns` 0).
- **Fixtures.** A library links only once its fixtures pass on this core. A fixture runs as a piece of seed 0 whose one
  item, `fixture`, is the fixture's item (linked like any other), on its track for `steps` steps, with
  logic.determinism's comparisons; it passes when every expected array at every step it names equals the run's, and,
  where given, every full-state hash. `deep_hashes` in a LibRecord are the fixture run's checkpoints' full-state hashes
  by step (the fixture item's checkpoints, as a bake of the fixture's piece gives them). Fixtures run once per library
  hash and logic module version in a process: `ran` is true at the check that ran them and false after, with `ns` that
  run's time. A fixture runs only once its own item's link resolves.
- **Receipts and deep_query.** The receipt is the item's Checked: `libraries` names each library linked, with its hash
  and the pack carrying it. deep_query's row for a logic item is answered by the logic module's `query`, because the
  base's deep-show build set holds no logic module (#403's note) and no criterion here asks for that wiring; it names
  each library with its name@version and hash, and `hash` is the rewritten program's.
- **Traps.** A trap inside library code names the library (`name`, `hash`) and the function by its export name (for an
  internal function, the name its object's symbol table gives it); `function` and `offset` are in the merged module
  before the rewrite (the program as the subset check sees it). A trap in the program's own code has `library` null.
- **Packs.** `pack_check` checks the pack's version: each library against the one subset, its `lib:` imports and the
  conventions' `env.__linear_memory` aside, then its fixtures (each fixture item linked against this pack's libraries);
  a pack never runs a library outside a fixture's item. `installed` is true when the version passes.
- **Claims.** `claim` decides "this library is right" from the library's fixtures as the piece's packs carry it. A
  library from a pack whose `origin` is `agent` (written by the working agent) binds only the agent's own claims, as its
  own checks do: when those fixtures are its only proof the verdict is INCONCLUSIVE with exactly one approval ask naming
  the library, never PASS. The same fixtures from an `installed` pack count: PASS when they pass.

### Refusals

A link that can't be made is refused at check (and at bake, plan and golden) with `{"ok": false, "code":
"link_refused", "item": <logic ID>, "refusals": [Refusal]}`; a pack version with `pack_refused` (above). Each Refusal
is `{"rule", "what", …}`; `rule` and `what` are the implementer's and never compared. The naming fields the tests read:

| Refused | Naming fields |
|---|---|
| a link whose bytes don't match its hash | `asset` (the link's hash) and `actual` (the bytes' sha256) |
| a name@version an installed pack maps to another hash | `pack` (`<name>@<version>`) |
| an import no listed library exports; a library importing from one listed after it; an import left unresolved | `import`: `{"module": "lib:<name>", "name": "<function>"}`, as sandbox@1's refusals name imports |
| a library importing anything but an earlier library (in a pack check: a host function) | `import` (`{"module": "env", "name": "now"}`) |
| a merged program over 4 MiB | `limit`: `{"name", "max": 4194304, "actual": its size}`, as sandbox@1's limit refusals |
| a fixture that fails | `library`, `fixture` (asset ID), `step`, `array` (the write name), `index` (the first element that differs), `expected`, `actual` |
| a library that ships no fixture | `library`, and no `fixture` |
| two versions of one library reached | `versions`: every name@version of it reached, e.g. `["grid_path@1", "grid_path@2"]` |
| a cycle of needs | `cycle`: the name@versions around it |

A fixture's failure names the first array that differs at the earliest step that differs, in the fixture's own order
of `expect.arrays[step]`'s keys, and its first element that differs. Link refusals (hashes, packs, versions, cycles,
imports, size) are reported before any fixture runs.

### Relocatable objects

With links, the program and every library are relocatable objects as the WebAssembly tool conventions' Linking.md
lays them out; this suite's assembler (wat/, `--program` and `--library`) writes them from ordinary WebAssembly text:

- The memory is imported as `env.__linear_memory` (the program's with its limits, maximum = minimum; a library's as
  `(memory 0)`); a library function is imported as module `lib:<name>`, field `<function>` (`<name>` without the
  version); nothing else is imported, except where a test means a refusal (env.now).
- Every `call` and `global.get`/`global.set` immediate is a 5-byte padded LEB with an `R_WASM_FUNCTION_INDEX_LEB` (0)
  or `R_WASM_GLOBAL_INDEX_LEB` (7) relocation in `reloc.CODE`; every address of a library's own data is a 5-byte padded
  SLEB `i32.const` with an `R_WASM_MEMORY_ADDR_SLEB` (4) relocation against its segment's data symbol plus an addend.
- The `linking` section (version 2) holds the symbol table and the segment info (each `.data.<i>`, alignment 8). A
  library's exported functions are global symbols named by their export (the pack's `exports`); the program's exports
  (`init`, `step`, `reads_at`, `writes_at`) are symbols flagged `WASM_SYM_EXPORTED` (0x20). Other functions and
  globals are local symbols. There is no export section, no name section, no table, element segment or start function.
- **The linker's layout** (this job's reading of "the libraries' data placed after the program's"): the program's data
  segments keep the offsets its object gives them (it is placed first, at address 0), so a program's own addresses,
  `reads_at` and `writes_at` among them, need no relocation; each library's segments follow, in link order, each at its
  alignment after the one before. The merged module has the program's memory, defined and exported as `memory`, and
  exports the program's `WASM_SYM_EXPORTED` symbols by name; an import `lib:<name>.<function>` resolves to the global
  function symbol `<function>` of library `<name>`, listed in its pack's `exports`.

### Planted twins of `deep-logic` (`--planted <name>`)

Each is one criterion's wrong program, reachable only through this argument, and changes nothing else:

| Name | Criterion | The wrong program |
|---|---|---|
| `linker_adds_linking_section` | 7 | the linker runs on every program, links or none, and adds an empty `linking` custom section to the module it gives the subset check and the rewrite |
| `pack_check_skips_library_subset` | 8 | `pack_check` checks no library against the one subset (so its host imports aren't refused) and runs its fixtures with each import a merged fixture program keeps bound to a function that traps when called |
| `linker_links_in_listing_order` | 9 | the linker orders the libraries as the item lists them, each one's needs after it, instead of in dependency order |

The planted corner-cutting grid_path (criterion 2) isn't a flag: it is a library this suite writes (`gridPath({cut:
true})`), which a pack carries under grid_path@1 with grid_path@1's own fixture.

## Programs and libraries

`programs.ts` holds the programs and libraries as WebAssembly text and works out every expected value from first
principles; `libs.ts` puts them into libraries with their fixtures, packs and pieces.

- **grid_path** (`find_route(grid, w, h, sx, sy, gx, gy, scratch, out) → moves`): breadth-first search over
  8-connected moves of unit cost, neighbors tried E, W, S, N, SE, SW, NE, NW (its documented contract, read from its
  own data through a relocated address), no diagonal past a blocked cell; it writes the route's cells and returns the
  move count. `bfsRoute` is the same search in TypeScript. Twins: `cut` (no corner rule: the planted library), `pad`
  (one data byte apart), `hostImport` (imports env.now, never calls it), `v2` (grid_path@2, adds `version`).
- **grid_path@1's fixture**: the issue's 5 × 5 grid, walls (2, 0) to (2, 3), from (0, 0) to (4, 0); one step; expects
  `route` (the cells as x, y pairs, -1 after, 50 i32) and `moves` (10), from bfsRoute.
- **route programs** (objects linking grid_path): `maze` (the fixture grid), `chase` (6 × 4), `swarm` (160 × 160, open,
  corner to corner: too large for 1,000,000 fuel). Each keeps its regions, grid, route buffer and search scratch in its
  own data, so a library's data placed over them breaks it.
- **pathing@1** needs grid_path@1 (`plan` → the route's second cell, x + 1000 y); **scout@1** needs grid_path@2;
  **ping@1** and **pong@1** need each other; **turns@1** (`next_turn`); **bulk@1** (n data bytes of "a", `first` →
  97); **big_a@1**, **big_b@1** (about 500 KB, half call chains, half seeded data) and the 1 MB program linking both.
- **plain**: a counter with no links, a whole module as #531's.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#190.e0980599` | `ac01-two-pieces.test.ts` (2) | `maze` and `chase` link grid_path@1: each receipt's merged program compiles in node, imports nothing, exports logic@1's exports and is admitted; receipt and `query` name `[grid_path@1, its hash]`; each bake's route is bfsRoute's. A twin one byte apart (gridcore@1.0.1) changes both rewritten hashes and bake keys; `plain`, beside the same packs, keeps its hash and key. Fails: an import left in, a receipt or row without the library, a hash or key that doesn't cover the library, a change that touches unlinked items |
| 2 `#190.c4868d76` | `ac02-fixtures.test.ts` (3) | bfsRoute finds 10 moves on the issue's grid; grid_path@1 links with its fixture PASS and bakes that route. The cut twin under its own fixture bakes 8 moves; shipped with grid_path@1's fixture it is `link_refused`, naming the fixture, `route` and its first differing element (with both values). A library with no fixture is refused naming it, at check and at bake. Fails: a link with fixtures unrun, a fixture that compares nothing, a refusal that names no fixture or element |
| 3 `#190.ea25cdd0` | `ac03-refusals.test.ts` (1) | bytes off their hash (naming both), a pack's other hash (naming gridcore@1.0.0), lib:grid_path.find_route with only turns@1 listed, pathing@1 listed before grid_path@1 (each naming the import), and a merged program of exactly 4 MiB admitted and 1 byte more refused naming the limit and its size. Fails: any of these admitted or refused without its name |
| 4 `#190.2d5bb5ea` | `ac04-machines-browser.test.ts` (2) | `maze`'s and `chase`'s merged programs on macOS arm64 and Linux x86_64 have one sha256 and the same bytes; grid_path@1's fixture's full-state hashes (its receipt's `deep_hashes`) equal the app's bake of the fixture's piece and headless Chrome's. Fails: a linker whose output depends on the host, a web player that runs other bytes |
| 5 `#190.99970527` | `ac05-library-trap.test.ts` (1) | `swarm` traps `fuel` at step 0, logic.trap naming `swarm`, the library grid_path@1 with its hash and `find_route`; Linux x86_64 (another architecture) gives the same trap, function and offset. Fails: a trap that names no library or function, an offset that differs by host |
| 6 `#190.949568c9` | `ac06-own-claims.test.ts` (1) | `claim` on grid_path@1 from the agent's own pack: INCONCLUSIVE with one approval ask naming it; from an installed pack: PASS, no ask. Fails: an agent's own fixtures passing its own claim, an installed pack's not counting |
| 7 `#190.2d024832` | `ac07-no-links.test.ts` (1) | `plain`'s rewritten hash, bake key and golden (bake key, step and checkpoint hashes) equal the merge base's; under `linker_adds_linking_section` the hash differs and the judgement fails naming `piece plain`. Fails: a linker that touches unlinked programs |
| 8 `#190.26483cb7` | `ac08-pack-check.test.ts` (2) | `pack_check`: hostpack@1.0.0 refused naming env.now, cutpack@1.0.0 refused naming its fixture, gridcore@1.0.0 installed; `pack_check_skips_library_subset` installs hostpack and the judgement fails naming env.now. Fails: a pack check without the subset check or without fixtures |
| 9 `#190.67822510` | `ac09-needs.test.ts` (3) | `tactics` links only pathing@1: its receipt names grid_path@1 then pathing@1 with their hashes and its bake gives planOf's cell; pathing@1 with scout@1 is refused naming grid_path@1 and grid_path@2; ping@1 is refused naming the cycle ping@1, pong@1; `linker_links_in_listing_order` is refused naming lib:grid_path.find_route. Fails: listing order, needs not followed, two versions or a cycle let through |
| 10 `#190.29b58f9e` | `ac10-budgets.test.ts` (2) | (macOS arm64) the 1 MB program with big_a@1 and big_b@1: `link_ns` under 300 ms, each fixture PASS in under 5 s at the first check and not run again at the second; `plain`: no link in its receipt, the merge base's fuel per step, 40 checks' median wall time within the merge base's + 5% + 5 ms over 7 alternating rounds, and the median one-step frame's `eval_ns` within the merge base's + 5% + 20 µs over 300 frames. Fails: a slow link, fixtures rerun per check, work added to unlinked items |

Test count: 2 + 3 + 1 + 2 + 1 + 1 + 1 + 2 + 3 + 2 = 18.

## Readings where the issue leaves a choice

- **The surface.** `deep-logic` again, because the criteria need Linux x86_64, the web runner, planted twins and the
  merge base's binary. deep-show's `deep_query` isn't driven: its build set holds no logic module at the base, so the
  logic module's `query` answers deep_query's row for a logic item.
- **"Receipts"**: an item's Checked, in `check`'s and `bake`'s replies.
- **"Merges to a program that imports nothing and passes the subset check"**: the receipt's merged bytes compile in node
  and import nothing, and the piece is admitted (a program outside the subset is `subset_refused`).
- **"Changing one byte of the library"**: a twin whose object differs in one byte of its data, in a new pack version
  (a published pack version never changes).
- **"Refused at link"**: `link_refused` at check. **"Naming the fixture, the route array and the first element that
  differs"**: `fixture`, `array` and `index` (with `expected` and `actual`); the expected index is the first element
  where this suite's two searches' route arrays differ.
- **"Returns an 8-move route"**: the cut library, under a fixture of its own worked with the corner cut, links and bakes
  8 moves (a refused library never runs, so its route is read this way).
- **"An installed pack maps to another hash"**: the piece's only pack carries grid_path@1 under another sound library's
  hash; the link names grid_path@1's.
- **"A library that imports from one listed after it"**: pathing@1, whose pack entry declares no needs, listed before
  grid_path@1.
- **"1 byte over 4 MiB"**: 4,194,305 bytes of merged module before the rewrite; the test finds the library size that
  merges to exactly 4,194,304 from the receipts' `linked.size`, so it relies on no layout of the linker's.
- **"Byte for byte the same on macOS arm64 and Linux x86_64"**: this host must be macOS arm64; Linux x86_64 is Docker's
  linux/amd64.
- **"The same full-state hashes in the app and in headless Chrome"**: the fixture's run in the app records them; the
  app's bake and Chrome's bake of `web_plan`'s request for the fixture's piece must give them at each checkpoint.
- **"At the same offset on two machines"**: this host and Linux x86_64, whose `about.arch` must differ.
- **"As its own checks do"**: a check the working agent wrote binds only its own claims (deep-show's registry rule:
  INCONCLUSIVE with an approval ask); `origin: agent` marks a pack the working agent wrote.
- **"Fails, naming …"** for a twin: either the reply itself names it (criterion 9), or the test's judgement of the
  twin's output fails and its message names the piece (7) or the import (8).
- **"Compared with the merge base"** and **"gains no work"**: the merge base's own binary, measured on the same machine
  in alternating rounds; "no work" is no link in the receipt, equal fuel per step, and check and frame times within the
  stated noise allowances (5% plus 5 ms for 40 checks, 5% plus 20 µs a frame).
- **"Takes under 300 ms once at check"**: the receipt's `link_ns` at the first check; "once per hash": the second check
  of the same libraries in the same process runs no fixture (`ran` false).

## Not tested, because no criterion reaches it here

`implements` and library interfaces; the 16-library cap; a link to a library no pack carries; a fixture's
`deep_hashes` expectation failing; links on a provider or a pack program; saves surviving a library change; a
library the working agent wrote failing someone else's claim; deep-show's own `deep_query` wiring.
