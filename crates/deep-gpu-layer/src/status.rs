//! Status where it can show (issue #382; canvas primitives: The status-color rule, Status
//! binding, Status guard): the look's status map in a theme, the check of a document's data roles
//! against it, the status marks of a 3D document's bindings (a badge chip at the item's screen
//! box, the state's color exact with its glyph) and their legend, rasterized into the status
//! layer the stage composites after the guard, and the report a call answers.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas::color::{srgb_to_oklab, Srgb};
use deep_canvas_marks::look::{self, Status, STATES};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{Scene, Shape, Stroke};
use deep_scene3d_render::status::{Guard, Layer, Mode};
use deep_text::{Atlas, Role, Shaper, Spec, PAGE};
use serde_json::{json, Map, Value};

type Rgb = [u8; 3];

/// A `look@1` with its theme's palette and roles over its own (a theme changes those only).
pub fn themed(look: &Value, theme: &str) -> Value {
    let mut out = look.clone();
    let Some(over) = look.get("themes").and_then(|t| t.get(theme)) else {
        return out;
    };
    for field in ["palette", "roles"] {
        if let (Some(Value::Object(from)), Some(Value::Object(to))) =
            (over.get(field), out.get_mut(field))
        {
            for (k, v) in from {
                to.insert(k.clone(), v.clone());
            }
        }
    }
    out
}

/// The look's status map, `None` for a look without one; a bad one is the look's refusal.
pub fn status_of(look: &Value) -> Result<Option<Status>, Value> {
    let Some(def) = look.as_object() else {
        return Ok(None);
    };
    if !def.contains_key("status") {
        return Ok(None);
    }
    look::status_map(def).map(Some).map_err(|r| r.to_json())
}

/// The call's theme: `light` unless it says `dark`.
pub fn theme_of(call: &Value) -> Result<String, Value> {
    match call.get("theme") {
        None | Some(Value::Null) => Ok("light".to_string()),
        Some(Value::String(t)) if t == "light" || t == "dark" => Ok(t.clone()),
        Some(_) => Err(crate::refused("bad_input", "theme is light or dark")),
    }
}

/// Every look role a document's items name in their params (`role` fields), the roles the
/// look's ground grid draws in when it has one, and `ink` (the legend's and the labels' text),
/// once each, sorted.
pub fn used_roles(doc: &Value, look_json: &Value) -> Vec<String> {
    fn walk(value: &Value, out: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (k, v) in map {
                    match (k.as_str(), v) {
                        ("role", Value::String(r)) if !out.contains(r) => out.push(r.clone()),
                        _ => walk(v, out),
                    }
                }
            }
            Value::Array(list) => list.iter().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    for item in doc["items"]
        .as_object()
        .into_iter()
        .flat_map(|m| m.values())
    {
        if let Some(params) = item.get("params") {
            walk(params, &mut out);
        }
    }
    if !out.iter().any(|r| r == "ink") {
        out.push("ink".to_string());
    }
    let ground = &look_json["ground_3d"];
    if ground["kind"] == "grid" {
        for (key, default) in [("minor", "muted"), ("major", "ink"), ("axis", "accent")] {
            let role = ground["roles"][key].as_str().unwrap_or(default).to_string();
            if !out.contains(&role) {
                out.push(role);
            }
        }
    }
    out.sort();
    out
}

/// The data role within `status`'s distance of a status color, as the look's refusal (the
/// status-color rule: "naming the data role and the status color it clashes with"), checked over
/// the roles `doc`'s items and the look's grid use, the ground aside.
pub fn clash(
    doc: &Value,
    look_json: &Value,
    roles: &Look3,
    status: &Status,
    theme: &str,
) -> Option<Value> {
    for role in used_roles(doc, look_json) {
        if role == "ground" {
            continue;
        }
        let Some(color) = roles.role(&role) else {
            continue;
        };
        if let Some(r) = role_clash(&role, color, status, theme) {
            return Some(r);
        }
    }
    None
}

/// One role's color against the status map: the look's refusal when it comes within the
/// distance of a status color.
pub fn role_clash(role: &str, color: [u8; 3], status: &Status, theme: &str) -> Option<Value> {
    let (state, _) = look::clash(color, status)?;
    Some(json!({
        "ok": false, "code": "status_distance", "theme": theme, "role": role, "state": state,
        "reason": format!("the data role `{role}` comes within the status distance of {state}"),
    }))
}

