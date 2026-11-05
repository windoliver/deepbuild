//! What a document draws (issue #372): its camera, read from the item the envelope's `camera`
//! names, its controls, and the drawn items of the two flat test kinds in stacking order
//! (layer order, then item order). The session picks among them and the renderer rasterizes
//! them, both under the same view-control visibility.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::camera::{Refused, Rig, Spec, Vec3};
use crate::document::{check, member};
use crate::kinds::with_defaults;

/// A drawn item's shape, in the document's units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shape {
    /// `test.rect@1`: from its top-left corner, in u.
    Rect { x: f64, y: f64, w: f64, h: f64 },
    /// `test.dot@1`: a disc about its position, in m.
    Dot { pos: Vec3, radius: f64 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Drawn {
    pub id: String,
    pub shape: Shape,
    pub fill: [u8; 3],
    pub visible: bool,
    pub pickable: bool,
}

/// A control's class (Control): what its entries are to the document.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    Document,
    View,
    Viewer,
}

/// `goto` on a control with `verb: camera.goto`: the point control whose new entry the view
/// jumps to, a grid map from a cell to a ground point, and the move's seconds.
#[derive(Clone, Debug, PartialEq)]
pub struct Goto {
    pub to: String,
    pub map: Option<([f64; 2], f64)>,
    pub ease: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Control {
    pub class: Class,
    pub binds: Vec<String>,
    pub default: Value,
    /// A camera verb this slice evaluates: `camera.pan`, `camera.goto` or `camera.reset`.
    pub verb: Option<String>,
    /// `camera.pan`: what one step moves the target by, in u or m.
    pub increment: Option<f64>,
    pub goto: Option<Goto>,
}

/// The verbs a control may carry (Control) that this slice reads: the camera's own are
/// evaluated here; `pick` and `canvas.full_screen` belong to other modules and move nothing.
/// `camera.turn` and `camera.zoom` are the camera's too and not evaluated yet, so a document
/// carrying one is refused rather than left inert.
const VERBS: [&str; 5] = [
    "camera.reset",
    "camera.pan",
    "camera.goto",
    "pick",
    "canvas.full_screen",
];

/// A checked document's camera, controls and drawn items.
#[derive(Clone, Debug, PartialEq)]
pub struct Scene {
    pub spec: Spec,
    pub rig: Rig,
    pub controls: BTreeMap<String, Control>,
    /// In stacking order: by the item's layer's order, then the item's, then its ID.
    pub items: Vec<Drawn>,
}

impl Scene {
    /// Every view-class control at its declared default: the view a still frame and a fresh
    /// session start from.
    pub fn view_defaults(&self) -> Map<String, Value> {
        self.controls
            .iter()
            .filter(|(_, c)| c.class == Class::View)
            .map(|(id, c)| (id.clone(), c.default.clone()))
            .collect()
    }

