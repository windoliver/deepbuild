# #190 by hand: `deep-logic` on linked libraries

Run on spark-c89f (Linux aarch64), 2026-11-09, by the implementing session, on this branch's code before its commit
(base 6042ef5a, main before the 2026-11-09 history rewrite; on today's main it is f61417522, the same tree, so 6042ef5a isn't an ancestor of this branch's
rewritten history; the object is still in the repository). No raw output of this first run is saved: its replies are the text below. The rerun at 9a02471b6
(further down) saves its raw files, and they give the same results, except where it says otherwise. The surface is the one `tests/acceptance/190/README.md` defines: `deep-logic`'s JSON lines.

## How it was run

1. The 14 request lines were written with the acceptance suite's own program builders (`tests/acceptance/190/libs.ts`,
   `programs.ts`: grid_path@1 and its fixture, the planted corner-cutting twin, pathing@1, grid_path@2, the `maze`,
   `chase`, `swarm`, `tactics` and `plain` items), by a throwaway vitest file under the ignored `target/` folder that
   writes `requests.jsonl`, plus `plain.jsonl` and `tactics.jsonl` for the planted twins (each line a `check`, `bake`, `query`, `claim` or `pack_check` call as the README
   gives it). Nothing in it judges a reply.
2. The binary, by hand, one process for all 14 lines (so a fixture that ran once should show `ran: false` after; reply 12 below shows
   it running again, the cache bug fixed in the rerun):

   ```sh
   cargo build --locked --bin deep-logic
   ./target/debug/deep-logic < requests.jsonl > replies.jsonl     # exit 0, 14 replies
   ./target/debug/deep-logic --planted linker_adds_linking_section < plain.jsonl
   ./target/debug/deep-logic --planted linker_links_in_listing_order < tactics.jsonl
   ```

3. The replies below are excerpts: each keeps only the fields it shows, with fixture IDs in fixture records shortened,
   `route` cut to its first 24 values and fixture times rounded to ms (`link_ns` stays raw); reply 10 keeps its full fixture ID and raw `ns`, and
   refusals keep their full fixture IDs. Bakes show step 0's arrays as a top-level
   `arrays`, and leave out the step items, so reply 7 doesn't show that swarm's step 0 failed (its trap does). The
   rerun's replies, with every field kept (only long base64 cut short, as said below), are in
   `e2e-raw/replies.jsonl`. The merged bytes were read back from each receipt's `linked`
   and compiled with node's own WebAssembly to list their imports and exports.

## Replies