/// The guard's inputs: the status colors in OKLab and the distance.
pub fn guard_of(status: &Status, min_distance: f64, mode: Mode) -> Guard {
    Guard {
        colors: STATES
            .iter()
            .map(|s| {
                let c = status.colors[s];
                let lab = srgb_to_oklab(Srgb {
                    r: f64::from(c[0]) / 255.0,
                    g: f64::from(c[1]) / 255.0,
                    b: f64::from(c[2]) / 255.0,
                });
                [lab.l, lab.a, lab.b]
            })
            .collect(),
        min_distance,
        mode,
    }
}

/// One status binding: its ID, the item and slot its target names, and its source handle.
#[derive(Clone, Debug, PartialEq)]
pub struct Binding {
    pub id: String,
    pub item: String,
    pub slot: &'static str,
    pub source: String,
}

/// The document's status bindings, in ID order. A 3D object has a material, not a paint, so a
/// binding takes its stroke slot, drawn as an outline around it (#386), or its badge; a fill slot
/// is refused (Status binding).
pub fn bindings(doc: &Value) -> Result<Vec<Binding>, Value> {
    let refused = |code: &str, path: String| json!({"ok": false, "code": code, "path": path});
    let mut out = Vec::new();
    for (id, b) in doc["status_bindings"].as_object().into_iter().flatten() {
        let path = format!("status_bindings/{id}");
        let (Some(target), Some(source)) = (b["target"].as_str(), b["source"].as_str()) else {
            return Err(refused("bad_doc", path));
        };
        let parts: Vec<&str> = target.split('/').collect();
        let (item, slot) = match parts.as_slice() {
            ["items", item, "params", "paint", "badge"] => (*item, "badge"),
            ["items", item, "params", "paint", "stroke"] => (*item, "stroke"),
            ["items", _, "params", "paint", "fill"] => {
                return Err(refused("status_slot_kind", format!("{path}/target")))
            }
            _ => return Err(refused("bad_doc", format!("{path}/target"))),
        };
        if doc["items"].get(item).is_none() {
            return Err(refused("ref_unresolved", format!("{path}/target")));
        }
        out.push(Binding {
            id: id.clone(),
            item: item.to_string(),
            slot,
            source: source.to_string(),
        });
    }
    Ok(out)
}

/// Each stroke binding's outline on its solid, in its state's color, exact, at least the status
/// treatment's core width (#386). A state the record doesn't hold is left to [`layer`], which
/// refuses it; a cylinder's or a sphere's outline isn't drawn yet, so binding one is refused.
pub fn strokes(
    scene: &mut Scene,
    status: &Status,
    bindings: &[Binding],
    states: &BTreeMap<String, String>,
) -> Result<(), Value> {
    for b in bindings.iter().filter(|b| b.slot == "stroke") {
        let Some(&state) = states
            .get(&b.source)
            .and_then(|s| STATES.iter().find(|x| *x == s))
        else {
            continue;
        };
        let color = status.colors[state];
        for solid in scene
            .layers
            .iter_mut()
            .flat_map(|l| &mut l.solids)
            .filter(|s| s.id == b.item)
        {
            if solid.shape != Shape::Box {
                return Err(json!({"ok": false, "code": "stroke_shape",
                    "path": format!("status_bindings/{}/target", b.id)}));
            }
            let width = solid
                .stroke
                .map_or(0.0, |s| s.width)
                .max(status.core_min_px);
            solid.stroke = Some(Stroke {
                color,
                width,
                exact: true,
            });
        }
    }
    Ok(())
}

/// The glyph run's size and weight for a badge chip and for a legend row.
const CHIP_TEXT: (f32, u16) = (11.0, 600);
const LEGEND_TEXT: (f32, u16) = (12.0, 400);
const CHIP_HEIGHT: f64 = 18.0;
const LEGEND_ROW: f64 = 20.0;
const LEGEND_SWATCH: f64 = 12.0;
const LEGEND_MARGIN: f64 = 16.0;

/// The shaper and the glyph atlas the status layer's text is drawn from.
pub struct Text {
    shaper: Shaper,
    atlas: Atlas,
}

impl Default for Text {
    fn default() -> Self {
        Text {
            shaper: Shaper::new(),
            atlas: Atlas::new(),
        }
    }
}

/// A shaped run with its glyphs' rasters placed: `(box w, box h, glyphs: (x, y, placed))`.
struct Run {
    width: f64,
    height: f64,
    glyphs: Vec<(f64, f64, deep_text::Placed)>,
}

