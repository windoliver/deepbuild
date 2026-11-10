//! R1's 2D canvas laid out as canvas modules (issues #387 and #388; technical design: Canvas
//! modules, the module table's text, look, marks2d and data rows). Each is one manifest and one
//! register call; its operators read only what they declare, through the scheduler's typed views:
//!
//! - **text**: the one shaper over the bundled fonts (a table), counters and bound values
//!   formatted in the view's locale, each text's shaped run, text animators, which keep only
//!   opacity under reduced motion (Transport), and each status mark's glyph and word with the
//!   legend;
//! - **look**: the look's roles resolved from its tokens, with the status map it contributes to
//!   the core's `core.status`;
//! - **marks2d**: the frame's draw list from every item's evaluated fields and transform, the
//!   formatted texts, the shaped runs and the look;
//! - **data**: each scale's nice domain and labelled ticks.
//!
//! The kinds keep their bare names, which the registry reserves to the core, so these modules
//! register operators, arrays, a table and fixtures, not kinds.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard};

use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver, TableValue};
use deep_canvas::schedule::core_ops::{Datum, Edit, Edits, Fields, StatusBase, Transform};
use deep_canvas::schedule::{canonical, Canonical, Hasher, Key, OpError, Outside, Val, View};
use deep_text::{Role, Shaped, Shaper};
use serde_json::{json, Map, Value};

use crate::look::Status;
use crate::relations;
use crate::scene::{
    self, object_or_empty, Frame, Mark, Palette, Record, Refused, Rgb, Shown, StatusMark, TextSpec,
};

fn manifest(name: &str, deps: &[&str]) -> Manifest {
    Manifest {
        name: name.into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: deps
            .iter()
            .map(|d| {
                (
                    d.to_string(),
                    Dependency {
                        range: Range::parse("^1").expect("a range"),
                        optional: false,
                    },
                )
            })
            .collect(),
        feature: name.into(),
        license: "Apache-2.0".into(),
        implements: format!("{name}@1"),
        implementation: deep_canvas::registry::Implementation::reference(
            name,
            Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

fn refused(r: Refused) -> OpError {
    OpError::new(r.code, r.path)
}

fn missing(v: &View<'_>) -> OpError {
    OpError::new("input_missing", v.path())
}

/// The record as one frame reads it, from the readings outside the document.
fn record_of(outside: &Outside) -> Record {
    let mut record = Record::default();
    for (handle, o) in &outside.readings {
        if let Some(state) = o.get("state").and_then(Value::as_str) {
            record.states.insert(handle.clone(), state.to_string());
        }
        if let Some(value) = o.get("value").and_then(Value::as_f64) {
            record.readings.insert(handle.clone(), value);
            if let Some(a) = o.get("as_of").and_then(Value::as_i64) {
                record.as_of.insert(handle.clone(), a);
            }
        }
    }
    record
}

impl Canonical for Shown {
    fn encode(&self, out: &mut Vec<u8>) {
        (
            &self.bound,
            &self.text,
            self.stale,
            self.age,
            self.changes_at,
        )
            .encode(out);
    }
}

/// An item's fields as the document writes them, built here from `core.fields` with motion's
/// edits applied.
fn fields_of(v: &mut View<'_>) -> Result<Value, OpError> {
    let fields = v
        .typed::<Fields>("core.fields")?
        .ok_or_else(|| missing(v))?;
    Ok(fields.to_json())
}

/// Every item's fields with its world transform as `at`, built here for the scene, which reads
/// items as the document writes them.
fn placed_items(v: &mut View<'_>) -> Result<Map<String, Value>, OpError> {
    let worlds: BTreeMap<&str, Val> = v.every("core.world")?.into_iter().collect();
    let mut items = Map::new();
    for (id, fields) in v.every("core.fields")? {
        let Some(fields) = fields.as_typed::<Fields>() else {
            continue;
        };
        let world = worlds.get(id).and_then(|w| w.as_typed::<Transform>());
        items.insert(id.to_string(), item_json(&fields, world.as_deref()));
    }
    Ok(items)
}

/// An item as the marks read it: its fields, at its world transform, keeping its relations and
/// a box-point pivot, which a transform doesn't hold, with what channels write on them (#221).
pub fn item_json(fields: &Fields, world: Option<&Transform>) -> Value {
    let mut item = fields.to_json();
    let Some(map) = item.as_object_mut() else {
        return item;
    };
    // `to_json` leaves `at` out but for what an edit wrote on it.
    let edited = map.remove("at");
    let Some(at) = world else {
        if let Some(e) = edited {
            map.insert("at".into(), e);
        }
        return item;
    };
    let mut placed = at.to_json();
    if let (Some(own), Some(out)) = (fields.lowered.get("at"), placed.as_object_mut()) {
        for k in ["place", "align", "anchor"] {
            if let Some(v) = own.get(k) {
                let mut v = v.clone();
                if let Some(e) = edited.as_ref().and_then(|e| e.get(k)) {
                    overlay(&mut v, e);
                }
                out.insert(k.into(), v);
            }
        }
        if let Some(p) = own.get("pivot").filter(|p| p.is_string()) {
            out.insert("pivot".into(), p.clone());
        }
    }
    map.insert("at".into(), placed);
    item
}

/// `edit`'s members written over `base`, object by object and list by list.
fn overlay(base: &mut Value, edit: &Value) {
    match (base, edit) {
        (Value::Object(b), Value::Object(e)) => {
            for (k, v) in e {
                match b.get_mut(k) {
                    Some(slot) => overlay(slot, v),
                    None => {
                        b.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (Value::Array(b), Value::Array(e)) => {
            for (slot, v) in b.iter_mut().zip(e) {
                if !v.is_null() {
                    overlay(slot, v);
                }
            }
        }
        (slot, v) => *slot = v.clone(),
    }
}

/// Each item's world transform: where its relations placed it (#221), else the core's.
fn worlds_of<'a>(v: &mut View<'a>) -> Result<BTreeMap<&'a str, Val>, OpError> {
    let mut worlds: BTreeMap<&str, Val> = v.every("core.world")?.into_iter().collect();
    worlds.extend(v.every("marks2d.at")?);
    Ok(worlds)
}

// ------------------------------------------------------------------------------------------------
// text

/// The text module.
pub fn text() -> Module {
    Module {
        manifest: manifest("text", &[]),
        register: register_text,
    }
}

/// A text's shaped run, with the spec it was shaped from. The run is the shaped-run cache's
/// (#856), shared by every document that shows the same text.
#[derive(Debug)]
pub struct Run {
    pub spec: TextSpec,
    pub shaped: Arc<Shaped>,
}

impl Canonical for TextSpec {
    fn encode(&self, out: &mut Vec<u8>) {
        self.text.encode(out);
        self.font.encode(out);
        self.family.unwrap_or("").encode(out);
        self.fallback.len().encode(out);
        for family in &self.fallback {
            family.encode(out);
        }
        self.lang.as_deref().unwrap_or("").encode(out);
        self.size.encode(out);
        self.weight.encode(out);
        self.width.encode(out);
        self.max_lines.encode(out);
        self.mask.encode(out);
        (self.align as u8).encode(out);
        self.bound.encode(out);
    }
}

impl Canonical for Run {
    fn encode(&self, out: &mut Vec<u8>) {
        self.spec.encode(out);
        let s = &self.shaped;
        s.glyphs.len().encode(out);
        for g in &s.glyphs {
            (g.font.index, g.size, g.id, g.x, g.y, g.grapheme).encode(out);
        }
        (s.width, s.height, s.lines, s.ellipsized).encode(out);
        s.shown.encode(out);
    }
}

/// The text module's shapers: a fixed count, never one taken from the machine, so texts shaping
/// on several of the scheduler's threads don't wait on one (#857). Each holds only the bundled
/// fonts, so any of them shapes a spec to the same glyphs.
struct Shapers(Vec<Mutex<Shaper>>);

/// How many shapers the text module holds: the most threads a live view's class sets.
const SHAPERS: usize = 4;

impl Shapers {
    /// A free shaper, else the first once it is.
    fn lock(&self) -> Option<MutexGuard<'_, Shaper>> {
        self.0
            .iter()
            .find_map(|s| s.try_lock().ok())
            .or_else(|| self.0[0].lock().ok())
    }
}

fn fonts() -> TableValue {
    Arc::new(Shapers(
        (0..SHAPERS).map(|_| Mutex::new(Shaper::new())).collect(),
    ))
}

fn register_text(r: &mut Registrar) {
    r.built_table("text.fonts", fonts);
    // #443: a shaped run's glyph outlines, text's entry in the core's `outline.source@1`.
    r.outline_source(
        "text",
        json!({"form": "text", "fixture": crate::outline_sources::text_fixture()}),
        crate::outline_sources::text_fill,
    );
    r.array("text.counter", "shown", "item", "text", "items");
    r.array("text.run", "run", "item", "text", "items");
    r.array("text.animated", "units", "item", "time", "items");
    r.operator(
        "counter",
        "items",
        &["core.fields", "refs", "reading", "view(locale)"],
        &["text.counter"],
    )
    .applies(is_bound_text)
    .run(counter);
    r.operator(
        "shape",
        "items",
        &[
            "core.fields",
            "text.counter",
            "view(locale)",
            "table:text.fonts",
        ],
        &["text.run"],
    )
    .applies(is_text)
    .run(shape);
    r.operator(
        "animate",
        "items",
        &["core.fields", "text.run", "view(reduced_motion)"],
        &["text.animated"],
    )
    .applies(is_animated)
    .run(animate);
    r.array(
        "text.status",
        "status_marks",
        "document",
        "shading",
        "extract",
    );
    r.operator(
        "status",
        "extract",
        &[
            "refs",
            "reading",
            "core.world",
            "core.fields",
            "core.status",
            "table:text.fonts",
        ],
        &["text.status"],
    )
    .document()
    .applies(deep_canvas::schedule::core_ops::has_status)
    .run(status);
    r.code(
        "status_slot_kind",
        "A status binding on a slot its item's kind can't carry a status color in.",
        "Bind a rect's or a circle's fill, or a stroke or badge, never a text's fill.",
        false,
    );
    r.code(
        "status_too_small",
        "A status fill on an item smaller than the look's smallest status mark.",
        "Make the item at least the look's core size, or bind its stroke or badge instead.",
        false,
    );
    r.code(
        "bad_doc",
        "A text item the text module can't read: no text to shape, or an alignment it doesn't know.",
        "Give the text item a text, and an align of start, center or end.",
        false,
    );
    r.code(
        "bad_format",
        "A bound value's format or missing field the text module can't read.",
        "Write the format with a precision of 0 to 12 and a known sign, group and unit.",
        false,
    );
    r.code(
        "format_notation",
        "A bound value's format in a notation the text module doesn't write.",
        "Use the notation fixed, compact, percent or duration.",
        false,
    );
    r.fixture("counter", counter_board(), Some(counter_record()))
        .sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/title/at/pos", "value": [24, 80, 0]},
    }));
    r.fixture("status", status_board(), Some(status_record()))
        .sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/build/params/box", "value": [16, 24, 168, 40]},
    }));
}