### 1 maze links grid_path@1: check
{ "ok": true, "items": { "maze": { "hash": "7db71e9c8586b32c266d575ccd62a9e2a0cfabcb64cb3b39062d1f6f283f13f1", "linked": { "sha256": "4b72dd698454f2b11d15e6b0c3f6be02ac8b617866fc8dc0574ffb1646a6dbde", "size": 9394 }, "libraries": [ { "name": "grid_path@1", "hash": "dcb79acc656fffa03e88e6c2800d85d32f94694749783c2d63d84ac69dca9ec5", "pack": "gridcore@1.0.0", "fixtures": [ { "fixture": "0b8d9f8abe45…", "verdict": "PASS", "ran": true, "ms": 199 } ] } ], "link_ns": 4852861 } } }
### 2 maze: bake 1 step
{ "ok": true, "items": { "maze": { "hash": "7db71e9c8586b32c266d575ccd62a9e2a0cfabcb64cb3b39062d1f6f283f13f1", "linked": { "sha256": "4b72dd698454f2b11d15e6b0c3f6be02ac8b617866fc8dc0574ffb1646a6dbde", "size": 9394 }, "libraries": [ { "name": "grid_path@1", "hash": "dcb79acc656fffa03e88e6c2800d85d32f94694749783c2d63d84ac69dca9ec5", "pack": "gridcore@1.0.0", "fixtures": [ { "fixture": "0b8d9f8abe45…", "verdict": "PASS", "ran": false, "ms": 199 } ] } ], "link_ns": 97104 } }, "arrays": { "maze.route": "0,0,0,1,0,2,0,3,1,4,2,4,3,4,3,3,3,2,3,1,4,0,-1,-1,…", "maze.moves": [ 10 ] }, "traps": [] }
### 3 chase: query (deep_query row)
{ "ok": true, "items": { "chase": { "kind": "logic@1", "program": "441c1aa245fffb149a13d28ca5972a6372de807607b6fbfd24232ce33aff854c", "hash": "5171260aec70ad58e1ca157efdda28fa06561534ba52007f379103822af520c6", "libraries": [ { "name": "grid_path@1", "hash": "dcb79acc656fffa03e88e6c2800d85d32f94694749783c2d63d84ac69dca9ec5" } ] } } }
### 4 plain (no links): check
{ "ok": true, "items": { "plain": { "hash": "342531a722a01595df4e9f2b6bc9353a536676f19c135fe056987d9f7edb74f2", "linked": null, "libraries": [], "link_ns": 0 } } }
### 5 planted corner-cutting grid_path with grid_path@1 fixture: check
{ "ok": false, "code": "link_refused", "item": "maze", "refusals": [ { "rule": "fixture", "library": "grid_path@1", "fixture": "05a1034ddff8acf0c68f00259a2b4a9b62e81e9ec6597a700dbbc457e04dd263", "step": 0, "array": "route", "index": 6, "expected": 0, "actual": 1 } ] }
### 6 library with no fixture: check
{ "ok": false, "code": "link_refused", "item": "maze", "refusals": [ { "rule": "fixture", "library": "grid_path@1" } ] }
### 7 swarm (160x160): bake 1 step, fuel trap in grid_path
{ "ok": true, "items": { "swarm": { "hash": "b51263f0a8381a5b70869b8d4445b9a142e9010f238deb460afb88850190b7ca", "linked": { "sha256": "0d484221a34f102edfa5e02867dd4f35ce9ad9afa8f9b67ef7889ddc2c0911f1", "size": 444168 }, "libraries": [ { "name": "grid_path@1", "hash": "dcb79acc656fffa03e88e6c2800d85d32f94694749783c2d63d84ac69dca9ec5", "pack": "gridcore@1.0.0", "fixtures": [ { "fixture": "0b8d9f8abe45…", "verdict": "PASS", "ran": false, "ms": 199 } ] } ], "link_ns": 504737 } }, "arrays": { "swarm.route": "0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,…", "swarm.moves": [ 0 ] }, "traps": [ { "item": "swarm", "step": 0, "t": 0, "kind": "fuel", "function": 2, "offset": 451, "inputs": [], "source": null, "library": { "name": "grid_path@1", "hash": "dcb79acc656fffa03e88e6c2800d85d32f94694749783c2d63d84ac69dca9ec5", "function": "find_route" } } ] }
### 8 claim from the agent's own pack
{ "ok": true, "verdict": "INCONCLUSIVE", "asks": [ { "kind": "approval", "library": "grid_path@1", "why": "grid_path@1's only proof is fixtures the working agent wrote for its own library, in mine@1.0.0: they bind only its own claims until you approve the pack" } ] }
### 9 claim from an installed pack
{ "ok": true, "verdict": "PASS", "asks": [] }
### 10 pack_check gridcore@1.0.0
{ "ok": true, "pack": "gridcore@1.0.0", "installed": true, "libraries": [ { "name": "grid_path@1", "hash": "dcb79acc656fffa03e88e6c2800d85d32f94694749783c2d63d84ac69dca9ec5", "pack": "gridcore@1.0.0", "fixtures": [ { "fixture": "0b8d9f8abe45b5238ebfcecb100acb965f44ef7fff8e6440f9312e96cafeb6d1", "verdict": "PASS", "ran": false, "ns": 199000257, "deep_hashes": { "0": "e5d18bfb5420fd13" } } ] } ] }
### 11 pack_check hostpack (imports env.now)
{ "ok": false, "code": "pack_refused", "pack": "hostpack@1.0.0", "refusals": [ { "rule": "import", "import": { "module": "env", "name": "now" }, "library": "grid_path@1" } ] }
### 12 tactics links pathing@1 (needs grid_path@1): check
{ "ok": true, "items": { "tactics": { "hash": "6fc85540c7566a1461e07463f4f5254d3e256e036b312a5b7ae476e54b616b9a", "linked": { "sha256": "79e47f3dbd442438245ad9e74567ec56715db146f5c17e0a24c9be57c76f1188", "size": 9385 }, "libraries": [ { "name": "grid_path@1", "hash": "dcb79acc656fffa03e88e6c2800d85d32f94694749783c2d63d84ac69dca9ec5", "pack": "kit@1.0.0", "fixtures": [ { "fixture": "0b8d9f8abe45…", "verdict": "PASS", "ran": true, "ms": 107 } ] }, { "name": "pathing@1", "hash": "e080cfa0d88332b3dcc8778917659532828a8998fb6b7f89fc96c8454420f9dd", "pack": "kit@1.0.0", "fixtures": [ { "fixture": "c9b1c09fe27e…", "verdict": "PASS", "ran": true, "ms": 105 } ] } ], "link_ns": 72880 } } }
### 13 needs reach grid_path@1 and grid_path@2: check
{ "ok": false, "code": "link_refused", "item": "tactics", "refusals": [ { "rule": "versions", "versions": [ "grid_path@1", "grid_path@2" ] } ] }
### 14 grid_path@1 fixture piece: check
{ "ok": true, "items": { "fixture": { "hash": "7db71e9c8586b32c266d575ccd62a9e2a0cfabcb64cb3b39062d1f6f283f13f1", "linked": { "sha256": "4b72dd698454f2b11d15e6b0c3f6be02ac8b617866fc8dc0574ffb1646a6dbde", "size": 9394 }, "libraries": [ { "name": "grid_path@1", "hash": "dcb79acc656fffa03e88e6c2800d85d32f94694749783c2d63d84ac69dca9ec5", "pack": "gridcore@1.0.0", "fixtures": [ { "fixture": "0b8d9f8abe45…", "verdict": "PASS", "ran": false, "ms": 199 } ] } ], "link_ns": 55936 } } }

### The merged programs, compiled in node (from the receipts' linked bytes)

```text
maze merged 9394 bytes; imports: [] exports: init:function step:function reads_at:global writes_at:global memory:memory
swarm merged 444168 bytes; imports: [] exports: init:function step:function reads_at:global writes_at:global memory:memory
tactics merged 9385 bytes; imports: [] exports: init:function step:function reads_at:global writes_at:global memory:memory
```

### Planted twins

- `--planted linker_adds_linking_section`, `plain` (no links): rewritten hash
  `a320863f1afd248ac216bc044c0664ddb0531079393657e64b3ba03db7805ebb`, where the shipped linker leaves
  `342531a722a01595df4e9f2b6bc9353a536676f19c135fe056987d9f7edb74f2` (line 4 above): the twin changes an unlinked
  program's hash; the shipped linker leaves it unlinked (`linked: null`), while the twin's reply carries a `linked`
  program (sha256 `226acef4…`, 172 bytes, `e2e-raw/planted-plain.jsonl`): it ran on a program without links. (`link_ns`
  is 0 for the twin too, so it shows nothing.) ac07 checks the rest.
