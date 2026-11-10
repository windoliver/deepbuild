# 07 — canvas module crates (motion, effects, effects-render, cells, vector, graph, sheet, record, input, loop, drawn, seams)

Read-only audit at main 6a6d6b4f. Nothing was built or run; every claim below is from reading the code and its callers. Paths are relative to the worktree root. Ranked by gain over risk.

What is already right and should stay: motion's per-frame core (`Curve::owner`, `Follow::at`, `Remap`, `Inputs`, occurrence reads) uses `partition_point` over sorted keys and fixed stacks; `Program::run` allocates nothing for channels, placements, mixes, drivers and limits (pinned by `crates/deep-marks-render/tests/no_alloc.rs`); labels use a word bitmap; the input track is indexed per control; the glow chain already runs on half-size mips. The findings are what is left around that core.

---

## F1 — motion: `Program::compile` is quadratic in the number of targets (CONFIRMED)

**Where**
- `crates/deep-canvas-motion/src/schedule.rs:88-102` (Kahn's loop)
- `crates/deep-canvas-motion/src/program.rs:2168` (`last_of`), `:1250` (`slot`), `:1215`/`:1236` (`mark_type`, `mark_written`), `:2022-2031` (`item_of`), `:679`, `:693`, `:1169`, `:1641`, `:2762` (other `items.iter().position`)

**What.** A program is compiled once per revision (`module.rs:382 compile`, `deep-marks-render` `session.compiled`, `deep-gpu-layer` `Flat::new`). For n scheduled steps (one per channel, placement write, driver, limit, constraint) and N items:
1. `schedule::order` pops each ready node and then scans every node: `for j in 0..n { if after[j].contains(&i) … }` → n² `BTreeSet::contains` per compile.
2. `Program::schedule` calls `last_of(&node.item)` for every node, each an `rposition` with a `String` compare over the whole order → n² string compares.
3. `Program::slot` finds the owner with `self.items.iter().position(|i| i == owner)` for every channel, write and driver var → targets × N string compares; `mark_type`, `mark_written` and `item_of` scan `self.fields` linearly per call.

The design's own scale is 10,000 animated items (#489 criterion 8). At n = N = 10,000 that is ~10⁸ set lookups plus ~10⁸ string compares per compile: by estimate several hundred milliseconds for every revision (unmeasured), where the rest of compile is linear. At ≤ 200 targets it is invisible.

**Change.**
(a) `schedule.rs`, replace the Kahn loop with a reverse adjacency:
```rust
let mut waiting: Vec<usize> = after.iter().map(BTreeSet::len).collect();
let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); n];
for (j, set) in after.iter().enumerate() {
    for &i in set {
        dependents[i].push(j);
    }
}
let mut ready: BTreeSet<usize> = (0..n).filter(|&i| waiting[i] == 0).collect();
let mut out = Vec::with_capacity(n);
while let Some(i) = ready.pop_first() {
    out.push(i);
    for &j in &dependents[i] {
        waiting[j] -= 1;
        if waiting[j] == 0 {
            ready.insert(j);
        }
    }
}
```
(b) `program.rs:2168`, one pass instead of `rposition` per node:
```rust
let mut last: BTreeMap<&str, usize> = BTreeMap::new();
for (at, &i) in order.iter().enumerate() {
    last.insert(nodes[i].item.as_str(), at);   // later entries overwrite: the last position
}
…
if last.get(node.item.as_str()) == Some(&at) && composed.insert(node.item.clone()) {
```
(c) Give `Program` a `pub(crate) index: BTreeMap<String, usize>` built right after `items` (line 487; the same map lines 741-745 already build as `at`, which then reads it), and use `self.index.get(owner).copied()` in `slot`, `world_read`, `slot_of`, `item_values`, the limit loop (679) and `index_of` (692).
(d) `self.fields` is ascending in `slot` (`slot = self.base.len()` only grows), so `mark_type`/`mark_written` can take `let k = self.fields.partition_point(|f| f.slot < slot)` and test `self.fields.get(k)` for `f.slot == slot` (the first match, as `find` gives); `item_of` the field at `partition_point(|f| f.slot <= slot) - 1`.

**Why it is safe.** (a) `after[j]` is a set, so each edge (i, j) decrements `waiting[j]` exactly once in both forms; `ready` is a `BTreeSet` popped lowest first, so the order nodes become ready in does not matter; the planted `whole_items` path only replaces `after` before this loop. (b) `rposition` is the last index whose item equals; the map's last insert is the same index. (c) item IDs are the keys of a JSON object, so unique: first match equals map lookup. `Program`'s canonical bytes are written field by field (`canonical.rs:505-524`), so a new derived field changes no digest; `PartialEq`/`Clone`/`Debug` derive for a `BTreeMap`. (d) holds for zero-width fields too: the first field with `slot >= x` is the first with `slot == x` when one exists.

**Gain.** Compile at 10,000 targets drops from ~2–3 × 10⁸ lookups/compares to O(n log n). Unmeasured; nothing changes below a few hundred targets.

**Proof plan.** Behavior: `schedule.rs` unit test `two_items_reading_each_others_other_components_order_and_a_loop_is_refused`, `tests/acceptance/489/evaluation-order.test.ts`, `constraint-kinds.test.ts`, `crates/deep-canvas-motion/tests/scope.rs` (order names), `tests/acceptance/391`. Gain without wall time: count `BTreeSet::contains` calls / string compares in `order` for the #489 budget document (10,000 channels) before and after, or instruction count of `Program::compile` on it.

**Risk.** Low. ~45 lines over two files; (a)+(b) alone are ~20 lines and carry most of the gain.

---

## F2 — effects-render: `DocOps::plan` deep-clones every operator's checked graph every frame (CONFIRMED)

**Where.** `crates/deep-effects-render/src/docops.rs:1439` (`let c = runner.compiled.checked.clone();`).

**What.** `plan` runs once per drawn frame (`frame.rs:721`, and deep-gpu-layer's live view). For every operator that draws it clones `Checked`: the whole `Operator` (inputs, steps with their arg and field maps, outputs, storage, textures), the `types` map, `order`, `body_order`, and recursively every iterate body (`Iterated.body: Box<Checked>`). An operator of 50 steps is several hundred heap allocations, made and freed per operator per frame, only to read it. `steps()` in the same file already does it without a copy (`:1302-1303`: `let runner = op.runner.clone().expect("built"); let c = &runner.compiled.checked;`).

**Change.**
```rust
// before
let runner = runner.expect("built");
let c = runner.compiled.checked.clone();
// after
let runner = runner.expect("built");
let c = &runner.compiled.checked;
```
`interp::inputs(&c, …)` and `self.plan_of(device, &item, &c)` keep compiling through auto-deref (or drop the `&`).

**Why it is safe.** `runner` is the function's own `Arc<Runner>` (cloned from `op.runner` at 1428), so the borrow is of a local, not of `self`: the later `&mut self` calls (`plan_of`, `kernels`, `target_of`, `textures.get_mut`, `counted.entry`) do not conflict. `runner` is only ever `.clone()`d into `Part`s, never moved, inside the block. Nothing mutates the checked graph.

**Gain.** Removes O(graph size) allocations per operator per frame (hundreds for a composed pass; more for a fused chain or an iterate). Unmeasured.

**Proof plan.** Behavior pinned by the docops acceptance suites through `deep-gpu` (`tests/acceptance/429`, `432`, `483`, `484`, `252`). Gain: allocation count around `plan` with the counting allocator pattern of `crates/deep-marks-render/tests/no_alloc.rs`.

**Risk.** Low. 1 line (plus cosmetic `&c` → `c`). Needs one compile to confirm borrows.

---

## F3 — motion: every constraint allocates 5–10 vectors per frame, against "evaluation after the first frame allocates nothing" (CONFIRMED)

**Where.** `crates/deep-canvas-motion/src/program.rs:2723-2728` in `constrain`, through `constraint_slots` (`:2034-2060`), `world_slots` (`:2063`) and `groups` (`:1904`).

**What.** `Step::Constraint(k)` runs per constraint per frame. `constrain` calls `self.constraint_slots(k)` only for its `writes`, which builds `other` (a `world_slots` vector, grown per ancestor), `reads`, `writes` and `[other, reads].concat()`, then `[solved.pos, solved.rot, solved.scale].concat()`. `groups` collects through `flat_map`, so each small vector may reallocate as it grows. The module doc (`program.rs:1-5`) and the README promise no allocation after the first frame; the allocation test's four documents (`crates/deep-marks-render/tests/no_alloc.rs:97-102`) hold no constraint (grep: no `constraint`, `look_at`, `child_of` in the test), so nothing catches it.

**Change.** Resolve the writes at compile, where every other slot is resolved.
```rust
// Compiled (program.rs:145)
/// The owner's slots it writes, as `constraint_slots` lists them.
pub(crate) writes: Vec<usize>,

// compile, right after the push at :739
program.constraints.push(Compiled { owner, other, chain, table, writes: Vec::new() });
let k = program.constraints.len() - 1;
let own = owner * TRANSFORM..(owner + 1) * TRANSFORM;
let writes = program.constraint_slots(k).1.into_iter().filter(|s| own.contains(s)).collect();
program.constraints[k].writes = writes;

// constrain (:2722-2728)
let w = spec.influence;
let after = [
    solved.pos[0], solved.pos[1], solved.pos[2],
    solved.rot[0], solved.rot[1], solved.rot[2],
    solved.scale[0], solved.scale[1], solved.scale[2],
];
for &s in &c.writes {
    let v = after[s - own_at];
    slots[s] += w * (v - slots[s]);
}
```

**Why it is safe.** The stored list is exactly the old filtered iteration, in the same order, duplicates included (a `reach2` whose lower bone is its owner lists the rot slots twice today; it still does). `constraint_slots(k).1` reads only `self.constraints[k]` (owner, chain) and `self.motion.constraints[k].kind`, both final at the push; `parents`, which is filled later, feeds only the reads. `Compiled` is not in the canonical bytes (`canonical.rs:505-524` encodes `motion`, `items`, `fields`, `base`, `channels`, `values`, `placements`, `parents`, `drivers`, `limits`, `follows`, `inputs`). `schedule` and `slot_bound` keep calling `constraint_slots` at compile.

**Gain.** 5–10 heap allocations per constraint per frame → 0. A rig of 100 constraints makes ~700 fewer allocations a frame. Unmeasured.

**Proof plan.** `tests/acceptance/489/constraint-kinds.test.ts`, `reach2-stretch.test.ts`, the kit fixtures in `src/kit.rs`. Gain: run the `no_alloc.rs` counting loop over a document with one constraint of each kind; it reports a nonzero count today and 0 after (a regression test existing coverage misses; adding it is the lead's call under AGENTS.md).

**Risk.** Low. ~15 lines.

---

## F4 — graph: the router tests every grid cell against every box, O(n³) per edge (CONFIRMED)

**Where.** `crates/deep-canvas-graph/src/route.rs:198-201` in `search`; callers `route` (`:146`), `view::routes` (`view.rs:166`), `deep-marks-render/src/graphs.rs:259`.

**What.** For each edge, `search` builds lanes from every obstacle's two edges and the midpoints between them (about 4n lanes an axis for n boxes), so the grid has ~16n² cells, and fills `ok` by calling `free`, which scans all n rects, for every cell: ~16n³ `inside` tests per edge before A* starts. At n = 100 boxes (nodes, node labels and frame titles all count) that is ~1.6 × 10⁷ tests per edge; with 200 edges, 3 × 10⁹ per routing pass. The design asks for "a sparse grid … inside the corridor … obstacles from the spatial index".

**Change.** `inside` is two interval tests, so a box blocks a rectangle of lanes. Mark those instead of asking every cell about every box.
```rust
// one definition of the interval, shared with `inside`
fn within(lo: f64, len: f64, c: f64, v: f64) -> bool {
    const EPS: f64 = 1e-9;
    v > lo - c + EPS && v < lo + len + c - EPS
}
fn inside(rect: &[f64; 4], c: f64, p: (f64, f64)) -> bool {
    within(rect[0], rect[2], c, p.0) && within(rect[1], rect[3], c, p.1)
}

// in search, replacing `let ok: Vec<bool> = (0..nx * ny).map(…).collect();`
let mut ok = vec![true; nx * ny];
let mut cols: Vec<usize> = Vec::new();
for r in &rects {
    cols.clear();
    cols.extend((0..nx).filter(|&i| within(r[0], r[2], c, xs[i])));
    if cols.is_empty() {
        continue;
    }
    for j in (0..ny).filter(|&j| within(r[1], r[3], c, ys[j])) {
        for &i in &cols {
            ok[at(i, j)] = false;
        }
    }
}
```
`free` stays for the midpoint test inside A*.

**Why it is safe.** `ok[k]` was `!∃r: inside(r, c, (xs[i], ys[j]))`; `inside` is the conjunction of an x test and a y test with the same expressions and operand order as before (`rect[0] - c + EPS`, `rect[0] + rect[2] + c - EPS`), so the marked set is bit-for-bit the same, NaN coordinates included (every comparison false in both forms). No sortedness is assumed. Routes, their order (edge-ID) and the blocked list are unchanged.

**Gain.** Grid fill per edge from ~16n³ to n·(nx+ny) + cells covered ≈ 8n² + small: about 200× fewer tests at n = 100. Unmeasured.

**Proof plan.** `tests/acceptance/399/place-route.test.ts` (routes keep clearance, share at most one segment, same bytes for the same boxes), `kit.test.ts`. Gain: count `inside`/`within` calls for one routing pass of the #399 fixtures before and after.

**Risk.** Low. ~20 lines.

---

## F5 — effects-render: the effects chain's targets are never released (GPU memory) (CONFIRMED)

**Where.** `crates/deep-effects-render/src/frame.rs:104` (`targets`), `:216-224` (`target`), used at `:631`, `:652`, `:683`, `:776`, `:797`; also `:107` (`half`).

**What.** `Effects` lives as long as its view (`deep-gpu-layer/src/session3.rs:211`; settings are assigned per frame). `target(i, size)` only ever grows `self.targets` or replaces a slot whose size changed; nothing shrinks it. The glow's slots start at `first = next`, which moves when the grid, shadow or selection pass toggles, so each toggle leaves a stale tail; turning bloom off leaves its whole chain. Each is an `Rgba16Float` texture: 16.6 MB at 1920×1080, 66 MB at 3840×2160. Bloom's chain after it is switched off holds ~1.67 full-size targets (28 MB at 1080p, 110 MB at 4K) for the rest of the session; a selection made once leaves one full-size target. The budget is 256 MB of GPU memory per window.

**Change.** Track the highest slot a frame uses and drop the rest when the frame's jobs are planned.
```rust
// Effects: add `used: usize`
fn target(&mut self, device: &Device, i: usize, size: [u32; 2]) -> wgpu::TextureView {
    self.used = self.used.max(i + 1);
    …
}
// Post::jobs: `self.used = 0;` first; before `(jobs, Some(cur))`:
self.targets.truncate(self.used);
if !s.sparks.iter().any(|sp| sp.half) {
    self.half = None;
}
```

**Why it is safe.** Every job holds its own `wgpu::TextureView` clones, which keep their textures alive until the job is encoded and submitted, so truncating after planning frees nothing a pending frame reads. A slot dropped and needed again is re-made by the existing `while self.targets.len() <= i` path, exactly as on first use; every pass clears its target (`LoadOp::Clear`) before writing, so no content carries between frames. A still view plans no jobs and keeps what it has.

**Gain.** Up to ~1.67 full-size HDR targets per window released when bloom is off, one per toggled chain pass: tens of MB at 1080p, over 100 MB at 4K. Cost: targets re-made on the frame a pass is switched back on (a settings change, not per frame).

**Proof plan.** `tests/acceptance/380` through `deep-gpu` (the shipped passes against their CPU reference), `418` (dirt), `1173` (half-resolution puffs). Gain: count live chain textures (or `targets.len()`) after frames with bloom on, then off.

**Risk.** Low. ~8 lines.

The same shape exists in `docops.rs:1642-1645`: an operator's `"{item}:{k}:full"` blit target stays after its resolution returns to 1 (PLAUSIBLE; the degrade ladder may move often enough that keeping it is intended. Not proposed without the lead's call).

---

## F6 — motion module: each animated item's node evaluates the whole program (PLAUSIBLE, design-level)

**Where.** `crates/deep-canvas-motion/src/module.rs:406-466` (`channels`), `:395-403` (`clock`), registered at `:187-198`; run by `deep-canvas/src/schedule/mod.rs` `Session::frame` → `visit_group` (per node), driven per frame by `deep-show/src/time.rs:427`.

**What.** `channels` is an item-scope operator reading `motion.program`, `t`, `view(reduced_motion)` and `self`. When `t` changes, every target item's node runs, and each run allocates a fresh `State` (`program.state()`, nine vectors sized to the whole program) and calls `evaluate_local` for the whole program, then keeps one item's nine slots and fields (`item_values`, which also finds the item by a linear scan). `clock` evaluates the whole program once more. A frame with N animated items costs N + 1 full evaluations: N² channel samples. At N = 1,000 that is ~10⁶ samples and ~9,000 allocations per frame against a 4 ms CPU budget; the direct path (`Program::evaluate` once, as marks-render and gpu-layer's `Flat` do) is N. #489's 2 ms budget measures only the direct path (`deep-motion eval`).

**Change (sketch; needs the registry's rules checked).** One document-scope node evaluates; item nodes read it.
```rust
r.private_array("motion.state", "state", "document", "transform", "items");
r.operator("evaluate", "items", &["motion.program", "t", "view(reduced_motion)"], &["motion.state"])
    .document().applies(has_motion).run(evaluate);   // t held at transport.start under holds && reduced_motion, as channels does today
r.operator("channels", "items",
    &["motion.program", "motion.state", "t", "view(reduced_motion)", "self"],
    &["motion.at", "motion.fields"]).applies(is_target).run(channels);
```
`evaluate` writes `Val::typed(state)` (needs `Canonical for State`: `t`, `slots`, `values`); `channels` takes `item_values` from it; `clock` reads `state.valid_until` from it when the time is not held, else evaluates as now.

**Why it may be safe / what to check.** A private array is left out of the interface digest (`registry/mod.rs:402`, `3295`), and the scheduler derives order from reads. Not verified: (1) whether any acceptance test pins the node list or `ran` counts of a document with motion (`tests/acceptance/387` reports `ran` per frame and node lists; `#387.f71bf834` requires every operator that plays motion to change key with reduced motion, which `evaluate` would by its read); (2) the right damage `class` for a document array feeding both a `transform` and a `geometry` contribution; (3) `ran_by_operator` readers (`deep-show/src/efficiency.rs`, #854). These need a build and the 387/488/854 suites.

**Gain.** Evaluations per frame from N + 1 to 1 or 2; State allocations from N + 1 to 1 or 2. The largest CPU item in this area once a scheduled document has more than a few dozen animated items.

**Risk.** Medium to high (new operator and array in a sealed registry; ~60 lines). Worth doing as its own change with the suites above.

---

## F7 — effects-render: a compute texture output's clear `Fill` is rebuilt every frame (CONFIRMED)

**Where.** `crates/deep-effects-render/src/docops.rs:1508-1510`; `crates/deep-effects-render/src/mips.rs:146-185` (`Fills::fill`), whose doc says "One texture's fill, bound once: recorded each frame".

**What.** For every texture output of every compute operator, every frame, `kern.2.fill(…)` allocates a `String` key, creates a 16-byte uniform buffer, a texture view, a bind group layout handle and a bind group. The mip `chain` beside it is cached in `OutTex` (`get_or_insert_with`, `:1517-1520`); the fill is not.

**Change.** Add `clear: Option<Arc<Fill>>` to `OutTex` (`docops.rs:343`, initialised `None` at `:717`), and at `:1508`:
```rust
if clear {
    let fill = t
        .clear
        .get_or_insert_with(|| Arc::new(kern.2.fill(&device.device, &t.tex, &t.out.format, [0.0; 4])))
        .clone();
    parts.push(Part::Fill(fill));
}
```
The marker fill (test hook) stays as it is.

**Why it is safe.** A `Fill` is immutable after creation (pipeline, bind group, group counts, its buffer) and `Part::Fill` already takes an `Arc<Fill>`; the texture is created once per `DocOps` (`:695`) and never replaced, so the cached view stays valid. The field-disjoint closure borrow is the same pattern as `t.chain` two lines below.

**Gain.** Per compute texture output per frame: one buffer, one view and one bind group fewer. Small per frame; removes steady GPU object churn. Unmeasured.

**Proof plan.** `tests/acceptance/483` (texture outputs start each frame at their clear value; the pool-marker hook proves the clear runs).

**Risk.** Low. ~8 lines.

---

## F8 — effects-render: each shipped pass creates two uniform buffers and two bind groups every frame (PLAUSIBLE)

**Where.** `crates/deep-effects-render/src/frame.rs:260-295` (`pass_job`), `:376-413` (`sparks_job`), `:198-214` (`runner`), `:618` (`self.settings.clone()`); `crates/deep-effects-render/src/runner.rs:260-315` (`bind_with`).

**What.** With grid, shadow, selection and a six-level bloom, a frame runs 15 passes; each calls `interp::inputs` (a `BTreeMap<String, Val>`), `create_buffer_init` twice and `create_bind_group` twice: ~30 buffers and ~30 bind groups created per frame. The inputs' bytes and the texture views of a pass are the same frame after frame unless a param animates or the view resizes; only the frame uniform (it holds `t`) changes while time runs. `runner()` also allocates `id.to_string()` on every hit, and `jobs` clones the whole `Settings` (param maps, roles, sparks) each frame.

**Change (sketch).** Split `Runner::bind_with` into `bind_frame` (group 0) and `bind_inputs` (group 1), keep `bind_with` as both. In `Effects`, keep per pass slot `(input bytes, views) → (g1, ib)` and reuse when both are equal (`wgpu::TextureView: Eq` in wgpu 30: `impl_eq_ord_hash_proxy!(TextureView => .inner)`); look the runner up with `get(id)` before `entry(id.to_string())`.

**Why it may be safe / what to check.** Reuse only on byte-equal contents and identical views never shows stale data; no `queue.write_buffer` into a buffer a pending frame may still read (that would be unsafe if two frames are planned before one is submitted, which I did not trace in deep-gpu). Not verified: the bind group cost on Metal, so the gain is unmeasured (expected: tens to low hundreds of µs of CPU per frame).

**Risk.** Medium. ~60 lines. Do after F2/F5/F7.

---

## F9 — vector: the CSS cascade is recomputed 3–5 times per SVG element (CONFIRMED)

**Where.** `crates/deep-canvas-vector/src/svg.rs:564-593` (`Sheet::declarations`), called from `style` (`:613`), `own` (`:619`), `hidden` (`:629`), `transform_of` (`:635`), and so from `walk` at `:678`, `:687`, `:688`, `:747`, `:751`; `Selector::matches` (`:475-488`).

**What.** `declarations(node)` copies every attribute into owned `(String, String)` pairs and tests every rule of every `<style>` block; `matches` collects the node's classes into a `Vec` per rule. `walk` asks for it once for `display`, once for the style, once for `transform`, and twice more (`clip-path`, `mask`) for every element that drew. The import runs at check per vector item (`lib.rs:98`, `outline_source.rs:46`), up to `nodes_limit: 1_000_000` nodes.

**Change.** Compute the declarations once per `walk` and read the five things from it:
```rust
fn own_in(declared: &[(String, String)], name: &str) -> Option<String> {
    declared.iter().rev().find(|(k, _)| k == name).map(|(_, v)| v.trim().to_string())
}
// walk: let declared = self.sheet.declarations(node);
//   hidden      → own_in(&declared, "display").as_deref() == Some("none")
//   style       → parent.with(&declared, &mut self.unread)
//   transform   → compare own_in(&declared, "transform") with the attribute, as transform_of does
//   clip-path / mask → own_in(&declared, …)
```
and in `matches`, `self.classes.iter().all(|c| node.attribute("class").is_some_and(|a| a.split_whitespace().any(|x| x == c)))`.

**Why it is safe.** `declarations` is a pure function of the node and the sheet; `walk` never changes either between the calls. `own` is already `declarations(node).into_iter().rev().find(…)`. Compute `declared` after the cheap name and namespace tests of the first `if`, so an element the walk skips costs what it does now; the hidden test then the `MAX_DRAWN` check then the style keep their order, so `unread` gains its names in the same order. `mask`, `pattern`, `marker` and `referenced_style` keep their own calls.

**Gain.** 3–5× fewer cascade passes and attribute copies per element at import; with a style sheet of R rules, R fewer class-vector allocations per pass. Check-time only. Unmeasured.

**Proof plan.** `svg.rs` unit tests (`a_style_rule_and_an_attribute_set_one_opacity_the_last_winning`, `a_style_rule_hiding_an_element_hides_it`, `a_css_transform_is_named_not_dropped`, …), `tests/acceptance/398`, `1175`. Gain: count `declarations` calls on a fixture.

**Risk.** Low. ~30 lines.

---

## F10 — motion: a `lag` driver reruns the whole program per driver, into a fresh `State`, every frame (PLAUSIBLE)

**Where.** `crates/deep-canvas-motion/src/program.rs:2390-2405` in `evaluate_core`.

**What.** `earlier` (the program evaluated at t − dt) is local to one `evaluate_core` call. D drivers that lag by the same dt each allocate a full `State` and run the whole program again: D extra evaluations and 9·D allocations per frame, where one per distinct dt would do. The nested run skips every lagging driver (`state.nested`, `:1489`), so its result depends only on t − dt, not on who asks.

**Change (sketch).** Hoist the cache to `run`: `let mut earlier: Vec<(i64, State)> = Vec::new();` before the step loop, passed `&mut` to `evaluate_core`. To also drop the allocations, keep the vector in `State` (`std::mem::take` it at the top of `run`, clear a `fresh` mark per entry, put it back at the end).

**Why it may be safe / what to check.** Sharing is exact for the reason above. Not checked: `trace` and the shots' framing call `run`/`evaluate` re-entrantly on other states, which is fine for a per-`run` local but needs care if the cache lives in `State`.

**Gain.** Documents with several lagged drivers only (#495): D → (distinct dt) nested evaluations per frame. **Risk.** Low for the hoist (~10 lines), medium for the pooled states.

---

## F11 — cells: four small allocations per CSI sequence, and a row allocation per scrolled line (CONFIRMED, small)

**Where.** `crates/deep-canvas-cells/src/emulator.rs:446-450` (`byte`), `:778-787` and `:863` (`csi`), `:969-977` (`sgr`), `:714-739` (`scroll_up`).

**What.** (a) `let params = std::mem::take(&mut self.params);` hands the buffer to `csi` and drops it, so the next sequence's first `push` allocates again. (b) `csi` parses `digits` into `params: Vec<u16>` and then `sgr(&digits)` parses the same bytes into a second `Vec<u16>`. Colored output is mostly SGR: four allocations per sequence where two are needed. (c) `scroll_up` allocates a fresh blank row and frees the old one for every scrolled line even when the old row is not kept (alternate screen, or `history_cap == 0`, which is how deep-app builds it: `deep-app/src/cells.rs:126`).

**Change.**
```rust
// (a) byte(): keep the buffer
let mut params = std::mem::take(&mut self.params);
self.state = State::Ground;
self.csi(&params, b);
params.clear();
self.params = params;
// (b) csi(): `(_, _, b'm') => self.sgr(&params),` and `fn sgr(&mut self, parts: &[u16])` without its own parse
// (c) scroll_up(): when `on_alt || self.history_cap == 0`, `last.fill(Cell::blank(&pen))` in place instead of mem::replace
```

**Why it is safe.** (a) every entry to `State::Csi` clears `self.params` first (`:557`, `:574`), and `csi` never touches it. (b) for empty text `csi` parses `[0]` (`"".split` yields one empty piece) and `sgr` used `vec![0]`; otherwise both run the same split and parse, so `parts` is identical. (c) every row is always exactly `cols` long (`Screen::new`, `resize`, `reverse_index`), so `fill` equals a fresh `vec![blank; cols]`.

**Gain.** ~2 allocations fewer per SGR and one row allocation fewer per scrolled line; a few percent of the emulator's time on heavy colored output. Unmeasured. **Proof plan.** `emulator.rs` unit tests, `tests/acceptance/402`. **Risk.** Low. ~15 lines.

Memory, not proposed without the owner: `Terminal::links` (one entry per distinct OSC 8 URL, found by a linear scan at `:1048`, never pruned), `clipboard.writes` (every OSC 52 write, up to 1 MiB each, kept and serialized into each frame by `deep-show/src/terminal.rs:268`) and `queries` grow without bound over a session. Bounding any of them changes what a frame lists.

---

## F12 — small exact cleanups (CONFIRMED, low gain)

- **Path strings through a temporary.** `crates/deep-canvas-vector/src/lower.rs:494` (`d.push_str(&format!(" {} {}", …))`), `crates/deep-canvas-motion/src/morph.rs:44`, `crates/deep-canvas-graph/src/module.rs:120`: one heap `String` per point. `use std::fmt::Write as _; let _ = write!(d, " {} {}", p[0], p[1]);` writes the same text with none. `morph::d_of` runs per frame for every path channel (`eval.rs:524`, `program.rs:1652`); `lower::d_of` per raster frame per SVG path.
- **Sheet near-copy test.** `crates/deep-canvas-sheet/src/lib.rs:53-67`: `d.sort_by(f64::total_cmp); d[rank - 1]` → `*d.select_nth_unstable_by(rank - 1, f64::total_cmp).1` (the same bits: elements equal under `total_cmp` are identical), O(N) instead of O(N log N) over every pixel; and a local `let lut: [f64; 256] = std::array::from_fn(|c| srgb_decode(c as f64 / 255.0));` in place of three `srgb_decode` calls per pixel per still. Reached today only through the `deep-sheet` binary's `taste`.
- **Salience hold.** `crates/deep-canvas-record/src/lib.rs:142-149`: `changed` finds each item in `hold.items` by a linear scan (N × H string compares). Index once: `let mut was: BTreeMap<&str, &Item> = BTreeMap::new(); for h in &hold.items { was.entry(h.id.as_str()).or_insert(h); }` (first match, as `find`). The module's operator passes no hold (`module.rs:104`), so only the `deep-record` binary and `tests/hold.rs` reach it.
- **Docops channel inputs.** `crates/deep-effects-render/src/docops.rs:1049-1072`: `channel_values` allocates a `State`, splits each channel path and resolves its slot by linear scans every frame; the `(path, slot)` list is fixed once the ops are built and the `State` can be kept (PLAUSIBLE; only documents whose operators read channels).

---

## Notes for other areas (not findings here)

- `deep_canvas_motion::eval::items` deep-clones every item of the document per frame and rewrites `at` as fresh JSON arrays; `deep-marks-render/src/macos.rs:1203`, `deep-gpu-layer/src/flat.rs:133` and `film.rs:93` call it per frame, while `eval::written` (used by scene3d) copies only items a field names.
- `deep_canvas_vector::lower_items` (`lib.rs:249`) clones every non-vector item on each call; its callers in `deep-marks-render/src/raster.rs:764`, `:1408`, `:1695` own their maps and could pass them by value.
- `deep_canvas_graph::labels::place` recomputes the chain from bucket 0 on each call; `deep-marks-render/src/graphs.rs:583` asks per view bucket. `view::routes` has no cache "by (endpoints, corridor obstacles)" as the Route primitive says.
- `docops::Pool` (`docops.rs:81`) keeps every pipeline a session ever built; the design's "≤ 32 operator pipelines per document session" is not enforced there. Evicting would make a re-made pipeline appear again in the pool's log, so it is the owner's call.
- motion: `Motion::clip` is a linear scan by ID, called ~4 times per placement write per frame; negligible below hundreds of clips. An echo (`held.rs:212-215`) evaluates the program and deep-clones all authored items once per copy per frame by design.

---

## Dispositions

| Crate | Disposition |
|---|---|
| `deep-canvas-motion` | F1, F3, F6, F10, F12 (morph `d_of`) |
| `deep-motion` | keep (proof binary; nothing worth changing) |
| `deep-canvas-effects` | keep (check-time only; reference interpreter stays separate from the GPU code) |
| `deep-effects-render` | F2, F5, F7, F8, F12 (channel inputs) |
| `deep-canvas-cells` | F11 |
| `deep-canvas-drawn` | keep |
| `deep-canvas-graph` | F4, F12 (`drawn` string) |
| `deep-canvas-input` | keep (track indexed per control; per-event clones are human-rate) |
| `deep-canvas-loop` | keep (weld grid and edge map are already near-linear) |
| `deep-canvas-record` | F12 (hold lookup) |
| `deep-canvas-seams` | keep |
| `deep-canvas-sheet` | F12 (near-copy percentile) |
| `deep-canvas-vector` | F9, F12 (`d_of`) |
| `deep-canvas-test-modules` | read only; planted faults and fixtures, no finding |
