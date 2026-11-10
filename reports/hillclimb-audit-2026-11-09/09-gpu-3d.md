# 09 — 3D and the GPU layer

Scope: `crates/deep-scene3d-render`, `crates/deep-gpu`, `crates/deep-canvas-scene3d`, `crates/deep-gpu-layer`.
Paths below are relative to the worktree root. `R/` = `crates/deep-scene3d-render/src/`, `S/` = `crates/deep-canvas-scene3d/src/`, `G/` = `crates/deep-gpu/src/`.

Not verified: nothing was compiled or run (brief). Every finding is from reading the code and its callers. Line numbers are at 6a6d6b4f.

What I read in full: `R/lib.rs` frame path (`prepare`, `prepare_moved`, `prepare_frame`, `prepare_batch`, `prepare_cascades/locals/env/lights`, `encode`, `jobs`, the pass functions, `Module3`), `R/shadow.rs`, `R/mesh.rs`, `R/motion.rs` (prepare paths), `R/mirror.rs`, `R/targets.rs`, `R/surface.rs` (step/hold), `R/maps.rs` (store), `R/flare.rs` and `R/print.rs` (prepare/record), `G/view.rs`, `G/render.rs`, `G/encode.rs`, `G/upload.rs`, `G/cache.rs`, `G/alloc.rs`, `G/memory.rs`, `G/device.rs`, `S/frames.rs`, and the parts of `S/scene.rs` that run per evaluation (types, `evaluate*`, the builder and instancer arms). Not read line by line: `R/diag.rs`, `R/water.rs`, `R/ao.rs`, `R/sss.rs`, `R/cull.rs`, `R/env.rs` internals, `scene3d.wgsl`, `G/ring.rs`, `G/seam.rs`, `G/structural.rs`, `G/meter.rs` (skimmed), the builders/modifiers in `S/` (`builders.rs`, `stack.rs`, `bevel.rs`, `poly.rs`, `curve.rs`, `gltf.rs`, `building.rs`, `lod.rs`, `light.rs` beyond `policy/scores`), and deep-gpu-layer beyond `live.rs` `run` and `liveview.rs` `draw`.

One fact the GPU findings lean on. wgpu-core 30.0.1 (`Cargo.lock`; `~/.cargo/registry/src/*/wgpu-core-30.0.1/src/device/queue.rs:631-688`, `src/resource.rs:1255-1278`): every `Queue::write_buffer` call makes its own HAL staging buffer (`StagingBuffer::new` → `device.raw().create_buffer` + `map_buffer`) and its own copy. So N small writes cost N Metal buffer allocations and N blits, not one.

---

## 1. G1 — `Set::finish` writes one staging buffer per changed record — CONFIRMED

**Where**: `R/lib.rs:1504-1523` (the `else` branch of `Set::finish`); callers `prepare_batch` `R/lib.rs:5743, 5748, 5801, 5818, 5851`, `prepare_outlines` `R/lib.rs:4236-4237`.

**What**: when a set's members hold, each changed record is uploaded by its own `queue.write_buffer`. A whole `prepare` of a scene in which every solid moved (any document off the `Frames` fast path: one with a light, a line, a label or a built mesh) calls it once per record: 1,000 moving parts → 1,000 staging buffers and 1,000 blits per frame (see the wgpu fact above). Records that change are almost always adjacent (a whole set moves).

**Change**: write each maximal run of adjacent changed records with one call. `written` and `revision` still count one per record.

```rust
        } else {
            let buffer = self.buffer.as_ref().expect("a set with members has a buffer");
            let n = (self.next.len() / stride).min(self.records.len() / stride);
            // The first record of the run of changed records being gathered.
            let mut run: Option<usize> = None;
            for i in 0..=n {
                let at = i * stride..(i + 1) * stride;
                let changed = i < n && self.next[at.clone()] != self.records[at];
                if changed {
                    *written += 1;
                    self.revision += 1;
                    run.get_or_insert(i);
                } else if let Some(a) = run.take() {
                    let bytes = &self.next[a * stride..i * stride];
                    deep_gpu::alloc::outside(|| {
                        device.queue.write_buffer(buffer, (a * stride) as u64, bytes)
                    });
                }
            }
        }
```

**Why it is safe**: same bytes land at the same offsets; a run is a multiple of `stride`, and every record type is a `Pod` struct whose size is a multiple of 4 (`SolidRecord`, `SegmentRecord`, `PointRecord`, `TextRecord`), so offset and size keep `COPY_BUFFER_ALIGNMENT`. `n` is the pair count `chunks_exact(..).zip(..)` gave. `written` feeds `counts.instances_written` (unchanged: +1 per changed record); `revision` is only compared for change by `cull::Culled::cull` (`R/lib.rs:5065`) and still rises by the same amount. `Set::write` (the `prepare_moved` path) is untouched.

**Gain**: per set, write calls drop from (changed records) to (runs of changed records): typically N → 1. Each call saved is one Metal buffer allocation, one map and one blit. Unmeasured.

**Proof plan**: `R/lib.rs` unit test `a_frame_that_writes_what_moved_leaves_the_records_a_whole_prepare_writes` (records equal after either path); tests/acceptance/378 (instance records written only where one changed: reads `instances_written`). Gain without wall time: count `Queue::write_buffer` calls per frame (a counter beside the `outside` call) on a scene of N moving solids: N before, the number of sets after.

**Risk**: low. ~18 lines.

---

## 2. G2 — the puffs' buffer is created and uploaded every frame, on the camera-only path too — CONFIRMED

**Where**: `R/lib.rs:7385-7463` (`prepare_puffs`), called from `prepare_frame` `R/lib.rs:5294`, which both `prepare` (`:4355`) and `prepare_moved` (`:4868`) run; state `puffs: Option<(wgpu::Buffer, u32)>` `R/lib.rs:1770`; read by `puff_draw` `R/lib.rs:7367-7382`.