fn is_text(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("text@1")
}

/// A text a bound value's text targets, or a counter.
fn is_bound_text(doc: &Value, id: &str, item: &Value) -> bool {
    if !is_text(doc, id, item) {
        return false;
    }
    let target = format!("items/{id}/params/text");
    let bound = doc
        .get("bound_values")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .any(|(_, b)| b.get("target").and_then(Value::as_str) == Some(target.as_str()));
    let counter = item
        .get("params")
        .and_then(|p| p.get("text"))
        .and_then(|t| t.get("counter"))
        .is_some();
    let template = scene::template_of(item).is_some();
    bound || counter || template
}

fn is_animated(doc: &Value, id: &str, item: &Value) -> bool {
    is_text(doc, id, item)
        && item
            .get("params")
            .and_then(|p| p.get("animators"))
            .and_then(Value::as_array)
            .is_some_and(|a| !a.is_empty())
}

/// What a bound value or counter shows, its numbers in the view's locale.
fn counter(v: &mut View<'_>) -> Result<(), OpError> {
    // The evaluated item: a keyed data value its template reads rides on it (motion@1).
    let item = fields_of(v)?;
    let doc = v.document()?;
    let record = record_of(v.outside()?);
    let locale = v.locale()?;
    let id = v.id().unwrap_or_default();
    let empty = Map::new();
    let shown = scene::bound_text(
        doc.as_object().unwrap_or(&empty),
        id,
        &item,
        &record,
        locale,
    )
    .map_err(refused)?;
    v.write("text.counter", Val::typed(shown))
}

/// The item's text shaped once by the one shaper: what drawing and the fit check read.
fn shape(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = fields_of(v)?;
    let shown = v
        .typed::<Option<Shown>>("text.counter")?
        .and_then(|s| (*s).clone());
    // The locale picks the shaping language; it keys every run, a label's included.
    let _ = v.locale()?;
    let id = v.id().unwrap_or_default();
    let params = object_or_empty(fields.get("params"));
    let spec = scene::text_spec(id, params, shown.as_ref()).map_err(refused)?;
    // The size is an f32 (Text `text@1`: `size: f32`): one past its range is an infinity.
    if !(spec.size as f32).is_finite() {
        return Err(OpError::new(
            "out_of_range",
            format!("items/{id}/params/size"),
        ));
    }
    let fonts = v.table::<Shapers>("text.fonts")?;
    let Some(shaper_spec) = spec.shaper_spec() else {
        return Err(OpError::new(
            "out_of_range",
            format!("items/{id}/params/font"),
        ));
    };
    let shaped = fonts
        .lock()
        .ok_or_else(|| OpError::new("shaper_poisoned", format!("items/{id}")))?
        .shape(&shaper_spec);
    v.write("text.run", Val::typed(Run { spec, shaped }))
}

