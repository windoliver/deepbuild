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
use std::sync::{Arc, Mutex};

use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver, TableValue};
use deep_canvas::schedule::{OpError, Outside, Val, View};
use deep_text::{Role, Shaped, Shaper};
use serde_json::{json, Map, Value};

use crate::look::Status;
use crate::scene::{self, Frame, Mark, Palette, Record, Refused, Rgb, Shown, StatusMark, TextSpec};

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

fn shown_json(s: &Shown) -> Value {
    json!({"bound": s.bound, "text": s.text, "stale": s.stale, "age": s.age, "changes_at": s.changes_at})
}

fn shown_of(v: &Value) -> Option<Shown> {
    Some(Shown {
        bound: v.get("bound")?.as_str()?.to_string(),
        text: v.get("text")?.as_str()?.to_string(),
        stale: v.get("stale")?.as_bool()?,
        age: v.get("age").and_then(Value::as_i64),
        changes_at: v.get("changes_at").and_then(Value::as_i64),
    })
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

fn fonts() -> TableValue {
    Arc::new(Mutex::new(Shaper::new()))
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
    v.write(
        "text.counter",
        Val::json(shown.as_ref().map_or(Value::Null, shown_json)),
    )
}

/// The item's text shaped once by the one shaper: what drawing and the fit check read.
fn shape(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = v.json("core.fields")?.ok_or_else(|| missing(v))?;
    let shown = v.json("text.counter")?.and_then(|s| shown_of(&s));
    // The locale picks the shaping language; it keys every run, a label's included.
    let _ = v.locale()?;
    let id = v.id().unwrap_or_default();
    let empty = Map::new();
    let params = fields
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let spec = scene::text_spec(id, params, shown.as_ref()).map_err(refused)?;
    // The size is an f32 (Text `text@1`: `size: f32`): one past its range is an infinity.
    if !(spec.size as f32).is_finite() {
        return Err(OpError::new(
            "out_of_range",
            format!("items/{id}/params/size"),
        ));
    }
    let fonts = v.table::<Mutex<Shaper>>("text.fonts")?;
    let Some(shaper_spec) = spec.shaper_spec() else {
        return Err(OpError::new(
            "out_of_range",
            format!("items/{id}/params/font"),
        ));
    };
    let shaped = fonts
        .lock()
        .map_err(|_| OpError::new("shaper_poisoned", format!("items/{id}")))?
        .shape(&shaper_spec);
    let mut bytes = spec.text.clone().into_bytes();
    for g in &shaped.glyphs {
        bytes.extend_from_slice(&g.id.to_le_bytes());
        bytes.extend_from_slice(&g.font.index.to_le_bytes());
        bytes.extend_from_slice(&g.x.to_bits().to_le_bytes());
        bytes.extend_from_slice(&g.y.to_bits().to_le_bytes());
        bytes.extend_from_slice(&g.size.to_bits().to_le_bytes());
    }
    v.write("text.run", Val::typed(Run { spec, shaped }, bytes))
}

/// A text animator's coverage of each unit (its glyphs, in order), mapped to a lift and an
/// opacity: `range` with its `offset` selects units, `falloff` softens its edges and `shape`
/// eases them; `props.y` lifts and `props.opacity` fades a covered unit. Under reduced motion
/// only opacity is kept, so units fade in place (Transport).
fn animate(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = v.json("core.fields")?.ok_or_else(|| missing(v))?;
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
    v.write("text.animated", Val::json(json!(out)))
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
    let worlds: BTreeMap<&str, Val> = v.every("core.world")?.into_iter().collect();
    let mut items = Map::new();
    for (id, fields) in v.every("core.fields")? {
        let Val::Json(fields) = fields else { continue };
        let mut item = (*fields).clone();
        if let (Some(map), Some(Val::Json(at))) = (item.as_object_mut(), worlds.get(id)) {
            map.insert("at".into(), (**at).clone());
        }
        items.insert(id.to_string(), item);
    }
    let base = v.json("core.status")?.ok_or_else(|| missing(v))?;
    let mut palette = Palette::new();
    for (role, value) in base["roles"].as_object().into_iter().flatten() {
        let c: Option<Vec<u8>> = value.as_array().and_then(|c| {
            c.iter()
                .map(|x| x.as_u64().and_then(|x| u8::try_from(x).ok()))
                .collect()
        });
        if let Some(rgb) = c.and_then(|c| <[u8; 3]>::try_from(c.as_slice()).ok()) {
            palette.insert(role.clone(), rgb);
        }
    }
    let map = Status::from_json(&base["map"]);
    let unmapped = unmapped();
    let status = map.as_ref().unwrap_or(&unmapped);
    let empty = Map::new();
    let doc = doc.as_object().unwrap_or(&empty);
    let marks =
        scene::status_marks(doc, &items, &record, Some(status), &palette).map_err(refused)?;
    let height = doc
        .get("size")
        .and_then(|s| s.get(1))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let fonts = v.table::<Mutex<Shaper>>("text.fonts")?;
    let mut shaper = fonts
        .lock()
        .map_err(|_| OpError::new("shaper_poisoned", "status_bindings"))?;
    let out = status_drawing(marks, map.as_ref(), &palette, height, &mut shaper);
    let bytes = format!("{out:?}").into_bytes();
    v.write("text.status", Val::typed(out, bytes))
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
    let mut bytes = Vec::new();
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
        bytes.extend_from_slice(role.as_bytes());
        bytes.extend_from_slice(&rgb);
        palette.insert(role.clone(), rgb);
    }
    let status = clean().status;
    bytes.extend_from_slice(format!("{status:?}").as_bytes());
    let map = status.as_ref().map(Status::to_json).unwrap_or(Value::Null);
    v.write(
        "look.status",
        Val::json(json!([{"op": "set", "path": ["map"], "value": map}])),
    )?;
    v.write(
        "look.palette",
        Val::typed(LookValue { palette, status }, bytes),
    )
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

/// A scale's nice domain, range, step and labelled ticks.
fn scale(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = v.json("core.fields")?.ok_or_else(|| missing(v))?;
    let id = v.id().unwrap_or_default();
    let s = crate::data::scale_of(id, &fields).map_err(refused)?;
    let ticks: Vec<Value> = s.ticks().into_iter().map(|(t, l)| json!([t, l])).collect();
    v.write(
        "data.scale",
        Val::json(json!({"domain": s.domain, "range": s.range, "step": s.step, "ticks": ticks})),
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
}

fn register_marks2d(r: &mut Registrar) {
    r.array(
        "marks2d.frame",
        "draw_list",
        "document",
        "geometry",
        "extract",
    );
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

/// The frame's draw list from every item's evaluated fields and transform.
fn frame(v: &mut View<'_>) -> Result<(), OpError> {
    let doc = v.document()?;
    let record = record_of(v.outside()?);
    let worlds: BTreeMap<&str, Val> = v.every("core.world")?.into_iter().collect();
    let mut items = Map::new();
    for (id, fields) in v.every("core.fields")? {
        let Val::Json(fields) = fields else { continue };
        let mut item = (*fields).clone();
        if let (Some(map), Some(Val::Json(at))) = (item.as_object_mut(), worlds.get(id)) {
            map.insert("at".into(), (**at).clone());
        }
        items.insert(id.to_string(), item);
    }
    let mut bound = BTreeMap::new();
    for (id, s) in v.every("text.counter")? {
        if let Val::Json(j) = &s {
            if let Some(shown) = shown_of(j) {
                bound.insert(id.to_string(), shown);
            }
        }
    }
    let mut runs = BTreeMap::new();
    for (id, r) in v.every("text.run")? {
        if let Val::Any(any, _) = r {
            if let Ok(run) = any.downcast::<Run>() {
                runs.insert(id.to_string(), run);
            }
        }
    }
    let mut animated = BTreeMap::new();
    for (id, a) in v.every("text.animated")? {
        if let Val::Json(j) = a {
            let units: Vec<[f64; 2]> = serde_json::from_value((*j).clone()).unwrap_or_default();
            animated.insert(id.to_string(), units);
        }
    }
    let look = v
        .typed::<LookValue>("look.palette")?
        .ok_or_else(|| OpError::new("input_missing", "look"))?;
    let empty = Map::new();
    let doc = doc.as_object().unwrap_or(&empty);
    let frame =
        scene::frame_with(doc, &items, &look.palette, 1.0, &bound, &record).map_err(refused)?;
    // Each text mark's font names a role the shaper bundles.
    for drawn in frame.layers.iter().flat_map(|l| &l.marks) {
        if let Mark::Text { item, spec, .. } = &drawn.mark {
            if Role::parse(&spec.font).is_none() {
                return Err(OpError::new(
                    "out_of_range",
                    format!("items/{item}/params/font"),
                ));
            }
        }
    }
    let mut bytes = format!("{frame:?}{animated:?}").into_bytes();
    for (id, run) in &runs {
        bytes.extend_from_slice(id.as_bytes());
        for g in &run.shaped.glyphs {
            bytes.extend_from_slice(&g.id.to_le_bytes());
            bytes.extend_from_slice(&g.x.to_bits().to_le_bytes());
            bytes.extend_from_slice(&g.y.to_bits().to_le_bytes());
        }
    }
    v.write(
        "marks2d.frame",
        Val::typed(
            Drawing {
                frame,
                runs,
                animated,
            },
            bytes,
        ),
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
