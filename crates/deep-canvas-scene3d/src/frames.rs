//! A document evaluated frame after frame (issue #379; technical design: Rules every primitive
//! follows, "evaluated in dependency order with no heap allocation after warm-up"). It's
//! compiled and evaluated whole once; each later frame evaluates the motion program into its
//! flat slots and rewrites only what those move, the solids' world matrices and the camera, in
//! place. A document that moves anything else (a line, a label, a paint) is evaluated whole every
//! frame, which gives the same scene and allocates.

use deep_canvas::camera::{Offsets, Rig, Spec, Vec3};
use deep_canvas::kinds::with_defaults;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::{Program, State, TRANSFORM};
use serde_json::{Map, Value};

use crate::look::Look3;
use crate::scene::{
    corners_into, evaluate, local_of, matmul, near_far, num, posed, Affine3, Labels, Refused, Scene,
};

/// One solid's place in the scene and what its world matrix is made of.
struct Solid {
    layer: usize,
    index: usize,
    /// Program item indices, the item first, then each parent outward.
    chain: Vec<usize>,
    size: Vec3,
}

/// A transform group a width-3 channel field overrides on an item.
struct Override {
    item: usize,
    group: usize,
    slot: usize,
}

/// A camera field a channel writes.
#[derive(Clone, Copy)]
enum CamField {
    Azimuth,
    Elevation,
    Distance,
    Fov,
    Target(usize),
}

struct Camera {
    spec: Spec,
    path: String,
    near: Option<f64>,
    far: Option<f64>,
    fields: Vec<(CamField, usize)>,
}

pub struct Frames {
    doc: Value,
    look: Look3,
    program: Program,
    state: State,
    scene: Scene,
    /// `None`: the document moves something the frame path doesn't rewrite, so every frame is
    /// evaluated whole.
    fast: Option<(Vec<Solid>, Vec<Override>, Camera)>,
    bounds: Vec<Vec3>,
}

impl Frames {
    /// Compiles `doc` (stamped) and evaluates it whole at t = 0.
    pub fn new(doc: &Value, look: &Look3, labels: &mut Labels) -> Result<Frames, Refused> {
        let scene = evaluate(doc, 0, look, labels)?;
        let map = doc.as_object().ok_or(Refused {
            code: "out_of_range",
            path: String::new(),
        })?;
        let program = Program::compile(map).map_err(|r| Refused {
            code: r.code,
            path: r.path,
        })?;
        let state = program.state();
        let fast = fast_path(map, &program, &scene);
        let bounds = Vec::with_capacity(scene.layers.iter().map(|l| l.solids.len() * 8).sum());
        Ok(Frames {
            doc: doc.clone(),
            look: look.clone(),
            program,
            state,
            scene,
            fast,
            bounds,
        })
    }

    /// Whether frames after the first allocate nothing.
    pub fn is_fast(&self) -> bool {
        self.fast.is_some()
    }

    /// The scene at `t` (flicks) on a frame of `size` px, the view turned by `offsets`.
    pub fn at(
        &mut self,
        t: i64,
        size: [u32; 2],
        offsets: &Offsets,
        labels: &mut Labels,
    ) -> Result<&Scene, Refused> {
        let Some((solids, overrides, cam)) = self.fast.as_mut() else {
            return self.whole(t, size, offsets, labels);
        };
        self.program
            .evaluate_local(t, Validity::Full, &mut self.state);
        let slots = &self.state.slots;
        let at = |item: usize, group: usize| -> Vec3 {
            let mut v = [0.0; 3];
            v.copy_from_slice(
                &slots[item * TRANSFORM + 3 * group..item * TRANSFORM + 3 * group + 3],
            );
            for o in overrides
                .iter()
                .filter(|o| o.item == item && o.group == group)
            {
                v.copy_from_slice(&slots[o.slot..o.slot + 3]);
            }
            v
        };
        let local =
            |item: usize| -> Affine3 { local_of(at(item, 0), at(item, 1), at(item, 2), [1.0; 3]) };
        self.bounds.clear();
        for s in solids.iter() {
            let mut m = local(s.chain[0]);
            for &p in &s.chain[1..] {
                m = matmul(&local(p), &m);
            }
            let model = matmul(
                &m,
                &[
                    [s.size[0], 0.0, 0.0, 0.0],
                    [0.0, s.size[1], 0.0, 0.0],
                    [0.0, 0.0, s.size[2], 0.0],
                ],
            );
            corners_into(&model, &mut self.bounds);
            self.scene.layers[s.layer].solids[s.index].model = model;
        }
        for &(field, slot) in &cam.fields {
            let v = slots[slot];
            match field {
                CamField::Azimuth | CamField::Elevation | CamField::Distance => {
                    let orbit = cam.spec.orbit.get_or_insert(deep_canvas::camera::Orbit {
                        azimuth: 45.0,
                        elevation: None,
                        distance: None,
                    });
                    match field {
                        CamField::Azimuth => orbit.azimuth = v,
                        CamField::Elevation => orbit.elevation = Some(v),
                        _ => orbit.distance = Some(v),
                    }
                }
                CamField::Fov => cam.spec.fov = v,
                CamField::Target(k) => cam.spec.target[k] = v,
            }
        }
        self.scene.size = size;
        self.scene.camera = turned(
            &cam.spec,
            &cam.path,
            offsets,
            size,
            cam.near,
            cam.far,
            &self.bounds,
        )?;
        Ok(&self.scene)
    }