/// A text animator's amount for each unit (its glyphs, in order), mapped to a lift and an
/// opacity: the animator's selectors as the per-glyph layout reads them (#496: its range in
/// Lottie's shapes, then noise and field selectors by their modes); `props.y` lifts and
/// `props.opacity` fades a covered unit. Under reduced motion only opacity is kept, so units fade
/// in place (Transport). The operator reads no clock: a noise or field selector is read at t = 0
/// here, and moves in the per-glyph layout drawing reads (`animator::lay_out`).
fn animate(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = fields_of(v)?;
    let run = v.typed::<Run>("text.run")?.ok_or_else(|| missing(v))?;
    let reduced = v.reduced_motion()?;
    let t = 0;
    let id = v.id().unwrap_or_default().to_string();
    let mut out: Vec<[f64; 2]> = vec![[0.0, 1.0]; run.shaped.glyphs.len()];
    let animators = fields
        .get("params")
        .and_then(|p| p.get("animators"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for (k, a) in animators.iter().enumerate() {
        let Value::Object(a) = a else {
            return Err(OpError::new(
                "bad_doc",
                format!("items/{id}/params/animators/{k}"),
            ));
        };
        let amounts = crate::animator::amounts(&id, k, a, &run.shaped, t).map_err(refused)?;
        let props = a.get("props");
        let lift = props
            .and_then(|p| p.get("y"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let fade = props.and_then(|p| p.get("opacity")).and_then(Value::as_f64);
        for (unit, g) in out.iter_mut().zip(&run.shaped.glyphs) {
            let w = amounts.get(g.grapheme).copied().unwrap_or(0.0);
            if !reduced {
                unit[0] += w * lift;
            }
            if let Some(o) = fade {
                unit[1] = (unit[1] + w * (o - 1.0)).clamp(0.0, 1.0);
            }
        }
    }
    v.write("text.animated", Val::typed(out))
}

fn counter_board() -> Value {
    json!({
        "format": 1, "profile": "board", "seed": 387, "title": "Text",
        "description": "A counter of a reading, a plain label and a title a text animator lifts in: the text module's fixture.",
        "size": [320, 200],
        "transport": {"span": "2s", "reduced_motion": "hold"},
        "items": {
            "ground": {"id": "ground", "kind": "rect@1", "name": "Ground", "order": "a0",
                       "params": {"box": [0, 0, 320, 200], "paint": {"fill": {"role": "ground"}}}},
            "n": {"id": "n", "kind": "text@1", "name": "Total", "order": "a1",
                  "params": {"text": {"counter": {"source": "bv"}}, "size": 13, "box": {"w": 160, "h": 20}, "widest": "8,888,888.8"},
                  "at": {"pos": [16, 16, 0]}},
            "lbl": {"id": "lbl", "kind": "text@1", "name": "Label", "order": "a2",
                    "params": {"text": "Checks passed", "font": "body", "size": 13, "box": {"w": 160, "h": 20}},
                    "at": {"pos": [16, 44, 0]}},
            "title": {"id": "title", "kind": "text@1", "name": "Title", "order": "a3",
                      "params": {"text": "Launch", "size": 24, "box": {"w": 200, "h": 32},
                                 "animators": [{"units": "grapheme", "range": {"from": 0, "to": 1, "falloff": 0.5, "offset": 0},
                                                "shape": "smooth", "mode": "add", "props": {"y": 16, "opacity": 0}}]},
                      "at": {"pos": [16, 72, 0]}}
        },
        "bound_values": {"bv": {"target": "items/n/params/text", "source": "reading:01JB8700000000000000000001", "format": {"precision": 1}}},
        "clips": {"rise": {"slots": {"target": {"type": "text@1", "required": true}}, "span": "auto",
            "channels": {"o": {"target": "slot:target/params/animators/0/range/offset", "type": "f32",
                "keys": {"k0": {"t": "0s", "value": -1, "interp": "linear"}, "k1": {"t": "2s", "value": 1, "interp": "linear"}}}}}},
        "placements": {"p": {"clip": "rise", "slots": {"target": "title"}, "start": "0s"}}
    })
}

fn counter_record() -> Value {
    json!({"reading:01JB8700000000000000000001": {"session": null, "value": 1234567.5, "as_of": 1000}})
}

/// What a frame's status marks draw (The status-color rule): each mark with the box of its glyph
/// and word, and the legend, one entry per state on screen.
#[derive(Clone, Debug, Default)]
pub struct StatusDrawing {
    pub marks: Vec<Labelled>,
    pub legend: Vec<LegendEntry>,
}

impl Canonical for StatusDrawing {
    fn encode(&self, out: &mut Vec<u8>) {
        self.marks.len().encode(out);
        for l in &self.marks {
            let m = &l.mark;
            (&m.item, &m.binding, m.slot as u8, m.state).encode(out);
            (m.color, m.bounds, m.radius, &m.glyph, m.word).encode(out);
            (m.ink, m.core, m.outline, l.label).encode(out);
        }
        self.legend.len().encode(out);
        for e in &self.legend {
            (e.state, &e.glyph, e.word, e.color).encode(out);
            (e.ink, e.swatch, e.label).encode(out);
        }
    }
}

/// A status mark and the box its glyph and word draw in, in u.
#[derive(Clone, Debug)]
pub struct Labelled {
    pub mark: StatusMark,
    pub label: [f64; 4],
}

/// A legend entry: the state's glyph, word and color, its swatch and its label's box, in u.
#[derive(Clone, Debug)]
pub struct LegendEntry {
    pub state: &'static str,
    pub glyph: String,
    pub word: &'static str,
    pub color: Rgb,
    pub ink: Rgb,
    pub swatch: [f64; 4],
    pub label: [f64; 4],
}

/// The text a status mark or a legend entry draws: its glyph and its word.
pub fn status_text(glyph: &str, word: &str) -> String {
    if glyph.is_empty() {
        word.to_string()
    } else {
        format!("{glyph} {word}")
    }
}

/// A status label's height: one line of the 13 px label face.
pub const LABEL_H: f64 = 17.0;
/// A legend row: its swatch's side and the row's pitch, in u.
const SWATCH: f64 = 12.0;
const LEGEND_ROW: f64 = 20.0;

/// The status map with nothing contributed: no state has a glyph or a color of its own, so a mark
/// drawn from it carries its word alone.
pub fn unmapped() -> Status {
    Status {
        colors: crate::look::STATES.iter().map(|s| (*s, [128; 3])).collect(),
        glyphs: crate::look::STATES
            .iter()
            .map(|s| (*s, String::new()))
            .collect(),
        core_min_px: 4.0,
        outline: None,
        min_distance: 0.0,
    }
}

/// Each status binding's mark in its source's state, through the status map in `core.status`,
/// with its glyph and word shaped by the one shaper, and the legend.
fn status(v: &mut View<'_>) -> Result<(), OpError> {
    let doc = v.document()?;
    let record = record_of(v.outside()?);
    let items = placed_items(v)?;
    let base = v
        .typed::<StatusBase>("core.status")?
        .ok_or_else(|| missing(v))?;
    let palette: Palette = base.roles.clone();
    let map = base
        .map
        .as_ref()
        .and_then(|m| m.as_typed::<Option<Status>>())
        .and_then(|m| (*m).clone());
    let unmapped = unmapped();
    let status = map.as_ref().unwrap_or(&unmapped);
    let empty = Map::new();
    let doc = doc.as_object().unwrap_or(&empty);
    let mut marks =
        scene::status_marks(doc, &items, &record, Some(status), &palette).map_err(refused)?;
    // In binding order, however the document lists its bindings: equal documents draw alike.
    marks.sort_by(|a, b| a.binding.cmp(&b.binding));
    let height = doc
        .get("size")
        .and_then(|s| s.get(1))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let fonts = v.table::<Shapers>("text.fonts")?;
    let mut shaper = fonts
        .lock()
        .ok_or_else(|| OpError::new("shaper_poisoned", "status_bindings"))?;
    let out = status_drawing(marks, map.as_ref(), &palette, height, &mut shaper);
    v.write("text.status", Val::typed(out))
}

/// Status marks with the box their glyph and word draw in, shaped by `shaper`, and the legend:
/// one entry per state on screen, in the legend's order, stacked up from the bottom left of a
/// document `height` u tall. With no status map (`status` `None`) there is no legend to give.
pub fn status_drawing(
    marks: Vec<StatusMark>,
    status: Option<&Status>,
    palette: &Palette,
    height: f64,
    shaper: &mut Shaper,
) -> StatusDrawing {
    let mut width = |text: &str| {
        let spec = deep_text::Spec {
            weight: 600,
            ..deep_text::Spec::label(text)
        };
        f64::from(shaper.shape(&spec).width)
    };
    let mut out = StatusDrawing::default();
    for mark in marks {
        let [x, y, w, h] = mark.bounds;
        let label = match mark.slot {
            scene::Slot::Fill => [
                x + 6.0,
                y + (h - LABEL_H) / 2.0,
                width(&status_text(&mark.glyph, mark.word)),
                LABEL_H,
            ],
            scene::Slot::Stroke | scene::Slot::Badge => {
                let chip = mark.core.max(16.0);
                [x + w - chip / 2.0, y - chip / 2.0, chip, chip]
            }
        };
        out.marks.push(Labelled { mark, label });
    }
    let Some(status) = status else {
        return out;
    };
    let states: Vec<&'static str> = crate::look::STATES
        .iter()
        .copied()
        .filter(|s| out.marks.iter().any(|m| m.mark.state == *s))
        .collect();
    let ink = palette.get("ink").copied().unwrap_or([0; 3]);
    for (i, state) in states.iter().enumerate() {
        let top = height - 8.0 - LEGEND_ROW * (states.len() - i) as f64;
        let glyph = status.glyphs[state].clone();
        let word = crate::look::word(state).unwrap_or(state);
        let label = [
            8.0 + SWATCH + 6.0,
            top + (LEGEND_ROW - LABEL_H) / 2.0,
            width(&status_text(&glyph, word)),
            LABEL_H,
        ];
        out.legend.push(LegendEntry {
            state,
            glyph,
            word,
            color: status.colors[state],
            ink,
            swatch: [8.0, top + (LEGEND_ROW - SWATCH) / 2.0, SWATCH, SWATCH],
            label,
        });
    }
    out
}

/// The text module's status board: three boxes bound to verdicts, a caption and room for the
/// legend below them, which the core set draws with text and look alone.
fn status_board() -> Value {
    let rect = |id: &str, b: [i64; 4], order: &str| {
        json!({"id": id, "kind": "rect@1", "name": format!("Check {id}"), "order": order,
               "params": {"box": b, "radius": 4, "paint": {"fill": {"role": "muted"}}}})
    };
    let bind = |id: &str, n: u8| {
        json!({"target": format!("items/{id}/params/paint/fill"),
               "source": format!("verdict:01JB88000000000000000000{n:02}")})
    };
    json!({
        "format": 1, "profile": "board", "seed": 388, "title": "Status",
        "description": "Three checks bound to their verdicts, each drawn in its state's color with its glyph and word, and the legend: the text module's status fixture.",
        "size": [480, 240],
        "items": {
            "build": rect("build", [16, 16, 168, 40], "a1"),
            "tests": rect("tests", [200, 16, 168, 40], "a2"),
            "review": rect("review", [16, 72, 168, 40], "a3"),
            "cap": {"id": "cap", "kind": "text@1", "name": "Caption", "order": "a4",
                    "params": {"text": "Checks", "font": "body", "size": 13, "box": {"w": 160, "h": 20}},
                    "at": {"pos": [200, 82, 0]}}
        },
        "status_bindings": {"sb-build": bind("build", 1), "sb-tests": bind("tests", 2), "sb-review": bind("review", 3)}
    })
}

fn status_record() -> Value {
    json!({
        "verdict:01JB8800000000000000000001": {"session": null, "state": "pass"},
        "verdict:01JB8800000000000000000002": {"session": null, "state": "fail"},
        "verdict:01JB8800000000000000000003": {"session": null, "state": "needs_you"}
    })
}

// ------------------------------------------------------------------------------------------------
// look

/// The look module.
pub fn look() -> Module {
    Module {
        manifest: manifest("look", &[]),
        register: register_look,
    }
}

/// A planted implementation of look@1 (#418's `test-look-finish-off`): declared bit and
/// canonical, under its own name, whose finish at identity moves one value of one role, so the
/// kit's bit part fails it and a release build refuses it.
pub fn look_finish_off() -> Module {
    let mut m = manifest("look", &[]);
    m.implementation = deep_canvas::registry::Implementation::reference(
        "look.finish_off",
        Semver::parse("1.0.0").expect("a version"),
    );
    Module {
        manifest: m,
        register: |r| look_with(r, finish_off),
    }
}

/// A look as the frame reads it: each role's color and the status map.
#[derive(Debug)]
pub struct LookValue {
    pub palette: Palette,
    pub status: Option<Status>,
}

impl Canonical for Status {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.colors, &self.glyphs, self.core_min_px, &self.outline).encode(out);
        self.min_distance.encode(out);
    }
}

impl deep_canvas::schedule::Canonical for LookValue {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.palette, &self.status), out);
    }
}

fn register_look(r: &mut Registrar) {
    look_with(r, finish);
}

fn look_with(r: &mut Registrar, finish: fn(&mut View<'_>) -> Result<(), OpError>) {
    r.array("look.palette", "palette", "document", "shading", "items");
    // #418: a finish swatch, `look.finish@1`: the look's roles through the look's finish at the
    // item's settings (its tone map, exposure and grade, and the deband, ao and bloom it names),
    // each role's swatch as the finish leaves it. An implementation whose finish moves a pixel at
    // identity differs here from the reference's.
    r.kind(finish_kind(), &[], "");
    r.array("look.finish", "palette", "item", "shading", "items");
    // The status map every status mark draws from, into the core's array (The status-color rule).
    r.contribution(
        "look.status",
        "status",
        "document",
        "shading",
        "items",
        "core.status",
    );
    r.operator(
        "palette",
        "items",
        &["look"],
        &["look.palette", "look.status"],
    )
    .document()
    .run(palette);
    r.operator(
        "finish",
        "items",
        &["self", "look.palette"],
        &["look.finish"],
    )
    .applies(is_finish)
    .run(finish);
    r.fixture("roles", roles_board(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/ink/params/box", "value": [86, 40, 56, 40]},
    }));
    // The finish at its identity defaults, and under each tone map with a grade, the deband, ao
    // and bloom: the analytic fixtures the issue's proof names, evaluated headless.
    r.fixture("finish", finish_board(), None).sidecar(json!({
        "codes": [],
        "covers": {"kinds": ["look.finish@1"], "fields": [
            "look.finish@1/params/tone_map", "look.finish@1/params/exposure",
            "look.finish@1/params/grade", "look.finish@1/params/deband",
            "look.finish@1/params/deband_lsb", "look.finish@1/params/ao",
            "look.finish@1/params/bloom",
        ]},
    }));
}

