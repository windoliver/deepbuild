# rust-3d: `crates/deep-canvas-scene3d` and `crates/deep-scene3d-render`

Checkout `the checkout` at 06fd33cd.
`S/` = `crates/deep-canvas-scene3d/src/`, `R/` = `crates/deep-scene3d-render/src/`.

Not verified: nothing was compiled or run (brief). Every finding is from reading the code, its callers and
the tests named, plus three `node -e` evaluations of copied-out arithmetic (noted where used).

Coverage is partial and the table at the end says exactly what. The area is 52k lines; I tried to split it
across six forks and the session's subagent limit refused all six, so one context read it. About 11k lines
were read in full, 4k more in targeted ranges, and the rest was reached only by whole-area greps.

Counts: 12 findings. broken 7, inconsistent 2, inefficient 1, unneeded 1, plus one mixed (unbounded cache).
SURE 4, LIKELY 6, QUESTION 2. Nits listed after.

---

### RUST3D-1  The frame fast path freezes everything in the scene that reads t except solids and the camera
- kind: broken
- confidence: LIKELY (mechanism read end to end; not run)
- where: `S/frames.rs:344-358` (`fast_path` admission), `S/frames.rs:165-250` (`Frames::at`, fast branch),
  `S/scene.rs:2951-2956` (`print: print::frame(&look.print, seed, t, false)`), `S/scene.rs:2630-2633` (a puff's
  `pos` is its world origin at t), `R/lib.rs:5105` (the renderer reads `scene.print`),
  `crates/deep-gpu-layer/src/liveview.rs:794, 888` (the live view draws from `Frames::at`).
