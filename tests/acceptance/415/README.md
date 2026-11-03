# Acceptance tests for #415: data layouts, `data.layout@1`, validators under the one subset, the first-party layouts

Written first, from issue #415 (its scope, Fields, three acceptance criteria and proof line: "The validators'
refusals naming offsets and traps, the pages@1 cap, and a planted pack cap failing"), its Oracle note, the design
sections it names and base commit `692cc5cd` ("Merge pull request #1132 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

## What was read

- The issue body and its Oracle note (as handed to this job): criterion 1's bounds trap is wasm-spec's "out of
  bounds memory access" (`memory_trap.wast`, `address.wast`); criteria 2 and 3 have no upstream test.
- `docs/canvas-primitives.md`: Logic: data layouts; Logic: sandbox (program roles, trap kinds); Pack; Driver: tables;
  Asset job: navigate (nav.graph@1/@2's fields); Asset: tables: catalogs `table.layout@1`; Logic: world pages;
  Provider `gen@1` and its links section (`out: data`, `out: pages`); Registry and seal: registries; Registries and
  closed lists. `docs/technical-design.md`: Data layouts; Dogfooding. AGENTS.md.
- At the base: `crates/deep-show` (`run`, `--planted`, `install_pack`, `packs`' `layouts` rows, the `sandbox`
  counts, `src/sandbox.rs`, which runs a pack layout's validator on its twins at pack check), `crates/deep-sandbox-wasmtime`
  (the validator role's run and budget: fuel 8 a byte, at least 10,000,000, memory the asset plus 4 MiB),
  `crates/deep-canvas/src/registry/{lists,core_lists}.rs` (#200's registries), `scripts/lanes.mjs`, and
  `tests/acceptance/238/`, whose shape this suite follows.

What the base already does, which these tests don't credit: #238's pack check admits a pack layout only when its
validator refuses every twin, and a trap counts as a refusal. Nothing at the base names `data.layout@1`, a
first-party layout, a `validate` call or either planted name below.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/415 --no-file-parallelism
npx tsc -p tests/acceptance/415/tsconfig.json
rm -rf tests/acceptance/415/node_modules/.vite
```

Each file builds `cargo build --locked --bin deep-show --no-default-features --features full` once (honoring
`CARGO_TARGET_DIR`) and copies it to a temporary folder. Every test passes an explicit timeout of one hour. Each test's
assets, packs and evidence store live in a temporary folder deleted after it; `caps.test.ts` writes its 4,096-page
asset (268,451,852 bytes) once, streamed a page at a time, and deletes it after the file, and its 4,097-page asset
(268,517,392 bytes) in its test's folder: about 540 MB of disk at the peak, and deep-show holds one such asset plus
its validator's memory. Node built-ins and vitest only.

`scripts/lanes.mjs` needs `'tests/acceptance/415/'` added to its `alone` list (the files build deep-show, write
256 MiB assets and run 10,000 validations in one process), which also takes the folder off the parallel line. This
README is the instruction; the implementer makes that edit.

`BASE-FAILURE.txt`: the suite wasn't run at the base, which lacks every surface it reads (reason there).

## The surface under test

The issue names a registry, layouts, validators and planted wrong programs, but no command. **Every name below
marked *invented* is this job's**, the smallest surface the criteria need; the implementer builds exactly these, or a
dispute goes to a blind redraft. Reused as they are: `deep-show run` and its startup `--planted <name>`,
`install_pack` with a pack folder (#306, #238), and `{"call": "sandbox"}`'s `runs` (#238).

### `{"call": "validate", "layout", "path"}` (*invented*)

A new call of `deep-show run`: the check-time validation of one data asset, the same function the sandbox module
runs wherever an asset is named (a logic item's `assets`, a provider's `out: data` or `out: pages`, a world's
`init`). `layout` is `name@version`, resolved through `data.layout@1`: a first-party entry (`nav.graph@1`,
`nav.graph@2`, `pages@1`, `fn.table@1`, …) or an installed pack's layout by the name its `layouts` key gives
(`oobpack.oob@1`). `path` is an absolute path to the asset's bytes. The reply:

```text
{"layout": name@version, "asset": sha256 hex of the bytes, "size": bytes, "max_bytes": the layout's cap,
 "outcome": "admitted" | "refused",
 "code": null | "layout_refused" | "layout_trap" | "over_cap",
 "offset": null | integer,     // layout_refused: validate's return, the first bad byte's offset
 "field": null | string,       // layout_refused: the field that byte lies in (below)
 "trap": null | {"kind", "function", "offset"}}   // layout_trap: sandbox@1's trap, as #238's run names it
```

Every key is always present. An asset past `max_bytes` is `over_cap` and its validator never runs (`sandbox.runs`
doesn't move); otherwise the validator runs (`runs` rises by one for an asset hash not seen before) and returns −1
(`admitted`, every other field null), an offset (`layout_refused`), or traps (`layout_trap`, offset and field null).

**Naming the field.** `field` is the name, in this README's byte layouts, of the field whose bytes hold `offset`,
with its record's index: `header.node_count`, `nodes[2].floor`, `nodes[1].vertex_count`, `nodes[2].tags`,
`links[5].a`, `links[5].face`, `pages[2].number`, `x[2]`, and so on (`offset` is that field's first byte). Each
first-party layout's `doc` documents these fields; how the implementation maps an offset to its field is its own.

### Planted twins of deep-show (`deep-show run --planted <name>`) (*invented names*)

Each is one criterion's wrong program, reachable only through this argument, and changes nothing else:

| Name | Criterion | The wrong program |
|---|---|---|
| `pages_capped_at_64mib` | 2 | pages@1 with a pack layout's cap: `max_bytes` 67,108,864 instead of its own |
| `nav_graph_trusts_link_count` | 3 | nav.graph@1's and nav.graph@2's validators without the check of `link_count` against the bytes after the nodes: each reads `link_count` links whatever follows |

`data.layout@1`'s own planted wrong entry (a validator that accepts its own twin) isn't read by these tests (Not
tested).

### Packs (written by the tests)

`test/oobpack@1.0.0` (as #238's quadpack): `requires.modules: {sandbox}`; `assets`: `oob.wasm` and `twin.bin` (one
zero byte); `layouts: {"oobpack.oob@1": {validator: sha256 of oob.wasm, max_bytes: 4096, twins: [sha256 of twin.bin],
doc}}`. `oob.wasm` is 77 bytes, hand-assembled in `helpers.ts` and checked with Node's `WebAssembly.validate`:
`memory` (1 page, max 1), `in_at` = 1024, and `validate(len: i64) → i64` whose body is `i32.const -16; i64.load;
end`, a load at 0xFFFFFFF0, past any memory a validator may hold, so every run traps `bounds` in function 0 at the
`i64.load` (byte 73). Its twin is refused by that trap, so the layout is admitted.

### Byte layouts (this suite's reading; the implementer builds exactly these and documents them in each layout's `doc`)

The design names the fields ("a documented little-endian layout") but not the bytes. All little-endian; f32 and f64
IEEE 754; no padding unless listed.

**nav.graph@1** (mesh form as the tests write it; the grid form's node is `floor f32, cell_x i32, cell_y i32`):

| Offset | Field | Type | Rule the tests read |
|---|---|---|---|
| 0 | `header.magic` | 4 bytes `NAVG` | |
| 4 | `header.version` | u32 | 1 |
| 8 | `header.form` | u32 | 0 grid, 1 mesh |
| 12 | `header.capsule.radius`, `.height`, `header.climb`, `header.slope` (deg), `header.cell` | 5 × f32 | finite |
| 32 | `header.source` | 32 bytes | sha256 of the world's static shapes |
| 64 | `header.node_count` | u32 | node_count × the smallest node (grid 12 bytes, mesh 20: one vertex; nav.graph@2 4 more) fits the bytes that follow |
| 68 | `header.link_count` | u32 | after the nodes, exactly link_count links remain |
| 72 | nodes, in order: `nodes[i].floor` f32, then `nodes[i].vertex_count` u32 and that many vertices, each 3 × f32 (x, y, z) | | floor finite; vertex_count 1 to **32** (the polygon cap), checked before its vertices are read; the vertices inside the asset |
| … | links, sorted by (a, b): `links[i].a` u32, `links[i].b` u32, `links[i].cost` f32, `links[i].rise` f32 (16 bytes) | | a and b below node_count |

**nav.graph@2**: nav.graph@1's bytes with `header.version` 2 and these additions: after `header.link_count`,
`header.tag_count` u32 (at most 32) at 72 and `tag_count` names of 32 bytes each, UTF-8 padded with zeros
(`tags[i]`); each node ends with `nodes[i].tags` u32 (one bit per tag; a bit at or past `tag_count` is out of range);
each link ends with `links[i].kind` u8 (0 walk, 1 jump, 2 drop, 3 wall), `links[i].face` u8 (on a wall link 0 to 5:
+x, −x, +y, −y, +z, −z; else 0), `links[i].reserved` u16 (0) and `links[i].shape` u32 (the wall's box ID; else 0):
24 bytes a link. These are the design's "about 4 B a node and 8 B a link more".

A validator walks the asset in order and returns the first bad byte, so each field that sizes or indexes another is
checked against the bytes and counts it points into before anything is read through it. Rules beyond those listed
(sorted links, finite costs, trailing bytes, a non-wall link's zeros, …) are the implementer's, as long as the fixture
level below is admitted.

**pages@1**: `header.magic` 4 bytes `PAGS` at 0, `header.version` u32 = 1 at 4, `header.page_count` u32 at 8, then
per page `pages[i].number` u32 and its 65,536 bytes (65,540 a page; page i's number at 12 + 65,540 i). Page numbers
strictly increase, so a repeat is refused at the second. Its `max_bytes` is its own cap, a header and 4,096 pages:
**12 + 4,096 × 65,540 = 268,451,852 bytes**, past a pack layout's 64 MiB, so a 4,097-page asset is `over_cap`.

**fn.table@1**: `header.magic` 4 bytes `FTAB`, `header.version` u32 = 1, `header.mode` u32 (0 linear, 1 monotone),
`header.count` u32 (2 to 4,096), then `x[i]` f64 × count from 16, then `y[i]` f64 × count. x strictly increases and
every value is finite, so x = 0, 2, 1 is refused at `x[2]`, byte 32.

### The fixture level

`helpers.ts`' `LEVEL`, in the mesh form: five convex polygons of 4, 3, 4, 5 and 4 vertices on floors 0, 0, 0.5, 1.5
and 3 m; six links sorted by (a, b): (0,1), (1,0), (1,2), (2,1) walks, (2,3) a jump and (3,4) a wall link on box 7's
face 2; in nav.graph@2 three tags (`near_drop`, `inside`, `spawn`) with node bits in 0..2. nav.graph@1's bytes are 448
long, nav.graph@2's 616. Both versions must admit it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading
`- [ ] ` dropped (checked against the live issue). Each test's name starts with its criterion's ID.

**`#415.cd60aa60`** (criterion 1) — `refusals.test.ts` (4):
1. nav.graph@1 admits the fixture level; with `links[2].b` = 9 (5 nodes) it's refused: `layout_refused`, the asset's
   hash, the layout, offset of `links[2].b` (the link's first bad byte), field `links[2].b`.
2. pages@1 admits pages 0, 5, 7 and refuses 0, 5, 5 at the second 5: offset 131,092, field `pages[2].number`.
3. `oobpack.oob@1` on a 4,096-byte asset: `layout_trap`, trap `{kind: "bounds", function: 0, offset: 73}`.
4. The same layout on 4,097 bytes: `over_cap`, `max_bytes` 4,096, no trap, `sandbox.runs` unchanged; then 4,096
   bytes runs its validator (runs + 1, `layout_trap`). Wrong programs: a cap checked after the run (a trap, runs + 1),
   a cap off by one (the 4,096-byte asset refused for size).

**`#415.701b371a`** (criterion 2) — `caps.test.ts` (3):
1. fn.table@1 admits x 0, 1, 2 and refuses x 0, 2, 1: offset 32, field `x[2]`.
2. pages@1 admits 4,096 pages (268,451,852 bytes, past 64 MiB) with `max_bytes` 268,451,852; refuses 4,097
   (268,517,392 bytes) `over_cap`, naming that cap. Wrong program: a pack layout's 64 MiB cap.
3. `--planted pages_capped_at_64mib`: the 4,096-page asset is refused `over_cap`, naming its hash, `max_bytes`
   67,108,864: the wrong program fails criterion 2's own test 2, naming the asset.

**`#415.99838793`** (criterion 3) — `navgraph.test.ts` (3):
1. nav.graph@1 and nav.graph@2 admit the fixture level, and each refuses, with `layout_refused`, no trap, the field's
   offset and its name: `header.node_count` = 0xFFFFFF; `header.link_count` one link past the bytes; `links[5].a` =
   the node count; `links[5].b` past it; `nodes[2].floor` NaN; `nodes[3].floor` −∞; `nodes[1].vertex_count` 0 and 33
   (past the cap of 32); and in nav.graph@2 `nodes[2].tags` with bit 3 of 3 tags and `links[5].face` 6.
2. 10,000 mutations of nav.graph@2's fixture level from seed 415 (mulberry32), alternately a truncation to a random
   shorter length and one to three random bit flips, in one deep-show process: it exits 0 with every reply (no
   crash); no reply traps; each is admitted (never a truncation) or refused `layout_refused` with a field and an
   offset inside the asset (0 to its size, the size itself naming a missing byte). A trap is how a read past the end
   shows; a read into memory past the asset that doesn't trap isn't observable here (Not tested).
3. A header `link_count` of 0x0FFFFFFF in both versions: shipped, refused naming `header.link_count` at 68, no trap;
   `--planted nav_graph_trusts_link_count`: not that refusal, and it reads past the asset: a trap, or a refusal at an
   offset past the asset's last byte. The wrong program fails test 1's count case, naming the count.

Test count: 4 + 3 + 3 = 10.

## Readings where the issue leaves a choice

- **"Naming the link's offset"** is the first bad byte, `validate`'s return: the offset of the link's `b` (or `a`),
  inside the link, as "the first bad byte's offset" says.
- **"Naming index 2"** is the field `x[2]`, its index in its name.
- **"Naming the cap"** is the reply's `max_bytes` with `code: "over_cap"`: pages@1's cap of 4,096 pages is its
  `max_bytes`, a header and 4,096 pages, "its own cap, past a pack layout's 64 MiB".
- **"Fails, naming the asset"** for the planted pages@1: the 4,096-page asset is refused, the refusal naming the asset
  by hash, where the shipped layout admits it.
- **"Reads past the asset"** for the planted nav.graph validator: with a link count far past the bytes, trusting it
  ends in a trap (past memory) or a refusal at an offset past the asset; either is a read past the asset.
- **A crash** is deep-show exiting otherwise than 0 or a missing reply.

## Not tested, because no criterion asks

`data.layout@1`'s registry row, kit and planted wrong entry; `table.layout@1`, `voxels.grid@1` and `static.shapes@1`;
`deep_kinds`' listing of layouts; a run once per asset hash and validator hash; the naming sites themselves (a logic
item's `assets`, a provider's `out: data` and `out: pages`, a world's `init`); a pack layout's `max_bytes` over 64
MiB or `doc` over 2,000 characters; the validator budget (fuel 8 a byte, memory the asset plus 4 MiB); nav.graph's
grid form; reads into a validator's memory past the asset that don't trap.