fn finish_kind() -> deep_canvas::kinds::Entry {
    use deep_canvas::kinds::{Entry, Param, ParamType, Version};
    let param = |name, ty, default: Value| Param {
        name,
        ty,
        unit: "",
        default,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    Entry {
        family: "look",
        name: "finish",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: vec![
                param("tone_map", ParamType::Json, json!("none")),
                // EV100; the default's exposure scale is 1.
                param("exposure", ParamType::Json, Value::Null),
                param("grade", ParamType::Json, json!({})),
                param("deband", ParamType::Str, json!("none")),
                param("deband_lsb", ParamType::Json, json!(1)),
                param("ao", ParamType::Json, json!("none")),
                param("bloom", ParamType::Json, json!("none")),
            ],
        }],
        migrations: vec![],
    }
}

fn is_finish(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("look.finish@1")
}

/// Swatches of the look's finish: at its identity defaults, then under filmic, AgX and Neutral, a
/// grade, the deband, ao and bloom.
fn finish_board() -> Value {
    let swatch = |id: &str, order: &str, params: Value| {
        json!({"id": id, "kind": "look.finish@1", "name": format!("Finish {id}"), "order": order,
               "params": params})
    };
    json!({
        "format": 1, "profile": "board", "seed": 418, "title": "Finish",
        "requires": {"modules": {"look": "^1"}},
        "description": "The look's roles through its finish: at the identity defaults, under each tone map, a grade, the deband, ambient occlusion and bloom: the look module's finish fixture.",
        "size": [320, 200],
        "items": {
            "identity": swatch("identity", "a0", json!({
                "tone_map": "none", "deband": "none", "ao": "none", "bloom": "none",
                "grade": {"white_balance": {"temperature": 6500, "tint": 0},
                          "slope": [1, 1, 1], "offset": [0, 0, 0], "power": [1, 1, 1], "saturation": 1}})),
            "filmic": swatch("filmic", "a1", json!({"tone_map": "filmic", "exposure": -1.263})),
            "agx": swatch("agx", "a2", json!({"tone_map": {"agx": {"white": 16.29, "contrast": 1.25}}, "exposure": -1.263})),
            "neutral": swatch("neutral", "a3", json!({
                "tone_map": "neutral", "deband": "spatial", "deband_lsb": 1,
                "ao": {"radius": 0.5, "strength": 1, "samples": 8, "resolution": "half",
                       "multi_bounce": true, "specular": true},
                "bloom": {"intensity": 0.04, "radius": 0.85},
                "grade": {"white_balance": {"temperature": 5600, "tint": 0},
                          "slope": [1.05, 1, 0.95], "offset": [0, 0, 0], "power": [1, 1, 1], "saturation": 0.9}})),
        }
    })
}

/// Each role's color through the finish at the swatch's settings: decoded, exposed,
/// white-balanced, tone-mapped, graded and encoded. The deband, ao and bloom are spatial, so a
/// swatch of one color holds them as named, checked, and unchanged.
fn finished(v: &mut View<'_>) -> Result<Palette, OpError> {
    let id = v.id().unwrap_or_default().to_string();
    let params = v.item()?.get("params").cloned().unwrap_or(Value::Null);
    let bad = |field: &str| OpError::new("out_of_range", format!("items/{id}/params/{field}"));
    let map = crate::finish::read_tone_map(params.get("tone_map")).map_err(|_| bad("tone_map"))?;
    let grade = crate::finish::read_grade(params.get("grade")).map_err(|_| bad("grade"))?;
    let exposure = match params.get("exposure").filter(|e| !e.is_null()) {
        None => 1.0,
        Some(e) => crate::finish::exposure_scale(e.as_f64().ok_or_else(|| bad("exposure"))?),
    };
    match params.get("deband").and_then(Value::as_str) {
        None | Some("none" | "spatial") => {}
        Some(_) => return Err(bad("deband")),
    }
    if params
        .get("deband_lsb")
        .and_then(Value::as_f64)
        .is_some_and(|l| !(0.0..=crate::finish::DEBAND_MAX_LSB).contains(&l))
    {
        return Err(bad("deband_lsb"));
    }
    let look = v
        .typed::<LookValue>("look.palette")?
        .ok_or_else(|| OpError::new("input_missing", "look.palette"))?;
    Ok(look
        .palette
        .iter()
        .map(|(role, c)| {
            let linear = c.map(|x| crate::finish::srgb_decode(f64::from(x) / 255.0));
            let out = crate::finish::finish(map, exposure, &grade, linear);
            let rgb = out.map(|x| (crate::finish::srgb_encode(x) * 255.0).round() as u8);
            (role.clone(), rgb)
        })
        .collect())
}

fn finish(v: &mut View<'_>) -> Result<(), OpError> {
    let out = finished(v)?;
    v.write("look.finish", Val::typed(out))
}

/// The planted finish: one value of the first role a code higher.
fn finish_off(v: &mut View<'_>) -> Result<(), OpError> {
    let mut out = finished(v)?;
    if let Some(c) = out.values_mut().next() {
        c[0] = c[0].wrapping_add(1);
    }
    v.write("look.finish", Val::typed(out))
}

/// The clean look, resolved: its status map and roles, as the session's tokens start.
pub fn clean() -> crate::look::Look {
    let def = crate::look::shipped("clean").expect("the clean look ships");
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    crate::look::resolve(&def, &bundled).expect("the clean look resolves")
}

/// The look's tokens: each role's color as `[r, g, b]`.
pub fn tokens(palette: &Palette) -> BTreeMap<String, Value> {
    palette
        .iter()
        .map(|(role, rgb)| (role.clone(), json!(rgb)))
        .collect()
}

/// The roles from the session's tokens, with the clean look's status map.
fn palette(v: &mut View<'_>) -> Result<(), OpError> {
    let tokens = v.look()?;
    let mut palette = Palette::new();
    for (role, value) in tokens {
        let rgb: Option<Rgb> = value.as_array().and_then(|c| {
            let c: Vec<u8> = c
                .iter()
                .filter_map(|x| x.as_u64().and_then(|x| u8::try_from(x).ok()))
                .collect();
            <[u8; 3]>::try_from(c.as_slice()).ok()
        });
        let Some(rgb) = rgb else {
            return Err(OpError::new("bad_look", format!("look: {role}")));
        };
        palette.insert(role.clone(), rgb);
    }
    let status = clean().status;
    v.write(
        "look.status",
        Val::typed(Edits::set(
            &["map"],
            Datum::Typed(Val::typed(status.clone())),
        )),
    )?;
    v.write("look.palette", Val::typed(LookValue { palette, status }))
}

fn roles_board() -> Value {
    let rect = |id: &str, x: f64, role: &str, order: &str| {
        json!({"id": id, "kind": "rect@1", "name": format!("Role {role}"), "order": order,
               "params": {"box": [x, 40, 56, 40], "paint": {"fill": {"role": role}}}})
    };
    json!({
        "format": 1, "profile": "board", "seed": 387, "title": "Roles",
        "description": "One box in each of the look's roles: the look module's fixture.",
        "size": [320, 200],
        "items": {
            "ground": rect("ground", 0.0, "ground", "a0"),
            "ink": rect("ink", 80.0, "ink", "a1"),
            "muted": rect("muted", 152.0, "muted", "a2"),
            "accent": rect("accent", 224.0, "accent", "a3")
        }
    })
}

// ------------------------------------------------------------------------------------------------
// data

/// The data module: R1's mark sets, scales and axes, which marks2d draws; it evaluates each
/// scale once, its domain made nice and its ticks labelled, for what reads it.
pub fn data() -> Module {
    Module {
        manifest: manifest("data", &["marks2d"]),
        register: |r| register_data(r, decimate),
    }
}

/// A planted implementation of data@1 (#399's `test-data-m4-drops-last`): declared bit and
/// canonical, under its own name, whose m4 decimation drops each pixel column's last row, so the
/// kit's bit part fails it and a release build refuses it.
pub fn data_m4_drops_last() -> Module {
    let mut m = manifest("data", &["marks2d"]);
    m.implementation = deep_canvas::registry::Implementation::reference(
        "data.m4_drops_last",
        Semver::parse("1.0.0").expect("a version"),
    );
    Module {
        manifest: m,
        register: |r| register_data(r, decimate_drops_last),
    }
}

fn register_data(r: &mut Registrar, decimate: fn(&mut View<'_>) -> Result<(), OpError>) {
    // #397: the data module's columns as the first entries of the core's column view (Array and
    // table: column view): data, const and table columns, each pure in t, so a seek equals a
    // clean evaluation and no rows change between steps.
    let rows = json!([1.5, 2.5]);
    let fixture = json!({"frames": [rows, rows], "changed": [[], []],
                         "seeks": [{"from": 1, "to": 0, "rows": rows}]});
    for (name, form, types) in [
        (
            "data.data@1",
            "{dtype, len, data}",
            json!(["f64", "f32", "i64", "i32", "u32", "u16", "u8", "bool", "role", "str"]),
        ),
        ("data.const@1", "{const}", json!(["f64", "bool", "str"])),
        (
            "data.table@1",
            "{from, column}",
            json!(["i64", "f64", "str"]),
        ),
    ] {
        r.entry(
            deep_canvas::columns::REGISTRY,
            name,
            json!({"form": form, "types": types, "fixture": fixture}),
            "R2",
        );
    }
    r.array("data.scale", "scale", "item", "geometry", "items");
    r.operator("scale", "items", &["core.fields"], &["data.scale"])
        .applies(is_scale)
        .run(scale);
    // #399: each line series' decimation, the rows it keeps in its window, column by column.
    r.array("data.decimated", "rows", "item", "geometry", "items");
    r.operator("decimate", "items", &["core.fields"], &["data.decimated"])
        .applies(is_line_series)
        .run(decimate);
    // #535 (Mark set: logic columns): each column, and `alive`, that reads an array, mapped at t
    // from the session's frame before by the ranges the steps since handed over, as edits on the
    // set's fields.
    r.contribution("data.columns", "fields", "item", "geometry", "items", "core.fields");
    r.private_array("data.mapped", "mapped", "item", "geometry", "items");
    r.operator("columns", "items", &["self", "t"], &["data.columns", "data.mapped"])
        .applies(reads_array)
        .run(columns);
    // A scale it can't read raises marks2d's `scale_type` or `bad_scale`, which mark sets and
    // axes raise through the same scale.
    r.fixture("points", points_board(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/x/params/domain", "value": [0, 20]},
    }));
    // #399: a line of four rows in each of its three pixel columns, each column's first, min,
    // max and last rows distinct, so m4 keeps all four.
    r.fixture("race", race_board(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/ys/params/range", "value": [190, 30]},
    }));
    r.fixture("decimated", decimated_board(), None)
        .sidecar(json!({
            "checks": [{"kind": "document.validate"}],
            "oracles": ["analytic"],
            "codes": [],
        }));
}

