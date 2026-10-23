//! R1's 2D canvas laid out as canvas modules (issue #387; technical design: Canvas modules, the
//! module table's text, look and marks2d rows). Each is one manifest and one register call;
//! its operators read only what they declare, through the scheduler's typed views:
//!
//! - **text**: the one shaper over the bundled fonts (a table), counters and bound values
//!   formatted in the view's locale, each text's shaped run, and text animators, which keep only
//!   opacity under reduced motion (Transport);
//! - **look**: the look's roles resolved from its tokens, with its status map;
//! - **marks2d**: the frame's draw list from every item's evaluated fields and transform, the
//!   formatted texts, the shaped runs and the look, with the status marks.
//!
//! The kinds stay the core's own until a later task moves them; these modules register
//! operators, arrays, a table and fixtures.

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

/// A text's shaped run, with the spec it was shaped from.
#[derive(Debug)]
pub struct Run {
    pub spec: TextSpec,
    pub shaped: Shaped,
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
    r.fixture("counter", counter_board(), Some(counter_record()));
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
    is_text(doc, id, item) && (bound || counter)
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
    r.operator("palette", "items", &["look"], &["look.palette"])
        .document()
        .run(palette);
    r.fixture("roles", roles_board(), None);
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
// marks2d

/// The marks2d module.
pub fn marks2d() -> Module {
    Module {
        manifest: manifest("marks2d", &["text", "look"]),
        register: register_marks2d,
    }
}

/// What the frame draws: the draw list, the status marks, each text's shaped run and each
/// animated text's units as `[lift, opacity]`.
#[derive(Debug)]
pub struct Drawing {
    pub frame: Frame,
    pub status: Vec<StatusMark>,
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
    r.fixture("board", marks_board(), None);
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
    let status = scene::status_marks(doc, &items, &record, look.status.as_ref(), &look.palette)
        .map_err(refused)?;
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
    let mut bytes = format!("{frame:?}{status:?}{animated:?}").into_bytes();
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
                status,
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