- evidence: `fast_path` returns `None` only for overlays, lights, others, built meshes, lines, points and
  labels, a pivot, a camera `fit`, or a channel field that is not `at/*` or a camera field. It never looks at
  the look or at `layer.puffs`. The fast branch of `at` then rewrites only `solids[..].model`, `scene.size` and
  `scene.camera`. But `evaluate_compiled` also makes, from t:
  - `scene.print` = `deep_canvas_marks::print::frame(print, seed, t, false)`
    (`crates/deep-canvas-marks/src/print.rs:593-615`: grain step, screen step, wear step, flicker, weave and
    each separation's jittered offset are all `step(t, rate, ..)`). `Frame` is `Copy + PartialEq`.
  - each `Puff.pos` = `origin(&world)` of its item, which a motion track on the puff or on its parent moves.
  - `scene.water` = `water::find(.., seed, seconds)` (`S/scene.rs:2968`), for a water material on a unit mark.
  Nothing else writes `scene.print` (grep `\.print = |print::frame` over `crates`: only `S/scene.rs:2951`, and
  the 2D path's own in `deep-gpu-layer/src/print2d.rs:274`).
- failure: a document of `mark.box@1` items with no light, line or label, under a look whose print finish has
  grain (or wear, or a jittered separation) at a rate above 0, played in the live view. `Frames::is_fast()` is
  true, so every frame after the first carries t = 0's `print`: the grain, the gate weave and the registration
  jitter never step, and `Frames::changed()` reports a still scene. Add one label to the same document and it
  goes down the whole path, where they step. Same shape for a `puff@1` with a position track: it stands still
  on the fast path and moves on the whole path.
- fix: smallest safe edit is to keep such documents off the fast path. In `S/frames.rs`:
  - `:118` `let fast = fast_path(map, &program, &scene);` →
    `let fast = fast_path(map, &program, &scene).filter(|_| look.print.is_identity());`
  - in `fast_path`, add to the first condition (`:347-355`):
    `|| scene.water.is_some() || scene.layers.iter().any(|l| !l.puffs.is_empty())`
  (`Print::is_identity` exists: `R/lib.rs:5105` calls it.) The faster fix, a follow-up: keep the seed in
  `Frames` and set `self.scene.print = print::frame(&self.look.print, seed, t, false)` in the fast branch
  (no allocation: `Frame` is `Copy`), folding `!=` into `changed`.
- verify: `S/frames.rs:496` `each_frame_on_the_fast_path_is_the_whole_evaluation` compares `Frames::at` with
  `evaluate` under a plain look. The same body under a look with `print.grain.rate > 0` fails today (the
  scenes differ in `print` at any t past one grain step) and passes after.
- risk: documents with a print finish or puffs lose the allocation-free path (they become whole-path frames,
  which is what a label already costs). `S/frames.rs:496` asserts `is_fast()` for its own plain look only,
  and `is_fast()` has no caller outside that file's tests. tests/acceptance/378 and 379 (the allocation
  counts) use no print finish and no puff (`rg -l -i 'grain|"print"|wear|separations' tests/acceptance/378
  tests/acceptance/379`: none). The renderer already takes `scene.print` fresh each frame on both paths
  (`prepare_frame`, `R/lib.rs:5101-5105`), so nothing downstream needs to change.

### RUST3D-2  A proxy's GPU mesh is keyed by its source mesh alone: two ratios of one mesh draw the same proxy
- kind: broken (cache keyed on too little)
- confidence: LIKELY
- where: `S/lod.rs:460-501` (`proxy_of`), `S/lod.rs:505-530` (`levels`), `S/lod.rs:396-400` (`drawn` sets
  `Shape::Built(l.hash)`), `R/lib.rs:4250-4255` (`built_mesh`: uploads only when `meshes` has no entry for the
  shape), `S/scene.rs:1965-1967` (caller).
- evidence: the CPU cache key is `(hash, p.ratio.to_bits(), p.error..to_bits())` (`:465`), so each ratio gets its
  own simplified mesh. But the `Level` it returns is `levels(&leveled, hash ^ 0x5052_4f58_5900_0000).pop()`
  (`:495`), whose hash is `that ^ (1 << 56) ^ 1` (`:525`): a function of the source mesh's hash only. `drawn`
  turns it into the solid's `Shape::Built(l.hash)`, and the renderer keeps one GPU mesh per `Shape`, never
  evicted (prior report finding 6).
- failure: (a) two `ball@1` items with equal params (so equal mesh bytes and hash) and `lod` proxy bands of
  `ratio: 0.5` and `ratio: 0.25`: both draw whichever proxy was uploaded first. (b) one item in a live
  session whose proxy `ratio` is edited from 0.5 to 0.25: `proxy_of` makes the new mesh, the shape is
  unchanged, `built_mesh` finds the entry and keeps drawing the 0.5 mesh until the renderer is rebuilt. The
  water's and motion pass's per-hash caches have the same input.
- fix: `S/lod.rs:495`
  `levels(&Arc::new(leveled), hash ^ 0x5052_4f58_5900_0000).pop()` →
  `levels(&Arc::new(leveled), hash ^ 0x5052_4f58_5900_0000 ^ p.ratio.to_bits().rotate_left(17) ^ p.error.unwrap_or(-1.0).to_bits().rotate_left(41)).pop()`
- verify: a unit test beside `S/lod.rs:566`: two `proxy_of` calls on one mesh and hash with ratios 0.5 and
  0.25 return levels whose `hash` differ (equal today). Grep for the constant found no other reader
  (`rg '5052_4f58' crates tests`: `S/lod.rs:495` only).
- risk: none seen. `S/lod.rs:566` reads triangle counts, not hashes.

### RUST3D-3  Unit-mesh and generated tangents disagree on the bitangent's sign, with each other and with glTF's
- kind: inconsistent (visible as a normal map's green channel flipped on some shapes)
- confidence: SURE that they disagree; QUESTION which side to change
- where: `R/mesh.rs:57-59` (box, with the rule in its comment), `:80` (cylinder side, `w = -1`), `:90`
  (cylinder caps, `w = ny`), `:121` (sphere, `w = -1`), `:197-201` (tangents made for a built mesh),
  `R/scene3d.wgsl:676-678` and `:1268` (`b = cross(n, t) * sign(tangent.w)`), `S/gltf.rs:302-306, 1021-1025`
  (a file's TANGENT kept as read; uv kept as read, v down).
- evidence: the box's comment states the rule: "its handedness makes cross(n, t) × w point along +v". `node -e`
  on the vertex formulas copied out, the dot of `cross(n, t) * w` with dP/dv:
  `box +Z: 1`, `cylinder side: -1`, `cylinder top cap: -1`, `cylinder bottom cap: 1`, `sphere: -1`.
  `vertices()` (`:197`) picks `w` so that `cross(n, t) * w` runs along +dP/dv, as the box does. So box, bottom
  cap and every built mesh use one sign; cylinder side, top cap and sphere use the other. glTF defines
  `bitangent = cross(normal, tangent) * w` with uv's v down the image and a normal map's green up, which is
  −dP/dv: the cylinder side, top cap and sphere match glTF, and so does a file's own TANGENT. The shader
  applies glTF's formula to all of them.
- failure: one normal map on a `mark.box@1` and on a `mark.sphere@1` lights its bumps from opposite vertical
  sides; a cylinder's two caps disagree with each other; a glTF asset without TANGENT (tangents made at
  `:155-204`) shades its normal map with green inverted against the same asset exported with TANGENT.
- fix (if glTF's sign is the one meant, which the shader's formula and the import imply): three edits in
  `R/mesh.rs`:
  - `:59` `if dot(cross(n, a), b) > 0.0 { -1.0 } else { 1.0 }` → `if dot(cross(n, a), b) > 0.0 { 1.0 } else { -1.0 }`
    and the comment `:57-58` "point along +v" → "point against +v, as glTF's TANGENT does"
  - `:90` `let t = [1., 0., 0., ny];` → `let t = [1., 0., 0., 1.];`
  - `:197` `if dot(cross(n, o), bs[i]) < 0.0 {` → `if dot(cross(n, o), bs[i]) > 0.0 {`
  The other way round (keep the box's sign) is `:80` → `1.`, `:90` → `-1.`, `:121` → `1.`, and then file
  tangents need their `w` negated at import. Owner call.
- verify: no test pins it. tests/acceptance/428/reference.ts:895 drops any pixel where "tangent frame
  convention matters"; tests/acceptance/423/ktx2.test.ts uses a flat map on one +z plane. A unit test beside
  `R/mesh.rs:253` that asserts one sign of `dot(cross(n, t) * w, dP/dv)` over every triangle of the three
  unit meshes fails today on whichever sign is chosen.
- risk: every normal-mapped (and anisotropic, `:1257-1268`) box, bottom cap and tangent-less mesh changes
  its picture under the first fix. Goldens under tests/acceptance/423 and 428 that include a normal map on a
  builder mesh would move; I did not enumerate them.

### RUST3D-4  `power: from_file` keeps the 800 lm range when the document writes the default `range: "auto"`
- kind: broken
- confidence: LIKELY
- where: `S/sets.rs:100-106`, `S/light.rs:781-783`, `S/spec.rs:566` (`p("range", "m", "m", json!("auto"), ..)`).
- evidence: `light()` reads `at("range", auto)` = `num(params.get("range")).unwrap_or(auto)`, so the string
  `"auto"` (the spec's default) and `null` both mean auto, sized from the default 800 lm. `read_light` then
  rescales for the file's lumens only `if params.get("range").is_none()`.
- failure: `{"power": "from_file", "distribution": <sha>, "range": "auto"}` with a 4,000 lm file: intensity is
  ×5, the range stays √(800 ÷ (4π·0.05)) ≈ 35.7 m instead of ≈ 79.8 m. The same light with `range` left out
  gets 79.8 m. The light fades to zero at less than half the distance its power calls for.
- fix: `S/sets.rs:103` `if params.get("range").is_none() {` → `if num(params.get("range")).is_none() {`
  (`num` is already imported at `:16`).
- verify: a unit test beside `S/sets.rs:379`: `read_light` on `{"power": "from_file", "range": "auto", ..}`
  gives the same `range` as without `range`. tests/acceptance/446/ies.test.ts:123 uses `power: 'from_file'`
  with no `range`, so it does not see this.
- risk: none seen.

### RUST3D-5  A glTF accessor with `byteStride: 0` and a large `count` allocates without bound
- kind: broken (an asset the reader should refuse exhausts memory)
- confidence: LIKELY
- where: `S/gltf.rs:92-95` (count read, unchecked), `:135-168` (`accessor_rows`).
- evidence: `stride` is the view's `byteStride` as given (`:137-140`); each row reads
  `base + r * stride + c * size`. With stride 0 every row reads the same in-range bytes, so no "an accessor
  past its buffer" error ever fires and the loop builds `count` rows of `Vec<f64>`. `count` is any u64 from
  the file. `base` is also two unchecked u64 sums (`:135-136`).
- failure: a 1 KB GLB whose POSITION accessor says `"count": 4000000000` over a view with `"byteStride": 0`:
  `gltf::mesh` (called per evaluation from `S/scene.rs:1930`, and from `deep-show`, `deep-gpu-layer`,
  `deep-canvas-loop`) tries to build 4e9 `Vec`s and the process is killed, where every other malformed file
  gets `out_of_range`.
- fix: `S/gltf.rs` after `:140` (the `stride` binding) add
  ```rust
      if stride < size * width {
          return Err(bad("a byte stride under its element"));
      }
  ```
  glTF requires byteStride ≥ the element size, so no valid file changes.
- verify: `S/gltf.rs:1084` test's `tetrahedron()` with `"byteStride": 0, "count": 1 << 40` on view 0 must
  return `Err` at once.
- risk: none for valid files.

### RUST3D-6  `proxy_of`'s store has no bound: a mesh that changes with t adds a simplified copy every frame
- kind: broken (leak) and inefficient
- confidence: LIKELY
- where: `S/lod.rs:460-501`; compare `S/geom.rs:548-552` (the crease store clears at 64).
- evidence: `MADE: HashMap<(u64, u64, u64), Option<Level>>` only ever inserts. A built mesh whose stack reads
  time has a new canonical hash at every t (`S/scene.rs:2466-2476`, prior report finding 6 for the GPU side),
  so `lod_of` (`S/scene.rs:1966`) calls `proxy_of` with a new key each frame: meshopt simplifies the whole mesh
  again (the doc comment says "never per frame") and the store keeps a `Level` holding copies of positions,
  normals, uvs and tangents (`levels`, `:512-519`) for the process's life.
- failure: a waving `plate@1` of 10,000 vertices with a `proxy` band, played for a minute at 60 fps: 3,600
  entries, each about 10,000 × (24 + 24 + 16 + 16) B ≈ 0.8 MB, so about 2.9 GB.
- fix: `S/lod.rs:497-499`
  ```rust
      if let Ok(mut m) = made.lock() {
          m.insert(key, level.clone());
      }
  ```
  →
  ```rust
      if let Ok(mut m) = made.lock() {
          if m.len() >= 64 {
              m.clear();
          }
          m.insert(key, level.clone());
      }
  ```
- verify: no existing test. Measure: `MADE.len()` after 100 `proxy_of` calls with distinct hashes: 100 today,
  at most 64 after.
- risk: a scene with more than 64 distinct static proxies re-simplifies some each frame; raise the bound if
  the budget classes allow more.

### RUST3D-7  `half()` halves every value under 2⁻¹⁴ and turns 65,520 to 65,536 into infinity
- kind: broken
- confidence: SURE (pure function; `node -e` on the copied arithmetic)
- where: `R/local.rs:326-344`; its test `:447-453`; caller `R/local.rs:408-412` (the IES atlas).
- evidence: for a half subnormal the mantissa is `(frac | 0x80_0000) >> (14 - exp)` exactly; the code then
  rounds with `(+ 1) >> 1`, which halves it. The cut-off `exp < -10` matches a shift of `13 - exp`, the one
  that leaves a bit to round. In the normal branch `m + (frac >> 12 & 1)` carries past `0x7bff` when
  `exp == 30` and the mantissa is all ones. Evaluated: `half(2^-15)` reads back `2^-16`; `half(1e-5)` reads
  back `5.0e-6`; `half(65530)` reads back `Infinity`. With `13 - exp`: `2^-15`, `1.0e-5`.
- failure: an IES table's cells under 6.1e-5 of the mean (the dark side of a downlight) upload at half their
  value; a cell between 65,520 and 65,536 (a beam of about 0.45° half angle) uploads as +inf and the light's
  pixels there are inf. Small in pictures, wrong in the bytes.
- fix: `R/local.rs:337` `>> (14 - exp)` → `>> (13 - exp)`; `:342` `(m + (frac >> 12 & 1)) as u16` →
  `(m + (frac >> 12 & 1)).min(0x7bff) as u16`.
- verify: add to `R/local.rs:447`: `assert_eq!(half(2f32.powi(-15)), 0x0200); assert_eq!(half(65530.0), 0x7bff);`
  (both fail today: `0x0100` and `0x7c00`). The five existing asserts keep passing.
- risk: none.

### RUST3D-8  `deep-scene3d-render/README.md` describes the crate as of #382
- kind: inconsistent
- confidence: SURE
- where: `crates/deep-scene3d-render/README.md:9-17`, against `crates/deep-scene3d-render/Cargo.toml:14-28`
  and the tree.
- evidence, line by line:
  - `:11` "No tests here: tests/acceptance/378, 380, 382 and 383 prove it". Nine files hold `#[cfg(test)]`
    modules (`rg -n 'cfg\(test\)' R/`: sss, env, lib, shadow, print, mesh, diag, created, local) and the
    manifest has `[dev-dependencies]` for them.
  - `:16` "deep-canvas-scene3d and deep-gpu through their crate roots, plus wgpu, wgpu-profiler and bytemuck".
    The manifest also depends on `deep-canvas-effects` (`R/op.rs`, `R/lib.rs:4272`) and `deep-canvas-marks`
    (`R/print.rs:9`, `R/lib.rs:1834`).
  - `:10` names three shaders "(scene3d.wgsl, output.wgsl, status.wgsl)"; there are 22, all loaded
    (`rg include_str R/`).
  - `:12` "effects passes go in deep-effects-render": ao, motion blur, flare, print, subsurface, water and the
    mirror are passes in this crate.
  - `:9` lists four source files of 30.
- fix: `:11` → "Unit tests sit in a `#[cfg(test)]` module in the file; tests/acceptance/378, 380, 382, 383
  and the later scene3d issues prove the passes through `deep-gpu` (crates/deep-gpu-layer)."
  `:16` → "…deep-canvas-scene3d, deep-canvas-effects (a material operator's graph), deep-canvas-marks (the
  print finish) and deep-gpu through their crate roots, plus wgpu, wgpu-profiler and bytemuck."
  `:10` → "WGSL sits beside the Rust that loads it with `include_str!`, one file per pass."
  `:12` → drop "effects passes go in deep-effects-render" or say which: "2D effect passes go in
  deep-effects-render; a pass that reads the 3D targets goes here."
- verify: diff review (docs only).
- risk: none.

### RUST3D-9  Every accessor read copies the whole binary buffer (or decodes the whole data URI) again
- kind: inefficient
- confidence: LIKELY (not in the prior reports; they looked at the frame path, not the reader)
- where: `S/gltf.rs:58-75` (`buffer` returns `Vec<u8>`: `bin.to_vec()`, `bytes.clone()`, or a fresh base64
  decode), called from `accessor_in` `:115-120` and `view_bytes` `:735-740`.
- evidence and call path: `asset_mesh` (`S/scene.rs:1930`) runs `gltf::mesh` on every whole evaluation of a
  document with a `mesh.asset@1` (prior report section 16: built meshes are rebuilt every whole-path frame).
  `mesh` reads 2 to 5 accessors per primitive plus one per LOD level; each one copies the entire BIN chunk.
  A 20 MB GLB of 30 primitives: about 120 copies, 2.4 GB of memcpy per evaluation. A data-URI buffer is
  base64-decoded that many times.
- fix: return a borrow. `S/gltf.rs:58`:
  `fn buffer(doc: &Value, bin: &[u8], ext: &[Option<Vec<u8>>], i: usize) -> Result<Vec<u8>, Fault>` →
  `fn buffer<'a>(doc: &Value, bin: &'a [u8], ext: &'a [Option<Vec<u8>>], i: usize) -> Result<std::borrow::Cow<'a, [u8]>, Fault>`;
  `:63` `return Ok(bytes.clone());` → `return Ok(Cow::Borrowed(bytes));`;
  `:66` `None => Ok(bin.to_vec()),` → `None => Ok(Cow::Borrowed(bin)),`;
  `:72` `deep_canvas::base64::decode(data).ok_or_else(..)` → `….map(Cow::Owned).ok_or_else(..)`.
  Both callers only take `&data` / `data.get(..)`, which `Cow` derefs to.
- verify: `S/gltf.rs:1084` unchanged; count `to_vec` calls (or bytes allocated) in one `gltf::mesh`.
- risk: low; lifetimes only.

### RUST3D-10  A shadowed spot with `outer: 0` makes a clip matrix of infinities
- kind: broken
- confidence: QUESTION (I did not find a check that refuses `outer: 0`; `S/spec.rs:654` gives the field no
  range, and `S/light.rs:788` clamps it to 0..90)
- where: `R/shadow.rs:422-428` (`tan = acos(cone[0])…min(85°)…tan()`), `:390` (`let k = 1.0 / tan;`).
- evidence: `outer: 0` → `cone[0] = 1` → `tan = 0` → `k = inf`; rows 0 and 1 of the matrix are `inf * r` with
  zeros turned to NaN. The matrix goes to the local map's frame uniform and to `LocalUniform.clip`
  (`R/lib.rs:4094`).
- failure: `light.spot@1` with `outer: 0, shadow: true` under a policy that shadows spots: its map's pass
  draws with NaN positions, and any pixel that samples its `Local.clip` gets NaN coordinates.
- fix: `R/shadow.rs:425` `.min(WIDEST_SPOT)` → `.clamp(0.5, WIDEST_SPOT)` (a half-degree floor), or refuse
  `outer <= 0` at read in `S/light.rs`. Owner call on which.
- verify: unit test: `local_map` of a spot with `cone: [1.0, 1.0]` has every `faces[0].1` entry finite.
- risk: none for cones above 0.5°.

### RUST3D-11  Three public functions nothing calls
- kind: unneeded
- confidence: SURE
- where and proof (each name grepped as a word over `crates tests packages scripts benchmarks docs adapters
  packs`, vendor excluded; one hit each, the definition):
  - `R/maps.rs:377-383` `pub fn has_bc(device: &Device) -> bool` (added by #423; `maps.rs` picks formats from
    the texels' own `format` string).
  - `S/look.rs:80-83` `pub fn unit_ev100() -> f64` (added by #378).
  - `R/surface.rs:69-77` `Surface::upscale_name` (added by #386); its two would-be callers spell it out:
    `crates/deep-gpu-layer/src/view3d.rs:2092` and `liveview.rs:849`.
- fix: delete the three items with their doc comments. With `unit_ev100` gone, `S/look.rs:8`
  `use deep_canvas::ops;` has no user left (`rg 'ops::' S/look.rs`: line 82 only): delete that line too.
- verify: the crates still compile with no unused-import warning; the greps above stay empty.
- risk: none; no acceptance suite names them.

### RUST3D-12  `Frames::with_program`'s doc says the program never reads `size`; since #493 it does
- kind: inconsistent (comment against code)
- confidence: QUESTION (harmless for scene3d today, which reads no shots; `rg shots S/` is empty)
- where: `S/frames.rs:104-105` ("or of `doc` before its `size` was set, which the program doesn't read"),
  `crates/deep-gpu-layer/src/live.rs:778-779` (the same claim), against
  `crates/deep-canvas-motion/src/program.rs:765` → `shots.rs:877-880` (`doc.get("size")` frames the shots).
- failure: none in this area today. The claim is what lets `live.rs:781` compile before the size is set; a
  reader of `program.shots` from that program gets shots framed for 1920 × 1080 or the earlier size.
- fix: `S/frames.rs:104-105` → "…or of `doc` before its `size` was set: only the program's shot plan reads
  the size, and nothing here reads the plan."
- verify: diff review.
- risk: none.

---

## Nits (one line each)

- `R/lib.rs:560` comment "x: 1 with a light grid; y: its far plane" misses z, the near plane, which `:4183`
  writes and `scene3d.wgsl:158` documents.
- `R/lib.rs:1029` doc line "A blend or add part drawn after the glass…" sits on `type RowDraw`; it belongs to
  `type LateDraw` at `:1040`, which has none.
- `R/lib.rs:1104` doc line "A 2D texture of `size`: one layer, one mip, one sample." sits on
  `struct PrintStage`; it belongs to `texture2d` at `:1135`.
- `S/light.rs:515` "No 3D ambient occlusion exists to catch yet." 3D AO landed the same day (`R/ao.rs`, #418).
  The refusal may still be right; the reason given is not.
- `S/light.rs:1-4` module doc lists sun, point and spot; `light.area@1` is read at `:759`.
- `crates/deep-canvas-scene3d/Cargo.toml:25` says sha2 is for "#419: a fixture world's step hashes";
  `S/shore.rs:12, 555` uses it too.
- `crates/deep-canvas-scene3d/README.md:17`: "reaches the core through deep-canvas, motion through
  deep-canvas-motion and shaping through deep-text" omits `deep-canvas-drawn`, `deep-canvas-marks`, `sha2` and
  `meshopt`, all in the manifest and in use.
- `S/geom.rs:595-605` `Mesh::welded` is `welded_ids(true)` (`:452-464`) written twice.
- `R/lib.rs:825-827` computes the determinant inline; `fn det` at `:974` is the same expression.
- Two half-float encoders in one crate: `R/local.rs:327` `half` (rounds) and `R/lib.rs:777` `half_bits`
  (truncates, 0 under the smallest normal).
- `R/lib.rs:2104` `Shape::Built(h) => 4 | (h << 3)` drops the hash's top three bits from every key built on
  `shape_code` (a 2⁻⁶¹ collision; `S/lod.rs:525` level hashes differ in low bits too, so none today).
- `S/water.rs:327-340`: a water material on a unit mark (no built mesh) is accepted with level 0 and plates
  of `[inf, inf, -inf, -inf]`, and `R/water.rs:615` then skips the part: it vanishes with no refusal.
- `S/light.rs:551` a `base_color` array that is not three or four numbers falls back to grey 0.8 where every
  neighbouring field refuses `out_of_range`.
- `S/cut.rs:219-221` `hidden` drops entries that are not unsigned integers without refusing.
- `S/gltf.rs:265-268` a primitive without `extras.lod` after one with it leaves that primitive out of every
  coarser level (the level's index list is extended only by primitives that carry the extra).

## Checked and sound (no finding)

- Every `#[repr(C)]` struct in `R/` against its WGSL struct, field by field: `FrameUniform`, `LightsUniform`,
  `LocalUniform`, `EnvUniform`, `SolidRecord` (144 B, against `Element` in scene3d.wgsl and cull.wgsl),
  cull `Params`, motion `Uniform`, flare `Params`, `AoUniform`, water `Params`, print `Params`/`Sep`, env
  `Params`, `GuardUniform`, `SpreadUniform`, diag `Uniform`/`LightU`, `MapsUniform`. Array lengths on both
  sides agree: 4 cascades, 12 locals, 32 lights, 768 adjust rows, 512 lobe entries, 16 × 9 × 24 grid cells.
- All 22 `.wgsl` files are loaded (`include_str!` in `R/`).
- Every dependency in both manifests has a user in its crate.
- `Camera::clip`, `project`, `unproject` (`S/scene.rs:413-534`) agree with each other for perspective and
  orthographic, reversed and forward Z; `local_of` is T·Rz·Ry·Rx·S as its comment says; `cut::rotated` and
  `quat` (zero quaternion gives identity); the cascade sphere fit, texel snap and clip rows in `R/shadow.rs`;
  `cull::planes` and `reaches` against `cull.wgsl`'s `in_view`; `clusters::grid` against `cluster_at`
  (same tile, slice and index formulas; near is `max(near, 1e-3)` on both sides); `spatial.rs` planes, BVH
  build and the nearest-n pruning; `ies.rs` header count and symmetry folds; `sets::bits` (≤ 32 sets before
  the shift); `light::policy_by` (a total order; NaN scores dropped).
- Flag bit layout of `SolidRecord.flags` and `tie` in `R/lib.rs:828-890` against scene3d.wgsl's constants.

## Coverage

| Files | How |
|---|---|
| `S/geom.rs`, `S/gltf.rs`, `S/lod.rs`, `S/clusters.rs`, `S/cut.rs`, `S/ies.rs`, `S/spatial.rs`, `R/mesh.rs`, `R/shadow.rs`, `R/cull.rs`, `R/cull.wgsl`, `R/local.rs`, both `Cargo.toml`, both `README.md` | read in full |
| `S/frames.rs` (1-465; tests by name), `S/light.rs` (1-1100; tests by name), `S/sets.rs` (1-380), `S/mirror.rs` (1-240) | read in full bar the tests |
| `S/scene.rs` | ranges 296-345, 362-790, 816-930, 1880-2110, 2800-2995, 3108-3130; outline of the rest; `evaluate_compiled`'s item arms (2169-2800) not read |
| `R/lib.rs` | ranges 395-1660, 2090-2112, 4086-4200, 4236-4330, 7490-7820; the rest not read (the prior audit read its frame path for cost, not for correctness) |
| `R/scene3d.wgsl` | ranges 1-300, 455-704, 1615-1650, 1885-1935; the rest not read |
| `S/water.rs` | 1-60, 300-352 |
| Every other `.rs` and `.wgsl` in `R/` (diag, water, motion, env, sss, surface, ao, print, flare, status, op, mirror, maps, targets, oit, glass, created, and upscale, output, outline, label, resolve, mask_dump, busy, and the passes' own shaders) | struct definitions only (extracted and compared both sides); not read line by line |
| `S/builders.rs`, `S/stack.rs`, `S/bevel.rs`, `S/poly.rs`, `S/curve.rs`, `S/hull.rs`, `S/sweep.rs`, `S/uv.rs`, `S/modifiers.rs`, `S/deviation.rs`, `S/building.rs`, `S/shore.rs`, `S/probe.rs`, `S/sky.rs`, `S/flare.rs`, `S/fixtures.rs`, `S/spec.rs`, `S/module.rs`, `S/build.rs`, `S/samples.rs`, `S/emitters.rs`, `S/label.rs`, `S/overlay.rs`, `S/look.rs`, `S/lib.rs` | not read (about 17k lines), beyond `S/builders.rs:28-44, 425-470`. Reached only by the whole-area greps: public-item use (803 names counted over the checkout), `include_str!`, dependency use, cast and `unwrap`/`expect` patterns, stale-design markers |

What that leaves unexamined, plainly: mesh building (builders, stack, bevel, poly, curve, hull, sweep, uv),
the spec table against what `scene.rs` reads, most of `Renderer` (`prepare`, `prepare_moved`, `prepare_batch`,
`jobs`, draw keys, the pick read-back) for correctness, most of the main shader's shading and shadow
sampling, and every effect pass's body. Tests under `tests/acceptance` were opened only where a finding
needed to know what they pin (423, 428, 446).
