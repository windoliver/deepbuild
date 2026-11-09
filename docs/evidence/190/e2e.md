# #190 by hand: `deep-logic` on linked libraries

Run on spark-c89f (Linux aarch64), 2026-11-09, by the implementing session, on this branch's code before its commit
(base 6042ef5a). The surface is the one `tests/acceptance/190/README.md` defines: `deep-logic`'s JSON lines.

## How it was run

1. The 14 request lines were written with the acceptance suite's own program builders (`tests/acceptance/190/libs.ts`,
   `programs.ts`: grid_path@1 and its fixture, the planted corner-cutting twin, pathing@1, grid_path@2, the `maze`,
   `chase`, `swarm`, `tactics` and `plain` items), by a throwaway vitest file under the ignored `target/` folder that
   only writes `requests.jsonl` (each line a `check`, `bake`, `query`, `claim` or `pack_check` call as the README
   gives it). Nothing in it judges a reply.
2. The binary, by hand, one process for all 14 lines (so fixtures that ran once show `ran: false` after):

   ```sh
   cargo build --locked --bin deep-logic
   ./target/debug/deep-logic < requests.jsonl > replies.jsonl     # exit 0, 14 replies
   ./target/debug/deep-logic --planted linker_adds_linking_section < plain.jsonl
   ./target/debug/deep-logic --planted linker_links_in_listing_order < tactics.jsonl
   ```

3. The replies below are cut down for reading: `what` texts, layouts and base64 bytes left out, fixture IDs shortened,
   `route` to its first 24 values, times rounded to ms. The merged bytes were read back from each receipt's `linked`
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
  program's hash; the shipped linker never runs on it (`linked: null`, `link_ns: 0`).
- `--planted linker_links_in_listing_order`, `tactics`: `{"ok":false,"code":"link_refused","item":"tactics",
  "refusals":[{"rule":"link","import":{"module":"lib:grid_path","name":"find_route"}}]}`: pathing@1 placed before
  grid_path@1 leaves its import unresolved, and the refusal names it.

## What this shows, per criterion

- 1: `maze` and `chase` merge to modules with no imports (node lists `[]`) that are admitted; the receipt (line 1) and
  deep_query's row (line 3) name grid_path@1 with its hash; `maze`'s bake gives the 10-move route.
- 2: the fixture passes and the library links (lines 1, 14); the corner-cutting twin with grid_path@1's fixture is
  refused naming the fixture, `route`, element 6, expected 0 and actual 1 (line 5); no fixture is refused naming the
  library (line 6).
- 5: `swarm`'s fuel trap at step 0 names grid_path@1, its hash and `find_route` (line 7). The second machine
  (Linux x86_64) wasn't run here.
- 6: INCONCLUSIVE with one approval ask from the agent's own pack, PASS from an installed one (lines 8, 9).
- 7: `plain` isn't linked (line 4) and the planted twin changes its hash (above).
- 8: gridcore@1.0.0 installs; hostpack@1.0.0 is refused naming `env.now` (lines 10, 11).
- 9: `tactics` links grid_path@1 then pathing@1 (line 12); grid_path@1 with grid_path@2 is refused naming both (13);
  the listing-order twin is refused naming the import (above).
- 3, 4 and 10 are covered by the acceptance suite (`acceptance-linux.txt`); 4's Mac and Linux x86_64 legs and 10 need
  the reference Mac.