    /// Whether the item is drawn under `view`: visible in the document and not hidden by a
    /// view-class control bound to its `visible`.
    pub fn shown(&self, item: &Drawn, view: &Map<String, Value>) -> bool {
        if !item.visible {
            return false;
        }
        let path = format!("items/{}/visible", item.id);
        !self.controls.iter().any(|(id, control)| {
            control.class == Class::View
                && control.binds.contains(&path)
                && view.get(id).and_then(Value::as_bool) == Some(false)
        })
    }
}

fn number(params: &Map<String, Value>, name: &str, path: &str) -> Result<f64, Refused> {
    match params.get(name).and_then(Value::as_f64) {
        Some(n) if n.is_finite() => Ok(n),
        _ => Err(Refused::new(
            "out_of_range",
            format!("{path}/{name}"),
            "not a finite number",
        )),
    }
}

/// The document's `size`, two numbers.
pub(crate) fn size(doc: &Value) -> Result<[f64; 2], Refused> {
    let size = member(doc, "size").and_then(Value::as_array);
    let (Some(w), Some(h)) = (
        size.and_then(|s| s.first()).and_then(Value::as_f64),
        size.and_then(|s| s.get(1)).and_then(Value::as_f64),
    ) else {
        return Err(Refused::new("out_of_range", "size", "not two numbers"));
    };
    Ok([w, h])
}

fn vec3_at(item: &Value, keys: &[&str]) -> Vec3 {
    let mut value = item;
    for key in keys {
        match member(value, key) {
            Some(v) => value = v,
            None => return [0.0, 0.0, 0.0],
        }
    }
    let at = |i: usize| value.get(i).and_then(Value::as_f64).unwrap_or(0.0);
    [at(0), at(1), at(2)]
}

fn fill_of(params: &Map<String, Value>, path: &str) -> Result<[u8; 3], Refused> {
    let bad = || Refused::new("out_of_range", format!("{path}/fill"), "not three bytes");
    let channels = params
        .get("fill")
        .and_then(Value::as_array)
        .ok_or_else(bad)?;
    if channels.len() != 3 {
        return Err(bad());
    }
    let mut out = [0u8; 3];
    for (i, c) in channels.iter().enumerate() {
        let n = c.as_f64().ok_or_else(bad)?;
        if !(0.0..=255.0).contains(&n) || n.fract() != 0.0 {
            return Err(bad());
        }
        out[i] = n as u8;
    }
    Ok(out)
}

fn controls_of(doc: &Value) -> Result<BTreeMap<String, Control>, Refused> {
    let mut out = BTreeMap::new();
    let Some(controls) = member(doc, "controls").and_then(Value::as_object) else {
        return Ok(out);
    };
    for (id, control) in controls {
        let path = format!("controls/{id}");
        let class = match member(control, "class").and_then(Value::as_str) {
            Some("document") => Class::Document,
            Some("view") => Class::View,
            Some("viewer") => Class::Viewer,
            _ => {
                return Err(Refused::new(
                    "out_of_range",
                    format!("{path}/class"),
                    "one of document, view, viewer",
                ))
            }
        };
        let binds = member(control, "binds")
            .and_then(Value::as_array)
            .map(|b| {
                b.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let default = member(control, "default").cloned().unwrap_or(Value::Null);
        let verb = match member(control, "verb") {
            None | Some(Value::Null) => None,
            Some(Value::String(v)) if VERBS.contains(&v.as_str()) => Some(v.clone()),
            Some(Value::String(v)) if v == "camera.turn" || v == "camera.zoom" => {
                return Err(Refused::new(
                    "out_of_range",
                    format!("{path}/verb"),
                    format!("{v} is not evaluated in this build"),
                ))
            }
            Some(_) => {
                return Err(Refused::new(
                    "out_of_range",
                    format!("{path}/verb"),
                    format!("one of {}", VERBS.join(", ")),
                ))
            }
        };
        if verb.as_deref().is_some_and(|v| v.starts_with("camera.")) && class != Class::Viewer {
            return Err(Refused::new(
                "out_of_range",
                format!("{path}/class"),
                "a camera verb is viewer input",
            ));
        }
        let increment = match member(control, "increment").and_then(Value::as_f64) {
            Some(n) if n.is_finite() && n > 0.0 => Some(n),
            _ => None,
        };
        if verb.as_deref() == Some("camera.pan") && increment.is_none() {
            return Err(Refused::new(
                "out_of_range",
                format!("{path}/increment"),
                "camera.pan needs a step above 0",
            ));
        }
        let goto = if verb.as_deref() == Some("camera.goto") {
            let goto_path = format!("{path}/goto");
            let g = member(control, "goto").and_then(Value::as_object);
            let to = g
                .and_then(|g| g.get("to"))
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    Refused::new(
                        "out_of_range",
                        format!("{goto_path}/to"),
                        "a point control ID",
                    )
                })?;
            // An array path (a vec3 the logic module holds) is a logic read; this build
            // evaluates a point control's entries.
            if to.contains('/') {
                return Err(Refused::new(
                    "module_missing",
                    format!("{goto_path}/to"),
                    "an array path needs the logic module; name a point control",
                ));
            }
            let Some(point) = controls.get(to) else {
                return Err(Refused::new(
                    "ref_unresolved",
                    format!("{goto_path}/to"),
                    format!("names no control: {to}"),
                ));
            };
            let viewer_point = member(point, "class").and_then(Value::as_str) == Some("viewer")
                && member(point, "kind").and_then(Value::as_str) == Some("point");
            if !viewer_point {
                return Err(Refused::new(
                    "out_of_range",
                    format!("{goto_path}/to"),
                    "a point control of class viewer",
                ));
            }
            let map = match g.and_then(|g| g.get("map")) {
                None | Some(Value::Null) => None,
                Some(m) => {
                    let origin = m
                        .get("origin")
                        .and_then(Value::as_array)
                        .filter(|o| o.len() == 2)
                        .and_then(|o| Some([o[0].as_f64()?, o[1].as_f64()?]))
                        .filter(|o| o.iter().all(|n| n.is_finite()));
                    let cell = m
                        .get("cell")
                        .and_then(Value::as_f64)
                        .filter(|c| c.is_finite() && *c > 0.0);
                    match (origin, cell) {
                        (Some(origin), Some(cell)) => Some((origin, cell)),
                        _ => {
                            return Err(Refused::new(
                                "out_of_range",
                                format!("{goto_path}/map"),
                                "{origin: [m, m], cell: m above 0}",
                            ))
                        }
                    }
                }
            };
            let ease = match g.and_then(|g| g.get("ease")) {
                None | Some(Value::Null) => 0.4,
                Some(e) => match e.as_f64() {
                    Some(n) if n.is_finite() && n >= 0.0 => n,
                    _ => {
                        return Err(Refused::new(
                            "out_of_range",
                            format!("{goto_path}/ease"),
                            "seconds, 0 or above",
                        ))
                    }
                },
            };
            Some(Goto {
                to: to.to_string(),
                map,
                ease,
            })
        } else {
            None
        };
        out.insert(
            id.clone(),
            Control {
                class,
                binds,
                default,
                verb,
                increment,
                goto,
            },
        );
    }
    Ok(out)
}

/// The box about a drawn item: a rectangle on the page at z = 0, a disc's cube.
pub fn bounds_of(shape: Shape) -> [Vec3; 2] {
    match shape {
        Shape::Rect { x, y, w, h } => [[x, y, 0.0], [x + w, y + h, 0.0]],
        Shape::Dot { pos, radius } => [
            [pos[0] - radius, pos[1] - radius, pos[2] - radius],
            [pos[0] + radius, pos[1] + radius, pos[2] + radius],
        ],
    }
}

/// The union of boxes, or none of an empty set.
pub fn union(boxes: impl Iterator<Item = [Vec3; 2]>) -> Option<[Vec3; 2]> {
    let mut out: Option<[Vec3; 2]> = None;
    for b in boxes {
        let u = out.get_or_insert(b);
        for axis in 0..3 {
            u[0][axis] = u[0][axis].min(b[0][axis]);
            u[1][axis] = u[1][axis].max(b[1][axis]);
        }
    }
    out
}

/// Reads `doc`: the check must pass (its first error is the refusal), the envelope's `camera`
/// must name a `camera@1` item, and every `test.rect@1` and `test.dot@1` item is drawn.
pub fn scene(doc: &Value) -> Result<Scene, Refused> {
    let result = check(doc);
    if let Some(issue) = result.issues.iter().find(|i| i.severity == "error") {
        return Err(Refused::new(
            issue.code,
            issue.path.clone(),
            issue.what.clone(),
        ));
    }
    let doc = &result.lowered;
    let Some(camera_id) = member(doc, "camera").and_then(Value::as_str) else {
        return Err(Refused::new(
            "ref_unresolved",
            "camera",
            "the document names no camera",
        ));
    };
    let items = member(doc, "items").and_then(Value::as_object);
    let Some(camera) = items.and_then(|items| items.get(camera_id)) else {
        return Err(Refused::new(
            "ref_unresolved",
            "camera",
            format!("names no item: {camera_id}"),
        ));
    };
    if member(camera, "kind").and_then(Value::as_str) != Some("camera@1") {
        return Err(Refused::new(
            "ref_unresolved",
            "camera",
            format!("{camera_id} is not a camera@1"),
        ));
    }
    let params_path = format!("items/{camera_id}/params");
    let empty = Map::new();
    let params = member(camera, "params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let mut spec = Spec::read(&with_defaults("camera@1", params), &params_path)?;
    let mut rig = spec.rig(&params_path)?;
    let controls = controls_of(doc)?;
    // Pivot eye never moves the eye, so nothing may move its target either.
    if spec.user.pivot == crate::camera::Pivot::Eye {
        if let Some((id, _)) = controls
            .iter()
            .find(|(_, c)| matches!(c.verb.as_deref(), Some("camera.pan") | Some("camera.goto")))
        {
            return Err(Refused::new(
                "out_of_range",
                format!("controls/{id}/verb"),
                "pivot eye never moves the eye; a pan or a goto needs pivot target",
            ));
        }
    }

    let layer_order = |item: &Value| -> String {
        member(item, "layer")
            .and_then(Value::as_str)
            .and_then(|layer| member(doc, "layers").and_then(|l| member(l, layer)))
            .and_then(|layer| member(layer, "order"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let mut drawn: Vec<((String, String, String), Drawn)> = Vec::new();
    for (id, item) in items.into_iter().flatten() {
        let kind = member(item, "kind").and_then(Value::as_str).unwrap_or("");
        let params = with_defaults(
            kind,
            member(item, "params")
                .and_then(Value::as_object)
                .unwrap_or(&empty),
        );
        let path = format!("items/{id}/params");
        let pos = vec3_at(item, &["at", "pos"]);
        let shape = match kind {
            "test.rect@1" => Shape::Rect {
                x: pos[0],
                y: pos[1],
                w: number(&params, "w", &path)?,
                h: number(&params, "h", &path)?,
            },
            "test.dot@1" => Shape::Dot {
                pos,
                radius: number(&params, "radius", &path)?,
            },
            _ => continue,
        };
        let order = member(item, "order")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        drawn.push((
            (layer_order(item), order, id.clone()),
            Drawn {
                id: id.clone(),
                shape,
                fill: fill_of(&params, &path)?,
                visible: member(item, "visible")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                pickable: member(item, "pickable")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            },
        ));
    }
    drawn.sort_by(|a, b| a.0.cmp(&b.0));
    let items: Vec<Drawn> = drawn.into_iter().map(|(_, item)| item).collect();
    if let Some(fit) = &spec.fit {
        // Framed once from the kept items' boxes, in the document's own frame.
        let mut kept = Vec::with_capacity(fit.keep.len());
        for (i, id) in fit.keep.iter().enumerate() {
            match items.iter().find(|item| &item.id == id) {
                Some(item) => kept.push(bounds_of(item.shape)),
                None => {
                    return Err(Refused::new(
                        "ref_unresolved",
                        format!("{params_path}/fit/keep/{i}"),
                        format!("names no drawn item: {id}"),
                    ))
                }
            }
        }
        let [w, h] = size(doc)?;
        if let Some(bounds) = union(kept.into_iter()) {
            spec.frame(&mut rig, bounds, [w, h], &params_path)?;
        }
        if ![rig.distance, rig.view_width]
            .iter()
            .chain(spec.target.iter())
            .all(|n| n.is_finite())
        {
            return Err(Refused::new(
                "out_of_range",
                format!("{params_path}/fit"),
                "the kept items are too far apart to frame",
            ));
        }
    }
    Ok(Scene {
        spec,
        rig,
        controls,
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::{Offsets, Projector};
    use serde_json::json;

    fn doc(camera: Value, items: Value) -> Value {
        let mut items = items;
        items["cam"] = json!({"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0", "params": camera});
        json!({
            "format": 1, "id": "d", "profile": "scene", "title": "T", "description": "D",
            "size": [100, 100], "camera": "cam",
            "layers": {"main": {"writer": "w", "title": "M", "order": "a0"}},
            "items": items
        })
    }

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Value {
        json!({"id": "r", "kind": "test.rect@1", "layer": "main", "name": "R", "order": "a1", "params": {"w": w, "h": h, "fill": [1, 2, 3]}, "at": {"pos": [x, y, 0]}})
    }

    /// The scene's view through a 100 px square frame.
    fn view_of(s: &Scene) -> Projector {
        Projector::new(
            &s.spec.pose(&s.rig, &Offsets::default()),
            [100.0, 100.0],
            [100.0, 100.0],
        )
    }

    /// The corners of the cube 1 m each way around the origin.
    fn unit_cube() -> impl Iterator<Item = [f64; 3]> {
        (0..8).map(|i| [i & 1, i & 2, i & 4].map(|b| if b == 0 { -1.0 } else { 1.0 }))
    }

    #[test]
    fn a_flat_fit_spans_the_kept_items_padded_over_the_fill_share_and_centres_them_at_place() {
        let s = scene(&doc(
            json!({"projection": "orthographic", "fit": {"keep": ["r"]}}),
            json!({"r": rect(10.0, 10.0, 40.0, 20.0)}),
        ))
        .unwrap();
        assert!(s.rig.flat);
        // 40 u padded by 0.08 each side spans 0.6 of the shorter side, 100 px.
        assert!(
            (s.rig.view_width - 100.0 * 46.4 / 60.0).abs() < 1e-9,
            "{}",
            s.rig.view_width
        );
        assert_eq!(s.spec.target, [30.0, 20.0, 0.0]);
        let left = scene(&doc(
            json!({"projection": "orthographic", "fit": {"keep": ["r"], "place": "thirds_left", "fill": 0.3}}),
            json!({"r": rect(10.0, 10.0, 40.0, 20.0)}),
        ))
        .unwrap();
        let view = view_of(&left);
        let centre = view.project([30.0, 20.0, 0.0]).unwrap();
        assert!(
            (centre.x - 100.0 / 3.0).abs() < 1e-9 && (centre.y - 50.0).abs() < 1e-9,
            "{} {}",
            centre.x,
            centre.y
        );
    }

    #[test]
    fn a_goto_names_a_viewer_point_control_and_a_place_stays_inside_the_frame() {
        let with_controls = |controls: Value| {
            let mut d = doc(
                json!({"projection": "orthographic", "view_width": 10}),
                json!({}),
            );
            d["controls"] = controls;
            d
        };
        for (to, path) in [
            (
                json!({"class": "document", "role": "button", "kind": "point"}),
                "controls/jump/goto/to",
            ),
            (
                json!({"class": "view", "role": "button", "kind": "point"}),
                "controls/jump/goto/to",
            ),
            (
                json!({"class": "viewer", "role": "slider", "kind": "slider"}),
                "controls/jump/goto/to",
            ),
        ] {
            let err = scene(&with_controls(json!({
                "spot": to,
                "jump": {"class": "viewer", "role": "button", "verb": "camera.goto", "goto": {"to": "spot"}}
            })))
            .unwrap_err();
            assert_eq!((err.code, err.path.as_str()), ("out_of_range", path));
        }
        let err = scene(&with_controls(json!({
            "jump": {"class": "viewer", "role": "button", "verb": "camera.goto", "goto": {"to": "items/piece/aim"}}
        })))
        .unwrap_err();
        assert_eq!(err.code, "module_missing");
        for place in [json!([-10, 0.5]), json!([0, 0.5]), json!([0.5, 0.9])] {
            let err = scene(&doc(
                json!({"projection": "orthographic", "fit": {"keep": ["r"], "place": place, "fill": 0.4}}),
                json!({"r": rect(10.0, 10.0, 40.0, 20.0)}),
            ))
            .unwrap_err();
            assert_eq!(err.path, "items/cam/params/fit/place", "{place}");
        }
        // Exactly at the edge of what fits is in.
        scene(&doc(
            json!({"projection": "orthographic", "fit": {"keep": ["r"], "place": [0.2, 0.8], "fill": 0.4}}),
            json!({"r": rect(10.0, 10.0, 40.0, 20.0)}),
        ))
        .unwrap();
    }

    #[test]
    fn a_rolled_and_shifted_fit_still_lands_the_kept_centre_at_place() {
        let s = scene(&doc(
            json!({"projection": "orthographic", "roll": 90, "shift": [0.1, 0], "fit": {"keep": ["r"], "place": "thirds_left", "fill": 0.3}}),
            json!({"r": rect(10.0, 10.0, 40.0, 20.0)}),
        ))
        .unwrap();
        let view = view_of(&s);
        let centre = view.project([30.0, 20.0, 0.0]).unwrap();
        assert!(
            (centre.x - 100.0 / 3.0).abs() < 1e-9 && (centre.y - 50.0).abs() < 1e-9,
            "{} {}",
            centre.x,
            centre.y
        );
        // Turned a quarter, the 40 u side stands up: padded to 46.4 u it spans 0.3 of the
        // frame as the height, so the side itself spans 40/46.4 of that.
        let top = view.project([10.0, 20.0, 0.0]).unwrap();
        let bottom = view.project([50.0, 20.0, 0.0]).unwrap();
        assert!(
            ((top.y - bottom.y).abs() - 30.0 * 40.0 / 46.4).abs() < 1e-9,
            "{} {}",
            top.y,
            bottom.y
        );
    }

    #[test]
    fn an_off_centre_perspective_fit_keeps_every_kept_corner_inside_the_frame() {
        let s = scene(&doc(
            json!({"orbit": {"azimuth": 0, "elevation": 0}, "fov": 40, "fit": {"keep": ["m"], "pad": 0, "place": [0.3, 0.5]}}),
            json!({"m": {"id": "m", "kind": "test.dot@1", "layer": "main", "name": "M", "order": "a1", "params": {"radius": 1, "fill": [1, 2, 3]}, "at": {"pos": [0, 0, 0]}}}),
        ))
        .unwrap();
        let view = view_of(&s);
        let centre = view.project([0.0, 0.0, 0.0]).unwrap();
        assert!(
            (centre.x - 30.0).abs() < 1e-6 && (centre.y - 50.0).abs() < 1e-6,
            "{} {}",
            centre.x,
            centre.y
        );
        for c in unit_cube() {
            let p = view.project(c).unwrap();
            assert!(
                (-1e-6..=100.0 + 1e-6).contains(&p.x) && (-1e-6..=100.0 + 1e-6).contains(&p.y),
                "{c:?} at {} {}",
                p.x,
                p.y
            );
            assert!(
                (p.x - 30.0).abs() <= 30.0 + 1e-6 && (p.y - 50.0).abs() <= 30.0 + 1e-6,
                "{c:?} spills the fill"
            );
        }
    }

    #[test]
    fn a_perspective_fit_shifted_and_placed_down_the_frame_keeps_every_corner_in_like_its_mirror() {
        let dot = json!({"m": {"id": "m", "kind": "test.dot@1", "layer": "main", "name": "M", "order": "a1", "params": {"radius": 1, "fill": [1, 2, 3]}, "at": {"pos": [0, 0, 0]}}});
        let framed = |place: Value, shift: Value| {
            let s = scene(&doc(
                json!({"orbit": {"azimuth": 0, "elevation": 0}, "fov": 120, "shift": shift, "fit": {"keep": ["m"], "pad": 0, "place": place, "fill": 0.3}}),
                dot.clone(),
            ))
            .unwrap();
            let view = view_of(&s);
            for c in unit_cube() {
                let p = view.project(c).unwrap();
                assert!(
                    (-1e-6..=100.0 + 1e-6).contains(&p.x) && (-1e-6..=100.0 + 1e-6).contains(&p.y),
                    "{c:?} at {} {} under place {place} shift {shift}",
                    p.x,
                    p.y
                );
            }
            s.rig.distance
        };
        let down = framed(json!([0.5, 0.16]), json!([0, -0.2]));
        let across = framed(json!([0.16, 0.5]), json!([-0.2, 0]));
        assert!((down - across).abs() < 1e-9, "{down} vs {across}");
    }

    #[test]
    fn a_pan_or_goto_control_and_a_turn_verb_are_refused_where_they_would_do_nothing() {
        let mut d = doc(
            json!({"orbit": {"distance": 5}, "user": {"pivot": "eye"}}),
            json!({}),
        );
        d["controls"] = json!({"keys": {"class": "viewer", "role": "button", "verb": "camera.pan", "increment": 1}});
        assert_eq!(scene(&d).unwrap_err().path, "controls/keys/verb");
        let mut d = doc(json!({"orbit": {"distance": 5}}), json!({}));
        d["controls"] =
            json!({"keys": {"class": "viewer", "role": "button", "verb": "camera.turn"}});
        assert_eq!(scene(&d).unwrap_err().path, "controls/keys/verb");
    }

    #[test]
    fn a_perspective_fit_sets_the_distance_so_the_kept_items_span_the_fill_share() {
        let s = scene(&doc(
            json!({"orbit": {"azimuth": 0, "elevation": 0}, "fov": 40, "fit": {"keep": ["m"], "pad": 0}}),
            json!({"m": {"id": "m", "kind": "test.dot@1", "layer": "main", "name": "M", "order": "a1", "params": {"radius": 1, "fill": [1, 2, 3]}, "at": {"pos": [3, 1, -2]}}}),
        ))
        .unwrap();
        let view = view_of(&s);
        let centre = view.project([3.0, 1.0, -2.0]).unwrap();
        assert!(
            (centre.x - 50.0).abs() < 1e-6 && (centre.y - 50.0).abs() < 1e-6,
            "{} {}",
            centre.x,
            centre.y
        );
        // The disc's box, 2 m each way, spans 60 px at its nearest corners and no more.
        let reach = (0..8)
            .map(|i| {
                let c = [
                    if i & 1 == 0 { 2.0 } else { 4.0 },
                    if i & 2 == 0 { 0.0 } else { 2.0 },
                    if i & 4 == 0 { -3.0 } else { -1.0 },
                ];
                let p = view.project(c).unwrap();
                (p.x - 50.0).abs().max((p.y - 50.0).abs())
            })
            .fold(0.0, f64::max);
        assert!((reach - 30.0).abs() < 1e-6, "{reach}");
        let err = scene(&doc(
            json!({"position": [0, 0, 5], "fit": {"keep": ["m"]}}),
            json!({"m": {"id": "m", "kind": "test.dot@1", "layer": "main", "name": "M", "order": "a1", "params": {"radius": 1, "fill": [1, 2, 3]}, "at": {"pos": [0, 0, 0]}}}),
        ))
        .unwrap_err();
        assert_eq!(err.path, "items/cam/params/position");
        let err = scene(&doc(json!({"fit": {"keep": ["ghost"]}}), json!({}))).unwrap_err();
        assert_eq!(err.path, "items/cam/params/fit/keep/0");
    }
}