    /// The scene evaluated whole, as [`evaluate`] gives it, with the camera turned by `offsets`
    /// from its params at `t`.
    fn whole(
        &mut self,
        t: i64,
        size: [u32; 2],
        offsets: &Offsets,
        labels: &mut Labels,
    ) -> Result<&Scene, Refused> {
        let mut doc = self.doc.clone();
        doc["size"] = Value::from(vec![size[0], size[1]]);
        self.scene = evaluate(&doc, t, &self.look, labels)?;
        if *offsets == Offsets::default() {
            return Ok(&self.scene);
        }
        let map = doc.as_object().expect("a document is an object");
        self.program.evaluate(t, Validity::Full, &mut self.state);
        let items = deep_canvas_motion::eval::items(map, &self.program, &self.state);
        let id = map.get("camera").and_then(Value::as_str).unwrap_or("");
        let params = items
            .get(id)
            .and_then(|c| c.get("params"))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let path = format!("items/{id}/params");
        let spec = Spec::read(&with_defaults("camera@1", &params), &path).map_err(|r| Refused {
            code: r.code,
            path: r.path,
        })?;
        let mut bounds = Vec::new();
        for l in &self.scene.layers {
            for s in &l.solids {
                corners_into(&s.model, &mut bounds);
            }
        }
        self.scene.camera = turned(
            &spec,
            &path,
            offsets,
            size,
            num(params.get("near")),
            num(params.get("far")),
            &bounds,
        )?;
        Ok(&self.scene)
    }
}

fn camera_params(map: &Map<String, Value>) -> Option<&Map<String, Value>> {
    let id = map.get("camera")?.as_str()?;
    map.get("items")?.get(id)?.get("params")?.as_object()
}

/// The camera `spec` turned by the viewer's `offsets`, on a frame of `size`.
fn turned(
    spec: &Spec,
    path: &str,
    offsets: &Offsets,
    size: [u32; 2],
    near: Option<f64>,
    far: Option<f64>,
    bounds: &[Vec3],
) -> Result<crate::scene::Camera, Refused> {
    let rig: Rig = spec.rig(path).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let mut cam = posed(
        spec,
        &rig,
        offsets,
        [f64::from(size[0]), f64::from(size[1])],
    );
    near_far(&mut cam, near, far, bounds.iter().copied());
    Ok(cam)
}

