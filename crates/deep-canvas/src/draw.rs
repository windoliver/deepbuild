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

#[derive(Clone, Debug, PartialEq)]
pub struct Control {
    pub class: Class,
    pub binds: Vec<String>,
    pub default: Value,
}

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
        out.insert(
            id.clone(),
            Control {
                class,
                binds,
                default,
            },
        );
    }
    Ok(out)
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
    let spec = Spec::read(&with_defaults("camera@1", params), &params_path)?;
    let rig = spec.rig(&params_path)?;
    let controls = controls_of(doc)?;

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
    Ok(Scene {
        spec,
        rig,
        controls,
        items: drawn.into_iter().map(|(_, item)| item).collect(),
    })
}