impl Text {
    fn run(&mut self, text: &str, (size, weight): (f32, u16)) -> Run {
        let spec = Spec {
            role: Role::Body,
            size,
            weight,
            ..Spec::label(text)
        };
        let shaped = self.shaper.shape(&spec);
        let mut glyphs = Vec::new();
        for g in &shaped.glyphs {
            if let Some(p) = self.atlas.glyph(&g.font, g.id, g.size) {
                glyphs.push((f64::from(g.x), f64::from(g.y), p));
            }
        }
        Run {
            width: f64::from(shaped.width),
            height: f64::from(spec.line_height()),
            glyphs,
        }
    }
}

/// The status layer under construction: premultiplied RGBA at the frame's size.
struct Canvas {
    size: [u32; 2],
    rgba: Vec<u8>,
}

impl Canvas {
    fn new(size: [u32; 2]) -> Canvas {
        Canvas {
            size,
            rgba: vec![0; (size[0] * size[1] * 4) as usize],
        }
    }

    /// `color` over the pixel at `coverage` (one over, premultiplied).
    fn blend(&mut self, x: i64, y: i64, color: Rgb, coverage: f64) {
        if x < 0 || y < 0 || x >= i64::from(self.size[0]) || y >= i64::from(self.size[1]) {
            return;
        }
        let a = coverage.clamp(0.0, 1.0);
        if a <= 0.0 {
            return;
        }
        let i = ((y as u32 * self.size[0] + x as u32) * 4) as usize;
        for (c, &channel) in color.iter().enumerate() {
            let src = f64::from(channel) * a;
            let dst = f64::from(self.rgba[i + c]) * (1.0 - a);
            self.rgba[i + c] = (src + dst).round().clamp(0.0, 255.0) as u8;
        }
        let dst_a = f64::from(self.rgba[i + 3]) * (1.0 - a);
        self.rgba[i + 3] = (255.0 * a + dst_a).round().clamp(0.0, 255.0) as u8;
    }

    /// A rounded rect, antialiased at its edge by the signed distance to it.
    fn round_rect(&mut self, [x, y, w, h]: [f64; 4], radius: f64, color: Rgb) {
        let r = radius.min(w / 2.0).min(h / 2.0).max(0.0);
        let (cx, cy, hw, hh) = (x + w / 2.0, y + h / 2.0, w / 2.0 - r, h / 2.0 - r);
        for py in y.floor() as i64..(y + h).ceil() as i64 {
            for px in x.floor() as i64..(x + w).ceil() as i64 {
                let (dx, dy) = (
                    (px as f64 + 0.5 - cx).abs() - hw,
                    (py as f64 + 0.5 - cy).abs() - hh,
                );
                let outside = (dx.max(0.0).powi(2) + dy.max(0.0).powi(2)).sqrt();
                let inside = dx.max(dy).min(0.0);
                let d = outside + inside - r;
                self.blend(px, py, color, 0.5 - d);
            }
        }
    }

    /// A run's glyphs in `color`, the run's box's top-left at `origin`.
    fn text(&mut self, text: &Text, run: &Run, origin: [f64; 2], color: Rgb) {
        let pages = text.atlas.pages();
        for (gx, gy, p) in &run.glyphs {
            let Some(page) = pages.get(p.page as usize) else {
                continue;
            };
            let bytes = page.bytes();
            let left = (origin[0] + gx).round() as i64 + i64::from(p.left);
            let top = (origin[1] + gy).round() as i64 + i64::from(p.top);
            for row in 0..p.h {
                for col in 0..p.w {
                    let a = bytes[((p.y + row) * PAGE + p.x + col) as usize];
                    if a > 0 {
                        self.blend(
                            left + i64::from(col),
                            top + i64::from(row),
                            color,
                            f64::from(a) / 255.0,
                        );
                    }
                }
            }
        }
    }
}