/// What the frame path rewrites for this document, or `None` when it moves anything else.
fn fast_path(
    map: &Map<String, Value>,
    program: &Program,
    scene: &Scene,
) -> Option<(Vec<Solid>, Vec<Override>, Camera)> {
    // A sun's direction and another module's items (#380) move with transforms this path
    // doesn't follow, so a scene holding one is evaluated whole.
    if !scene.overlays.is_empty()
        || scene.sun.is_some()
        || !scene.others.is_empty()
        || scene
            .layers
            .iter()
            .any(|l| !l.lines.is_empty() || !l.points.is_empty() || !l.labels.is_empty())
    {
        return None;
    }
    let items = map.get("items")?.as_object()?;
    let index = |id: &str| program.items.iter().position(|i| i == id);
    let camera_id = map.get("camera")?.as_str()?;
    let camera_item = index(camera_id);
    let mut overrides = Vec::new();
    let mut fields = Vec::new();
    for f in &program.fields {
        let item = f.item?;
        let path: Vec<&str> = f.path.iter().map(String::as_str).collect();
        match path.as_slice() {
            ["at", group] if f.width == 3 => overrides.push(Override {
                item,
                group: ["pos", "rot", "scale"].iter().position(|g| g == group)?,
                slot: f.slot,
            }),
            ["params", "orbit", name] if Some(item) == camera_item && f.width == 1 => {
                fields.push((
                    match *name {
                        "azimuth" => CamField::Azimuth,
                        "elevation" => CamField::Elevation,
                        "distance" => CamField::Distance,
                        _ => return None,
                    },
                    f.slot,
                ));
            }
            ["params", "fov"] if Some(item) == camera_item && f.width == 1 => {
                fields.push((CamField::Fov, f.slot))
            }
            ["params", "target"] if Some(item) == camera_item && f.width == 3 => {
                fields.extend((0..3).map(|k| (CamField::Target(k), f.slot + k)))
            }
            _ => return None,
        }
    }
    let params = camera_params(map)?;
    let path = format!("items/{camera_id}/params");
    let spec = Spec::read(&with_defaults("camera@1", params), &path).ok()?;
    if spec.fit.is_some() {
        return None;
    }
    let mut solids = Vec::new();
    for (l, layer) in scene.layers.iter().enumerate() {
        for (i, s) in layer.solids.iter().enumerate() {
            let mut chain = vec![index(&s.id)?];
            let mut seen = vec![s.id.as_str()];
            let mut parent = items.get(&s.id)?.get("parent").and_then(Value::as_str);
            while let Some(p) = parent {
                if seen.contains(&p) || !items.contains_key(p) {
                    break;
                }
                chain.push(index(p)?);
                seen.push(p);
                parent = items[p].get("parent").and_then(Value::as_str);
            }
            let size = crate::scene::size3(
                items[&s.id].get("params").and_then(|p| p.get("size")),
                [1.0; 3],
            )?;
            solids.push(Solid {
                layer: l,
                index: i,
                chain,
                size,
            });
        }
    }
    Some((
        solids,
        overrides,
        Camera {
            spec,
            path,
            near: num(params.get("near")),
            far: num(params.get("far")),
            fields,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn look() -> Look3 {
        Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap()
    }

    /// Boxes, one sliding by a channel and one riding it as a child, under a camera whose
    /// orbit a second channel turns.
    fn doc(orbit: bool) -> Value {
        let mut d = json!({
            "format": 1, "profile": "scene", "title": "T", "size": [128, 96], "camera": "cam",
            "transport": {"span": "60s"},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "C", "order": "a0",
                        "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 30, "elevation": 35, "distance": 14}, "fov": 40}},
                "a": {"id": "a", "kind": "mark.box@1", "name": "A", "order": "b0", "params": {"size": [1, 2, 1], "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [-2, 0.5, 0], "rot": [0, 30, 0]}},
                "b": {"id": "b", "kind": "mark.box@1", "name": "B", "order": "b1", "parent": "a", "params": {"size": 0.5, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 1, 0]}}
            },
            "channels": {"slide": {"target": "items/a/at/pos/0", "type": "f32", "keys": {"k0": {"t": "0s", "value": -3, "interp": "linear"}, "k1": {"t": "60s", "value": 3, "interp": "linear"}}}}
        });
        if orbit {
            d["channels"]["orbit"] = json!({"target": "items/cam/params/orbit/azimuth", "type": "f32", "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"}, "k1": {"t": "60s", "value": 1800, "interp": "linear"}}});
        }
        d
    }

    #[test]
    fn each_frame_on_the_fast_path_is_the_whole_evaluation() {
        let mut labels = Labels::new();
        for orbit in [false, true] {
            let d = doc(orbit);
            let mut frames = Frames::new(&d, &look(), &mut labels).unwrap();
            assert!(
                frames.is_fast(),
                "transforms and the orbit stay on the fast path"
            );
            for n in [0i64, 1, 17, 600, 3599] {
                let t = n * 705_600_000 / 60;
                let fast = frames
                    .at(t, [128, 96], &Offsets::default(), &mut labels)
                    .unwrap()
                    .clone();
                let whole = evaluate(&d, t, &look(), &mut labels).unwrap();
                assert_eq!(fast, whole, "orbit {orbit}, frame {n}");
            }
        }
    }

    #[test]
    fn a_view_turn_is_the_orbit_turned_as_far() {
        let mut labels = Labels::new();
        let mut frames = Frames::new(&doc(false), &look(), &mut labels).unwrap();
        let offsets = Offsets {
            azimuth: 20.0,
            ..Offsets::default()
        };
        let turned = frames
            .at(0, [128, 96], &offsets, &mut labels)
            .unwrap()
            .clone();
        let mut d = doc(false);
        d["items"]["cam"]["params"]["orbit"]["azimuth"] = json!(50);
        let whole = evaluate(&d, 0, &look(), &mut labels).unwrap();
        let close = |a: [f64; 3], b: [f64; 3]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-9);
        assert!(
            close(turned.camera.eye, whole.camera.eye),
            "{:?} against {:?}",
            turned.camera.eye,
            whole.camera.eye
        );
    }

    #[test]
    fn a_moving_size_takes_the_whole_path() {
        let mut d = doc(false);
        d["channels"]["grow"] = json!({"target": "items/a/params/size/1", "type": "f32", "keys": {"k0": {"t": "0s", "value": 1, "interp": "linear"}, "k1": {"t": "60s", "value": 3, "interp": "linear"}}});
        let mut labels = Labels::new();
        let mut frames = Frames::new(&d, &look(), &mut labels).unwrap();
        assert!(!frames.is_fast());
        let t = 600 * 705_600_000 / 60;
        let got = frames
            .at(t, [128, 96], &Offsets::default(), &mut labels)
            .unwrap()
            .clone();
        assert_eq!(got, evaluate(&d, t, &look(), &mut labels).unwrap());
    }
}
