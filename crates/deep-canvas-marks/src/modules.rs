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
use deep_canvas::schedule::core_ops::{Datum, Edits, Fields, StatusBase, Transform};
use deep_canvas::schedule::{canonical, Canonical, Hasher, Key, OpError, Outside, Val, View};
use deep_text::{Role, Shaped, Shaper};
use serde_json::{json, Map, Value};

use crate::look::Status;
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

/// An item as the marks read it: its fields, at its world transform.
fn item_json(fields: &Fields, world: Option<&Transform>) -> Value {
    let mut item = fields.to_json();
    if let (Some(map), Some(at)) = (item.as_object_mut(), world) {
        map.insert("at".into(), at.to_json());
    }
    item
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
        self.size.encode(out);
        self.weight.encode(out);
        self.width.encode(out);
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
    r.array("text.counter", "shown", "item", "text", "items");
    r.array("text.run", "run", "item", "text", "items");
    r.array("text.animated", "units", "item", "time", "items");
    r.operator(
        "counter",
        "items",
        &["core.lowered", "refs", "reading", "view(locale)"],
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
    is_text(doc, id, item) && (bound || counter || template)
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
    let item = v.json("core.lowered")?.ok_or_else(|| missing(v))?;
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

/// A text animator's coverage of each unit (its glyphs, in order), mapped to a lift and an
/// opacity: `range` with its `offset` selects units, `falloff` softens its edges and `shape`
/// eases them; `props.y` lifts and `props.opacity` fades a covered unit. Under reduced motion
/// only opacity is kept, so units fade in place (Transport).
fn animate(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = fields_of(v)?;
    let run = v.typed::<Run>("text.run")?.ok_or_else(|| missing(v))?;
    let reduced = v.reduced_motion()?;
    let units = run.shaped.glyphs.len();
    let mut out: Vec<[f64; 2]> = vec![[0.0, 1.0]; units];
    let animators = fields
        .get("params")
        .and_then(|p| p.get("animators"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for a in &animators {
        let num = |v: Option<&Value>, d: f64| v.and_then(Value::as_f64).unwrap_or(d);
        let range = a.get("range");
        let offset = num(range.and_then(|r| r.get("offset")), 0.0);
        let (from, to) = (
            num(range.and_then(|r| r.get("from")), 0.0) + offset,
            num(range.and_then(|r| r.get("to")), 1.0) + offset,
        );
        let falloff = num(range.and_then(|r| r.get("falloff")), 0.0);
        let shape = a.get("shape").and_then(Value::as_str).unwrap_or("square");
        let props = a.get("props");
        let lift = num(props.and_then(|p| p.get("y")), 0.0);
        let fade = props.and_then(|p| p.get("opacity")).and_then(Value::as_f64);
        for (i, unit) in out.iter_mut().enumerate() {
            let s = (i as f64 + 0.5) / units.max(1) as f64;
            let d = if s < from {
                from - s
            } else if s > to {
                s - to
            } else {
                0.0
            };
            let mut w = if d == 0.0 {
                1.0
            } else if falloff > 0.0 {
                (1.0 - d / falloff).max(0.0)
            } else {
                0.0
            };
            w = match shape {
                "smooth" => w * w * (3.0 - 2.0 * w),
                "square" => {
                    if w > 0.0 {
                        1.0
                    } else {
                        0.0
                    }
                }
                _ => w,
            };
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
    r.array("look.palette", "palette", "document", "shading", "items");
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
    r.fixture("roles", roles_board(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/ink/params/box", "value": [86, 40, 56, 40]},
    }));
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
        register: register_data,
    }
}

fn register_data(r: &mut Registrar) {
    r.array("data.scale", "scale", "item", "geometry", "items");
    r.operator("scale", "items", &["core.fields"], &["data.scale"])
        .applies(is_scale)
        .run(scale);
    // A scale it can't read raises marks2d's `scale_type` or `bad_scale`, which mark sets and
    // axes raise through the same scale.
    r.fixture("points", points_board(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/x/params/domain", "value": [0, 20]},
    }));
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
        "scale_type",
        "A scale of a type the marks module doesn't map.",
        "Use a linear or time scale.",
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

/// One item's marks, built from the item alone (#857); `None` for an item the frame builds
/// itself.
fn item(v: &mut View<'_>) -> Result<(), OpError> {
    let id = v.id().unwrap_or("");
    let fields = v.typed::<Fields>("core.fields")?;
    let world = v.typed::<Transform>("core.world")?;
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
    let envelope = envelope_of(doc);
    if let Some(drawing) = replaced(v, envelope)? {
        return v.write("marks2d.frame", Val::typed(drawing));
    }
    let record = record_of(v.outside()?);
    // Each item's transform, looked up only for the items the frame builds itself.
    let worlds = v.every("core.world")?;
    let by_id = std::cell::OnceCell::new();
    let world = |id: &str| {
        let by_id: &BTreeMap<&str, &Val> =
            by_id.get_or_init(|| worlds.iter().map(|(i, w)| (*i, w)).collect());
        by_id.get(id).and_then(|w| w.as_typed::<Transform>())
    };
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
    let (frame, basis) =
        match scene::frame_prebuilt(doc, &items, &look.palette, 1.0, &bound, &record, &placed)
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
                let frame = scene::frame_with(doc, &all, &look.palette, 1.0, &bound, &record)
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