/// The screen box of an item's solids: every corner of each unit shape through its model and the
/// camera; `None` for an item with nothing on screen.
fn screen_box(scene: &Scene, item: &str) -> Option<[f64; 4]> {
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        if s.id != item {
            continue;
        }
        for k in 0..8 {
            let u = [
                if k & 1 == 0 { -0.5 } else { 0.5 },
                if k & 2 == 0 { -0.5 } else { 0.5 },
                if k & 4 == 0 { -0.5 } else { 0.5 },
            ];
            let m = &s.model;
            let w = [
                m[0][0] * u[0] + m[0][1] * u[1] + m[0][2] * u[2] + m[0][3],
                m[1][0] * u[0] + m[1][1] * u[1] + m[1][2] * u[2] + m[1][3],
                m[2][0] * u[0] + m[2][1] * u[1] + m[2][2] * u[2] + m[2][3],
            ];
            if let Some([x, y, _]) = scene.camera.project(w) {
                lo = [lo[0].min(x), lo[1].min(y)];
                hi = [hi[0].max(x), hi[1].max(y)];
            }
        }
    }
    lo[0]
        .is_finite()
        .then(|| [lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1]])
}

fn boxes_meet(a: [f64; 4], b: [f64; 4]) -> bool {
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
}

fn px_box(b: [f64; 4]) -> Value {
    json!([
        (b[0] * 100.0).round() / 100.0,
        (b[1] * 100.0).round() / 100.0,
        (b[2] * 100.0).round() / 100.0,
        (b[3] * 100.0).round() / 100.0
    ])
}