/// A `series@1` item drawn as a line, not as candles.
fn is_line_series(_: &Value, _: &str, item: &Value) -> bool {
    let p = item.get("params");
    item.get("kind").and_then(Value::as_str) == Some("series@1")
        && p.and_then(|p| p.get("decimate")).and_then(Value::as_str) != Some("ohlc")
        && !p
            .and_then(|p| p.get("marks"))
            .and_then(Value::as_array)
            .is_some_and(|m| m.iter().any(|m| m == "candle"))
}

/// The rows a line series keeps, in draw order (`data.decimated`): m4's per pixel column, or
/// every row under `decimate: "none"`.
fn decimated_rows(v: &mut View<'_>, m4: crate::data::Decimate) -> Result<(), OpError> {
    let fields = fields_of(v)?;
    let id = v.id().unwrap_or_default();
    let how = match fields["params"]["decimate"].as_str() {
        Some("none") => crate::data::Decimate::None,
        _ => m4,
    };
    let d = crate::data::decimated(id, &fields, how).map_err(refused)?;
    let rows: Vec<u64> = d.rows().into_iter().map(|r| r as u64).collect();
    v.write("data.decimated", Val::typed(rows))
}

fn decimate(v: &mut View<'_>) -> Result<(), OpError> {
    decimated_rows(v, crate::data::Decimate::M4)
}

/// The data module's planted narrowing that wraps a value into its column's range.
pub const NARROWING_WRAPS: &str = "narrowing_wraps";
/// The data module's planted mapping that keeps its rows across a seek back.
pub const KEEPS_ROWS_ACROSS_SEEK: &str = "keeps_rows_across_seek";
/// #535's planted programs in this crate's modules: the data module's two, and marks2d's free
/// atlas row turned about its quad's corner.
pub const PLANTED: [&str; 3] = [NARROWING_WRAPS, KEEPS_ROWS_ACROSS_SEEK, "turns_about_corner"];

/// A mark set whose columns or `alive` read an array, which the column view baked.
fn reads_array(_: &Value, _: &str, item: &Value) -> bool {
    let p = item.get("params");
    p.and_then(|p| p.get("alive")).is_some_and(|a| a.get("steps").is_some())
        || p.and_then(|p| p.get("columns"))
            .and_then(Value::as_object)
            .is_some_and(|c| c.values().any(|c| c.get("steps").is_some()))
}

/// The set's array columns at t (`data.columns`), each as its values and hidden rows, and their
/// mappings (`data.mapped`), from the session's last frame unless t is before it.
fn columns(v: &mut View<'_>) -> Result<(), OpError> {
    let t = v.t()?;
    let item = v.item()?;
    let last = v.last("data.mapped");
    let last = last
        .as_ref()
        .and_then(|l| l.as_typed::<BTreeMap<String, deep_canvas::columns::Mapped>>());
    let planted = v.planted();
    let wraps = planted == Some(NARROWING_WRAPS);
    let p = &item["params"];
    let mut readers: Vec<(Vec<String>, &Value)> = p["columns"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, c)| c.get("steps").is_some())
        .map(|(n, c)| (vec!["params".into(), "columns".into(), n.clone()], c))
        .collect();
    if p["alive"].get("steps").is_some() {
        readers.push((vec!["params".into(), "alive".into()], &p["alive"]));
    }
    let mut edits = Vec::new();
    let mut mapped = BTreeMap::new();
    for (path, column) in readers {
        let key = path.join("/");
        let before = last.as_ref().and_then(|l| l.get(&key)).map(|m| {
            let mut m = m.clone();
            if planted == Some(KEEPS_ROWS_ACROSS_SEEK) {
                // The planted mapping: a seek back keeps the rows the later frame mapped.
                m.step = m.step.min(t.div_euclid(column["every"].as_i64().unwrap_or(1).max(1)));
            }
            m
        });
        let Some(m) = deep_canvas::columns::map(column, t, before.as_ref(), wraps) else {
            continue;
        };
        let at = |leaf: &str| [path.clone(), vec![leaf.to_string()]].concat();
        let alive = path.last().map(String::as_str) == Some("alive");
        let hide = deep_canvas::columns::hidden_rows(&m, alive);
        edits.push(Edit {
            add: false,
            path: at("data"),
            value: Datum::Text(deep_canvas::columns::data_of(&m)),
        });
        edits.push(Edit {
            add: false,
            path: at("hide"),
            value: Datum::Nums(hide.into_iter().map(|r| r as f64).collect()),
        });
        mapped.insert(key, m);
    }
    v.write("data.columns", Val::typed(Edits(edits)))?;
    v.write("data.mapped", Val::typed(mapped))
}

/// The planted decimation: m4 without each column's last row.
fn decimate_drops_last(v: &mut View<'_>) -> Result<(), OpError> {
    decimated_rows(v, crate::data::Decimate::DropsLast)
}

fn decimated_board() -> Value {
    // Twelve rows at t = 1..12 flicks over the window [0, 12], three columns of four; in each,
    // v runs 0.5, 0, 1, 0.25.
    let le = |bytes: Vec<u8>| deep_canvas::base64::encode(&bytes);
    let t: Vec<u8> = (1..=12i64).flat_map(i64::to_le_bytes).collect();
    let v: Vec<u8> = (0..12)
        .map(|i| [0.5f32, 0.0, 1.0, 0.25][i % 4])
        .flat_map(f32::to_le_bytes)
        .collect();
    json!({
        "format": 1, "profile": "board", "seed": 399, "title": "Decimated",
        "description": "A line of twelve rows in three pixel columns, decimated by m4: the data module's decimation fixture.",
        "size": [320, 200],
        "items": {
            "line": {"id": "line", "kind": "series@1", "name": "Line", "order": "a0",
                     "params": {"t": {"dtype": "i64", "len": 12, "data": le(t)},
                                "v": {"dtype": "f32", "len": 12, "data": le(v)},
                                "window": [0, 12], "decimate": "m4", "bucket": "1px",
                                "marks": ["line"], "box": [20, 20, 3, 60]}}
        }
    })
}

fn is_scale(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("scale@1")
}

/// A scale's nice domain, range and step, and its ticks with their labels (`data.scale`).
#[derive(Clone, Debug, PartialEq)]
pub struct ScaleValue {
    pub domain: [f64; 2],
    pub range: [f64; 2],
    pub step: f64,
    pub ticks: Vec<(f64, String)>,
}

impl deep_canvas::schedule::Canonical for ScaleValue {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(
            &(&self.domain, &self.range, &self.step, &self.ticks),
            out,
        );
    }
}

/// A scale's nice domain, range, step and labelled ticks.
fn scale(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = fields_of(v)?;
    let id = v.id().unwrap_or_default();
    let s = crate::data::scale_of(id, &fields).map_err(refused)?;
    v.write(
        "data.scale",
        Val::typed(ScaleValue {
            domain: s.domain,
            range: s.range,
            step: s.step,
            ticks: s.ticks(),
        }),
    )
}

