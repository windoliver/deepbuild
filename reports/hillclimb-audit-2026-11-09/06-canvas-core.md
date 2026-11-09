# 06 — canvas core (`crates/deep-canvas`)

Read-only audit at 6a6d6b4f. Nothing was built or run; every claim below is from reading the code and its callers. Paths are relative to `crates/deep-canvas/` unless they start with `crates/`.

Scale used in the estimates (counted with grep over `crates/deep-canvas*/src`): about 92 `.operator(` registrations, 78+ `r.array(` registrations, 26 `table:` reads, 17 `view(` reads (only `view(locale)` and `view(reduced_motion)` in module crates).

The follow-up from the earlier pass, "skip `apply_deferred` pool spin-up when no ops queued", is **still open**. It is finding 1, with the exact edit.

---

## 1. `apply_deferred` spawns the pool for an empty op list — CONFIRMED

**Where:** `src/schedule/mod.rs:653-698` (`Scheduler::apply_deferred`), called from `src/schedule/mod.rs:2247-2256` (`Session::visit_wave`). Pool: `crates/deep-show/src/workers.rs:92-110` (`Workers::run`).

**What:** `visit_wave` sets `s.deferred = Some(Vec::new())`, lands every fate, then always calls `apply_deferred`. That builds 16 `Vec`s and 16 `Mutex`es and calls `pool.run(threads, 16, …)`. `Workers::run` spawns `min(threads, 16) − 1` scoped OS threads per call. The op list is empty in two common cases:
- every Clean-mode wave: `land` inserts only `if self.mode == Mode::Live` (2333) and `settle` holds only `if mode == Mode::Live` (2409). So every parallel wave of every `probe` (each whole revision, `crates/deep-show/src/frames.rs:212`) and every `clean` (eval, geometry, kit) spawns threads to apply nothing;
- a Live wave whose nodes are all `Fate::Kept` (dirty by epoch, same key: a keyed operator whose item changed in a field it does not read, the #854 case).

**Change:**
```rust
fn apply_deferred(&mut self, threads: usize) -> Vec<(usize, Option<Key>)> {
    let ops = self.deferred.take().unwrap_or_default();
    if ops.is_empty() {
        return Vec::new();
    }
    let mut by_shard: Vec<Vec<CacheOp>> = (0..SHARDS).map(|_| Vec::new()).collect();
```

**Why it is safe:** with no ops every shard job runs zero iterations and leaves its `held` empty, so the function already returns an empty `Vec`; the cache is untouched. `self.deferred.take()` still clears the deferred state before the return, as now. The only caller iterates the result. The pool's `thread` index is unused by `apply`.

**Gain:** per empty wave, `min(threads,16) − 1` thread spawns and joins, 16 mutexes and 16 vecs. For a probe of a document with W waves across its parallel groups that is W × (threads − 1) spawns removed (unmeasured in ms; a macOS thread spawn+join is tens of microseconds).

**Proof plan:** `schedule/tests.rs::deferred_cache_changes_apply_as_in_node_order` (pins the sharded result against in-order application; an empty op list gives empty on both sides), `frames_that_visit_what_changes_reach_leave_what_whole_loads_leave` (pooled and unpooled), `tests/acceptance/857`. Gain without wall time: count `Pool::run` calls in a counting test pool during one `probe`.

**Risk:** low. 3 lines.

---

## 2. `compile()`: a full scan of every node per document read, linear array lookups, `format!` per view read — CONFIRMED

**Where:** `src/schedule/mod.rs:3203-3215` (`array_index`, `nodes_of`), `3231`, `3279-3284` (view term parse), `3261` (reads vec), all inside `compile`, which runs on every `load` and every `probe`.

**What:**
- `nodes_of(op)` (3207) iterates the **whole** `node_of` map, filters by operator, collects and sorts. It is called once per read (and per contribution) of a per-item array by a per-document node (3299). `node_of` holds every node of the plan (operators × items that apply), so each call is O(all nodes). With 10,000 items, ~10 nodes an item and ~20 such reads that is about 2 million map entries walked per compile. `node_of` is a `BTreeMap<(usize, Option<usize>), usize>`, so the operator's nodes are one contiguous range, already in item order.
- `array_index` (3204) is `array_names.iter().position(..)`, a linear string scan over every sealed array, called per group read, per contribution, per operator write and per tree. `array_names` is `sealed.arrays.keys()` of a `BTreeMap` (`src/registry/mod.rs:1266`), so it is sorted and unique.
- `VIEW_INPUTS.iter().position(|v| format!("view({v})") == r)` allocates up to 6 strings per `view(..)` read: once per group (3231) and once **per node** (3282). `view(locale)` and `view(reduced_motion)` are inputs 4 and 5, so each node of a text operator pays 5 or 6 allocations.
- `let mut reads = Vec::new()` (3261) grows by pushes though its final length is known.

**Change:**
```rust
// next to VIEW_INPUTS (line 60)
/// Each view input's read term, in [`VIEW_INPUTS`]' order.
const VIEW_TERMS: [&str; 6] = [
    "view(camera)",
    "view(viewport)",
    "view(pixel_scale)",
    "view(match.me)",
    "view(locale)",
    "view(reduced_motion)",
];

// 3204
let array_index = |name: &str| array_names.binary_search_by(|n| n.as_str().cmp(name)).ok();

// 3207-3215
let nodes_of = |op: usize| -> Vec<usize> {
    node_of.range((op, None)..(op + 1, None)).map(|(_, n)| *n).collect()
};

// 3231
if let Some(k) = VIEW_TERMS.iter().position(|v| *v == r) {

// 3279-3284
r if r.starts_with("view(") => {
    Bound::View(VIEW_TERMS.iter().position(|v| *v == r).unwrap_or(0))
}

// 3261
let mut reads = Vec::with_capacity(sop.op.reads.len());
```

**Why it is safe:**
- `nodes_of` is reached only in `bind` when the writer is not `Per::Document` and the reader is (3296-3299), so every key of that operator is `(op, Some(i))` with distinct `i`. The old code sorted `(item, n)` ascending; the map's own order over `(op, Some(i))` is ascending `i`. Same nodes, same order (the order matters: it is the order of writers in keys and tree leaves).
- `binary_search_by` on a sorted, unique `Vec<String>` returns the same index `position` did, or `None` for a name not there.
- `format!("view({v})") == r` holds exactly when `r` is the literal in `VIEW_TERMS` at that index. The const must stay in step with `VIEW_INPUTS`; both are closed lists side by side.

**Gain:** `nodes_of` goes from O(all nodes) to O(log + own nodes) per call: at 10k items roughly 2M map steps → ~20 × 10k. `array_index`: ~300 calls × ~40 string compares → ~300 × 7. View parse: 5–6 allocations per text node per compile → 0. Unmeasured in ms.

**Proof plan:** `schedule/tests.rs` (all), `tests/acceptance/387`, `896`, `854`; the conformance kit's "cached result equals a clean rebuild". Any change in writer order or array index would move content keys, which `a_revision_of_item_values_alone_leaves_what_a_whole_load_leaves` and the kit's key comparisons see. Measure: allocation count and instruction count of one `Session::load` on a 10k-item fixture.

**Risk:** low. ~20 lines.

---

## 3. A hover builds and sorts an owned `Target` for every item, and `hidden()` walks every item with nothing hidden — CONFIRMED

**Where:** `src/scope.rs:599-643` (`hidden`), `273-279` (`Target`), `347-420` (`targets`), `719-724` (`shown_targets`), `840-873` (`hit`), `1058-1065` (hover on `Event::Move`). Driven per input event by `crates/deep-show/src/input.rs:325`.

**What:** every pointer move with no button down calls `hit` → `shown_targets` → `hidden(doc)` + `targets(doc, flat)`. `targets` allocates 3–4 `String`s per item (`id`, `name`, `parent`, `order`), then sorts all of them by `(order, id)`. `hidden` walks every item, doing the `kind` lookup twice and `writer_of` (three map lookups) per item, even when no filter and no isolation is set (the usual state), where its answer is always empty. For 1,000 items that is ~4,000 allocations and an N log N string sort per mouse move on the UI thread. `to_json`, `view_document`, `crates/deep-show/src/input.rs:156` and `access.rs:185` call `hidden` too.

**Change (a), `hidden` early-out:**
```rust
pub fn hidden(&self, doc: &Value) -> Vec<String> {
    let v = &self.view;
    if v.kinds.is_empty() && v.writers.is_empty() && v.isolate.is_none() {
        return Vec::new();
    }
```

**Change (b), `Target` borrows the document:**
```rust
struct Target<'a> {
    id: &'a str,
    name: &'a str,
    parent: Option<&'a str>,
    order: &'a str,
    bounds: Bounds,
}

fn targets(doc: &Value, flat: bool) -> Vec<Target<'_>> {
    …
            let text = |k: &str| member(item, k).and_then(Value::as_str);
            Some(Target {
                id: id.as_str(),
                name: text("name").unwrap_or(id),
                parent: text("parent"),
                order: text("order").unwrap_or_default(),
                bounds,
            })
```
Use sites:
- 719: `fn shown_targets<'d>(&self, doc: &'d Value) -> Vec<Target<'d>>` (the lifetime must be named: elision would tie it to `&self`); 722: `all.retain(|t| hidden.binary_search_by(|h| h.as_str().cmp(t.id)).is_err());`
- 854: `Hit::Item(t.id.to_string())`; 868: `best = Some((depth, t.id.to_string()));`
- 882-883: `.find(|t| t.id == path.last().expect("not empty").as_str()).and_then(|t| t.parent.map(str::to_string))`; 901: `all.iter().find(|t| t.id == step.as_str())`
- 1119: `.map(|t| t.id.to_string())`
- 576 (`t.id == id`) and 1117-1118 compile unchanged (`&str == String`, `starts_with(&String)`).

**Why it is safe:** (a) with both filter lists empty `filtered` is false for every item (`any` over an empty list; `is_some_and` over an empty list), and with `isolate == None` `outside` is false, so the filter keeps nothing: the result was already an empty `Vec`. (b) the fields hold the same text, compared and sorted the same way (`str` order equals `String` order); `hidden` stays sorted (it comes out of a `BTreeSet`), so `binary_search_by` on `as_str()` finds what `binary_search(&String)` found. Nothing outside `scope.rs` names `Target` (it is private).

**Gain:** per hover on N items: 3–4 N allocations → 0, and the `hidden` walk → O(1) in the unfiltered state. The sort stays (a later step could take the max `(order, id)` among boxes under the pointer instead of sorting; not proposed here).

**Proof plan:** the in-file tests `a_click_in_3d_selects_the_nearest_box_under_the_pointer`, `a_double_click_in_3d_flies_to_the_box_and_esc_backs_out`, `a_filter_hides_by_kind_or_writer_and_what_it_hides_cant_be_picked`, `isolation_keeps_an_item_with_its_parents_and_children_and_esc_ends_it_first`, `a_click_in_3d_hits_a_point_or_a_line_within_a_few_px_of_it`, `the_view_document_hides_what_the_view_hides_and_paints_the_lens_and_saves_nothing`; `tests/acceptance/383`. Measure: allocation count of one `Scope::input(Event::Move)`.

**Risk:** (a) low, 4 lines. (b) low to medium (lifetimes; the compiler checks every site), ~20 lines.

---

## 4. `Sealed::kinds()` rebuilds the whole kind registry on every check — CONFIRMED

**Where:** `src/registry/mod.rs:1497-1505` (`Sealed::kinds`), called by `src/document/check.rs:78, 84, 93` (`check_in`, `check_packed`, `check_costed`) and `src/document/packs.rs:253`. `check_in` is also what every incremental recheck ends in (`check.rs:756`), so it runs once per patch (`crates/deep-show/src/shared.rs:931`).

**What:** each call runs `crate::kinds::registry()` (builds the six core entries: versions, params, `json!` defaults) and then clones every module's kind `Entry` (each a `Vec<Version>` of `Vec<Param>` with a `serde_json::Value` default). The sealed set "never changes" after the seal (its own doc comment, 1260), and no code mutates `sealed.modules` after `seal()` (repo-wide grep for `let mut sealed`, `&mut Sealed`, `sealed.<field> =`: none). So every check and every patch recheck rebuilds a value that is constant for the process.

**Change:** compute it once in `seal()` and hand the core a borrow.
```rust
// Sealed (after `outlines`):
    /// The core's kinds plus every kind the sealed modules register: built once at the seal.
    kinds: crate::kinds::Registry,

// seal(), before `Ok(Sealed {`:
        let mut kinds = crate::kinds::registry();
        kinds.extend(modules.iter().flat_map(|m| m.shapes.kinds.iter().map(|k| k.entry.clone())));
// and `kinds,` in the struct literal.

// impl Sealed:
    pub fn kinds(&self) -> crate::kinds::Registry {
        self.kinds.clone()
    }
    /// The same registry, borrowed.
    pub(crate) fn kinds_ref(&self) -> &crate::kinds::Registry {
        &self.kinds
    }
```
`check.rs:78/84/93`: `&sealed.kinds()` → `sealed.kinds_ref()`. `packs.rs:253`: `sealed.kinds_ref().entries()`.

**Why it is safe:** the value is the same one `kinds()` built (same entries, same order: core first, then modules in `modules` order). It is a field, not a static, so the rule in `src/kinds.rs:465-467` (no static a check could carry state through) still holds; `Sealed` is immutable after the seal. `Registry` is `Clone + Debug`, which `Sealed`'s `Debug` derive needs. `kinds()` keeps its signature for the nine callers outside the crate (one stores it: `crates/deep-show/src/kit/fuzz.rs:59`).

**Gain:** one registry build (hundreds to low thousands of allocations in a full build: ~84 kind registrations with their params) removed from every `check_in`, so from every patch recheck and every whole check. Follow-up outside this crate: `crates/deep-show/src/shared.rs:889`, `hub.rs:1729`, `hub.rs:2052` and `shared.rs:178` also call `kinds()` on hot paths and could borrow if `kinds_ref` were made `pub`.

**Proof plan:** `src/registry/mod.rs` tests `kinds_are_one_per_name_with_their_needs_and_draws_as_resolved`, `a_sealed_sets_canonical_form_counts_its_module_kinds_defaults`; `document/mod.rs::the_incremental_recheck_gives_the_full_checks_issues`, `a_big_document_checks_in_chunks_as_one_pass_would`; `tests/acceptance/305`, `306`, `389`. Measure: allocation count of one `recheck_with`.

**Risk:** low. ~15 lines.

---

## 5. `load()` clones an item ID per node and scans array names quadratically — CONFIRMED

**Where:** `src/schedule/mod.rs:1586-1614` (state carry-over), `1615-1619` (array epochs).

**What:** for every node of the new plan, `load` clones the node's item ID into a `String` to look it up (1595), and `parent_of` (1586) clones up to two more IDs per node that has a `parent` read. All three are only compared. Then each array name is found in the old plan by a linear `position` over the old names: A² string compares for A arrays, though both lists are the sorted keys of `sealed.arrays`.

**Change:**
```rust
// replace the closure at 1586-1593 with an inner fn
fn parent_of<'l>(l: &'l Loaded, n: &Node) -> Option<Option<&'l str>> {
    n.reads.iter().find_map(|b| match b {
        Bound::Parent(p) => {
            Some(p.and_then(|p| l.nodes[p].item.map(|i| l.items[i].id.as_str())))
        }
        _ => None,
    })
}
for k in 0..next.nodes.len() {
    let node = &next.nodes[k];
    let id = node.item.map(|i| next.items[i].id.as_str());
    let Some(&was) = carried.get(&(node.op, id)) else {
        continue;
    };
    // A node whose parent read now binds to another item, or to none, as
    // when its parent was deleted, runs again: nothing it reads changed.
    if parent_of(&o, was) != parent_of(&next, node) {
        continue;
    }
    let n = &mut next.nodes[k];
    n.key = was.key;
    // … the eight assignments, unchanged
}
// 1615-1619
for (a, name) in next.array_names.iter().enumerate() {
    if let Ok(k) = o.array_names.binary_search(name) {
        next.array_at[a] = o.array_at[k];
    }
}
```

**Why it is safe:** the same keys are looked up and the same IDs compared, as `&str` instead of `String`. `was` is a `&Node` into `o`, so the shared borrows of `next` end before `&mut next.nodes[k]`. `array_names` is always `sealed.arrays.keys()` (3203), sorted and unique, in both plans, so `binary_search` finds what `position` found.

**Gain:** 1–3 `String` allocations per node per reload removed (nodes = operators × items that apply); A² → A log A compares.

**Proof plan:** `schedule/tests.rs::a_revision_stamps_only_the_classes_its_change_falls_in`, `a_revision_of_item_values_alone_leaves_what_a_whole_load_leaves`, `a_panic_freezes_its_session_alone_until_a_new_revision`; `tests/acceptance/387`, `854`. Measure: allocation count of a second `load` of a 10k-item document.

**Risk:** low. ~20 lines.

---

## 6. Each step clones the stepping arrays' map once per stepper — CONFIRMED

**Where:** `src/schedule/steps.rs:184-190` (`Session::run_steps`).

**What:** at every step time, for every stepping operator, `let current = self.steps.values.clone();` copies a `BTreeMap<String, Val>` (a `String` per key) only to lend it to the operator's `StepCtx`. `Session::call` takes `&self` (`src/schedule/mod.rs:2588`) and returns owned values, so the map can be lent in place.

**Change:**
```rust
let ctx = StepCtx {
    time,
    current: &self.steps.values,
    earlier: &earlier,
};
let (out, err, noted, tails) = self.call(s, *n, Some(ctx), report);
```
and delete the `let current = …;` line.

**Why it is safe:** the clone was taken immediately before the call and read only during it; nothing mutates `self.steps` during `call` (`&self`). The writes (`self.steps.values.insert`, 197) happen after `call` returns and `ctx` is gone, so the next stepper at the same time still sees the earlier stepper's writes, as now. `earlier` stays a snapshot (it must).

**Gain:** per step time, S map clones (S steppers, each clone = one `String` per stepping array plus `Arc` bumps) → 0. Per frame while a logic or physics piece plays.

**Proof plan:** `tests/acceptance/488`, `497` (seek equals play, step order), the test modules' stepping fixtures in `crates/deep-canvas-test-modules/src/time.rs`. Measure: allocation count of one stepping frame.

**Risk:** low. 5 lines.

---

## 7. Per-item nodes pay a `tree_of` map lookup per array read that can never hit — CONFIRMED

**Where:** `src/schedule/mod.rs:2184` (`node_dirty`), `2479-2484` (`key_in`).

**What:** both look `(node, read)` up in `tree_of: BTreeMap<(usize, usize), usize>` for every `Bound::Array`. A tree exists only where a read has more than one writer (3364-3365), and `bind` returns more than one writer only in its `per_doc` branch (3296-3302). So a per-item node never has an entry, yet every per-item node of every visited group pays the lookup (and `key_in` pays `contains_key` then an index).

**Change:**
```rust
// 2184
let many = match n.item {
    None => l.tree_of.get(&(k, r)).and_then(|t| l.trees[*t].array),
    Some(_) => None,
};

// 2479-2482
Bound::Array { contributions, .. }
    if !planted_hash
        && self.hash == HashVersion::V2
        && node.item.is_none()
        && l.tree_of.contains_key(&(n, r)) =>
```

**Why it is safe:** `tree_of.insert` has one site (3365), guarded by `writers.len() > 1`; the three branches of `bind` give ≤ 1, `nodes_of(w)` (only when `per_doc`), ≤ 1. A `Per::Document` operator's node has `item == None` (3141-3144). So for `item == Some(_)` the lookup is always `None`.

**Gain:** one `BTreeMap` lookup per array read per per-item node per visit, on the path a `t`-driven frame takes over every node (10k items × ~3 reads ≈ 30k lookups a frame). Unmeasured.

**Proof plan:** `schedule/tests.rs::frames_that_visit_what_changes_reach_leave_what_whole_loads_leave`, `tests/acceptance/896`. Measure: instruction count of a frame where `t` changed.

**Risk:** low. 5 lines.

---

## 8. Every operator run builds a table map; every `view()` read formats a string — CONFIRMED

**Where:** `src/schedule/mod.rs:2618-2625` (`run_op`), `src/schedule/view.rs:30, 61, 74, 455-459, 496-503`.

**What:** `run_op` builds a fresh `BTreeMap<String, TableValue>` per node run, cloning each table's name and `Arc`, for a `View` that only ever does `.get(name)` after `declared("table:…")` has already refused an undeclared name. `View::view` allocates `format!("view({input})")` per call (`locale()` and `reduced_motion()` go through it).

**Change:**
- `view.rs`: field and parameter `tables: &'a BTreeMap<String, (TableValue, super::Key)>`; in `table()`: `self.tables.get(name).map(|(v, _)| v.clone()).and_then(|v| v.downcast::<T>().ok())…`.
- `mod.rs` `run_op`: delete lines 2618-2625 and pass `&s.tables` to `View::new`.
- `view.rs:455` (with `VIEW_TERMS` from finding 2):
```rust
pub fn view(&mut self, input: &str) -> Result<&'a Value, OpError> {
    let Some(k) = VIEW_INPUTS.iter().position(|v| *v == input) else {
        self.declared(&format!("view({input})"))?;
        return Ok(&self.session.view[0]);
    };
    self.declared(super::VIEW_TERMS[k])?;
    Ok(&self.session.view[k])
}
```

**Why it is safe:** a table reaches the old per-node map only if the node declared it and `s.tables` holds it. `View::table` checks the declaration first, so reading `s.tables` directly returns the same value or the same `table_missing`. `s.tables` is already read through `&Scheduler` on pool threads (`key_in`, 2541), and `tables_of` has built the node's tables before `run_op` (2219, 2245, 2595). For `view`, the declared term, the access-log text and the error's `read` are the same strings; an unknown input keeps today's path (format, then `view[0]`).

**Gain:** per node run with a table read: one map node, one `String` and one `Arc` bump per table → 0; per `view()` call: one `String` → 0. These run per item per frame while text, eases or motion animate.

**Proof plan:** `tests/acceptance/387` (undeclared reads refused and logged), `855`, the access-log assertions in the conformance kit. Measure: allocation count of a frame that runs N text nodes.

**Risk:** low. ~15 lines.

---

## 9. The expression evaluator allocates per evaluation — CONFIRMED (code), PLAUSIBLE (size of gain)

**Where:** `src/expr.rs:1131-1134` (`eval_num`), `1281-1284` (`comps`), `1343-1350` (`Node::Swizzle`), used at `1483-1590`. Callers per sample or per frame: `crates/deep-canvas-marks/src/function.rs:166`, `animator.rs:641`, `crates/deep-canvas-motion/src/program.rs:1110, 2455`, `rows.rs:154`, `occurrence.rs:163`.

**What:** `eval_num` collects its vars into a `Vec<V>` on every call (a path function calls it per sample, a driver per frame). `comps(v)` returns a `Vec<f64>` of at most 4 numbers, so `length`, `distance`, `dot`, `cross`, `angle`, `noise`, `noise3`, `fbm` and `cells` allocate once or twice per evaluation. A swizzle allocates a `Vec` of at most 4.

**Change:**
```rust
pub fn eval_num(&self, vars: &[f64]) -> f64 {
    let mut buf = [V::S(0.0); 8];
    if vars.len() <= buf.len() {
        for (slot, x) in buf.iter_mut().zip(vars) {
            *slot = V::S(*x);
        }
        return self.eval(&buf[..vars.len()]).num();
    }
    let v: Vec<V> = vars.iter().map(|x| V::S(*x)).collect();
    self.eval(&v).num()
}

/// A value's components, on the stack.
struct Comps(u8, [f64; 4]);

impl std::ops::Deref for Comps {
    type Target = [f64];
    fn deref(&self) -> &[f64] {
        &self.1[..self.0 as usize]
    }
}

fn comps(v: V) -> Comps {
    let (n, c) = v.comps();
    Comps(n, c)
}
```
Lines 1483 and 1564 (`flat_map(|v| comps(*v))` needs an owned iterator): `a.iter().flat_map(|v| comps(*v).to_vec())` (these two, `vec(..)` and `hash(..)`, keep their allocation). Swizzle (1348-1349):
```rust
let mut out = [0.0; 4];
for (slot, i) in out.iter_mut().zip(s) {
    *slot = c[*i as usize];
}
vec_of(&out[..s.len().min(4)])
```
(`swizzle()` at 845 admits 1 to 4 letters, so `s.len()` is 1..=4.)

**Why it is safe:** `V` is `Copy`; the slices hold the same numbers in the same order, so every sum runs in the same order and gives the same bits. Every other use of `comps(..)` reads it as a slice (`.iter()`, `.len()`, indexing, `&comps(..)` to a `&[f64]` parameter), which `Deref` serves.

**Gain:** one allocation per `eval_num` call and one or two per vector function per evaluation. A 512-node path function sampled a few thousand times saves that many allocations per rebuild.

**Proof plan:** the 12 in-file tests of `src/expr.rs` (point and interval forms) and the function tests in `crates/deep-canvas-marks/src/function.rs`; I did not map which acceptance suite covers each vector function, so run `node scripts/affected.mjs`. Measure: allocation count of sampling one `fn` path with `noise`.

**Risk:** low. ~30 lines.

---

## 10. `canonical_value` allocates a path vector per number and per member — CONFIRMED

**Where:** `src/canon.rs:435-443` (`width_of`, `default_of`), used by `canonical_at` (259, 288) and `write_value` (366). Callers: `src/schedule/core_ops.rs:113` (`lower`, once per item per revision check, and for **every** item in every probe, which runs clean), `crates/deep-canvas-motion/src/module.rs:71, 385`, `write_member`'s default branch.

**What:** both helpers collect the path into a `Vec<&str>` to call the `Shape`. `canonical_bytes` already avoids this with `with_steps` (106-117), a stack buffer of 16; `canonical_at` does not. With `NoShape` (what `lower` passes) the vector is built and ignored.

**Change:**
```rust
/// Calls `f` with `path` as the `&[&str]` a [`Shape`] reads, on the stack for the usual depth.
fn with_path<R>(path: &[String], f: impl FnOnce(&[&str]) -> R) -> R {
    let mut buf: [&str; 16] = [""; 16];
    if path.len() <= buf.len() {
        for (slot, step) in buf.iter_mut().zip(path) {
            *slot = step;
        }
        f(&buf[..path.len()])
    } else {
        let all: Vec<&str> = path.iter().map(String::as_str).collect();
        f(&all)
    }
}

fn width_of(shape: &dyn Shape, path: &[String]) -> Width {
    with_path(path, |p| shape.width(p))
}

fn default_of<'a>(shape: &'a dyn Shape, path: &[String]) -> Option<&'a Value> {
    with_path(path, |p| shape.default_at(p))
}
```

**Why it is safe:** the shape gets the same slice contents. `default_at` returns a borrow of the shape, not of the path (`write_member` already relies on that at 192).

**Gain:** one allocation per number and one per object member in every `canonical_value` call: for an item with ~10 members and ~12 numbers, ~22 fewer allocations per `lower`.

**Proof plan:** `canon.rs` tests `a_param_equal_to_its_default_is_left_out`, `floats_write_shortest_at_their_width`, `a_number_at_an_f32_field_is_rounded_to_f32_before_whole_or_default_is_decided`, `nested_maps_and_arrays_keep_shape`. Measure: allocation count of `canonical_value` on one item.

**Risk:** low. ~15 lines.

---

## 11. A tree chunk hash copies its keys to the heap first — CONFIRMED

**Where:** `src/schedule/tree.rs:38-41` (`chunk`), reached from `Block::update` (per changed chunk) on every `items_tree.set` (one per patched item) and every `Loaded::refresh` (per changed writer chunk of each document read, per frame).

**What:** `chunk` collects up to 64 keys (1,024 bytes) into a `Vec<u8>` before hashing them.

**Change:**
```rust
fn chunk(keys: &[Key]) -> Key {
    let mut bytes = [0u8; CHUNK * 16];
    for (slot, k) in bytes.chunks_exact_mut(16).zip(keys) {
        slot.copy_from_slice(&k.0);
    }
    Hasher::of(HashVersion::V2, "chunk")
        .bytes(&bytes[..keys.len() * 16])
        .finish()
}
```

**Why it is safe:** callers pass `keys.chunks(CHUNK)` and `c * CHUNK..end` slices, never more than `CHUNK` keys; the hashed bytes are identical, so every root and every `hash@2` key is unchanged.

**Gain:** one 1 KB allocation per chunk hash. (The second allocation, the boxed streaming hasher past `GATHER` = 512 bytes, stays; removing it means changing `Hasher`, not proposed.)

**Proof plan:** `tree.rs::replaced_keys_root_the_tree_as_one_over_every_key_does`, `the_root_commits_to_every_key_and_its_place`, and `tests/acceptance/896`. Measure: allocation count of `KeyTree::set`.

**Risk:** low. 8 lines.

---

## 12. Two hex encoders in the scheduler duplicate `canon`'s — CONFIRMED (KISS)

**Where:** `src/schedule/mod.rs:88-90` (`Key::hex`), `217-222` (`schedule::sha256_hex`); `src/canon.rs:229-242` (`sha256_hex`, `hex`).

**What:** the same two functions exist twice. The scheduler's copies allocate one `String` per byte (`format!("{b:02x}")`); `canon`'s write into one buffer.

**Change:**
```rust
pub fn hex(&self) -> String {
    canon::hex(&self.0)
}
…
pub fn sha256_hex(bytes: &[u8]) -> String {
    canon::sha256_hex(bytes)
}
```
(`canon` is already imported at line 42; `Sha256`/`Digest` stay imported for `Hasher` and `batch`.)

**Why it is safe:** both produce lower-case, two-digit hex of the same bytes. `schedule::sha256_hex` stays exported for its callers in deep-show, deep-marks-render and the module crates.

**Gain:** 16 or 32 short allocations per call → 1; one implementation instead of two. `Key::hex` runs per node in every `eval` reply and `cache_results`.

**Proof plan:** every golden that prints a key or a digest (`tests/acceptance/387`, `855`). 

**Risk:** low. 4 lines.

---

## 13. `revise_items` re-evaluates the per-document `applies` predicates once per patched item — CONFIRMED

**Where:** `src/schedule/mod.rs:1689-1716`.

**What:** inside `for id in ids`, the `Per::Document` arm calls `f(&l.doc, "", &Value::Null) == f(doc, "", &Value::Null)` for every operator with a document-level `applies`. Its arguments do not depend on `id`, so a patch of k items evaluates each predicate 2k times. The full build has five such predicates (`has_motion` ×2, `has_status`, `has_relations`, `has_light`), some of which scan the document.

**Change:** before the `for id in ids` loop (inside the same block, after the envelope loop):
```rust
let docs_alike = ids.is_empty()
    || s.sealed.ops.iter().all(|sop| match (sop.op.applies, sop.op.per) {
        (Some(f), Per::Document) => f(&l.doc, "", &Value::Null) == f(doc, "", &Value::Null),
        _ => true,
    });
if !docs_alike {
    return None;
}
```
and in the loop keep only the per-item arm:
```rust
let applies_alike = s.sealed.ops.iter().all(|sop| match (sop.op.applies, sop.op.per) {
    (Some(f), Per::Item) => f(&l.doc, id, was) == f(doc, id, &value),
    _ => true,
});
```

**Why it is safe:** `applies` is a plain `fn` (`registry/mod.rs:432`), pure over its arguments; every failure in this block returns `None` with nothing mutated yet (mutation starts at `self.bump()`, 1718), so the order of the checks cannot be observed. `ids.is_empty() ||` keeps today's result for an empty list (the predicates were never called).

**Gain:** (k − 1) × 10 predicate calls per k-item patch (a multi-selection drag). Nothing for k = 1.

**Proof plan:** `schedule/tests.rs::a_revision_of_item_values_alone_leaves_what_a_whole_load_leaves`, `crates/deep-show/src/efficiency.rs` tests at 894 and 941, `tests/acceptance/854`.

**Risk:** low. ~12 lines.

---

## Observations (not ready edits; each needs a decision or a larger change)

- **O1, memory: `Steps::checkpoints` has no bound.** `src/schedule/steps.rs:31, 39-49`: a checkpoint of every stepping array is kept every 0.5 s (`src/time.rs:10`) for as long as the session plays, and dropped only by a seek without checkpoints (158). An hour of play holds 7,200 maps, each pinning that instant's values. The design gives physics a "checkpoint ring with a byte budget, whose spacing doubles when it passes the budget" (technical-design.md, Soft body and checkpoint ring); the core's store has neither. Bounding it changes which checkpoint a seek restores from (same result by determinism, more steps), so it is a design call, not a behavior-preserving edit. Related waste: `Session::clean` (`mod.rs:1919-1922`) clones the whole session, checkpoints included, then replaces `steps`, `tails` and `report` with empty ones.
- **O2, CPU: the incremental recheck copies the envelope twice.** `src/document/check.rs:745-756` clones every non-item member into `reduced`, then `check_by` → `copy_of` (117, 351-379) clones them again into `lowered`, which `recheck_by` drops. With a large `data` or `assets` section the patch path costs the envelope's size twice, against "its cost is its ops', never the document's". Removing the first copy needs `check_by` to take the envelope and the item subset separately. PLAUSIBLE; medium risk.
- **O3, CPU: `revise_items` compares every non-item member by deep equality** (`mod.rs:1684-1688`) on each patch. A patch reaches only items (`apply.rs:793-801`), so the caller could say so; that is an API change in deep-show's call.
- **O4, structure: a `Bound` holds owned names per node.** `Bound::Array { name, contributions: Vec<(String, usize)> }`, `Bound::Table(String)`, `Bound::Earlier(String)` (`mod.rs:774-797`, built at 3285-3315) allocate per node per read on every compile and every `Session::clone`, though each equals its operator's read term (`sop.op.reads[r]`) or a sealed contribution name. Indexing the term instead removes O(nodes × reads) allocations per reload; it touches `view.rs`, `key_in`, `plant`, `refresh`. Medium risk; not specified here.
- **O5, the cache has no release on session end.** `Session` has no teardown that releases its `held` keys. No caller drops a live session today (deep-show never removes one), so nothing leaks now.

## Modularity

The crate imports no workspace crate (Cargo.toml: libm, serde_json, sha2, blake3, unicode-normalization), and module code registers through `registry/`. Places where core code names a module's kind:
- `src/schedule/mod.rs:823-832, 872`: `classes_changed` names `text@1` and its eight shaped params to pick `Class::Text`. The design says a kind declares what a change to each param costs; here the core holds the text module's list.
- `src/scope.rs:573, 592`: `point()` branches on `image@1` and `text@1` (marks2d kinds).
- `src/document/check.rs:2374`: `path@1 | vector@1` in a target check.
- `src/steps.rs:100`: `cells@1` in a table.
- `src/registry/mod.rs:143, 177, 686` (`BARE_MODULE_KINDS`, `KNOWN_MODULES`, `MODULE_CHECK_KINDS`): the design-named module lists, by intent.
None is a dependency on a module crate; each is a name the core would have to edit if the module changed. No edit proposed.

A file that mixes lifetimes: `src/schedule/mod.rs` (3,524 lines) holds the process-lifetime cache (`Cache`, `CacheOp`, `apply_deferred`, 626-770), the session-lifetime epochs and logs (`Session`), the revision-lifetime plan (`Loaded`, `compile`, `items_of`, 2947-3479) and the pure hasher (82-241). The cache is the one cohesive piece with its own state and a five-call interface (`get`, `insert`, `hold`, `release`, `apply_deferred`) that could move to `schedule/cache.rs` without passing its owner in. Not proposed as a finding: it changes no cost.

## Dispositions

| Part of `crates/deep-canvas` | Disposition |
|---|---|
| `src/schedule/mod.rs` | findings 1, 2, 5, 7, 8, 12, 13; observations O3, O4, O5 |
| `src/schedule/steps.rs` | finding 6; observation O1 |
| `src/schedule/view.rs` | finding 8 |
| `src/schedule/tree.rs` | finding 11 |
| `src/schedule/bytes.rs`, `core_ops.rs` | keep (read; nothing worth changing) |
| `src/scope.rs` | finding 3 |
| `src/registry/` | finding 4; rest keep |
| `src/document/check.rs` | finding 4 (call sites); observation O2 |
| `src/document/apply.rs` | keep (cost is per op; `packs::resolve` is per pack entry) |
| `src/document/packs.rs` | finding 4 (one call site); rest not audited in depth |
| `src/document/` others (`merge`, `rules`, `rows`, `shape`, `transform`, `order`, `close`, `requires`) | not audited in depth: off the frame and patch hot path |
| `src/canon.rs` | finding 10 |
| `src/expr.rs` | finding 9 |
| `src/kinds.rs` | keep (rebuilt per call by a stated lint rule; finding 4 caches the sealed copy as a field) |
| `src/session.rs`, `camera.rs`, `draw.rs`, `render.rs`, `show.rs`, `steps.rs`, `interval.rs`, `ease.rs`, `cost.rs`, `budget.rs`, `color.rs`, `blend.rs`, `table.rs`, `columns.rs`, `outline.rs`, `template.rs`, `time.rs`, `grammar/`, `base64.rs`, `ops.rs`, `main.rs` | not audited in depth: CLI proof surfaces and pure math off the per-frame path |

Not verified: no build, test or measurement was run, so every gain is a count from reading, and every edit still needs the compiler (the lifetime edits in findings 3 and 5 most of all).