**What**: any scene with `puff@1` items (the castle showpiece's clouds) pays, every frame: a `Vec<&Puff>`, a sort, a `Vec<PuffRecord>`, and `create_buffer_init` (a new GPU buffer, mapped, copied, unmapped). A puff's record holds no camera term (`center`, `shape`, `light`), so on a camera move the bytes change only when the back-to-front order does; on a frame where solids move and the camera holds they never change. Every other instance family in this file goes through `Set`, which keeps its buffer and writes only what changed.

**Change**: hold the puffs' records in a `Set`.
- Add `puff_records: Set` to `Renderer` (`Set: Default`), initialised in `Renderer::new`.
- In `prepare_puffs`, replace `records: Vec<PuffRecord>` + `create_buffer_init` (`:7397-7422`) with:

```rust
        self.puff_records.begin();
        for p in &all {
            let record = PuffRecord { /* as today */ };
            self.puff_records.push(&p.id, bytemuck::bytes_of(&record));
        }
        // As the outlines' sets: their writes aren't a batch's instance records.
        let (mut next, mut written) = (self.next_generation, 0);
        self.puff_records.finish(device, &mut next, &mut written);
        self.next_generation = next;
```
- and the last line (`:7462`) with `self.puffs = self.puff_records.buffer.clone().map(|b| (b, all.len() as u32));`

**Why it is safe**: the draw binds the same bytes in the same order (`puff_draw` → `pass.draw(0..6, 0..count)` over `buffer.slice(..)`; a larger buffer than `count` records is fine, as for every `Set`). The early return for no puffs (`:7389-7392`) stays ahead of `begin`, so `self.puffs = None` as today. `written` is discarded exactly as `prepare_outlines` does (`R/lib.rs:4235-4238`), so `counts.instances_written` is unchanged. `next_generation` only names buffers in draw keys; an extra bump is what `prepare_outlines` already does. A `Set` buffer carries `VERTEX | STORAGE | COPY_DST`; the puff pipeline needs `VERTEX`.

**Gain**: per frame with puffs: one GPU buffer creation and one full upload removed; with the order unchanged, zero GPU work (today: always both). It also removes a GPU allocation from the `prepare_moved` path, which the design counts as allocation-free. The two CPU `Vec`s (`all`, and the sort) remain. Unmeasured.

**Proof plan**: tests/acceptance/422 (sky, puffs: pixels). Gain: device buffer count per frame (Metal `currentAllocatedSize` via `deep_gpu::memory::across`) or a counter on `create_buffer_init` here: 1 per frame before, 0 after warm-up.

**Risk**: low. ~25 lines.

---

## 3. C1 — a culled instancer recomputes its prototype's bounds once per element — CONFIRMED

**Where**: `R/lib.rs:5718-5722` in `prepare_batch`; `Mesh::bounds` `S/geom.rs:408-417` (a scan of every position, uncached).

**What**: for every element of a GPU-culled batch (`s.batch != 0`: instancers above 256 elements, `S/cut.rs:15`, `S/scene.rs:2746`) `set.bounds` is assigned from `m.bounds()`, a pass over the prototype's vertices. All elements of one set share one `Shape` (the set key's first field), which for a built mesh is the hash of its bytes, so every pass returns the same box. Cost per whole `prepare`: elements × vertices. 10,000 elements of a 200-vertex prototype read 2,000,000 `[f64; 3]` (48 MB) to compute one box.

**Change**:
```rust
            if slot.0 .3 != 0 {
                // One box per set: its elements share the set's shape, so its mesh.
                if set.count == 0 {
                    set.bounds = s.mesh.as_ref().map_or([[-0.5; 3], [0.5; 3]], |m| {
                        let b = m.bounds();
                        [b[0].map(f64::from), b[1].map(f64::from)]
                    });
                }
                set.elements.push(s.row);
```

**Why it is safe**: `set.count` is 0 at the set's first record of the frame (`Set::begin` `R/lib.rs:1450-1458`, or a new `or_default()` set) and is raised by `set.push` below. A set's key is `(shape, maps, op, batch)` (`R/lib.rs:1551`); two solids with one `Shape::Built(hash)` have byte-equal meshes (`S/scene.rs:2466-2476`), which the renderer already relies on by drawing them from one GPU mesh (`built_mesh` `R/lib.rs:4250-4255`). A solid with no mesh gives the unit box either way. Today's value is the last element's box; the first element's is the same box.

**Gain**: O(elements × vertices) → O(vertices) per culled set per whole `prepare`. Unmeasured.

**Proof plan**: tests/acceptance/484 (cull kept lists, CPU reference against GPU). Gain: count calls of `Mesh::bounds` per frame on a 1,000-element instancer: 1,000 → 1.

**Risk**: low. 3 lines.

---

## 4. C2 — `Frames::whole` deep-clones the document and recompiles the motion program every frame — CONFIRMED (cost); the fix has a trap

**Where**: `S/frames.rs:254-270` (`whole`), reached from `Frames::at` `S/frames.rs:179` for every document off the fast path (`fast_path` `S/frames.rs:344-358`: any light, line, point, label, overlay, built mesh or other-module item); `evaluate` → `evaluate_any` `S/scene.rs:1783-1801` (`water::logic_moved`, then `Program::compile`). Driver: `crates/deep-gpu-layer/src/liveview.rs:794` and `:888` call `frames.at` on every tick of a live view, also to learn that the scene is still.