/// A race with its labels, a growing axis and a counter on `#period`: every part reads the bars'
/// rows at t, so a frame played and a frame sought draw the same.
fn race_board() -> Value {
    let i32s = |v: &[i32]| {
        let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
        json!({"dtype": "i32", "len": v.len(), "data": deep_canvas::base64::encode(&bytes)})
    };
    let at = "items/bars/params/transforms/0/periods/at";
    json!({
        "format": 1, "profile": "board", "seed": 167, "title": "Race",
        "description": "Two periods of three keys, with labels, an axis and a year: the data module's race.",
        "size": [320, 200],
        "items": {
            "slots": {"id": "slots", "kind": "scale@1", "name": "Slots", "order": "a0",
                      "params": {"domain": [1, 4], "range": [20, 260], "nice": false}},
            "ends": {"id": "ends", "kind": "scale@1", "name": "Ends", "order": "a1",
                     "params": {"domain": [1, 4], "range": [80, 320], "nice": false}},
            "ys": {"id": "ys", "kind": "scale@1", "name": "Values", "order": "a2",
                   "params": {"domain": "periods", "range": [180, 20]}},
            "bars": {"id": "bars", "kind": "marks@1", "name": "Bars", "order": "a3", "params": {
                "mark": "bar", "n": 6, "key": "key",
                "columns": {"year": i32s(&[2000, 2000, 2000, 2001, 2001, 2001]),
                            "key": {"dtype": "str", "len": 6, "data": ["a", "b", "c", "a", "b", "c"]},
                            "value": i32s(&[10, 20, 30, 40, 25, 15])},
                "transforms": [{"periods": {"by": "year", "at": 2000}}, {"standing": {"by": "value"}}],
                "encode": {"x": {"column": "standing", "scale": "slots"},
                           "x2": {"column": "standing", "scale": "ends"},
                           "y": {"column": "value", "scale": "ys"}},
                "paint": {"fill": {"role": "ink"}}}},
            "labels": {"id": "labels", "kind": "marks@1", "name": "Labels", "order": "a4", "params": {
                "mark": "text", "rows_of": "bars",
                "encode": {"x": {"column": "standing", "scale": "slots"},
                           "y": {"column": "value", "scale": "ys"},
                           "text": {"column": "value"}, "size": 11},
                "paint": {"fill": {"role": "muted"}}}},
            "axis": {"id": "axis", "kind": "axis@1", "name": "Axis", "order": "a5",
                     "params": {"scale": "ys", "side": "left", "at": 16}},
            "year": {"id": "year", "kind": "text@1", "name": "Year", "order": "a6",
                     "params": {"text": {"counter": {"source": "items/bars#period/by", "tabular": true,
                                                     "format": {"group": "none"}}},
                                "size": 13, "box": {"w": 60, "h": 20}, "widest": "8888"}}
        },
        "channels": {"at": {"target": at, "type": "f32", "keys": {
            "k0": {"t": "0s", "value": 2000, "interp": "linear"},
            "k1": {"t": "1s", "value": 2001, "interp": "linear"}}}},
        "transport": {"span": "1s"}
    })
}

fn points_board() -> Value {
    json!({
        "format": 1, "profile": "board", "seed": 388, "title": "Points",
        "description": "Two points placed through a linear scale, with its axis: the data module's fixture.",
        "size": [320, 200],
        "items": {
            "x": {"id": "x", "kind": "scale@1", "name": "X", "order": "a0",
                  "params": {"domain": [0, 10], "range": [20, 300]}},
            // [2.0, 5.0] as little-endian f64.
            "dots": {"id": "dots", "kind": "marks@1", "name": "Dots", "order": "a1",
                     "params": {"mark": "point", "n": 2, "key": "k",
                                "columns": {"v": {"dtype": "f64", "len": 2, "data": "AAAAAAAAAEAAAAAAAAAUQA=="},
                                            "k": {"dtype": "str", "len": 2, "data": ["a", "b"]}},
                                "encode": {"x": {"column": "v", "scale": "x"}, "y": 80, "size": 8}}},
            "axis": {"id": "axis", "kind": "axis@1", "name": "Axis", "order": "a2",
                     "params": {"scale": "x", "side": "bottom"}, "at": {"pos": [0, 140, 0]}}
        }
    })
}

// ------------------------------------------------------------------------------------------------
// marks2d

/// The marks2d module.
pub fn marks2d() -> Module {
    Module {
        manifest: manifest("marks2d", &["text", "look"]),
        register: register_marks2d,
    }
}

/// The marks2d module with a planted relation solve (#221), whose `constraint@1` entries' fixtures
/// the constraint kit must refuse at the seal.
pub fn marks2d_planted(planted: relations::Planted) -> Module {
    Module {
        register: match planted {
            relations::Planted::None => register_marks2d,
            relations::Planted::Iterates => {
                |r| register_marks2d_with(r, relations::Planted::Iterates)
            }
            relations::Planted::PreviousPlace => {
                |r| register_marks2d_with(r, relations::Planted::PreviousPlace)
            }
        },
        ..marks2d()
    }
}

/// What the frame draws: the draw list, each text's shaped run and each animated text's units as
/// `[lift, opacity]`. The status marks are the text module's (`text.status`).
#[derive(Debug)]
pub struct Drawing {
    pub frame: Frame,
    pub runs: BTreeMap<String, Arc<Run>>,
    pub animated: BTreeMap<String, Vec<[f64; 2]>>,
    /// The marks this frame put into its draw list: every mark when it built the list, the
    /// changed items' when it replaced them in the last one (#896).
    pub built: usize,
    /// Each layer whose marks it replaced in place, for a view to upload those alone (#896).
    pub damage: Vec<Damage>,
    /// What the next frame replaces marks by; `None` when it builds the whole list.
    pub basis: Option<Basis>,
}

/// The marks a frame replaced in one layer of the last frame's list: the layer's place, its key
/// before, and each replaced mark's place in it.
#[derive(Clone, Debug)]
pub struct Damage {
    pub layer: usize,
    pub was: crate::key::ContentKey,
    pub marks: Vec<usize>,
}

/// A frame's list as the next one replaces marks in it (#896): built from items each of which
/// placed its own marks, from this envelope, with where each item's marks sit.
#[derive(Clone, Debug)]
pub struct Basis {
    envelope: Key,
    places: scene::Places,
}

/// A frame by its size, its ground and each layer's ID and content key, which covers every mark
/// the layer draws.
impl Canonical for Frame {
    fn encode(&self, out: &mut Vec<u8>) {
        (self.size, self.ground).encode(out);
        self.layers.len().encode(out);
        for l in &self.layers {
            (&l.id, l.key.0).encode(out);
        }
    }
}

impl deep_canvas::schedule::Canonical for Drawing {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.frame, &self.runs, &self.animated), out);
    }
}

fn register_marks2d(r: &mut Registrar) {
    register_marks2d_with(r, relations::Planted::None);
}

fn register_marks2d_with(r: &mut Registrar, planted: relations::Planted) {
    // #443: a path@1 item's outline, marks2d's entry in the core's `outline.source@1`.
    r.outline_source(
        "path",
        json!({"form": "path", "fixture": crate::outline_sources::path_fixture()}),
        crate::outline_sources::path_fill,
    );
    // #221: placement by relation, the module's entries in the core's `constraint@1`.
    for (name, value) in relations::entries(planted) {
        r.entry("constraint@1", name, value, "R2");
    }
    // Each frame, every placed item's world position from its relations, solved in one order
    // over the evaluated boxes; then each placed item's own transform there.
    r.array("marks2d.places", "places", "document", "transform", "items");
    r.operator(
        "relations",
        "items",
        &[
            "refs",
            "core.world",
            "core.transform",
            "core.fields",
            "text.run",
            "text.counter",
            "table:text.fonts",
        ],
        &["marks2d.places"],
    )
    .document()
    .applies(has_relations)
    .run(relations_op);
    r.array("marks2d.at", "transform", "item", "transform", "items");
    r.operator(
        "place",
        "items",
        &["core.world", "marks2d.places"],
        &["marks2d.at"],
    )
    .applies(is_placed)
    .run(place_op);
    r.code(
        relations::CYCLE,
        "Items placed by relation that read each other back, through relations or parents.",
        "Place one item of the chain by something outside it, so no relation reads back.",
        false,
    );
    r.array(
        "marks2d.frame",
        "draw_list",
        "document",
        "geometry",
        "extract",
    );
    // #857: each R1 item's marks, built from the item alone on its own node, so a board's items
    // build on the scheduler's pool; the frame places them.
    r.array("marks2d.item", "placed", "item", "geometry", "extract");
    r.operator(
        "item",
        "extract",
        &[
            "core.fields",
            "core.world",
            "marks2d.at",
            "text.counter",
            "look.palette",
            "view(locale)",
        ],
        &["marks2d.item"],
    )
    .applies(|_, _, item| {
        matches!(
            item.get("kind").and_then(Value::as_str),
            Some("rect@1" | "circle@1" | "path@1" | "text@1")
        )
    })
    .run(item);
    r.operator(
        "frame",
        "extract",
        &[
            "refs",
            "reading",
            "core.world",
            "marks2d.at",
            "core.fields",
            "text.counter",
            "text.run",
            "text.animated",
            "look.palette",
            "marks2d.item",
        ],
        &["marks2d.frame"],
    )
    .document()
    .run(frame);
    r.code(
        "bad_doc",
        "An item missing a field the marks module draws it from, or holding one it can't read.",
        "Give the item the field its kind draws from, such as a box, a center or path data.",
        false,
    );
    r.code(
        "bad_paint",
        "A paint the marks module can't read: a role that isn't a name, or a malformed gradient or steps.",
        "Write the paint as a role name, a gradient or steps the paint section defines.",
        false,
    );
    r.code(
        "role_unresolved",
        "A paint names a role the look doesn't hold.",
        "Name one of the look's roles, such as ink, muted, accent or ground.",
        false,
    );
    r.code(
        "gradient_kind",
        "A gradient of a kind the marks module doesn't draw.",
        "Use a linear, radial or sweep gradient, or along on a stroke.",
        false,
    );
    r.code(
        "gradient_stops",
        "A gradient with fewer than two stops, or more than it can draw.",
        "Give the gradient between two and the most stops it allows.",
        false,
    );
    r.code(
        "bad_path_data",
        "A path's data that doesn't parse as path commands.",
        "Write the path data as SVG path commands with all their numbers.",
        false,
    );
    r.code(
        "mask_r2",
        "A mask the marks module can't clip by yet: a shape other than a rect, a feather, an inverted or a combined mask.",
        "Use an unfeathered rect mask that adds, or wait for the module that draws the others.",
        false,
    );
    r.code(
        "mask_writer",
        "A mask over an item in another writer's layer.",
        "Mask only items in the mask's own layer.",
        false,
    );
    r.code(
        "mask_depth",
        "More than four masks clip one item.",
        "Nest at most four masks over an item.",
        false,
    );
    r.code(
        "bad_asset",
        "An image whose asset isn't the sha256 of a stored file.",
        "Name the asset by the 64 hex digits of its sha256.",
        false,
    );
    r.code(
        "alt_missing",
        "An image with no alt text.",
        "Give the image an alt text that says what it shows.",
        false,
    );
    r.code(
        "bad_column",
        "A mark set's column that doesn't decode to the set's rows.",
        "Write the column as a constant, or `n` values of its dtype.",
        false,
    );
    r.code(
        "asset_missing",
        "A mark set's column whose sidecar data no store inlined.",
        "Store the sidecar file, or inline the column's data.",
        false,
    );
    r.code(
        "bad_transform",
        "A mark set's transform that isn't on the closed list, or a field of one it can't read.",
        "Use periods, standing, reveal or emphasis, with the columns and channels they name.",
        false,
    );
    r.code(
        "log_domain",
        "A value at or below 0 reaches a log scale, which has no place for it.",
        "Use a symlog scale, or leave the row out of the set.",
        false,
    );
    r.code(
        "scale_type",
        "A scale of a type the marks module doesn't map.",
        "Use a linear, log, symlog, time, ordinal or quantize scale.",
        false,
    );
    r.code(
        "bad_scale",
        "A scale without a domain or range of two numbers.",
        "Give the scale a domain and a range, each two numbers.",
        false,
    );
    r.code(
        "bad_encode",
        "A mark set's encoding the marks module can't place a row by.",
        "Encode x and y, each a column of the set or a number.",
        false,
    );
    r.code(
        "key_not_unique",
        "A mark set's key column that holds one key twice.",
        "Give every row its own key.",
        false,
    );
    r.code(
        "bad_axis",
        "An axis with no scale, or on a side it can't take.",
        "Name the axis's scale, and a side of bottom, top, left or right.",
        false,
    );
    r.fixture("board", marks_board(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/box/params/box", "value": [22, 16, 80, 48]},
    }));
}