/// The status layer of a frame and its report: one mark per binding (a badge chip at the top
/// right of the item's screen box, in the state's color with its glyph), and the legend of every
/// state on screen in the first corner clear of the marks, top right first. `roles` is the look
/// the scene was drawn in (its ground is what a chip sits on); `ink` is the legend's text color,
/// the look whose legend shows (a host's on its card). A source the record doesn't hold is
/// `ref_unresolved`, never a guess; a state outside the map is `out_of_range`.
pub fn layer(
    scene: &Scene,
    roles: &Look3,
    ink: [u8; 3],
    status: &Status,
    bindings: &[Binding],
    states: &BTreeMap<String, String>,
    text: &mut Text,
) -> Result<(Layer, Value, Value), Value> {
    let refused = |code: &str, path: String| json!({"ok": false, "code": code, "path": path});
    let size = scene.size;
    let frame = [0.0, 0.0, f64::from(size[0]), f64::from(size[1])];
    let mut canvas = Canvas::new(size);
    let ink_role = ink;
    let ground = roles.ground;
    let mut marks = Vec::new();
    let mut chips: Vec<[f64; 4]> = Vec::new();
    let mut on_screen: Vec<&'static str> = Vec::new();
    struct Chip {
        rect: [f64; 4],
        color: Rgb,
        ink: Rgb,
        run: Run,
        label: [f64; 4],
        /// A stroke mark's glyph draws in its color beside the outline, with no chip.
        bare: bool,
    }
    let mut drawn: Vec<Chip> = Vec::new();
    for b in bindings {
        let path = format!("status_bindings/{}", b.id);
        let Some(state) = states.get(&b.source) else {
            return Err(refused(
                "ref_unresolved",
                format!("{path}/source: {}", b.source),
            ));
        };
        let Some(&state) = STATES.iter().find(|s| *s == state) else {
            return Err(refused("out_of_range", format!("{path}/source: {state}")));
        };
        // A bound item the scene has no solid for has nowhere to carry its mark: refused, never
        // shown as if its status were on screen.
        let Some(item_box) = screen_box(scene, &b.item) else {
            return Err(refused(
                "status_slot_kind",
                format!("{path}/target: items/{} has no solid to mark", b.item),
            ));
        };
        let color = status.colors[state];
        let ink = if look::contrast(ink_role, color) >= look::contrast(ground, color) {
            ink_role
        } else {
            ground
        };
        let glyph = status.glyphs[state].clone();
        let run = text.run(&glyph, CHIP_TEXT);
        let ch = CHIP_HEIGHT.max(status.core_min_px);
        let cw = ch.max(run.width + 8.0);
        // The chip at the item's top right corner, kept inside the frame.
        let mut rect = [
            item_box[0] + item_box[2] - cw / 2.0,
            item_box[1] - ch / 2.0,
            cw,
            ch,
        ];
        rect[0] = rect[0].clamp(0.0, (frame[2] - cw).max(0.0));
        rect[1] = rect[1].clamp(0.0, (frame[3] - ch).max(0.0));
        let origin = [
            (rect[0] + (cw - run.width) / 2.0).round(),
            (rect[1] + (ch - run.height) / 2.0).round(),
        ];
        let label = [origin[0], origin[1], run.width, run.height];
        marks.push(json!({
            "item": b.item, "binding": b.id, "state": state, "slot": b.slot, "color": color,
            "bounds": px_box(rect), "glyph": glyph, "word": look::word(state), "label": px_box(label),
        }));
        chips.push(rect);
        if !on_screen.contains(&state) {
            on_screen.push(state);
        }
        drawn.push(Chip {
            rect,
            color,
            ink,
            run,
            label,
            bare: b.slot == "stroke",
        });
    }
    // The legend: every state on screen, in the status map's order, in the first corner clear of
    // the marks (top right first).
    let mut legend = Vec::new();
    let states_shown: Vec<&'static str> = STATES
        .iter()
        .copied()
        .filter(|s| on_screen.contains(s))
        .collect();
    if !states_shown.is_empty() {
        let runs: Vec<Run> = states_shown
            .iter()
            .map(|s| {
                text.run(
                    &format!("{} {}", status.glyphs[s], look::word(s).unwrap_or(s)),
                    LEGEND_TEXT,
                )
            })
            .collect();
        let widest = runs.iter().map(|r| r.width).fold(0.0, f64::max);
        let (lw, lh) = (
            widest + LEGEND_SWATCH + 6.0,
            LEGEND_ROW * states_shown.len() as f64,
        );
        let (right, bottom) = (frame[2] - LEGEND_MARGIN - lw, frame[3] - LEGEND_MARGIN - lh);
        let corners = [
            [right, LEGEND_MARGIN],
            [right, bottom],
            [LEGEND_MARGIN, bottom],
            [LEGEND_MARGIN, LEGEND_MARGIN],
        ];
        let [x0, y0] = corners
            .iter()
            .find(|c| !chips.iter().any(|b| boxes_meet([c[0], c[1], lw, lh], *b)))
            .copied()
            .unwrap_or(corners[0]);
        for (k, (state, run)) in states_shown.iter().zip(&runs).enumerate() {
            let top = y0 + LEGEND_ROW * k as f64;
            let swatch = [
                x0,
                top + (LEGEND_ROW - LEGEND_SWATCH) / 2.0,
                LEGEND_SWATCH,
                LEGEND_SWATCH,
            ];
            let color = status.colors[state];
            canvas.round_rect(swatch, 0.0, color);
            let origin = [
                x0 + LEGEND_SWATCH + 6.0,
                (top + (LEGEND_ROW - run.height) / 2.0).round(),
            ];
            canvas.text(text, run, origin, ink_role);
            legend.push(json!({
                "state": state, "glyph": status.glyphs[state], "word": look::word(state), "color": color,
                "swatch": px_box(swatch), "label": px_box([origin[0], origin[1], run.width, run.height]),
            }));
        }
    }
    // The marks after the legend, so nothing covers them.
    for c in &drawn {
        if c.bare {
            canvas.text(text, &c.run, [c.label[0], c.label[1]], c.color);
        } else {
            canvas.round_rect(c.rect, c.rect[3] / 2.0, c.color);
            canvas.text(text, &c.run, [c.label[0], c.label[1]], c.ink);
        }
    }
    Ok((
        Layer {
            size,
            rgba: Arc::from(canvas.rgba),
        },
        Value::Array(marks),
        Value::Array(legend),
    ))
}

/// The record's states a call pins: `states: {handle → state}`.
pub fn states(call: &Value) -> Option<BTreeMap<String, String>> {
    let mut out = BTreeMap::new();
    if let Some(v) = call.get("states") {
        for (h, s) in v.as_object()? {
            out.insert(h.clone(), s.as_str()?.to_string());
        }
    }
    Some(out)
}

/// The `status` a `view3d` or `host` reply carries. `guard` is `None` where status can't show;
/// where it can, the pixels the guard counted, or `None` when no GPU ran it: then `ran` is false
/// and `pixels_moved` null, never a count the call didn't see (an agent's word is never evidence).
pub fn report(
    shows: bool,
    look: &str,
    distance: Option<f64>,
    guard: Option<Option<u32>>,
    marks: Value,
    legend: Value,
) -> Value {
    let mut out = Map::new();
    out.insert("shows".into(), json!(shows));
    out.insert("look".into(), json!(look));
    out.insert("distance".into(), json!(distance));
    out.insert(
        "guard".into(),
        match guard {
            Some(moved) => json!({"ran": moved.is_some(), "pixels_moved": moved}),
            None => Value::Null,
        },
    );
    out.insert("marks".into(), marks);
    out.insert("legend".into(), legend);
    Value::Object(out)
}