- `--planted linker_links_in_listing_order`, `tactics`: `{"ok":false,"code":"link_refused","item":"tactics",
  "refusals":[{"rule":"link","import":{"module":"lib:grid_path","name":"find_route"}}]}`: pathing@1 placed before
  grid_path@1 is refused by the listed-before rule, naming the import (the saved reply's `what`: "library pathing@1
  imports lib:grid_path.find_route from grid_path@1, which isn't listed before it", `e2e-raw/planted-tactics.jsonl`).

## What this shows, per criterion

"Line N" is reply N above; the same request is line N of the rerun's saved `e2e-raw/replies.jsonl`, which gives the
same results (see the rerun below).

Each bullet sums up the proof for the issue's criterion of that number, in the issue's order; the criteria's own
wording is the issue's (its Acceptance criteria), not repeated here.

- 1: linked programs merge to modules with no imports that pass the subset check. At 9a02471b6 the saved proof is ac01 passing
  (`acceptance-linux-9a02471b6.txt`) and `e2e-raw/web-plan-imports.txt`, where `e2e-tools/imports.mjs` compiles the
  four `web_plan` rewritten programs, chase's included, and finds `imports []` for each. (The merged `linked` bytes
  themselves are cut short in `e2e-raw`; node's `[]` above is from the 11-09 run.) Both items are admitted; maze's receipt (line 1), chase's
  receipt (`e2e-raw/app-bakes-replies.jsonl` row 2) and chase's deep_query row (line 3) name grid_path@1 with its hash,
  and ac01's first test (passing) asserts both receipts and both deep_query rows; `maze`'s bake gives the 10-move route. Changing one byte of
  the library changes both pieces' rewritten hashes and bake keys, while a third piece that doesn't link it keeps its
  own: ac01's second test, passing.
- 2: the fixture passes and the library links (lines 1, 14); the fixture's 10-move route on its 5×5 grid is
  `app-bakes-replies.jsonl` row 4 and screenshot 04, and ac02's first test (passing); the corner-cutting twin with grid_path@1's fixture is
  refused naming the fixture, `route`, element 6, expected 0 and actual 1 (line 5); no fixture is refused naming the
  library (line 6). The planted corner-cutter's 8-move route is ac02 (passing in `acceptance-linux-9a02471b6.txt`) and
  screenshot 03.
- 3: bytes off their hash (naming both hashes), a pack mapping the name@version to another hash (naming the pack), an
  import no listed library exports (naming it), an import of a later-listed library (naming it) and a merged program
  1 byte over 4 MiB (naming the limit) are each refused in ac03's test, passing in `acceptance-linux-9a02471b6.txt`; no
  saved reply here shows them.
- 4: the app-vs-headless-Chrome fixture test (ac04's second) passes in the acceptance suite
  (`acceptance-linux-9a02471b6.txt`). That test compares only the fixture's `deep_hashes`, the state before step 0, which the honest and the
  corner-cutting libraries share; the page's item-hash, route and moves comparison is what tells them apart, so the
  browser half of 4 rests on the page too. The merged programs on macOS arm64 and Linux x86_64 are BLOCKED here
  (ac04's first test). Its unblock ask: run ac04's first test on the reference Mac (the whole file also needs Chrome there, or `CHROME_BIN`,
  for its second test) with Docker, the linux/amd64 image pulled
  (`docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm`) and amd64 emulation on (`helpers.ts`'
  `linuxLogic` blocks on each). It hasn't run yet. So 4 is not proven.
- 5: `swarm`'s fuel trap at step 0 names grid_path@1, its hash and `find_route` (line 7). The same offset on a second
  machine is BLOCKED (ac05 in `acceptance-linux-9a02471b6.txt`): its
  second machine is a linux/amd64 container, and its unblock ask has two steps: the image, `docker pull --platform
  linux/amd64 rust:1.99.1-slim-bookworm`, which the suite doesn't pull; then amd64 emulation (binfmt), which this
  host doesn't have registered (`/proc/sys/fs/binfmt_misc` lists only python3.12), or the reference Mac's Docker. (helpers.ts's
  message also offers an x86_64 host, but ac05 then fails its check that the two machines differ in CPU architecture.) So 5 is not proven.
- 6: INCONCLUSIVE with one approval ask from the agent's own pack, PASS from an installed one (lines 8, 9), and ac06's test, which holds both,
  passes (`acceptance-linux-9a02471b6.txt`).
- 7: `plain` isn't linked (line 4) and the planted twin changes its hash (above). The same hash, bake key and goldens as
  the merge base, and the twin failing naming the piece, are ac07 (passing in `acceptance-linux-9a02471b6.txt`).
- 8: gridcore@1.0.0 installs; hostpack@1.0.0 is refused naming `env.now` (lines 10, 11). A pack whose library fails a
  fixture is refused naming the fixture, and the planted pack check that skips the subset check installs the first
  pack and fails naming the import, in ac08 (both tests passing in
  `acceptance-linux-9a02471b6.txt`).
- 9: `tactics` links grid_path@1 then pathing@1 (line 12); grid_path@1 with grid_path@2 is refused naming both (13);
  the listing-order twin is refused naming the import (above). The ping/pong cycle is refused by ac09's second test (passing in
  `acceptance-linux-9a02471b6.txt`).
- 10: both budget tests are BLOCKED here (ac10 in `acceptance-linux-9a02471b6.txt`): the budgets' reference machine is
  the reference Mac, where they haven't run yet. Its unblock ask: run ac10 on the reference Mac in the local preflight,
  with local `main` set so `git merge-base HEAD main` names the merge base it builds and compares against
  (`helpers.ts`' `baseBin`). So 10 is not proven.
- Oracle lane, criteria 1 and 3: INCONCLUSIVE for both; its 6 tests pass (`oracle-linux-9a02471b6.txt`). The map's upstream tests were in the
  owner's oracle-tests zip all along; `tests/acceptance/190/README.md` lines 10–16 (not edited; by the session's report written
  before the code, though it landed in the same commit, 85169f887) say the page answered 404. By the session's report,
  a blind job wrote `tests/acceptance/190/oracle/` from the issue, the map, the three vendored
  wasm-ld tests (`function-imports.s`, `data-layout.s`, `undefined.s`, copied unchanged with a NOTICE) and the base
  commit, never the implementation; its README lists what each test can't hold of the upstream one and why. The
  oracle-tests README (line 27, citing #136) counts a linked test as evidence only when it rejects our output with a
  planted fault, and "it" is the linked upstream test: so here only checks upstream's live CHECKs hold can count.
  No planted twin is shown failing one. `linker_adds_linking_section` fails only function-imports' no-`linking` check,
  which is ours (upstream's CHECKs read no custom section's name but `name`); its upstream-held "imports nothing"
  check fails only on the unlinked input object, which isn't our output. By round 40's report (rust-objcopy 1.99.1,
  not saved here; obj2yaml itself not installed), the twin's `linking` section is empty and LLVM's object reader, the
  one obj2yaml uses, aborts on it, so upstream's RUN line would likely reject the twin's output; whether that counts as
  upstream-held is not settled here. `linker_links_in_listing_order`'s output is aligned and consistent in its own
  order (beta@1 at 8,200, alpha@1 at 8,208, v = 65,033, by validators' probes, not saved here), so it breaks only our
  rule that link order is dependency order with ties by name; data-layout's three failing checks are fixed addresses
  that hold that order rule along with alignment. So the oracle lane is INCONCLUSIVE for criterion 1: its tests pass
  and can fail, but no planted fault is shown failing an upstream-held check. Its one ask, to the owner: does the
  function-imports twin's rejection by LLVM's object reader count (then run obj2yaml on the twin's output and save it)?
  If not, the unblock is a wrong program an upstream-held check rejects, such as a linker that misaligns a segment: a
  new planted twin (which needs the blind job to redraft the parent README's planted table) or a mutant of the linker's
  layout lines that data-layout kills. (A linker that leaves an import can't serve: the subset check on the merged
  program refuses it before any oracle check runs.)
  undefined.s has no planted twin, so the lane is INCONCLUSIVE for criterion 3 too. The base (`BASE-FAILURE.txt`, all
  6 fail) fails it before its import check. The design's "Wrong programs" accepts a mutant of the lines a change adds
  (`docs/technical-design.md`, Wrong programs), and link.rs line 404 is one (link.rs is new in 85169f887), but the two
  mutants here were made by hand in a scratch clone and saved only as output, not run by the trace lane's mutation
  step. Its one ask: run the trace lane's mutation step (cargo-mutants on `link.rs`) against the tagged
  `undefined.test.ts` and save the output. One that names no import fails upstream's CHECK (`oracle-mutants/names-no-import.txt`). Upstream's CHECK-NOT (`baz`, a symbol only `--undefined` names) isn't held:
  our linker has no `--undefined`. In its place the test checks something of our own, that no refusal names an import
  a listed library defines, and the mutant that names every import of the program fails it
  (`oracle-mutants/names-every-import.txt`). The blind job's first draft called that check the CHECK-NOT and put
  data-layout.s's `aligned_bar` at 65552 (it is at 65568); round 32 disputed both, and the job's redraft (blind, by the session's report)
  (2b38d894b, comments and docs only) corrected them. The 6 tests were rerun as committed there. The mutant runs used
  d49221e13's test text; the oracle test code is identical from d49221e13 to HEAD (every later oracle commit changes comments and docs only). The oracle README's "checks against a real linker" (rust-lld) is the blind
  job's report: no output of that run is saved.


## Rerun with the browser leg and screenshots (2026-11-11 and 12), code at 9a02471b6

Run on spark-c89f (Linux arm64). The code is commit 9a02471b6: the PR's head before these commits, 7b5d9da1f (main e7609b7b merged in),
plus fixes to the fixture cache that the separate-agent checks and the code review below found (0ed3de856, 597d83692,
eafa3d635) and one refactor with no change in behavior (9a02471b6: one reader for a piece's assets).

**How to rebuild it.** From the repo root:

```sh
cargo build --locked --bin deep-logic
mkdir -p target/e2e190 && cp docs/evidence/190/e2e-tools/gen.test.ts target/e2e190/
npx vitest run --root target/e2e190 --testTimeout=600000   # the first run builds the assembler; writes requests.jsonl, plain.jsonl, tactics.jsonl, web.jsonl, app-bakes.jsonl, labels.json, grids.json
cd target/e2e190
../debug/deep-logic < requests.jsonl > replies.jsonl
../debug/deep-logic --planted linker_adds_linking_section < plain.jsonl > planted-plain.jsonl
../debug/deep-logic --planted linker_links_in_listing_order < tactics.jsonl > planted-tactics.jsonl
../debug/deep-logic < web.jsonl > web-replies.jsonl          # line 1: web_runner's source; 2-5: web_plan replies {ok, request}
../debug/deep-logic < app-bakes.jsonl > app-bakes-replies.jsonl
```

`e2e-raw/` holds those outputs. `web-replies.jsonl` is the 9a02471b6 build's output (an earlier build wrote it first, by
the session's report; the rerun was byte-identical). In the replies, base64 strings over 200 characters (the merged programs' bytes) are cut
short; no array here is long enough to be cut. The reply files were also re-serialized with `", "` and `": "`
  spacing, so they are equal in content, not byte for byte, to `deep-logic`'s output. `web-replies.jsonl`, `labels.json` and `grids.json` are kept whole. The
requests themselves aren't kept: they are 0.8 MB, and `gen.test.ts` rebuilds them.
From `docs/evidence/190`, `node e2e-tools/imports.mjs e2e-raw/web-replies.jsonl > e2e-raw/web-plan-imports.txt` lists each `web_plan`
item's rewritten program with its sha256 and WebAssembly imports.

To serve the page and take the screenshots, from `docs/evidence/190`. Node resolves `playwright` from the repo's
`node_modules`, so `e2e-tools` has to sit inside the repo:

```sh
HEAD_SHA=<the code's commit> node e2e-tools/server.mjs e2e-raw &   # 127.0.0.1:41190; saves each browser's replies into e2e-raw
node e2e-tools/shoot.mjs screenshots
```

Then stop the server by its PID. Screenshots 00–06 here were taken exactly that way, from the saved `e2e-raw`.

**The replies.** The 14 replies give the same results as the 2026-11-09 run above:

- the same hashes and linked sizes (9394, 444168, 9385)
- the same refusals and verdicts

One thing changed: grid_path@1's fixture now runs once per `deep-logic` process. It shows `ran: true` in row 1 and
`ran: false` in rows 2, 7, 10, 12 and 14. On 11-09 and at 7b5d9da1f, row 12 ran it again, because the cache was keyed
by the piece's whole pack list.

The cache lives in the process's memory: a new process, such as the one behind `app-bakes-replies.jsonl`, runs a
library's fixtures again. The issue says the logic module "runs them once per library hash and module version". Nothing
in the issue or the design names a store that would keep results across processes, and ac10 checks a second check in
the same process.

Since 11-09, main added `pipelined` to check and bake replies, `issues` to check replies, and `ranges`, `ring` and
`occurrences` to bake replies. `assets_at` was
already there.

**The fixes**, in `crates/deep-logic/src/fixtures.rs`, with tests in `crates/deep-logic/tests/fixture_once.rs`. Each
test feeds request lines through `Logic::handle`: `fixture-once.jsonl`'s are the acceptance suite's own; the exports tests'
are derived from them (gridcore@1.0.0/1.0.1 and kit@1.0.0/1.0.1, with grid_path@1 exporting nothing in the older one).

- **0ed3de856.** The cache key was the piece's whole pack list, so the same grid_path@1, reached through kit@1.0.0
  after gridcore@1.0.0, ran its fixture again.
- **597d83692.** 0ed3de856's key dropped the pack entries' `exports`, so a refusal under a pack version whose
  grid_path@1 exported nothing was reused under a later version exporting `find_route`.
- **eafa3d635.** The code review of those two found three more problems:
  - a refusal that turned on what the piece carried (a fixture asset it lacked) was cached and replayed for a later
    piece that carried it, which was already true on 7b5d9da1f
  - 0ed3de856 (kept by 597d83692) walked the needs closure apart from `resolve`, as a new public `links::reach`
  - unreadable packs fell back to none

  Now `verify` resolves the library through the piece's packs with `links::resolve`, the same walk its fixture item
  links by. It keys on the library's fixture IDs and each linked library's label, hash and exports. It reads the packs or refuses with `bad("packs")`.
  It keeps only a fixture's own verdict (a value that differs, or `logic.determinism` failing), never a refusal from a
  missing asset or from a fixture item the check refuses. `links.rs` is back to 7b5d9da1f.
- **9a02471b6** (a refactor, not a fix). The reader closures that `verify`, `pack_check` and `claim` each passed to
  `links::resolve` are now one `stored()` (`run_fixtures` and `pack_check`'s subset loop still decode inline). The four tests
  give the same result on eafa3d635's source and on 9a02471b6's (`tests-on-eafa3d635-src.txt`).

`fixture-cache/` has the four tests, as committed in 9a02471b6, run against each source:

| Source | Failing tests |
|---|---|
| 7b5d9da1f | once-per-hash; missing-asset |
| 0ed3de856 | exports; missing-asset; needs' exports |
| 597d83692 | missing-asset |
| eafa3d635 | none; all four pass |
| 9a02471b6 | none; all four pass |

The needs' exports test also fails on a mutant whose key keeps only the library's own entry
(`mutant-key-without-needs.txt`).

The code review's last round of the cache fixes found nothing new; that is the implementing session's report, not a
saved check. One finding was kept on purpose: `verify` resolves, so it decodes and
hashes, the libraries even when the result is cached. Its cost wasn't measured in a saved run.
Criterion 10's budgets (linking a 1 MB program with two 500 KB libraries under 300 ms, fixtures once per hash under
5 s, no added work for an item without links) are BLOCKED until ac10 runs on the reference Mac.

**The suite.** #190's acceptance suite at a clean checkout of 9a02471b6 is in `acceptance-linux-9a02471b6.txt`. It ran
verbose, so each passing test is named:

- 14 tests pass, including ac07, which fails on a twin that touches an unlinked piece, comparing with the merge base's
  build.
- 4 are BLOCKED, the same four as the 11-09 run (`acceptance-linux.txt`, base 6042ef5a with the then-uncommitted
  change): ac04's first test, ac05, and ac10's two.

**The browser leg.** The page imports deep-logic's own `web_runner` source. It runs each `web_plan` request in the
browser's WebAssembly engine, for four programs:

- `maze` with grid_path@1
- `chase` with grid_path@1
- the planted corner-cutter with its own fixture
- grid_path@1's fixture piece

For each one, the page draws the route on the grid with (x, y) coordinates. It then compares five things with the
app's `bake` of the same piece, and shows ✓ only when all five are equal:

- the route
- the move count
- the item's hash after step 0 (a hash of its globals, the arrays it wrote and the rows it emitted)
- the checkpoint
- the traps

The checkpoint is labeled with the step about to run, so `0:` is the full state before step 0. grid_path@1's fixture
records only that checkpoint too: `deep_hashes {"0": "e5d18bfb5420fd13"}`, in `e2e-raw/replies.jsonl` rows 1, 2, 7, 10, 12 and 14 (the page shows
it in its rows 1, 2, 7, 12 and 14). The
honest maze and the corner-cutter share it because they start from the same memory and differ only in code. So the
checkpoint shows only that the browser and the app start from the same full state. The written route, moves and item
hash show that they computed the same thing:

| | moves | item hash |
|---|---|---|
| honest | 10 | `79f43f8d469c7abf` |
| corner-cutter | 8 | `9b9dae75fbf04f72` |

The page header shows two things the replies don't record:

- the code's commit, from the server's `HEAD_SHA`
- the host the page was served from

The app's replies were made on that same machine; that is the implementing session's report, as no saved file records
where `deep-logic` ran. The page ran in two browsers: Playwright's Chromium 156 on spark-c89f (`shoot.mjs` connects to 127.0.0.1), and the
app's pane, Chromium 152, which by the session's report ran on the same machine (07a shows only where the page was
served). `navigator.platform` says "Linux x86_64" in Chromium on every Linux, so this is
not criterion 4's Linux x86_64 leg.

| Browser | Screenshots | Replies |
|---|---|---|
| The Claude app's browser pane, Chromium 152 (the session's report; the JPEGs show Chromium 152, not the app) | 07a–07d, 800-pixel JPEGs that together cover the whole page | `browser-replies-chromium-152.json` |
| Playwright's headless Chromium 156 | 00–06 | `browser-replies-chromium-156.json` |

The two reply files are byte for byte the same. In both browsers, all four programs matched the app on all five.

| Screenshot | What it shows |
|---|---|
| `screenshots/00-full-page.png` | the whole page |
| `screenshots/01-maze-browser-vs-app.png` | maze: 10 moves around the wall, browser = app |
| `screenshots/02-chase-browser-vs-app.png` | chase: 8 moves, browser = app |
| `screenshots/03-corner-cutter-own-fixture.png` | the planted library cuts the wall's corner at (2,3) twice: 8 moves. It links only with a fixture of its own; with grid_path@1's fixture it is refused (row 5). |
| `screenshots/04-grid-path-fixture.png` | grid_path@1's fixture piece, browser = app |
| `screenshots/05-deep-logic-replies.png` | the 14 replies and what each one names, including whether each fixture ran in that call or had already run in the process. A reply that answered but whose step failed (row 7), or whose verdict is INCONCLUSIVE (row 8), is shown in amber, not green. |
| `screenshots/06-planted-twins.png` | the two planted linker twins. One answers ok with a changed hash for an unlinked program, and ac07 is the test that fails on it. The other is refused naming `lib:grid_path.find_route`. |
| `screenshots/07a`–`07d` | the same page in Chromium 152, the app's browser pane by the session's report |

**Checked by separate agents.** These are the agents' reports, not proof: where a round says it reproduced
something, its outputs weren't saved here, and the saved files named elsewhere in this document are the proof. Each round, a new agent that hadn't written the page read every screenshot against the
raw files, `gen.test.ts`, the code and the issue. It also ran its own BFS over the grids, written to `programs.ts`'s
`bfsRoute` rule.

- **Round 1:**
  - Found no wrong values. The routes are legal, and the corner-cutter's route cuts (2,3) twice in 8 moves.
  - Running the web runner in node reproduced the browser column.
  - Found nine labelling gaps on the page, all fixed.
- **Round 2:**
  - No wrong values. The sha256 of each `web_plan` request's rewritten program equals the app's rewritten-program
    hash (`hash` in the receipt, not the page's item hash after step 0).
  - Found eleven gaps in the page, the write-up and reproducibility, all fixed.
- **Round 3:**
  - No wrong values. Its own run of the server and `shoot.mjs` gave byte-identical screenshots.
  - Found one code problem: grid_path@1's fixture ran again when the same library came through another pack. Fixed in
    0ed3de856.
  - Also found twelve smaller gaps, all fixed.
- **Round 4:**
  - No wrong values. Its rebuild from the documented steps gave byte-identical `web-replies`, `labels` and `grids`,
    and replies that differ only in timings. The screenshots were byte-identical too.
  - Found a problem in 0ed3de856's key: it dropped `exports`, and a probe reused a refusal across pack versions. Fixed
    in 597d83692, with a test.
  - Also found:
    - the before-fix output came from an earlier text of the test
    - the suite had run before its commit existed
    - "arrays trimmed" was wrong
    - `NODE_PATH` does nothing for ESM imports
    - traps were listed as compared but weren't
    - the header asserted where the app ran
    - the circles were too small for "10"

  All fixed. The before-fix outputs and the suite were redone from committed code.
- **Round 5** checked `597d83692`'s evidence.
  - Its two cache problems give the right answer at `9a02471b6`: a fixture's result is kept per library hash and the
    exports its links resolve with, and a refusal that turns on what the piece carries isn't kept.
  - Four small gaps, fixed here: the generator's cold first run timed out (the rebuild step now passes `--testTimeout`);
    the saved test outputs dropped their assertion messages; the round-2 bullet said "item hash" for the rewritten
    program's hash; table row 7 showed grid_path@1's fixture checkpoint where it could be read as swarm's (it now says
    "the fixture's checkpoints"; swarm's own step 0 failed). Screenshots 00–07d were retaken after that label change.
- **Round 6** checked this evidence.
  - No wrong values. Every screenshot (00–07d) matches the raw files and the current page. Its rebuild gave
    byte-identical generated inputs, replies (timings aside), screenshots 00–06 and Chromium 156 replies.
  - Five wording gaps, fixed here: "committed `e2e-raw`" (it wasn't yet); an unrecorded timing comparison; criterion 1's
    claim about chase's imports, now stated with its check; 9a02471b6 called a fix (it's a refactor); and
    `mutant-key-without-needs.txt`, now rerun against 9a02471b6 with its assertion message and its mutant named.
- **Round 7** checked these fixes and the whole set again.
  - No wrong values; every screenshot (00–07d) is correct, its rerun gave byte-identical 00–06, and it reproduced the
    mutant's single failure.
  - Four wording gaps, fixed here: the chase-imports claim cited an agent, not a file (now `imports.mjs` and
    `web-plan-imports.txt`); round 6's timing was an agent's number (dropped); criterion 3, 4 and 10 pointed at the
    old suite file and called 10 covered; and this bullet pointed ahead to the PR.
- **Round 8** checked these fixes and the whole set again.
  - No wrong values; every screenshot (00–07d) is correct, and `imports.mjs` reproduces `web-plan-imports.txt`, whose
    sha256s equal the app's program `hash`es.
  - Fixed here: criterion 5's second machine is now called BLOCKED; criterion 1 now names its 9a02471b6 proof apart
    from the 11-09 run; the 11-09 run says it has no saved raw output; these agent rounds and the code review are
    marked as reports, not proof; the refactor claim now rests on `tests-on-eafa3d635-src.txt`.
  - It flagged that nothing shows a fixture's ID includes the linked library's hash (the page's note on reply 5).
- **Round 9** found no wrong values and one gap: round 8's bullet called that note the app's text, but it is the
  page's. It rests on the suite's own definition: a fixture asset is JSON whose item links the library by its sha256
  (`tests/acceptance/190/README.md` lines 112–113 and 128), and `helpers.ts`'s `fixtureBytes` and `fixtureId` build and
  hash it that way (lines 370–375).
- **Round 10** found no wrong values and five low gaps, fixed here: criteria 7 and 8 now cite ac07 and ac08 for their
  parts the replies don't show; "line N" now says it maps to the saved `replies.jsonl`; where the replies ran and that
  07a–07d come from the app's pane are marked as the session's report; the README citation is lines 112–113; and the
  `imports.mjs` step says to run it from `docs/evidence/190`.
- **Round 11** found no wrong values; fixed here: the oracle lane is now called BLOCKED with its unblock ask (P2);
  criterion 2 cites ac02 and screenshot 03 for the 8-move corner-cutter; and the 11-09 base names why it isn't in
  this branch's history.
- **Round 12** found no wrong values and one low gap, fixed here: `links::reach` came in 0ed3de856, not 597d83692.
- **Round 13** found no wrong values and two low gaps, fixed here: step 2's note on `ran: false` now names reply 12's
  rerun, and `gen.test.ts`'s comment names all four `web_plan` requests.
- **Round 14** found no wrong values (its rerun gave byte-identical 00–06) and one low gap, fixed here: 9a02471b6's
  `stored()` replaces the three reader closures passed to `links::resolve`, not every asset decode.
- **Round 15** found no wrong values (its rerun gave byte-identical 00–06) and one gap, fixed here: the code review's
  last round was cited as "reported in the PR"; it is the implementing session's report.
- **Round 16** found no wrong values (its rerun gave byte-identical 00–06) and four low gaps, fixed here: the 11-09
  replies' list of cuts is complete; the fixture tests' pieces are the suite's or derived from them; the key includes
  the fixture IDs; the earlier suite file is named; and criterion 4's summary names the one ac04 test that passes.
- **Round 17** found no wrong values (its rerun gave byte-identical 00–06) and three low gaps, fixed here: where the
  Chromium 152 pane ran is marked as the session's report; the reply files' re-serialization is stated; and
  `acceptance-linux.txt`'s header says the amd64 image is missing, not that the box can't run it. Criterion 1 now also
  cites ac01's one-byte test.
- **Round 18** found no wrong values (its rerun gave byte-identical 00–06) and one low gap, fixed here: the 11-09
  replies' list of cuts named `program`, which reply 3 keeps, and left out the bake fields cut, which hid swarm's
  failed step 0 in reply 7.
- **Round 19** found no wrong values (its rerun gave byte-identical 00–06) and two low gaps, fixed here: round 18's
  field-by-field list of what the 11-09 excerpts leave out was still inexact (it named `occurrences`, which the 11-09
  code didn't have, and missed `pages`), so the note now says each excerpt keeps only the fields it shows; and main's
  `occurrences` is added to what main changed since 11-09.
- **Round 20** found no wrong values (its rerun gave byte-identical 00–06 and `web-replies.jsonl`) and one low gap,
  fixed here: the excerpts' note said every fixture ID was shortened; reply 10 and the refusals keep theirs whole.
- **Round 21** found no wrong values (its rerun gave byte-identical 00–06) and three low gaps, fixed here: the
  generator's outputs now include `plain.jsonl` and `tactics.jsonl`; the `deep_hashes` rows name the file they count;
  and `web-replies.jsonl`, first written by an earlier build, is now the 9a02471b6 build's output (byte-identical).
- **Round 22** found no wrong values (its rerun gave byte-identical 00–06, `web-replies.jsonl`, `labels.json` and
  `grids.json`) and two low gaps, fixed here: criterion 1's one-byte sentence now says what ac01 checks (rewritten
  hashes and bake keys), and 7b5d9da1f is named as the PR's head before these commits.
- **Round 23** found no wrong values (its rerun gave byte-identical 00–06, replies equal but for timings) and two low
  gaps, fixed here: the 9a02471b6 suite file says how the clone's `main` was set (a report), and the fixture tests feed
  request lines, one of them a `pack_check` with no piece.
- **Round 24** found no wrong values (its rerun gave byte-identical 00–06; `fixture_once` 4 passed) and one low gap,
  fixed here: the rerun's replies were called whole, though their long base64 is cut.
- **Round 25** found no wrong values (its rerun gave byte-identical 00–06 and `web-replies.jsonl`; `fixture_once` 4
  passed) and three low gaps, fixed here: `link_ns: 0` no longer cited as proof for the no-links twin; ac04's
  browser test is described with its limit and the page named as the stronger proof; and the earlier build that
  wrote `web-replies.jsonl` first is marked as a report.
- **Round 26** found no wrong values (its rerun gave byte-identical 00–06 and `web-replies.jsonl`) and two low gaps,
  fixed here: only fixture times are rounded in the excerpts (`link_ns` is raw); and criterion 1 now cites each
  piece's receipt and deep_query row, with ac01's first test for the ones no saved reply shows.
- **Round 27** found no wrong values (its rerun gave byte-identical 00–06) and two low citation gaps, fixed here:
  criterion 2's 10-move fixture route and criterion 9's cycle now cite the reply, file and passing test that show them.
- **Round 28** found no wrong values (its rerun gave byte-identical 00–06) and two low gaps, fixed here: main's
  `issues` in check replies is listed with what main added since 11-09; and the Mac lines say those runs haven't
  happened.
- **Round 29** found no wrong values (its rerun gave byte-identical 00–06 and `web-replies.jsonl`; `fixture_once` 4
  passed) and two low gaps, fixed here: criterion 10's budgets are named as the issue states them; and the
  screenshot table marks 07a–07d's source as the session's report.
- **Round 30** found no wrong values (its rerun gave byte-identical 00–06; `fixture_once` 4 passed) and one P2: the
  oracle lane was called unreachable, though its tests were in the owner's zip. Fixed here: a blind job wrote the
  oracle suite and it passes (above; its verdict is INCONCLUSIVE since round 39). Its three low gaps are fixed too: criteria 1, 3 and 8 are stated as the issue
  states them, and the item hash after step 0 is described as `step_hash` computes it.
- **Round 31** reproduced the oracle run (6 passed) and found one P2 and two low gaps, fixed here: undefined.s had
  no wrong program reaching its import check (now two saved mutant runs); the README's rust-lld run is marked as a
  report; and only two test files show their own wrong program.
- **Round 32** found no wrong values and one P2 and three low gaps, fixed here: the oracle suite called its own
  defined-import check undefined.s's CHECK-NOT (sent back to the blind job, which redrafted its comments and README);
  its data-layout comment put `aligned_bar` at 65552 (redrafted to 65568); the mutant files now carry the exact code
  change, host and date; and the oracle run is redone on the tests as committed.
- **Round 33** found no wrong values and no P2 (it reran the oracle lane, 6 passed, and checked every screenshot
  against `e2e-raw`); its six low gaps are fixed here: two wordings in the oracle suite (upstream checks the segment
  and a global, not foo's and aligned_bar's addresses; `--undefined` names a symbol rather than requiring it) went
  back to the blind job, whose redraft (5779f0291) changes comments and docs only, so the oracle run on 2b38d894b's
  tests stands; 5's unblock ask is named apart from the Mac runs; the blind job's inputs and the README's
  timing are marked as the session's report; the planted-fault rule is cited to the oracle-tests README; and the
  per-criterion bullets run 1 to 10, with ac06 cited under 6.
- **Round 34** found no wrong values (it reran the oracle lane, 6 passed, matched the vendored files to the owner's
  zip and checked all 11 screenshots against `e2e-raw`) and two P2s and three low gaps, fixed here: 4's unblock ask
  now names Docker, the amd64 image and emulation on the Mac; 5's names emulation after the pull; 4 is one bullet; the
  mutant runs' test text is named; and the no-links twin's `linked` program is cited.
- **Round 35** found no wrong values (oracle rerun 6 passed; `imports.mjs` output byte-identical; all 11 screenshots
  checked against `e2e-raw`) and one P2 and two low gaps, fixed here: 5's unblock ask no longer offers an x86_64 host,
  where ac05's different-architecture check fails; 10 names its unblock ask; and the listing-order twin's refusal is
  quoted as the listed-before rule it is.
- **Round 36** found no wrong values (oracle rerun 6 passed; vendored files byte-identical to the owner's zip; all
  11 screenshots and every `e2e-raw` value checked) and one P2 and two low gaps. The P2 and one low were in the oracle
  suite, sent back to the blind job: upstream's live CHECKs never read `external_ref`'s resolved address, so that check
  is our own, and five globals and both segment offsets are checked, not one global. Its redraft (317d82301) changes
  comments and docs only, so the oracle run stands. The other low is fixed here: 4's unblock ask names its first
  test, and Chrome on the Mac for the second.
- **Round 37** found no wrong values (oracle rerun 6 passed; screenshots and `e2e-raw` checked) and one P2 and three
  low gaps. The P2 and two lows were in the oracle suite, sent back to the blind job: function-imports presented its
  no-`linking` check as upstream's, though upstream's live CHECKs never read section names, and its planted twin fails
  only that check; data-layout's judge has its own export and zero-fill checks; and upstream's 2 pages are stack plus
  data. Its redraft (f300d835d) changes comments and docs only. Fixed here: the oracle bullet says function-imports doesn't
  count under the planted-fault rule, so criterion 1's oracle proof rests on data-layout (superseded by round 39); and the mutant runs'
  provenance names the latest oracle commit.
- **Round 38** found no wrong values (oracle rerun 6 passed; it probed both planted twins in a scratch copy of the
  tests; screenshots and `e2e-raw` checked) and two P2s and three low gaps, fixed here: the oracle bullet called
  data-layout's planted twin caught by an upstream-held check, though it fails only our own order rule (sent back to
  the blind job too, whose redraft 2ce09306c changes comments and docs only); the bullet now applies the planted-fault rule
  by its letter to all three tests and says undefined.s, which has no planted fault, doesn't count; an unfilled
  commit placeholder is filled; `name` is named as the one custom section upstream reads; and the mutant runs'
  provenance says the test code is identical from d49221e13 to HEAD.
- **Round 39** found no wrong values (oracle rerun 6 passed, type check clean, both twins probed, screenshots and
  `e2e-raw` checked) and one P2 and three low gaps. The P2: round 38's "counts by the rule's letter" overclaimed, since
  the rule's "it" is the linked upstream test and no upstream-held check rejects either planted twin; rounds 37 and 38
  had read the same facts two ways. Settled here on the strict reading: the oracle lane is INCONCLUSIVE for criteria 1
  and 3, with an unblock ask, and the looser reading is left to the owner. The lows: the planted twin's layout is
  stated as probed rather than shown by the test; and two oracle-file wordings went back to the blind job, whose
  redraft (89ef55002) changes comments and docs only.
- **Round 40** found no wrong values (oracle rerun 6 passed, code identical d49221e13 to HEAD after stripping
  comments, twins probed, all screenshots and `e2e-raw` checked) and three P2s and five low gaps, all on the oracle
  lane, fixed here: LLVM's object reader rejects the `linking` twin's empty section, which the bullet now reports
  as unsettled and puts to the owner; the unblock example "a linker that leaves an import" can't work (the subset check
  refuses it first) and is dropped; criterion 3 gets its own ask, the trace lane's mutation step on `link.rs`, and
  the design's mutant route is cited correctly; the two asks replace the separate "looser reading" aside; rounds 30
  and 37's verdicts are marked superseded; and three oracle-file wordings went back to the blind job, whose redraft
  (8552bc983) changes comments and docs only.