**What**: per frame: (a) `self.doc.clone()`, a deep copy of the whole JSON document, only to set `size`; (b) `Program::compile(map)`, the full motion compile (`held::check`, `doc::read_with`, eases, shots), although `Frames` holds a program compiled from the same document. `live.rs:796-800` documents the admission side of this: compile and the document's drop are worth milliseconds at 10,000 items.

**The trap**: do not just pass `self.program`. `Program::compile_with` ends in `shots::Plan::compile(doc, &program)` (`crates/deep-canvas-motion/src/program.rs:763`), which reads `doc["size"]` (`crates/deep-canvas-motion/src/shots.rs:877-880`). Today's per-frame compile therefore frames shots for the size of the frame being drawn; `self.program` may have been compiled before the size was set (`live.rs:781`) or at another size.

**Change** (behaviour-preserving): keep the document in place and cache the compile by the size it was made for.
```rust
    /// The program `whole` evaluates with, as compiled for the document at this size.
    whole_program: Option<([u32; 2], Program)>,   // new field, None in with_program

    fn whole(&mut self, t: i64, size: [u32; 2], offsets: &Offsets, labels: &mut Labels)
        -> Result<&Scene, Refused> {
        let mut doc = std::mem::take(&mut self.doc);
        let want = Value::from(vec![size[0], size[1]]);
        if doc.get("size") != Some(&want) {
            doc["size"] = want;
        }
        let out = self.whole_of(&doc, t, size, offsets, labels);
        self.doc = doc;
        out?;
        Ok(&self.scene)
    }

    fn whole_of(&mut self, doc: &Value, t: i64, size: [u32; 2], offsets: &Offsets,
                labels: &mut Labels) -> Result<(), Refused> {
        let map = doc.as_object().ok_or(Refused { code: "out_of_range", path: String::new() })?;
        crate::water::logic_moved(map)?;
        // Taken out for the call and put back, as `doc` is: a refusal below leaves it cached.
        let program = match self.whole_program.take() {
            Some((s, p)) if s == size => p,
            _ => Program::compile(map).map_err(|r| Refused { code: r.code, path: r.path })?,
        };
        let scene = evaluate_compiled(map, &program, t, &self.look, labels, None, &[]);
        self.whole_program = Some((size, program));
        let mut scene = scene?;
        if *offsets != Offsets::default() {
            scene.camera = self.turned_whole(doc, &scene, t, size, offsets)?;
        }
        self.changed = scene != self.scene;
        self.scene = scene;
        Ok(())
    }
```
(With finding 5 applied, `evaluate_compiled` takes `doc` as well.)

**Why it is safe**: the document in `Frames.doc` is read only by `whole` (it is `Value::Null` on the fast path, `S/frames.rs:126-130`), and apart from `size` it never changes, so `Program::compile` is a pure function of `size` here (`Options::default()`, no clock, no randomness). The same checks run in the same order as `evaluate_any`: `logic_moved`, compile (its refusal is not cached, so a refusing document refuses every frame as today), `evaluate_compiled`. `doc["size"] = …` on an existing key keeps its place under serde_json's `preserve_order`; on a missing key it appends once instead of once per clone, the same final order. `turned_whole` keeps using `self.program` and `self.state` as today.

