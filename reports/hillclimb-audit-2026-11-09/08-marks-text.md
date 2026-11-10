# 08 — 2D marks and text

Area: `crates/deep-canvas-marks`, `deep-marks-render`, `deep-marks-vello`, `deep-marks-gpui`, `deep-text`, `deep-text-gpui`, `deep-text-render`. Read-only; nothing was compiled or run, so every "Change" below is unverified by the compiler. Paths are relative to the worktree root. Line numbers are at 6a6d6b4f.

How the hot path runs (needed to read the findings): the live draw list is the `frame` operator in `crates/deep-canvas-marks/src/modules.rs:1903`. It is document-scoped and reruns whenever anything it reads changed. It has a fast path (`replaced`, `modules.rs:1802`, #896) only when the last list was built entirely from per-item nodes (`items.is_empty()` at `modules.rs:2004`); per-item nodes exist only for parentless `rect@1 | circle@1 | path@1 | text@1` painted by role (`scene::item_placed`, `scene.rs:5338`). Any other document (a frame, a group child, a mark set, a star, a gradient) runs `scene::build` (`scene.rs:5438`) over every non-prebuilt item each time the operator runs. So "per full build" below means "per changed frame" for most real documents.

Ranked by gain over risk.

---

## F1 — `text_at` deep-clones the whole document for every template text — CONFIRMED

**Where**: `crates/deep-canvas-marks/src/scene.rs:3135` (clone), `:3154` (wrap), `:3161` (only use). Reader: `crates/deep-canvas/src/template.rs:75-95` (`value`).

**What**: for an item with `params.template`, `text_at` does `let mut at_t = doc.clone();` (the whole document map: every item, clip, and every mark set's inline base64 column), overlays `data/<name>` values, wraps it in a `Value` and passes it to `template::value(&at_t, slot)`. `template::value` reads only `doc["data"][name]` (`template.rs:76-77`). Callers: the `counter` operator per template item whenever its fields, a reading or the locale change (`modules.rs:411-427`; a keyed data value riding on the item changes its fields every frame), the `frame` operator for anchor-reading items (`modules.rs:1989-1995`), and `scene::bound_texts` for every template item on every `scene::frame`/`frame_planted` call (`scene.rs:4133`; deep-show snapshots, deep-gpu-layer film/flat, deep-marks-render). Cost is O(template items × document bytes) per frame.

**Change** (replace `scene.rs:3135-3154`):
```rust
// Only `data` is read (deep_canvas::template::value).
let mut data = doc.get("data").cloned();
if let Some(values) = item.pointer("/params/data").and_then(Value::as_object) {
    for (name, x) in values {
        let entry = data
            .get_or_insert_with(|| json!({}))
            .as_object_mut()
            .and_then(|d| d.get_mut(name));
        match entry {
            Some(Value::Object(e)) => {
                e.insert("value".into(), x.clone());
            }
            Some(e) => *e = x.clone(),
            None => {}
        }
    }
}
let path = format!("items/{id}/params/template");
let mut text = String::new();
let mut at_t = Map::new();
if let Some(d) = data {
    at_t.insert("data".into(), d);
}
let at_t = Value::Object(at_t);
```
The loop below it (`template::parts` … `template::value(&at_t, slot)`) stays as is.

**Why it is safe**: `at_t` has exactly one reader, `template::value`, which does `doc.get("data")?.get(name)?` and nothing else. The overlay logic is unchanged: `data` is created as `{}` only inside the loop (as `entry("data").or_insert_with` did), a non-object `data` yields `None` from `as_object_mut` in both versions, a missing name is skipped in both. `anchor_of(items, slot)` reads `items`, not `at_t`. Error paths (`ref_unresolved`) are untouched.

**Gain**: per template item per evaluation, a clone of `doc["data"]` instead of the whole document. For a board with mark-set columns inline this is megabytes to bytes; with K animated template texts it removes K whole-document clones per frame. Unmeasured.

**Proof plan**: `tests/acceptance/381/template.test.ts` and `crates/deep-canvas-marks/src/scene.rs` test `a_counter_formats_its_bound_value_s_reading_with_tabular_figures` pin the text; `story.rs:774` test path calls `bound_text`. Measure by allocation bytes around `scene::bound_text` on a fixture with one template and a 100k-row mark set (bytes allocated should stop scaling with the set).

**Risk**: low. ~15 lines.

---

## F2 — `build_path` hashes and copies every shape's outline for a report the draw path never reads — CONFIRMED

**Where**: `crates/deep-canvas-marks/src/scene.rs:1921-1950` (segments, SHA-256 digest, `placed`), struct fields `:1834`, `:1840`, `:1844`; draw-path callers `:4707`, `:4765`, `:4778`, `:4804`, each followed by `Paints::shapes` (`:1673-1732`); the only reader of those three fields is `path_report` (`:2541-2547`), whose one external caller is `crates/deep-marks-render/src/raster.rs:1711`.

**What**: every star, arc, non-R1 rect/circle and every R2 path goes through `build_path` on each build. It computes `segments`, a SHA-256 `digest` over every point of every copy (via `verb_points`, one `Vec` allocation per verb, `:1926`), and `placed` (a clone plus transform of every copy's verbs, `:1947-1950`). `shapes` reads only `copies`, `below`, `widths`, `alphas` and `ends`, and re-does the place transform itself in `shape_with` (`:1800`). So per shape per build: one full-outline hash, one allocation per verb and one outline copy are thrown away. The mark's own key hashes the same verbs again later (`Mark::feed`, `:1105-1117`), so this roughly doubles the hashing per shape.

**Change**:
1. Remove `placed`, `segments` and `digest` from `PathBuilt` (`:1832-1849`) and their computation from `build_path` (`:1921-1950`; keep `stroke_width`, which `ends::build` uses at `:1916`).
2. Add a private helper used only by `path_report`:
```rust
/// What the `path` surface reports beyond what the marks draw from: each copy where it draws,
/// the segments built, and the tessellation's key.
fn reported(
    built: &PathBuilt,
    paint: &Map<String, Value>,
    place: Place,
) -> (Vec<Vec<Verb>>, u64, ContentKey) {
    let segments = built.copies.iter().map(|c| pathops::segments(&c.verbs)).sum();
    let stroke_width = paint.get("stroke").and_then(|s| num(s.get("width"))).unwrap_or(1.0);
    let mut k = KeyBuilder::new("tessellate@marks2d.160");
    for c in &built.copies {
        k.int(c.verbs.len() as i64).number(c.opacity);
        for v in &c.verbs {
            for p in verb_points(v) {
                k.number(p[0]).number(p[1]);
            }
        }
    }
    for (_, h) in &built.ends {
        k.text(h.kind).number(h.tip[0]).number(h.tip[1]).number(h.length).number(h.width);
    }
    k.number(stroke_width);
    for field in ["taper", "wave"] {
        let v = paint.get("stroke").and_then(|s| s.get(field));
        k.text(&v.map_or(String::new(), Value::to_string));
    }
    for (s, w) in built.widths.iter().chain(&built.alphas) {
        k.number(*s).number(*w);
    }
    let placed = built.copies.iter().map(|c| place.verbs(c.verbs.clone())).collect();
    (placed, segments, k.finish())
}
```
3. In `path_report` (`:2507-2549`): `let (placed, segments, digest) = reported(&built, paint, place);` and fill `PathReport { placed, segments, declared: built.declared, digest, built: Some(built), .. }`.

**Why it is safe**: the feed order and operator tag are copied verbatim, `built.ends` is the same vector the digest iterated as `heads` (`:1952`), and `copies` is already in copy order when the digest read it (`:1908`). A repo-wide grep finds no reader of `PathBuilt.placed/.segments/.digest` outside `scene.rs`; `raster.rs:1730` reads only `report.built…lag`, and `raster.rs:1715-1726` reads `PathReport.digest/.segments/.declared`, which keep their values. `PathBuilt` is `pub`, so this removes three public fields nothing uses. The segment-budget refusal (`:1865-1868`) uses `declared`, which stays.

**Gain**: per non-R1 shape per build: one SHA-256 pass over 32 bytes a point, one `Vec` allocation a verb, one outline clone. For an imported SVG of 500 paths × 50 verbs that is ~25,000 allocations and ~800 KB of hashing per build. Unmeasured.

**Proof plan**: `tests/acceptance/160/*.test.ts` (the `path` surface's `tessellation`, `segments`, `declared`; `budgets.test.ts` reads the digest) and `scene.rs` tests `a_path_draws_at_most_10_000_dashes`, `a_gradient_spans_another_item_s_box_and_runs_along_strokes_alone`. Count allocations in one `scene::frame` of a board of 1,000 stars before and after.

**Risk**: low. ~45 lines moved, 3 fields removed.

---

## F3 — `columns` measures every segment's arc length when the item has no per-point column — CONFIRMED

**Where**: `crates/deep-canvas-marks/src/scene.rs:2060-2079`; called once per shape from `build_path` (`:1863`). Cost sites: `anchors_of` (`:1966`), `anchor_lengths` (`:2014`) → `pathops::subs_of` (`pathops.rs:407`) and `Seg::length` (`pathops.rs:212-228`: for a curve, a `turns()` `Vec` plus Gauss–Legendre quadrature per piece).

**What**: `columns` builds the anchor list and each anchor's arc length before it looks at `params.width`/`params.opacity`. When neither exists (the common case: every star, arc, rounded rect, plain path) both `read` calls return `Vec::new()` and the lengths are discarded.

**Change** (insert at the top of `columns`, `:2066`):
```rust
let present = |name: &str| params.get(name).is_some_and(|v| !v.is_null());
if !present("width") && !present("opacity") && ctx.planted != Planted::MergeZeroFills {
    return Ok((Vec::new(), Vec::new()));
}
```

**Why it is safe**: with a column absent or `null`, `column_values` returns `Ok(None)` before it can refuse anything (`:1985-1986`), and `read` then returns `Ok(Vec::new())` unless the planted program is `MergeZeroFills` (`:2071-2074`). `joined_under` is pure, so skipping it changes nothing. The planted twin keeps the old path. `Planted` derives `PartialEq` (`:4082`).

**Gain**: per shape per build: no `subs_of` allocations and no quadrature. A circle is four cubics, so four `turns()` vectors and at least four quadratures saved; a 200-curve path saves 200 of each. Also skips two O(items) sibling scans for children of outlined groups. Unmeasured.

**Proof plan**: `tests/acceptance/160` (`anchors.test.ts`, columns and `column_length`), `scene.rs` tests around steps and gradients. Instruction or allocation count for `scene::frame` on the marks fixture with circles (`modules.rs:2034` `marks_board` plus a stroked circle).

**Risk**: low. 4 lines.

---

## F4 — deep-text-gpui's per-frame run set is never cleared in the apps: unbounded growth, and a key clone on every label — CONFIRMED

**Where**: `crates/deep-text-gpui/src/lib.rs:401` (`frame: HashSet<ShapeKey>`), `:428-431` (`self.frame.insert(key.clone())` on every `shape`), `:599-607` (`begin_frame`, `frame_runs`). Only caller of either: `crates/deep-text-render/src/main.rs:257` and `:464`.

**What**: `Text::shape` inserts a clone of the label's `ShapeKey` (its text `String`, fallback list and language) into `frame` on every call. Only `begin_frame()` clears it and only the proof binary calls that. In deep-app (`src/text.rs:38-42`, `src/cells.rs:186-213` — every terminal grid row's text, `src/show.rs`) and deep-show (`src/window.rs`, `src/live.rs`) the thread-local set keeps every distinct label text ever shaped for the life of the process. The neighbouring `shaped` map is bounded (4,096, `:434`); this set is not. It also costs one text allocation per `shape` call, and `place` runs twice a frame per label (`prepare_at` then `paint_runs`).

**Change**: make the set opt-in, as `new_glyphs` already is (`:406`, `:554`):
```rust
// field
frame: Option<HashSet<ShapeKey>>,          // None until begin_frame is first called
// Text::new
frame: None,
// Text::shape, replacing `self.frame.insert(key.clone());`
if let Some(frame) = &mut self.frame {
    if !frame.contains(&key) {
        frame.insert(key.clone());
    }
}
// begin_frame
TEXT.with(|text| match &mut text.borrow_mut().frame {
    Some(frame) => frame.clear(),
    slot => *slot = Some(HashSet::new()),
});
// frame_runs
TEXT.with(|text| text.borrow().frame.as_ref().map_or(0, HashSet::len))
```

**Why it is safe**: `frame_runs` is read only at `deep-text-render/src/main.rs:464`, after two `render_frame` calls whose paint closure calls `begin_frame()` first (`main.rs:257`), so the count it reads is unchanged. No other crate reads the set. The one observable difference: `frame_runs()` called before any `begin_frame()` returns 0 instead of the count since process start; no caller does that.

**Gain**: removes an unbounded per-process set (one `String` per distinct label; a scrolling terminal grid adds one per new row) and one allocation per label per `place` in the apps. Unmeasured.

**Proof plan**: `crates/deep-text-render/tests/frame.rs` and `tests/acceptance/390` (run counts in the report) pin the proof surface. For the leak: resident bytes of deep-app after painting N distinct cell rows should stop growing with N.

**Risk**: low. ~12 lines.

---

## F5 — auto layout serializes every item into a throwaway JSON document before solving — CONFIRMED

**Where**: `crates/deep-canvas-marks/src/scene.rs:3934-3936` (`json!({"items": items, "bound_values": …})` then `layout::solve(&input, …)`), `crates/deep-canvas-marks/src/layout.rs:161-193` (`Doc::new`), `:643-646` (`solve`). Same pattern: `crates/deep-marks-render/src/graphs.rs:137-139`.

**What**: `laid_out` runs in every `scene::build` (`:5449`), in `relations_op` (`modules.rs:1702`), `item_boxes` and `laid_out_boxes`. When any frame lays out, it deep-copies all items into a new `Value` only so `layout::solve` can read `doc["items"]` and `doc["bound_values"]` back out; `Doc` only borrows them. Then `items.clone()` at `:3941` copies them a second time for the result.

**Change** (`layout.rs`):
```rust
impl<'a> Doc<'a> {
    fn new(items: &'a Map<String, Value>, bound_values: Option<&'a Value>) -> Self {
        // body as today, with `items` given and `bound_values.and_then(Value::as_object)`
        // in place of `doc.get("bound_values").and_then(Value::as_object)`; returns `Doc`, not `Option`
    }
}

pub fn solve(doc: &Value, shaper: &mut Shaper) -> Result<BTreeMap<String, Rect4>, Refusal> {
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return refuse("bad_input", "");
    };
    solve_items(items, doc.get("bound_values"), shaper)
}

/// [`solve`] over items and bound values a caller already holds apart.
pub fn solve_items(
    items: &Map<String, Value>,
    bound_values: Option<&Value>,
    shaper: &mut Shaper,
) -> Result<BTreeMap<String, Rect4>, Refusal> {
    let doc = Doc::new(items, bound_values);
    // the rest of today's `solve` body
}
```
`scene.rs:3934-3936` becomes `crate::layout::solve_items(items, doc.get("bound_values"), &mut s.borrow_mut())`; `graphs.rs:137-139` the same with `deep_canvas_marks::layout::solve_items(items, doc.get("bound_values"), …)`.

**Why it is safe**: `Doc::new` reads exactly those two members. A missing `bound_values` was serialized as `null` and then failed `as_object`; `None` gives the same empty set. `solve(doc)` keeps its `bad_input` refusal for a document with no `items` object, so `deep-layout solve` (`src/main.rs`), `deep-motion/src/main.rs:32` and the layout tests are unchanged. Two callers need the new entry today (scene, graphs).

**Gain**: one full deep copy of all items removed per `laid_out` call, so per build for any document with an auto-layout frame. Proportional to document size. Unmeasured.

**Proof plan**: `layout.rs` tests (`:690-812`), `tests/acceptance/375`, `tests/acceptance/1162`. Allocation bytes for one `scene::frame` on `tests/acceptance/375/fixtures` should drop by about the serialized size of the items.

**Risk**: low. ~20 lines.

---

## F6 — `build` clones the item's `Rank` and allocates its ID once per mark — CONFIRMED

**Where**: `crates/deep-canvas-marks/src/scene.rs:3438` (`type Ordered`), `:5604-5622` (push loop), `:5631-5644` (places).

**What**: for each mark, `slot.2.push((placed.rank.clone(), …))` clones a `Rank` (`Vec<(u8, String, String)>`: one vector and two strings per tree level), and `places.entry(m.2.to_string())` allocates the item's ID even when the entry exists. A mark set of N rows costs N × (1 + 2·depth) + N allocations per build only to sort and count. `placed.rank.after_children()` (`:5613`) also allocates for every item, though almost none has `after` marks.

**Change**:
```rust
// :3438
type Ordered<'a> = (Cow<'a, Rank>, usize, &'a str, &'a Arc<Drawn>, ContentKey);
// :5611
slot.2.push((Cow::Borrowed(&placed.rank), k, id, drawn, key));
// :5613-5622
if !placed.after.is_empty() {
    let later = placed.rank.after_children();
    for (k, drawn) in placed.after.iter().enumerate() {
        slot.2.push((
            Cow::Owned(later.clone()),
            placed.drawn.len() + k,
            id,
            drawn,
            drawn.key(bucket),
        ));
    }
}
// :5634-5636
if !places.contains_key(m.2) {
    places.insert(m.2.to_string(), (li as u32, k as u32, 0));
}
let e = places.get_mut(m.2).expect("inserted above");
```
The sort comparator (`:5631`) is unchanged: `Cow<Rank>` orders as `Rank`.

**Why it is safe**: `&placed.rank` has the same provenance and lifetime as the `&Arc<Drawn>` the tuple already borrows from `placed.drawn`. `Ord for Cow<B>` delegates to `B`, so order and stability are identical. The `places` rewrite keeps the same first-insert value and the same adjacency test. `Cow` is already imported (`:21`).

**Gain**: for a 10,000-row mark set at depth 2: ~60,000 fewer allocations per build; for every item, one fewer `Rank` clone. Unmeasured.

**Proof plan**: `scene.rs` test `marks_draw_by_z_then_by_the_tree_not_by_flat_order_keys`, `crates/deep-show/src/efficiency.rs:913` `a_replaced_draw_list_is_the_list_a_whole_build_gives`, `tests/acceptance/896`. Allocation count of `scene::frame` on `data.rs`'s point-set fixture.

**Risk**: low. ~15 lines.

---

## F7 — mark sets and series: per-row strings that only an error path reads, and path data printed then parsed back — CONFIRMED (a, b, c); (d) is the riskier part

**Where**: `crates/deep-canvas-marks/src/data.rs`.
- (a) `:1114-1117`: `color_of` formats `rpath` (and `{path}/roles`) for every row; both are read only by refusals.
- (b) `:984`: a bound cell's row is found by `(0..n).find(|&i| k.text(i).as_deref() == Some(key))`; `Column::text` clones a `String` per row tested (`:53-60`), so B bound cells × n rows allocations per build.
- (c) `:1294-1300`, `:1306`, `:1344`, `:1590`, `:1592`: `d.push_str(&format!(…))` allocates a temporary per point.
- (d) `:1315` and `:1599`: the string just written is parsed back with `path::parse` to get the verbs.

**Change**:
- (a) before the closure: `let rpath = format!("{path}/encode/role"); let roles_path = format!("{path}/roles");` and use `&rpath` / `&roles_path` inside.
- (b)
```rust
.and_then(|k| match k {
    Column::Texts(v) => v.iter().position(|t| t == key),
    _ => (0..n).find(|&i| k.text(i).as_deref() == Some(key.as_str())),
});
```
- (c) `use std::fmt::Write as _;` and `let _ = write!(d, "{} {} {} ", …);` at each site (same bytes).
- (d) build the verbs beside the string and skip the parse when every coordinate is finite. For the mark-set line (`:1292-1322`, not dashed): `Move(line[0])`, `Line(line[k])…`, and for an area `Line([last[0], base])`, `Line([first[0], base])`, `Close`; keep `path::parse(&d).unwrap_or_default()` for the dashed string and use `Vec::new()` when any coordinate is not finite. For `series` (`:1577-1606`): per column `Move([px, py]), Line([cx, y(first)])` when `previous` is set, then `Move([cx, y(max)]), Line([cx, y(min)])`; `Vec::new()` when any is not finite.

**Why it is safe**: (a) the strings are identical, only built once. (b) `column_of` guarantees a text column has exactly `n` values (`:91`), so `position` finds the same first index; other column kinds keep the old code. (c) `write!` into a `String` produces the same text as `format!`. (d) `path::parse` reads numbers with `str::parse::<f64>` (`path.rs:137-140`) and Rust's `{}` for `f64` round-trips exactly, so parsed verbs equal the pushed points bit for bit; a non-finite value prints as `NaN`/`inf`, which `parse` rejects whole (`path.rs:83`, `:139`), giving the empty default that `Vec::new()` reproduces. The `d` string still goes into the mark unchanged, so every key is unchanged.

**Gain**: (a) n allocations per build per set; (b) B × n allocations; (c) one allocation per point; (d) 2n decimal parses for a line of n points (a 10,000-point line: 20,000 parses). Unmeasured.

**Proof plan**: `data.rs` tests `a_mark_set_draws_a_point_per_row_through_its_scale`, `a_bound_cell_draws_its_reading_and_a_row_without_one_is_left_out`; `tests/acceptance/399` (series geometry and decimation), `tests/acceptance/397`, `tests/acceptance/505`. For (d), compare `Mark::Path.geometry.verbs` against `path::parse(&d)` on the existing fixtures once before removing the parse.

**Risk**: (a–c) low, ~12 lines; (d) medium, ~25 lines. Apply (d) separately.

---

## F8 — the draw list's text maps are deep-copied on the fast path and by every reader — CONFIRMED (compile unverified across two crates)

**Where**: `crates/deep-canvas-marks/src/modules.rs:1320-1321` (`Drawing.runs`, `.animated`), `:1875-1876` (`replaced` clones both), `:2023-2030` (construction); `crates/deep-show/src/frames.rs:1084-1085`, `:1095-1096`; `crates/deep-show/src/snapshot.rs:51-53`, `:90-91`, `:136-137`, `:407-408`, `:431-432`, `:441-442`.

**What**: `Drawing.runs` is a `BTreeMap<String, Arc<Run>>` and `.animated` a `BTreeMap<String, Vec<[f64; 2]>>`. The #896 fast path, which exists so a one-item change costs O(1), copies both whole (one `String` per text item, one `Vec` per animated text) because "no text's run changed". deep-show copies them again per `drawing_of` and per `prepare_drawing`.

**Change**: hold both behind `Arc`.
```rust
pub runs: Arc<BTreeMap<String, Arc<Run>>>,
pub animated: Arc<BTreeMap<String, Vec<[f64; 2]>>>,
```
`modules.rs:2025-2026`: `runs: Arc::new(runs), animated: Arc::new(animated)`. `modules.rs:1875-1876` and `frames.rs` keep `.clone()` (now a reference count). In `snapshot.rs`, give `Drawn.runs/.animated` the same `Arc<…>` types and write `Arc::default()` at `:407-408` and `:431-432`; `.get(item)` at `:102-103` and `:689-690` works through `Deref`.

**Why it is safe**: `Canonical for Arc<T>` forwards to `T` (`crates/deep-canvas/src/schedule/bytes.rs:102-106`), so `Drawing`'s canonical bytes (`modules.rs:1360-1364`) are identical. No site mutates either map after construction (grep of `.runs`/`.animated` over deep-show, deep-gpu-layer, deep-app, deep-marks-render). deep-gpu-layer's `Drawing` (`live.rs:2040`) is a different type.

**Gain**: per replaced frame: T string allocations and A vector copies become two atomic increments; the same per `drawing_of` and `prepare_drawing`. Unmeasured.

**Proof plan**: `crates/deep-show/src/efficiency.rs:913` and `:951-953`, `tests/acceptance/896`, `tests/acceptance/857`. Allocation count of one replaced frame on a board with 200 labels.

**Risk**: low. ~10 lines in two crates.

---

## F9 — a paint that spans boxes makes the `frame` operator build the whole list three times — PLAUSIBLE

**Where**: `crates/deep-canvas-marks/src/modules.rs:1996-2016`; `crates/deep-canvas-marks/src/scene.rs:5394-5414` (`frame_prebuilt` drops its frame when `wants_boxes`), `:4168-4201` (`frame_shown`: first pass, `boxes_of`, second pass).

**What**: when any paint asks for another item's box (a gradient `span`, steps by position, an `attach`), `frame_prebuilt` runs a full `build`, discards the frame and returns `None`; the operator then calls `frame_with`, whose first pass is another full `build` with no boxes (it must report `wants_boxes` again), then the second pass with boxes. Three builds where two are needed.

**Change**: return the first pass instead of dropping it, and add the second pass as its own entry.
```rust
// scene.rs
pub fn frame_prebuilt(…) -> Result<Result<(Frame, Places), Frame>, Refused> {
    …
    Ok(if wants_boxes { Err(frame) } else { Ok((frame, places)) })
}

/// [`frame_with`]'s second pass alone: the frame drawn with the boxes of `first`, a first pass
/// over the same items.
pub fn frame_boxed(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    palette: &Palette,
    zoom: f64,
    bound: &BTreeMap<String, Shown>,
    record: &Record,
    first: &Frame,
) -> Result<Frame, Refused> {
    let row_readings = bound_rows(doc, record);
    let boxes = boxes_of(first, items);
    Ok(build(doc, (items, &[]), (palette, &Type::default()), (bound, &row_readings), zoom,
             Planted::None, Some(&boxes))?.0)
}
```
`modules.rs:2007-2015`: `Err(first) => { let all = …; (scene::frame_boxed(doc, &all, &look.palette, 1.0, &bound, &record, &first).map_err(refused)?, None) }`.

**Why it should be safe, and what I could not check**: `boxes_of` reads only each mark's geometry (`scene.rs:2585-2600`) and each item's parent chain from `all`. The first pass from `frame_prebuilt` holds the same marks as `frame_with`'s first pass provided a prebuilt item's marks equal the marks the frame would build for it; the module already depends on that (`modules.rs:1798-1801`, `:1918-1919`). I read `item_placed` and found nothing that breaks it for a parentless R1 item, but I could not run the suites that pin it. Check needed: `tests/acceptance/857`, `tests/acceptance/374` (gradient span), `tests/acceptance/160` (attach), and `scene.rs` test `a_gradient_spans_another_item_s_box_and_runs_along_strokes_alone`.

**Gain**: one of three full builds removed per frame for documents with a spanning paint. Those documents never get the fast path, so this is a third of their `frame` operator time. Unmeasured.

**Risk**: medium. ~25 lines, one changed public signature (`frame_prebuilt`, one caller).

---

## F10 — whole-document clones to read one member (cold paths) — CONFIRMED

**Where**: `crates/deep-canvas-marks/src/animator.rs:1046` (`held_keys`) and `:1074` (`roll_at`): `Value::Object(doc.clone())` only to call `deep_canvas::document::duration`, which reads `transport` alone (`crates/deep-canvas/src/document/check.rs:2258-2264`). `crates/deep-canvas-marks/src/check.rs:111` and `:145`: `Value::Object(doc.clone())` per template text item, passed only to `story_issues`/`story_numbers`, which read `doc["data"]` alone (`crates/deep-canvas/src/document/rules.rs:312-313`, `template.rs:58-70`).

**What**: `roll_at` runs per rolling counter per `animator::lay_out`, whose one caller is the CPU `raster` painter (`crates/deep-marks-render/src/raster.rs:637`); a roll makes two whole-document copies per text per raster. `check::numbers` (`deep-show/src/verdict.rs:581`, `check.rs:444`) makes one or two per template item per check.

**Change**:
- `animator.rs:1046` and `:1074`: `let wrap = json!({"transport": doc.get("transport")});` (resp. `input.doc.get("transport")`), the form `scene.rs:3178` already uses for the same call.
- `check.rs`: before the item loop at `:87`, `let data = match doc.get("data") { Some(d) => json!({"data": d}), None => json!({}) };` and pass `&data` to `story_issues` at `:115` and to `text_numbers` (give it a `data: &Value` parameter for the `story_numbers` call at `:146`, in place of its own clone at `:145`).

**Why it is safe**: `duration` reads `member(doc, "transport")` only; an absent transport becomes `null`, for which `frame_rate_of` returns `None` exactly as for a missing member (`check.rs:2201-2211`). `story_numbers` reads only `data` through `template::value`. `text_numbers` keeps using the full `doc` for `items`.

**Gain**: document-sized copies removed: 2 per rolling counter per raster, 1–2 per template item per check (the check becomes linear in the document instead of items × document). Unmeasured.

**Proof plan**: `tests/acceptance/496/counter-roll.test.ts`, `animator.rs` tests (`:1594-1620`), `story.rs:782` test, `tests/acceptance/406`.

**Risk**: low. ~10 lines.

---

## F11 — `Scope::feed` allocates per verb and clones pass params to print them — CONFIRMED

**Where**: `crates/deep-canvas-marks/src/scene.rs:513-517` (`verb_points(v)` returns a `Vec` per verb) and `:483` (`Value::Object(p.params.clone()).to_string()`).

**What**: every mark inside a cover or a path-shaped mask feeds the scope's whole outline into its key, allocating a vector per verb; every mark under an effect group deep-clones each pass's params to serialize them. Both run per mark per key.

**Change**:
```rust
// :513-517, the form Mark::feed already uses at :1106-1112
for v in verbs.iter() {
    let points: &[[f64; 2]] = match v {
        Verb::Move(p) | Verb::Line(p) => std::slice::from_ref(p),
        Verb::Quad(a, b) => &[*a, *b],
        Verb::Cubic(a, b, c) => &[*a, *b, *c],
        Verb::Close => &[],
    };
    points.iter().for_each(|p| {
        k.number(p[0]).number(p[1]);
    });
}
// :483
k.text(&serde_json::to_string(&p.params).unwrap_or_default());
```

**Why it is safe**: the same numbers are fed in the same order. `Value`'s `Display` is compact serialization of the same map, so the text is identical (it cannot fail for a `Map<String, Value>`).

**Gain**: per mark in such a scope: V allocations (V = scope verbs) and one params clone per pass. A 20-sector cover with 200 verbs: 4,000 allocations per build. Unmeasured.

**Proof plan**: `tests/acceptance/385` (cover), `tests/acceptance/1175` (clip path), `scene.rs` mask tests (`:5782`, `:5805`); layer keys in `tests/acceptance/896` must not move.

**Risk**: low. ~12 lines.

---

## F12 — `Shaper::shape` builds the cache key twice for a text that fits — CONFIRMED

**Where**: `crates/deep-text/src/shape.rs:260-267` (`run`), `:286-291` (`shape`), `:336`; `crates/deep-text/src/cache.rs:39-54` (`Key::of`: boxes the text and runs `font_hash`).

**What**: `shape` builds the `fitted` key, misses (a text that fits is never stored under `fitted`), then `run` builds the same key with `fitted: false`: a second text allocation and a second font hash on every call, including every auto-layout leaf measure per build (`layout.rs:434`).

**Change**:
```rust
// cache.rs, impl Key
pub(crate) fn whole(mut self) -> Key {
    self.fitted = false;
    self
}
// shape.rs
fn run(&mut self, spec: &Spec<'_>, text: &str) -> Arc<Shaped> {
    self.run_by(spec, text, Key::of(spec, text, false))
}
fn run_by(&mut self, spec: &Spec<'_>, text: &str, key: Key) -> Arc<Shaped> {
    if let Some(run) = cache::get(&key) {
        return run;
    }
    let run = self.shape_now(spec, text, &key);
    cache::put(key, run)
}
pub fn shape(&mut self, spec: &Spec<'_>) -> Arc<Shaped> {
    let fitted = Key::of(spec, spec.text, true);
    if let Some(run) = cache::get(&fitted) {
        return run;
    }
    let whole = self.run_by(spec, spec.text, fitted.whole());
    …
    cache::put(Key::of(spec, spec.text, true), best)   // :336, the overflow path only
}
```

**Why it is safe**: the two keys differ only in `fitted`; every other field, including the thread's `SCOPE`, is read at the same moment. The number and order of `cache::get`/`put` calls is unchanged, so LRU ticks, the planted programs and the shaping log (`cache.rs:218`) behave as before.

**Gain**: one allocation and one SipHash pass over the family names and face table per `shape` call on a warm cache. Small per call; it is paid per text leaf per build under auto layout. Unmeasured.

**Proof plan**: `crates/deep-text/tests/shape.rs`, `tests/acceptance/856/ac1–ac3.test.ts` (shaping counts and eviction order).

**Risk**: low. ~15 lines.

---

## F13 — GPUI paths are grown by push on every paint — CONFIRMED

**Where**: `crates/deep-marks-gpui/src/lib.rs:31-35` (`paint`), `:172-178` (`paint_strip`); `crates/deep-text-gpui/src/lib.rs:795-801` (a large glyph's path). `vendor/gpui-pre/src/scene.rs:827` (`pub vertices: Vec<PathVertex<P>>`), `:840` (`Vec::new()`), `:929-943` (three pushes a triangle).

**What**: each paint builds a fresh `Path` and pushes three vertices per triangle, so the vector reallocates and copies about log2(3n) times per path per frame.

**Change**: after `Path::new(…)` add
```rust
path.vertices.reserve(mesh.indices.len());          // paint
path.vertices.reserve(strip.corners.len());         // paint_strip
path.vertices.reserve(triangles.len() * 3);         // deep-text-gpui
```

**Why it is safe**: capacity only; the vertex list and bounds are unchanged.

**Gain**: per path per painted frame, one allocation instead of ~log2(3n) with copies (a 1,000-triangle mesh, 32-byte vertices: ~10 reallocations, ~100 KB copied). Unmeasured.

**Proof plan**: `crates/deep-marks-render/tests/marks.rs`, `crates/deep-text-render/tests/frame.rs`, `tests/acceptance/380` and `1479` read the pixels.

**Risk**: low. 3 lines.

---

## F14 — the envelope hash is recomputed on every `frame` run — PLAUSIBLE (needs a core accessor)

**Where**: `crates/deep-canvas-marks/src/modules.rs:1788-1796` (`envelope_of`), `:1905`. The core computes the same thing at load: `crates/deep-canvas/src/schedule/mod.rs:3051-3063` (`envelope_key`).

**What**: each time the operator runs it canonicalizes and hashes every document member but `items` (clips and their keys, bound values, collections, data), only to compare with the last run's value. Those members change only when a document is loaded.

**Change**: expose the session's envelope key (or a load counter) through `View` and compare that; keep `envelope_of` only as the value under `hash@1`, where the core holds none. I did not trace `View`'s source-perturbation path (`view.rs:209-224`), which swaps the document and would need the same key swapped.

**Gain**: removes a canonical serialization of the envelope per changed frame; for a film with 50 KB of clips that is 50 KB serialized and hashed per frame. Unmeasured.

**Risk**: medium; crosses into deep-canvas. Not for this pass unless the core's owner agrees.

---

## Minor, same file families (apply only if touching the lines)

- `scene.rs:5539`: the matte loop clones every member under a source (`member.clone()`) though only the source itself is edited; use a `Cow` and clone when `k == source`. `:5557` clones each `Drawn` out of a uniquely held `Arc`; `Arc::try_unwrap(m.3).unwrap_or_else(|a| (*a).clone())`. Mattes only.
- `outline_sources.rs:72`: `Shaper::new()` (registers every bundled face) per text-outline request, while `scene.rs:3913` and `check.rs:361` each keep a thread-local shaper. Three shapers per thread in one crate; one `pub(crate)` thread-local would do.
- `scene.rs:1286-1292` `MarkList::from_iter` collects, then clones every `Arc` into blocks and drops the first vector: N extra atomic pairs per build.
- `crates/deep-show/src/snapshot.rs:465-468` spells out `RenderSettings { level: Level::fallback(), num_threads: 0 }`; `deep_marks_vello::settings()` (`lib.rs:170`) is the same value and the file already imports from that crate.
- `scene.rs:3187`: `format!("items/{id}/params/text")` inside the loop over every bound value; hoist it above the loop.

## Asked about, checked, no finding

- **Draw list rebuilt when nothing changed**: no. The operator runs only when a read changed; `Val::typed` encodes lazily (`schedule/mod.rs:278`).
- **Sort by z each frame**: only in a full `build`; marks arrive in presorted runs; the fast path does not sort.
- **Content keys per mark**: a prebuilt item's keys are computed once and reused (`scene.rs:5387`, `:5603-5606`). Extra hashing is F2; a matte scope rehashes every source mark for every mark under it (`scene.rs:503-505`), rare.
- **Hit testing**: none in these crates (`first_hit`/`box_hit` are attachment geometry).
- **Cache bounds**: glyph atlas 8 pages × 1 MB, LRU by page (`atlas.rs:25`, `:367-390`); shaped-run cache 32 MB LRU (`cache.rs:17`, `:243-250`), bytes only, no entry bound; deep-text-gpui `shaped` and `outlines` 4,096 entries each, no byte bound; `frame` unbounded (F4). deep-marks-render's session caches are trimmed to what the frame used (`macos.rs:1323`, `:1499-1511`).
- **Atlas**: glyphs rasterize once; the per-glyph `Pixmap` (`atlas.rs:305`) is warm-up only.
- **Worker handoff**: one text copy per job (`deep-show/src/shaper.rs:66`), once per long text.
- **marks-vello as shared owner**: paints (`brush`), `shape`, `Scopes`, `image`, `sampler`, `rasterizer` are shared. Rect, circle, R1 path, text and image marks are translated twice, in `deep-marks-render/src/raster.rs:537-723` and `deep-show/src/snapshot.rs:605-767`, and they differ (curve tolerance 0.1 vs 0.01, radius clamp, a two-stop gradient built locally in sRGB at `snapshot.rs:615-626`, a path drawn from tessellated triangles vs from its verbs, image opacity baked vs sampled). Merging them would change pixels, so it is not a finding here.
- **`path::fill`** (`path.rs:365-411`) is ear clipping with a full scan per candidate, O(n²) for convex and up to O(n³) for concave outlines. It is cached by content key and bucket in the renderers. A faster exact-same-output form is not provable for self-touching input, so no change proposed.
- **`dirty.rs`** is used only by the proof binary (`deep-marks-render/src/macos.rs:33`); its per-frame `items.clone()` is not a product cost.
- **deep-text canvas-lint failures**: not examined as findings.

## scene.rs: is there a split with a narrow interface?

A line-moving split exists; a coupling-removing one does not, so it is not a finding.

- The draw-list model (`Fill`, `Scope`, `Geometry`, `TextSpec`, `Mark`, `Drawn`, `Layer`, `MarkList`, `Frame` and their keys, `scene.rs:60-1315`) never calls the builders. It could be its own module, but every builder constructs those types directly, so the interface would be the whole type set.
- The bound-value text block (`Format`, `Record`, `Shown`, `show`, `bound_texts`, `text_at`, `bound_rows`, `scene.rs:2619-3259`) has a narrow data interface (document, items, record, locale in; `Shown` out) and no state. Moving it would need re-exports for six crates' `scene::Record`/`scene::Shown` paths and removes no dependency.
- The real knot is `ItemCtx`/`Paints` (`scene.rs:4553`, `:1499`) handing every per-item evaluator the whole `items` map. That is what keeps per-item nodes to four kinds and forces the full rebuild described at the top. Untangling it is feature work on #857, not a refactor.

## Structural costs seen, no exact edit offered

- One non-prebuilt item disables the fast path for the document (`modules.rs:2004`), so each changed frame re-runs Taffy, re-decodes every mark set's base64 columns (`data.rs:961-967`) and rebuilds every mark.
- A mark set's rows are decoded and replayed once for drawing, once per item anchored to its `#head` (`scene.rs:4220`) and once per counter or template slot reading its anchor (`scene.rs:3058`), all in the same frame.

## Dispositions

| Crate | Disposition |
|---|---|
| `deep-canvas-marks` | F1, F2, F3, F5, F6, F7, F8, F9, F10, F11, F14, minors |
| `deep-marks-render` | keep (proof binary); `graphs.rs:137` takes F5's `solve_items` |
| `deep-marks-vello` | keep; shared paints and scopes intact, duplication with deep-show noted, not mergeable without pixel change |
| `deep-marks-gpui` | F13 |
| `deep-text` | F12; cache and atlas keep |
| `deep-text-gpui` | F4, F13 |
| `deep-text-render` | keep |