/// Whether `item` holds a relation.
fn holds_relation(item: &Value) -> bool {
    item.get("at")
        .is_some_and(|a| a.get("place").is_some() || a.get("align").is_some())
}

fn has_relations(doc: &Value, _: &str, _: &Value) -> bool {
    doc.get("items")
        .and_then(Value::as_object)
        .is_some_and(|items| items.values().any(holds_relation))
}

/// Whether a relation moves `item`: its own, or an ancestor's, which carries it.
fn is_placed(doc: &Value, _: &str, item: &Value) -> bool {
    let items = doc.get("items").and_then(Value::as_object);
    let mut at = Some(item);
    for _ in 0..=items.map_or(0, Map::len) {
        let Some(i) = at else { break };
        if holds_relation(i) {
            return true;
        }
        at = i
            .get("parent")
            .and_then(Value::as_str)
            .and_then(|p| items?.get(p));
    }
    false
}

/// Every placed item's world position, by ID.
#[derive(Debug, PartialEq)]
pub struct Places(pub BTreeMap<String, [f64; 3]>);

impl Canonical for Places {
    fn encode(&self, out: &mut Vec<u8>) {
        self.0.len().encode(out);
        for (id, p) in &self.0 {
            (id, p[0], p[1], p[2]).encode(out);
        }
    }
}

/// The boxes items take in the frame: marks2d's geometry, and each text's shaped run (a bound
/// value's at its `widest`).
struct Runs<'a> {
    runs: BTreeMap<&'a str, Arc<Run>>,
    bound: std::collections::BTreeSet<String>,
    fonts: Arc<Shapers>,
}

impl Runs<'_> {
    fn shaped(&self, id: &str, item: &Value) -> Option<Arc<Shaped>> {
        let run = self.runs.get(id)?;
        let widest = item
            .get("params")
            .and_then(|p| p.get("widest"))
            .and_then(Value::as_str);
        match widest {
            Some(w) if self.bound.contains(id) => {
                let spec = TextSpec {
                    text: w.to_string(),
                    ..run.spec.clone()
                };
                Some(self.fonts.lock()?.shape(&spec.shaper_spec()?))
            }
            _ => Some(Arc::clone(&run.shaped)),
        }
    }
}

impl relations::Bounds for Runs<'_> {
    fn own(&mut self, id: &str, item: &Value, part: Option<&str>) -> Option<relations::Box4> {
        if part.is_some() {
            return None;
        }
        let kind = item.get("kind").and_then(Value::as_str)?;
        let params = object_or_empty(item.get("params"));
        if kind == "text@1" {
            let shaped = self.shaped(id, item)?;
            let w = params
                .get("box")
                .and_then(|b| b.get("w"))
                .and_then(Value::as_f64)
                .unwrap_or(f64::from(shaped.width));
            let local = [0.0, 0.0, w, f64::from(shaped.height)];
            return Some(relations::placed(local, relations::place_of(item, None)));
        }
        let local = relations::own_box(kind, params)?;
        Some(relations::placed(
            local,
            relations::place_of(item, Some(local)),
        ))
    }

    fn baseline(&mut self, id: &str, item: &Value) -> Option<f64> {
        let shaped = self.shaped(id, item)?;
        let (_, offset) = relations::place_of(item, None);
        Some(offset[1] + f64::from(shaped.glyphs.first()?.y))
    }
}

/// The relations solved over the frame's evaluated items (#221).
fn relations_op(v: &mut View<'_>) -> Result<(), OpError> {
    let doc = v.document()?;
    let frame = relations::Frame::of(object_or_empty(Some(doc)));
    // A relation reads its target where it draws: frames laid out first (#375), so an item
    // placed beside a frame's child reads the child's laid-out box (#1162).
    let mut items = placed_items(v)?;
    scene::as_written(object_or_empty(Some(doc)), &mut items);
    let mut items = scene::laid_out(object_or_empty(Some(doc)), &items)
        .map_err(refused)?
        .into_owned();
    // Each item's own `at.pos`, before its parents: what a relation adds after it.
    let offsets: BTreeMap<String, [f64; 2]> = v
        .every("core.transform")?
        .into_iter()
        .filter_map(|(id, t)| {
            let t = t.as_typed::<Transform>()?;
            Some((id.to_string(), [t.pos[0], t.pos[1]]))
        })
        .collect();
    let runs = v
        .every("text.run")?
        .into_iter()
        .filter_map(|(id, r)| r.as_typed::<Run>().map(|r| (id, r)))
        .collect();
    let bound = v
        .every("text.counter")?
        .into_iter()
        .filter(|(_, s)| s.as_typed::<Option<Shown>>().is_some_and(|s| s.is_some()))
        .map(|(id, _)| id.to_string())
        .collect();
    let fonts = v.table::<Shapers>("text.fonts")?;
    let before: BTreeMap<String, Value> = items
        .iter()
        .map(|(id, i)| (id.clone(), i["at"]["pos"].clone()))
        .collect();
    let mut runs = Runs { runs, bound, fonts };
    relations::place(
        &mut items,
        &offsets,
        frame,
        &mut runs,
        &mut relations::Ops::default(),
    )
    .map_err(|r| OpError::new(r.code, r.path))?;
    let mut places = BTreeMap::new();
    for (id, item) in &items {
        let pos = &item["at"]["pos"];
        if before.get(id) != Some(pos) {
            let n = |i: usize| pos[i].as_f64().unwrap_or(0.0);
            places.insert(id.clone(), [n(0), n(1), n(2)]);
        }
    }
    v.write("marks2d.places", Val::typed(Places(places)))
}

/// A placed item's world transform at its place (#221).
fn place_op(v: &mut View<'_>) -> Result<(), OpError> {
    let id = v.id().unwrap_or_default();
    let world = v.typed::<Transform>("core.world")?;
    let places = v.typed::<Places>("marks2d.places")?;
    let placed = match (world, places.as_ref().and_then(|p| p.0.get(id))) {
        (Some(w), Some(pos)) => Transform { pos: *pos, ..*w },
        (Some(w), None) => *w,
        _ => return Ok(()),
    };
    v.write("marks2d.at", Val::typed(placed))
}

/// One item's marks, built from the item alone (#857); `None` for an item the frame builds
/// itself.
fn item(v: &mut View<'_>) -> Result<(), OpError> {
    let id = v.id().unwrap_or("");
    let fields = v.typed::<Fields>("core.fields")?;
    let world = match v.typed::<Transform>("marks2d.at")? {
        Some(placed) => Some(placed),
        None => v.typed::<Transform>("core.world")?,
    };
    let shown = v
        .typed::<Option<Shown>>("text.counter")?
        .and_then(|s| (*s).clone());
    // A text's marks move with the locale's formatting; it keys every item's marks, as shaping does.
    let _ = v.locale()?;
    let look = v
        .typed::<LookValue>("look.palette")?
        .ok_or_else(|| OpError::new("input_missing", "look"))?;
    let placed = fields.and_then(|f| {
        let item = item_json(&f, world.as_deref());
        scene::item_placed(id, &item, &look.palette, shown.as_ref())
    });
    v.write("marks2d.item", Val::typed(placed))
}

/// What a frame reads of the document beside its items: every other member, as written.
fn envelope_of(doc: &Value) -> Key {
    let mut h = Hasher::new("marks2d.envelope");
    for (k, v) in doc.as_object().into_iter().flatten() {
        if k != "items" {
            h.text(k).bytes(&canonical(v));
        }
    }
    h.finish()
}