**Gain**: per whole-path frame: one deep document clone and drop, and one program compile, both O(document), removed after the first frame at a size. Unmeasured; allocation count per `Frames::at` is the direct measure (the crate's counting allocator, `G/alloc.rs`, or a `#[global_allocator]` in a unit test).

**Proof plan**: `S/frames.rs` tests `lights_and_material_channels_follow_each_frame` and `a_moving_size_takes_the_whole_path` (whole path equals `evaluate` at several times). Add nothing unless the lead wants the size trap pinned: a document with a timeline shot evaluated through `Frames::at` at two sizes must equal `evaluate` at each.

**Risk**: medium-low. ~35 lines.

---

## 5. C3 — `evaluate_compiled` deep-clones the document whenever a scene has a builder mesh or a mesh-edge line — CONFIRMED

**Where**: `S/scene.rs:2210` (`let mut doc_value: Option<Value> = None;`), `:2336` and `:2442` (`doc_value.get_or_insert_with(|| Value::Object(map.clone()))`); `evaluate_compiled` signature `S/scene.rs:2143-2151`; its two callers `S/scene.rs:1800` and `S/frames.rs:116`.

**What**: `mesh_of` and `edge_line` take `doc: &Value` (as `building::build` and `build::built` do), but `evaluate_compiled` only has the `&Map`, so it rebuilds a `Value` by cloning the entire document once per evaluation. Both callers already hold the `&Value` the map came from.

**Change**: pass the `&Value` down.
- `pub(crate) fn evaluate_compiled(doc: &Value, map: &Map<String, Value>, program: &Program, …)`; callers pass `doc` (`evaluate_any` has `doc` and `map`; `with_program` has `doc` and `map`; C2's `whole_of` has both).
- Delete `:2210`; at `:2336` and `:2442` use `doc` directly.

**Why it is safe**: `Value::Object(map.clone()) == *doc` by construction (`map = doc.as_object()` in both callers), and both uses only read it.

**Gain**: one deep document clone and drop per evaluation of any scene with a built mesh, a building kind, an asset mesh or a mesh-edge line (most real scenes). O(document) bytes and allocations. Unmeasured.

**Proof plan**: every scene3d acceptance suite that evaluates a builder (tests/acceptance/420, 425, 1640) and `S/frames.rs` tests; no behaviour to pin beyond equality. Gain: allocation count of one `evaluate` on a document with one builder item, before and after.

**Risk**: low. ~8 lines.

---

## 6. M1 — the renderer's mesh cache never evicts: a mesh that deforms with time leaks GPU buffers every frame — CONFIRMED (leak); fix needs one owner call

**Where**: `R/lib.rs:1874` (`meshes: BTreeMap<Shape, Mesh>`), inserts only at `R/lib.rs:4242-4255`; no `retain`/`remove`/`clear` on it anywhere in the crate (grep `meshes\.` over `R/`). Key source: `S/scene.rs:2466-2476`, `Shape::Built(hash)` is the hash of the mesh's canonical bytes unless it is a shared asset.

**What**: a built mesh whose stack reads time (sway, wave, `build` revealing, `mesh.sequence@1`, a pre-skin) has new bytes, so a new `Shape::Built`, at every t. `built_mesh` uploads a vertex and an index buffer for each and keeps them for the renderer's life. The instance `Set`s for stale shapes are dropped each frame (`batch.solids.retain(|_, set| set.count > 0)`, `R/lib.rs:5745`), the meshes are not. A 10,000-vertex waving mesh is 560 KB of vertices (14 f32 each) plus indices per frame: tens of MB a second against "under 256 MB of GPU memory per window" and "every long-lived cache bounded in entries and bytes".

**Change** (smallest that bounds it): at the end of a whole `prepare`, after the layer loop (`R/lib.rs:4436-4438`), drop built meshes no solid of this frame names:
```rust
        // A built mesh no solid of this frame draws is freed; it is uploaded again if it returns.
        if self.meshes.keys().any(|k| matches!(k, Shape::Built(_))) {
            let used: BTreeSet<Shape> =
                scene.layers.iter().flat_map(|l| &l.solids).map(|s| s.shape).collect();
            self.meshes
                .retain(|shape, _| !matches!(shape, Shape::Built(_)) || used.contains(shape));
        }
```
(`BTreeSet` allocates per whole prepare; a `seen` stamp on the entry avoids it if that matters.)

**Why it is (mostly) safe, and what changes**: every later reader looks a shape up with `self.meshes.get(shape)` and skips a miss; `prepare_batch` calls `built_mesh` for every solid every whole prepare, so a mesh that returns is rebuilt before it is drawn; the readers that follow in the same `prepare` (`motion.prepare` `:4473`, `prepare_core` `:4644-4653`) look up this frame's solids only. `prepare_moved` never changes the solid list. The mirror holds a renderer of its own (the same code bounds it); the water keeps its own insert-only map by hash (`R/water.rs:533-548`), the same shape of cache, which this edit does not touch. **Observable**: `counts.meshes_built` rises again when an evicted shape comes back (an LOD level switching away and back, an item hidden then shown, a looping `mesh.sequence@1`), and that re-upload costs CPU. If a test asserts "a second visit builds no mesh" across such a sequence, eviction needs a grace (keep N frames) instead; that is the owner call. I did not find such an assertion but could not run the suites.

**Gain**: GPU memory bounded by the meshes of the current frame instead of every mesh ever drawn.

**Proof plan**: existing: tests/acceptance/420 and 425 (meshes, LOD) must stay green, watching `meshes_built`. Measure: `deep_gpu::memory::allocated` across 600 frames of a scene with one time-deforming builder: linear growth before, flat after.

**Risk**: medium (the count above). ~8 lines.

---

## 7. C4 — the cascades' prepare walks every caster's vertices twice and looks each caster up three times per cascade — CONFIRMED

**Where**: `R/lib.rs:3617` (`shadow::cascades`) → `R/shadow.rs:259` (`caster_corners(scene)` inside it); `R/lib.rs:3635` (`caster_corners(scene)` again); `R/lib.rs:3641-3646` (`solids: BTreeMap<&str, &Solid>`); `R/lib.rs:3662-3669` (three `solids[id.as_str()]` per caster per cascade). `corners_of` `R/shadow.rs:169-194` clones each caster's ID and calls `Mesh::bounds()` (O(vertices), `S/geom.rs:408`). Runs every frame of a cascaded scene, `prepare_moved` included (`prepare_frame` `R/lib.rs:5279`).

**What**: per frame: 2 × (one `String` per caster + a full vertex scan of every casting mesh), and up to 4 cascades × casters × 3 string-keyed map lookups.

**Change** (two exact steps):
1. `R/shadow.rs`: split `cascades` so the caller can hand in the corners.
```rust
pub fn cascades(scene: &Scene, toward: [f64; 3], settings: &CascadeSettings, size: u32,
                soft: Option<Reach>, snap: bool) -> Vec<Cascade> {
    cascades_from(scene, toward, settings, size, soft, snap, &caster_corners(scene))
}

pub(crate) fn cascades_from(/* same */, casters: &[(String, [[f64; 3]; 8])]) -> Vec<Cascade> {
    /* today's body from `let cam = &scene.camera;` on, with `casters` the parameter */
}
```
2. `R/lib.rs` `prepare_cascades`: move `let casters = shadow::caster_corners(scene);` up to just after the `let Some(sun) = … else { return }` (`:3584-3586`), call `shadow::cascades_from(…, &casters)` at `:3617`, delete `:3635`, and resolve each caster once:
```rust
        let caster_solids: Vec<&Solid> = casters.iter().map(|(id, _)| solids[id.as_str()]).collect();
        for (i, cascade) in c.list.iter().enumerate() {
            …
            for (s, (_, corners)) in caster_solids.iter().zip(&casters) {
                let drawn = sun_caster == 0 || s.caster_sets & sun_caster != 0;
                if !drawn || !shadow::inside(&cascade.clip, corners) {
                    continue;
                }
                local::hash_caster(s, &mut h);
                local::hash_time(s, self.planted.local, &mut h);
            }
```

**Why it is safe**: `caster_corners` is a pure function of `scene`; both calls today see the same scene. The lookup `solids[id]` is kept (not replaced by zipping the scene's solids) on purpose: with two solids of one ID (an LOD band beside its cast-only level) the map resolves to the last, and the hash must keep hashing that one so `counts.shadow_maps` keys do not move. The same solids are hashed in the same order. `cascades` keeps its signature for `shadow_texels` (`R/lib.rs:987`) and `diag.rs:667`.

**Gain**: one of two caster passes (n `String`s + Σ vertices) and (3 × cascades − 1) × casters map lookups per frame. Unmeasured. A follow-up, not proposed here: cache each built mesh's box by `Shape` so neither pass scans vertices.

**Proof plan**: tests/acceptance/422 (cascades drawn only when their key changes; reads the keys), 425, 446. Gain: count `caster_corners` calls per frame (2 → 1).

**Risk**: low. ~20 lines.

---

## 8. G3 — motion blur uploads each deforming solid's two side meshes in full, with tangents and index buffers nothing binds — CONFIRMED

**Where**: `R/motion.rs:215-218` (`Mesh::of(device, o), Mesh::of(device, c)` in `draw_list`), run per frame from `prepare` `R/motion.rs:476` and `target_frame` `R/motion.rs:431` (both, when a frame has motion blur and the core velocity target: four meshes per solid); `Mesh::of` → `vertices` `R/mesh.rs:140-216` + `upload` `R/mesh.rs:230-245`; readers `R/motion.rs:634-642` and `:695-703`.

**What**: the velocity pipelines read one attribute from each of vertex buffers 0–2: `Float32x3` at offset 0, stride `FLOATS * 4` (`R/motion.rs:285-296`, `:372-384`). For a side mesh, `vertices()` still derives per-vertex tangents from uv0 (two `Vec<[f32;3]>`, a pass over the triangles, Gram-Schmidt per vertex) and `upload` creates and fills an index buffer; the draws bind `dr.indices` (the mesh at t) and only `sides.*.vertices`.

**Change**: upload positions alone, in the same stride.
```rust
/// A side mesh's positions in the solids' vertex stride: the velocity passes read nothing else.
fn positions(device: &Device, m: &deep_canvas_scene3d::geom::Mesh) -> wgpu::Buffer {
    let mut v = vec![0f32; m.positions.len() * FLOATS];
    for (out, p) in v.chunks_exact_mut(FLOATS).zip(&m.positions) {
        out[..3].copy_from_slice(&p.map(|x| x as f32));
    }
    device.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("scene3d.motion side"),
        contents: bytemuck::cast_slice(&v),
        usage: wgpu::BufferUsages::VERTEX,
    })
}
```
`Draw.sides: Option<(wgpu::Buffer, wgpu::Buffer)>` (`:58`); `:215-218` maps to `(positions(device, o), positions(device, c))`; the two record sites drop `.vertices` (`Some((o, c)) => (o, c)`).

**Why it is safe**: positions are the same `f64 → f32` casts `vertices()` makes (`R/mesh.rs:141, 209`), at the same offsets and stride, for the same vertex count (`m.positions.len()`); the other 11 floats per vertex were never read by these pipelines. The side meshes' index buffers were never bound.

**Gain**: per deforming solid per frame: two index buffers (creation + upload of 4 B × indices each) and two tangent derivations removed; doubled when both passes run. Unmeasured.

**Proof plan**: tests/acceptance/419 (velocity target and blur, pre-skins) and 431 (core velocity). Gain: bytes uploaded per frame for one deforming solid: 2 × (56 V + 4 I) → 2 × 56 V, and the tangent pass's allocations (4 `Vec`s per side) → 1.

**Risk**: low. ~25 lines.

---

## 9. C5 — `maps::Store::by_index` scans every bind group per lookup; `group()` builds two `String`s per textured solid per frame — CONFIRMED

**Where**: `R/maps.rs:193-198` (`by_index`), `R/maps.rs:170-190` (`group`); `by_index` callers per frame: `R/lib.rs:4660, 5938, 5983, 6047, 6098, 6122, 6181, 6567, 7377, 7475`; `group` caller `R/lib.rs:5528` (every solid with maps and a material, every whole `prepare`).

**What**: (a) `by_index(n)` walks `groups.values()` until it finds index `n`: O(groups) per call, called per set and per see-through draw, so O(sets × groups) per frame in a scene with many textured materials. Indices are dense from 1 and entries are never removed (`next` only grows, `R/maps.rs:185-187`). (b) `group()` collects a `present` `String` and `format!`s a key for every call, hit or miss.

**Change (a)**, exact: add `by: Vec<wgpu::BindGroup>` to `Store` (empty in `new`), push on insert, index on read.
```rust
            self.groups.insert(key.clone(), (n, g.clone()));
            self.by.push(g);          // index n lives at n - 1
…
    pub fn by_index(&self, n: u32) -> &wgpu::BindGroup {
        n.checked_sub(1).and_then(|i| self.by.get(i as usize)).unwrap_or(&self.none)
    }
```
**Change (b)**, PLAUSIBLE (needs the key's uniqueness argued by whoever applies it): key the cache without a heap key, e.g. `groups: BTreeMap<String /* maps.key */, Vec<(u16 /* present bits */, u8 /* taps */, u32)>>`, looked up with `maps.key.as_str()`.

**Why (a) is safe**: `n` is assigned `self.next` then `next += 1` starting at 1, exactly one insert per index, so `by[n - 1]` is the group `groups` holds for `n`. `n == 0`, or an `n` with set-key bits left in it (`clear_kind_draws` passes the unmasked word, `R/lib.rs:6047`), misses and gives `none`, as the scan does today. `wgpu::BindGroup` clones are handle clones.

**Gain**: (a) O(groups) → O(1) per lookup. (b) two allocations per textured solid per whole prepare. Unmeasured.

**Proof plan**: tests/acceptance/423 (texture maps; "a second load makes none" reads `uploads`). Gain: iterations of `groups.values()` per frame.

**Risk**: (a) low, ~8 lines; (b) low-medium, ~25 lines.

---

## 10. A1 — `ensure_casters` formats names and collects every caster each frame after its pipelines exist — CONFIRMED

**Where**: `R/lib.rs:4541-4600`, called from every whole `prepare` (`R/lib.rs:4469`).

**What**: the function can only act when a caster kind's pipeline is missing and a caster of that kind exists. It still builds `maps: Vec<String>` (a `format!` per shadowed sun, an ID clone per local map), `maps.join(", ")`, and, for each kind, `casters: Vec<&Solid>` of every casting solid *before* testing `made`.

**Change**: after `self.mask_casts = casting().any(mask);` (`:4548`) add
```rust
        // Nothing below makes a pipeline unless a caster kind still lacks its own.
        let made = [self.shadow.pipeline.is_some(), self.shadow.mask.is_some()];
        if [false, true]
            .into_iter()
            .all(|k| made[usize::from(k)] || !casting().any(|s| mask(s) == k))
        {
            return;
        }
```
**Why it is safe**: the loop body at `:4568-4599` does nothing for a kind when `made || casters.is_empty()`; the new test is the conjunction of exactly that over both kinds. `mask_casts` is set before it. `maps`/`target` are locals with no other reader.

**Gain**: per whole prepare with a shadowed light: 3+ `String`s and an 8 B × casters `Vec` (two when both pipelines exist) removed, plus one pass over the solids. Small; it is on the zero-allocation budget.

**Proof plan**: tests/acceptance/432 (pipelines made on first use, the created log: `made_for` unchanged). Gain: allocation count of `prepare` on a shadowed scene's second frame.

**Risk**: low. 7 lines.

---

## 11. A2 — small exact removals on the frame path — CONFIRMED

Each is independent.

a. **`Module3::layers` deep-clones the look every frame.** `R/lib.rs:8294` `s.next.clone()` clones `(Arc<Scene>, Look3)`; `Look3` holds `roles: BTreeMap<String, [u8; 3]>` and `materials: serde_json::Map<String, Value>` (`S/look.rs:51-78`). Borrow instead (the guard is held for the whole call):
```rust
        let mut s = lock(&self.shared);
        if s.next.is_none() {
            return Vec::new();
        }
        if s.renderer.is_none() && s.planted.builds_on_first_frame {
            s.renderer = Some(Renderer::new(device, s.planted));
        }
        let Shared { next, renderer, post, after, .. } = &mut *s;
        let (Some((scene, look)), Some(renderer)) = (next.as_ref(), renderer.as_mut()) else {
            return Vec::new();
        };
        … renderer.prepare(device, scene, look); …
```
Safe: disjoint fields of one guard; same order of effects (the planted first-frame build still only happens with a scene). Risk low, ~8 lines.

b. **`prepare_core` builds the emission draw list when nothing reads emission.** `R/lib.rs:4646-4677`: `draws` (four handle clones per opaque set) and `binds` are built, then `Core::emission_frame` returns `None` at once when `self.emission` is `None` (`R/targets.rs:147`). Wrap `:4646-4677` in `if self.core.emission.is_some() { … } else { self.emission_frame = None; }`. Safe: `core.ensure` (`:4633`) has already settled `emission` for this frame. Risk low, 4 lines.

c. **`prepare_batch` collects `order` only for a planted reversal.** `R/lib.rs:5676-5684`: a `Vec<(&Solid, &mut Slot)>` of every solid per layer per whole prepare. Index instead:
```rust
        let reversed = self.planted.ties_by_submission && self.flip;
        let n = layer.solids.len();
        for j in 0..n {
            let i = if reversed { n - 1 - j } else { j };
            let (s, slot) = (&layer.solids[i], &mut slots[i]);
```
Safe: `slots` has one entry per solid (pushed in the loop at `:5518-5614`); same visiting order in both cases. Risk low, 6 lines.

d. **`prepare_batch` scans the layer six times for see-through kinds whose pipelines exist.** `R/lib.rs:5457-5458`: test `self.clear_pipelines[k].is_none()` before `layer.solids.iter().any(..)`. Safe: `wanted` is used only under that test. Risk low, 2 lines.

e. **`S/scene.rs:2456` and `:2495` scan one mesh's vertices twice** (`mesh.bounds()`); pass `[lo, hi]` to `lod_of`. **`S/scene.rs:2774`** `bounds.extend(s.points())` allocates a `Vec` of every prototype vertex per instancer element (`Solid::points` `S/scene.rs:170-175`) only to append it; extend from the iterator instead: `match &s.mesh { Some(m) => bounds.extend(m.positions.iter().map(|p| apply(&s.model, *p))), None => bounds.extend(corners(&s.model)) }`. Same values in the same order. Risk low, ~6 lines.

f. **`R/lib.rs:5161` `self.maps.texels.clone_from(&scene.texels)`** runs every frame; skip it when both maps hold the same keys and the same `Arc`s (`len` equal and `iter().zip()` with `a == b && Arc::ptr_eq(x, y)`). PLAUSIBLE for the gain: whether std's `BTreeMap::clone_from` reallocates I could not read here (no rust-src on this machine); the walk and key compares are saved either way. Risk low, 5 lines.

**Proof plan** for all: tests/acceptance/378, 379 (allocation and written counts), 421 (ties, `ties_by_submission` planted), 431 (emission target), 425 (LOD reads `bounds`), 484. Gain: allocation count per frame.

---

## 12. G4 — with a post module, the output pass's bind group is created again every frame — CONFIRMED

**Where**: `R/lib.rs:6815-6838` (`bind = self.output_bind(&device.device, view)` whenever `post.jobs` returns a source); `output_bind` `R/lib.rs:3479-3490`; the effects module always returns `Some` (`crates/deep-effects-render/src/frame.rs:821`, `(jobs, Some(cur))`, where `cur` starts as `frame.linear.clone()`).

**What**: every frame of every view with the effects module makes a bind group over (source view, tone buffer, covered view), even when the source is the linear target itself, for which `targets.output_bind` already holds the identical group, or the same effects target as last frame.

**Change**: reuse by view equality (wgpu 30 handles implement `PartialEq` by identity: `wgpu-30.0.1/src/api/texture_view.rs:23`).
- New field `pre_tone_bind: Option<(wgpu::TextureView, wgpu::BindGroup)>`, `None` in `new`.
- At `:6835-6837`: if `*view == t.linear_view` use `t.output_bind.clone()`; else if the cached view equals `view` use the cached group; else build and cache.
- Clear the cache where the group's other inputs change: in `cover` when it returns true (`R/lib.rs:3536-3541`, the covered view) and in `ensure_targets` when it rebuilds (`R/lib.rs:3466`).

**Why it is safe**: the group's three resources are the view (compared), `tone_buffer` (made once in `new`), and `covered.1` (changes only in `cover`, which also rebuilds `targets.output_bind`). `cover` runs at `:6811`, before this point, in the same call.

**Gain**: one bind group creation per frame per view with effects. Small, steady. Unmeasured.

**Proof plan**: tests/acceptance/380, 418 (pre-tone source), 382 (covers). Gain: `create_bind_group` calls per frame.

**Risk**: low-medium (borrow of `t` across the cache write needs the values cloned first). ~20 lines.

---

## 13. G5 — effect passes rebuild their parameter buffer and bind groups every frame — CONFIRMED; larger change

**Where**: `R/motion.rs:480-584` (`prepare`: 2 buffers, 4 bind groups) and `:433-450` (`target_frame`: 2 buffers, 1 bind group); `R/mirror.rs:165-175` (2 buffers) and `:211-236` (1 bind group); `R/flare.rs:296-304` (1 buffer) and `:315-365` (2–3 bind groups); `R/print.rs:369-409` (2 buffers, 1 bind group, inside the encode job).

**What**: each makes its uniform with `create_buffer_init` per frame, so every bind group naming it must be rebuilt too, although the textures they bind are stable between frames. `surface::Low` in the same crate already does the other thing (`hold` writes its uniform only when the value changed; its groups are made with its targets, `R/surface.rs:337-348`).

**Change**: per pass, a persistent `UNIFORM | COPY_DST` buffer written with `queue.write_buffer` (skipped when the bytes equal the last write), a grow-only instance buffer where there is one, and bind groups rebuilt only when a bound view changes (compare handles). Not written out here: four sites, ~120 lines; `print::Printer::record` takes no queue and is shared with `crates/deep-gpu-layer/src/print2d.rs`, so it needs a signature change or stays as is.

**Why it would be safe**: a write in `prepare` lands before that frame's command buffers at the next submit, which is what a buffer created in `prepare` gives today; these passes read the uniform only in that frame's jobs.

**Gain**: per frame with the effect on: motion 2 buffers + 4 groups, velocity target 2 + 1, mirror 2 + 1, flare 1 + 2–3, print 2 + 1 creations removed. Unmeasured.

**Proof plan**: tests/acceptance/419, 431, 465, 464, 166. **Risk**: medium (four sites). Do after 1–12.

---

## 14. X1 — where `R/lib.rs` has a seam that removes coupling: the cascades and the environment, as `local::Locals` already is — CONFIRMED by tracing field use

**Where**: `prepare_cascades` `R/lib.rs:3571-3768` with `struct Cascaded` `R/lib.rs:1687-1702`; `prepare_env` `R/lib.rs:3869-4007` with `struct EnvState` `R/lib.rs:1705-1716`. The precedent: `local::Locals` (`R/local.rs:83-93`, `prepare` `:170`, `ensure`, `reports`), driven from `prepare_locals` `R/lib.rs:3773-3818`.

**What**: both methods take `&mut self` (the whole `Renderer`, `R/lib.rs:1721-1906`) but touch little of it:
- `prepare_cascades`: `self.cascaded`, `self.shadow_scale`, `self.shadow_mark`, three `planted` fields (`local`, `cascade_cache_keeps_stale`, `cuts_color_only`), `counts.{cascades_drawn, cascade_splits, shadow_maps}`, and one call out, `rebind_lights`, when the texture is first made.
- `prepare_env`: `self.env`, `planted.prefilter_over_frames`, `counts.env_builds`, and `rebind_lights` when a cube was rebuilt.

**Change**: move each to the state it owns, returning what the renderer copies out, exactly as `Locals::prepare` returns `fresh`:
- `shadow.rs` (or `cascades.rs`): `impl Cascaded { pub(crate) fn prepare(&mut self, device, scene, frame: &FrameUniform, planted: &Planted, scale: u32, mark: f32) -> CascadeReport { fresh_texture, splits, maps, drawn } }`; the renderer writes the three count fields and calls `rebind_lights` on `fresh_texture`.
- `env.rs`: `impl EnvState { pub(crate) fn prepare(&mut self, device, scene, camera: &[f64; 16], partial: bool) -> bool /* rebuilt */ }`.

**Not a seam**: "the lights" as a whole. Group 1's bind group (`rebind_lights` `R/lib.rs:3830-3865`) also binds the per-pixel lists (`oit`), the glass copy, and the adjust and lobe tables, so it has to stay on the renderer; and `jobs()` (`R/lib.rs:6520-6990`) reads nearly every field. Moving `Set`, the pipeline constructors (`R/lib.rs:2241-2603`) or the read-backs (`R/lib.rs:7507-7790`) to files of their own would be line moves that remove no coupling.

**Gain**: ~340 lines leave `lib.rs`; two methods stop taking the whole owner; C4's dedupe becomes local to the cascades. No runtime change.

**Proof plan**: pure move: tests/acceptance/422, 425, 426, 446 unchanged. **Risk**: low-medium (mechanical, ~360 lines moved, ~30 new).

---

## 15. M2 — `Device::raised` and `Device::failures` grow without bound when nobody drains them — PLAUSIBLE

**Where**: `G/device.rs:232` (`raised: Arc<Mutex<Vec<Raised>>>`), pushed at `G/device.rs:343`, drained only by `take_raised` `G/device.rs:358`; `failures` `G/device.rs:233`, pushed by `failed` `G/device.rs:376`, never removed; each uncaptured error also `format!`s once per recorded failure (`G/device.rs:331-335`). `take_raised` callers: only `crates/deep-gpu-layer` (`main.rs:657`, `live.rs:2164`, `validation.rs:214, 218`) and a test in `R/lib.rs:8582`. `crates/deep-show/src/scene3d.rs` and `crates/deep-app/src/gpu_view.rs` never drain.

**What**: the print of these errors is rate-limited because they can flood (#1413), the list is not: a resource that failed makes each later use raise again, one `String` per error for the device's life.

**Change**: needs a policy, so not written as an edit: a cap with a dropped count (as `print`'s `suppressed`), or draining where the app's render loop reports. Either changes what a late `take_raised` returns past the cap.

**Check I could not do**: whether any app path is meant to drain it (a status surface not yet landed). **Risk**: low-medium.

---

## 16. D1 — design-level costs I verified but do not propose as edits

These need a decision or a wider change than this pass; listed so they are not lost.

- **Whole-scene clones per frame in `prepare`.** `R/lib.rs:4329-4340`: a scene with any LOD band clones the entire `Scene` (every `Solid` with its `String` ID and inline `Material`) each frame so `lod::resolve` can mutate it; `R/lib.rs:4342-4352`: a scene with water clones it again to drop the wet solids. Both recurse into `prepare`. Removing them means `lod::resolve` and the water split producing a filtered view instead of a copy.
- **Every built mesh is rebuilt and re-hashed on every whole-path frame.** `S/scene.rs:2443-2471`: `mesh_of` runs the builder and stack, then `Canonical::canonical_bytes(&mesh)` serialises the whole mesh to hash it, for static items too. The scheduler's dirty-class key for exactly this exists (`keyed_build`, `S/build.rs:111-119`; `is_builder` vs `is_live_builder` `S/build.rs:74-86`). A memo in `Frames` keyed by it (bounded by the item count) would make a static mesh cost a key compare per frame. This is the largest CPU cost in the area for scenes of built meshes, and also what makes the still-scene check in `liveview.rs:794-806` expensive: `frames.at` evaluates the whole scene to learn nothing changed.
- **The key light's single shadow map is redrawn every frame.** `shadow_job` `R/lib.rs:6409-6414` has no key, while the cascades (`Cascaded.keys`) and local maps redraw only when stale. Its clip is fitted to the solids alone (`shadow::light_clip`), so a camera-only move redraws an identical 2048² map. Keying it would change which frames list `scene3d.shadow` in their passes, which tests/acceptance/1297/convex-sun.test.ts:37 and 424 read: an observable change.
- **`View::render` submits a second, empty command buffer on the zero-copy path.** `G/view.rs:379-384`: `ZeroCopy::after_render` is a no-op (`G/surface.rs:377`), yet an encoder is created, finished and submitted so the `Done::All` callback has a submission of its own. One submit would do there, but `Times::handoff` is measured between the two callbacks.
- **`update_culls` allocates three `String`s per culled set per view per frame for `counts.indirect`** (`R/lib.rs:5029-5048`), on the `prepare_moved` path too. Fixing it changes the public `Counts` shape.
- **`picks` (`R/lib.rs:1877`), `materials` and `op_binds` (`:1742-1744`), and `maps::Store.{textures, groups}` are insert-only.** Bounded by the distinct IDs, operators and images a document's life names; pick IDs must stay stable, so no eviction is proposed.

Checked and sound (no finding): load/store ops (`geometry_pass`, `resolve_ids`, `full_pass`: the multisampled color is transient and discarded, clears not loads where nothing is kept, `Load` only on passes that composite); no `poll(wait)` or blocking map reachable from `Ui` (`G/view.rs:61-131`; the waits are `wait_done`, `memory::drain`, the copy path's `finish`, `read_back`, `oit::check`, all render-thread or report-only); batches replay from bundles while their draw key holds; cascades, local maps and environment cubes are keyed; `surface::Low` caches its groups; `Uploads::flush` is budgeted; `G/cache.rs` frees on release.

---

## Dispositions

| Crate | Disposition |
|---|---|
| `crates/deep-scene3d-render` | Findings 1 (G1), 2 (G2), 3 (C1), 6 (M1), 7 (C4), 8 (G3), 9 (C5), 10 (A1), 11a–d,f (A2), 12 (G4), 13 (G5), 14 (X1); notes in 16 |
| `crates/deep-canvas-scene3d` | Findings 4 (C2), 5 (C3), 11e (A2); notes in 16 (mesh memo). Builders/modifiers not audited line by line |
| `crates/deep-gpu` | Keep. Finding 15 (M2, plausible); note in 16 (empty second submit). View, ring handoff, encode pool, uploads, cache, meter: nothing to change |
| `crates/deep-gpu-layer` | Keep. Proof binary; its live loop is the caller that pays findings 1–5 and 7 (`liveview.rs:794, 888, 894-897`). No finding of its own |