/// The last frame's draw list with the marks of the items whose own marks changed replaced in
/// place (#896: "a changed item rebuilds and re-uploads only itself"), when that list was built
/// from items that each placed their own marks, the envelope is the same and no text's run
/// changed. `None` sends the frame to build the whole list, as it must give the same list.
fn replaced(v: &mut View<'_>, envelope: Key) -> Result<Option<Drawing>, OpError> {
    let Some(last) = v
        .last("marks2d.frame")
        .and_then(|d| d.as_typed::<Drawing>())
    else {
        return Ok(None);
    };
    let Some(basis) = last.basis.as_ref().filter(|b| b.envelope == envelope) else {
        return Ok(None);
    };
    let Some(at) = basis.places.at.clone() else {
        return Ok(None);
    };
    // The palette's ground, or the runs it carries.
    if v.changed("look.palette")?.is_none() {
        return Ok(None);
    }
    for name in ["text.run", "text.animated"] {
        if v.changed(name)?.is_none_or(|ids| !ids.is_empty()) {
            return Ok(None);
        }
    }
    let Some(ids) = v.changed("marks2d.item")? else {
        return Ok(None);
    };
    let mut frame = last.frame.clone();
    let mut trees = basis.places.trees.clone();
    let mut damage: Vec<Damage> = Vec::new();
    let mut built = 0;
    for id in ids {
        let Some(&(li, first, count)) = at.get(id) else {
            return Ok(None);
        };
        let placed = v.at("marks2d.item", id)?;
        let Some(p) = placed
            .as_ref()
            .and_then(|p| p.as_typed::<Option<scene::Placed>>())
        else {
            return Ok(None);
        };
        let (li, first, count) = (li as usize, first as usize, count as usize);
        let layer = &mut frame.layers[li];
        let fits = |p: &scene::Placed| {
            p.layer == layer.id && p.drawn.len() == count && p.keys.len() == count
        };
        let Some(p) = p.as_ref().as_ref().filter(|p| fits(p)) else {
            return Ok(None);
        };
        let at_layer = match damage.iter().position(|d| d.layer == li) {
            Some(k) => k,
            None => {
                damage.push(Damage {
                    layer: li,
                    was: layer.key,
                    marks: Vec::new(),
                });
                damage.len() - 1
            }
        };
        for k in 0..count {
            check_font(&p.drawn[k])?;
            layer.marks.set(first + k, Arc::clone(&p.drawn[k]));
            trees[li].set(first + k, Key(p.keys[k].0));
            damage[at_layer].marks.push(first + k);
        }
        built += count;
    }
    for d in &damage {
        let layer = &mut frame.layers[d.layer];
        layer.key = scene::layer_key(&layer.id, frame.size, 1.0, &trees[d.layer]);
    }
    Ok(Some(Drawing {
        frame,
        runs: last.runs.clone(),
        animated: last.animated.clone(),
        built,
        damage,
        basis: Some(Basis {
            envelope,
            places: scene::Places {
                at: Some(at),
                trees,
            },
        }),
    }))
}

/// A text mark's font names a role the shaper bundles.
fn check_font(drawn: &scene::Drawn) -> Result<(), OpError> {
    if let Mark::Text { item, spec, .. } = &drawn.mark {
        if Role::parse(&spec.font).is_none() {
            return Err(OpError::new(
                "out_of_range",
                format!("items/{item}/params/font"),
            ));
        }
    }
    Ok(())
}

/// The frame's draw list from every item's evaluated fields and transform.
fn frame(v: &mut View<'_>) -> Result<(), OpError> {
    let doc = v.document()?;
    let planted = scene::Planted::named(v.planted());
    let envelope = envelope_of(doc);
    if let Some(drawing) = replaced(v, envelope)? {
        return v.write("marks2d.frame", Val::typed(drawing));
    }
    let record = record_of(v.outside()?);
    // Each item's transform, looked up only for the items the frame builds itself.
    let worlds = worlds_of(v)?;
    let world = |id: &str| worlds.get(id).and_then(|w| w.as_typed::<Transform>());
    let fields: Vec<(&str, Arc<Fields>)> = v
        .every("core.fields")?
        .into_iter()
        .filter_map(|(id, f)| f.as_typed::<Fields>().map(|f| (id, f)))
        .collect();
    // Each item's own marks, in item order as the fields are; an item out of that order is built
    // by the frame, which draws it the same.
    let prebuilt: Vec<(&str, Arc<Option<scene::Placed>>)> = v
        .every("marks2d.item")?
        .into_iter()
        .filter_map(|(id, p)| p.as_typed::<Option<scene::Placed>>().map(|p| (id, p)))
        .collect();
    let mut prebuilt = prebuilt.iter().peekable();
    // An item in a collection or naming a layer the document lacks, and one that is a parent,
    // draws in a scope other items set or is refused: the frame builds those itself.
    let members: std::collections::BTreeSet<&str> = doc["collections"]
        .as_object()
        .into_iter()
        .flat_map(|c| c.values())
        .flat_map(|c| c["members"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .collect();
    let layers = doc["layers"].as_object();
    let mut items = Map::new();
    let mut held: Vec<(&str, &Fields, &scene::Placed)> = Vec::new();
    for (id, f) in &fields {
        let own = prebuilt.next_if(|(i, _)| i == id).map(|(_, p)| p);
        match own.and_then(|p| p.as_ref().as_ref()) {
            Some(p)
                if !members.contains(id) && layers.is_some_and(|l| l.contains_key(&p.layer)) =>
            {
                held.push((id, f, p));
            }
            _ => {
                items.insert(id.to_string(), item_json(f, world(id).as_deref()));
            }
        }
    }
    // A prebuilt item has no parent, so every parent's child is among the items built here.
    let parents: std::collections::BTreeSet<String> = items
        .values()
        .filter_map(|i| i.get("parent").and_then(Value::as_str).map(str::to_string))
        .collect();
    let mut placed: Vec<(&str, &scene::Placed)> = Vec::new();
    for (id, f, p) in held {
        if parents.contains(id) {
            items.insert(id.to_string(), item_json(f, world(id).as_deref()));
        } else {
            placed.push((id, p));
        }
    }
    let mut bound = BTreeMap::new();
    for (id, s) in v.every("text.counter")? {
        if let Some(shown) = s.as_typed::<Option<Shown>>().and_then(|s| (*s).clone()) {
            bound.insert(id.to_string(), shown);
        }
    }
    let mut runs = BTreeMap::new();
    for (id, r) in v.every("text.run")? {
        if let Some(run) = r.as_typed::<Run>() {
            runs.insert(id.to_string(), run);
        }
    }
    let mut animated = BTreeMap::new();
    for (id, a) in v.every("text.animated")? {
        if let Some(units) = a.as_typed::<Vec<[f64; 2]>>() {
            animated.insert(id.to_string(), (*units).clone());
        }
    }
    let look = v
        .typed::<LookValue>("look.palette")?
        .ok_or_else(|| OpError::new("input_missing", "look"))?;
    let empty = Map::new();
    let doc = doc.as_object().unwrap_or(&empty);
    // A text on a mark set's anchor reads rows its own operator doesn't see.
    let locale = doc.get("locale").and_then(Value::as_str).unwrap_or("en");
    for (id, item) in items.iter().filter(|(_, i)| scene::reads_anchor(i)) {
        if let Some(shown) =
            scene::text_at(doc, &items, id, item, &record, locale).map_err(refused)?
        {
            bound.insert(id.clone(), shown);
        }
    }
    let (frame, basis) =
        match scene::frame_prebuilt(doc, &items, &look.palette, 1.0, &bound, &record, &placed, planted)
            .map_err(refused)?
        {
            // A list of items that each placed their own marks is one the next frame can
            // replace marks in.
            Some((frame, places)) => (
                frame,
                items.is_empty().then_some(Basis { envelope, places }),
            ),
            // A paint spanning boxes reads every item's: the frame builds them all.
            None => {
                let all: Map<String, Value> = fields
                    .iter()
                    .map(|(id, f)| (id.to_string(), item_json(f, world(id).as_deref())))
                    .collect();
                let frame = scene::frame_with(doc, &all, &look.palette, 1.0, &bound, &record, planted)
                    .map_err(refused)?;
                (frame, None)
            }
        };
    for drawn in frame.layers.iter().flat_map(|l| &l.marks) {
        check_font(drawn)?;
    }
    let built = frame.layers.iter().map(|l| l.marks.len()).sum();
    v.write(
        "marks2d.frame",
        Val::typed(Drawing {
            frame,
            runs,
            animated,
            built,
            damage: Vec::new(),
            basis,
        }),
    )
}

fn marks_board() -> Value {
    json!({
        "format": 1, "profile": "board", "seed": 387, "title": "Marks",
        "description": "A box, a ring, a path and a label on a ground: the marks2d module's fixture.",
        "size": [320, 200],
        "items": {
            "ground": {"id": "ground", "kind": "rect@1", "name": "Ground", "order": "a0",
                       "params": {"box": [0, 0, 320, 200], "paint": {"fill": {"role": "ground"}}}},
            "box": {"id": "box", "kind": "rect@1", "name": "Box", "order": "a1",
                    "params": {"box": [16, 16, 80, 48], "radius": 6, "paint": {"fill": {"role": "ink"}}}},
            "ring": {"id": "ring", "kind": "circle@1", "name": "Ring", "order": "a2",
                     "params": {"center": [160, 60], "r": 30, "inner_r": 20, "paint": {"fill": {"role": "muted"}}}},
            "line": {"id": "line", "kind": "path@1", "name": "Line", "order": "a3",
                     "params": {"d": "M 16 140 L 300 120", "paint": {"stroke": {"role": "ink", "width": 2}}}},
            "cap": {"id": "cap", "kind": "text@1", "name": "Caption", "order": "a4",
                    "params": {"text": "Marks", "font": "body", "size": 13, "box": {"w": 120, "h": 20}},
                    "at": {"pos": [16, 170, 0]}}
        }
    })
}
