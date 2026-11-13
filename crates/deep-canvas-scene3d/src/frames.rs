//! A document evaluated frame after frame (issue #379; technical design: Rules every primitive
//! follows, "evaluated in dependency order with no heap allocation after warm-up"). It's
//! compiled and evaluated whole once; each later frame evaluates the motion program into its
//! flat slots and rewrites only what those move, in place: the world matrices of the solids the
//! program moves (the item or a parent) and the camera. A solid nothing moves keeps the matrix the
//! whole evaluation gave it. A document that moves anything else (a line, a label, a paint) is
//! evaluated whole every frame, which gives the same scene and allocates.

use std::collections::BTreeMap;

use deep_canvas::camera::{Offsets, Rig, Spec, Vec3};
use deep_canvas::kinds::with_defaults;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::{Program, State, TRANSFORM};
use serde_json::{Map, Value};

use crate::look::Look3;
use crate::scene::{
    corners8, corners_into, evaluate, evaluate_compiled, local_of, matmul, near_far, num, posed,
    Affine3, Labels, Refused, Scene,
};

/// A solid the motion program moves: its place in the scene and what its world matrix is made of.
struct Solid {
    layer: usize,
    index: usize,
    /// Its first corner in the bounds.
    corner: usize,
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

/// What the frame path rewrites: the solids the motion program moves, the transform groups channels
/// override, and the camera.
struct Fast {
    solids: Vec<Solid>,
    overrides: Vec<Override>,
    camera: Camera,
    /// Each moving solid's layer and index in it.
    moved: Vec<(usize, usize)>,
}

pub struct Frames {
    /// The document, kept only when every frame is evaluated whole (`fast` is `None`).
    doc: Value,
    look: Look3,
    program: Program,
    state: State,
    scene: Scene,
    /// `None`: the document moves something the frame path doesn't rewrite, so every frame is
    /// evaluated whole.
    fast: Option<Fast>,
    /// Every solid's eight corners, in layer and solid order.
    bounds: Vec<Vec3>,
    /// Whether the last [`Frames::at`] gave a scene other than the one before it (#421).
    changed: bool,
}

impl Frames {
    /// Compiles `doc` (stamped) and evaluates it whole at t = 0.
    pub fn new(doc: &Value, look: &Look3, labels: &mut Labels) -> Result<Frames, Refused> {
        Frames::with_program(doc, Frames::compile(doc)?, look, labels)
    }

    /// The motion program [`Frames::new`] compiles of `doc`, which reads neither the look nor
    /// the atlas: the live view compiles it while the document is checked.
    pub fn compile(doc: &Value) -> Result<Program, Refused> {
        let map = doc.as_object().ok_or(Refused {
            code: "out_of_range",
            path: String::new(),
        })?;
        Program::compile(map).map_err(|r| Refused {
            code: r.code,
            path: r.path,
        })
    }

    /// [`Frames::new`] with `program` from [`Frames::compile`] of `doc`, or of `doc` before its
    /// `size` was set, which the program doesn't read.
    pub fn with_program(
        doc: &Value,
        program: Program,
        look: &Look3,
        labels: &mut Labels,
    ) -> Result<Frames, Refused> {
        let map = doc.as_object().ok_or(Refused {
            code: "out_of_range",
            path: String::new(),
        })?;
        let scene = evaluate_compiled(map, &program, 0, look, labels, None, &[], None)?;
        let state = program.state();
        let fast = fast_path(map, &program, &scene);
        let mut bounds = Vec::with_capacity(scene.layers.iter().map(|l| l.solids.len() * 8).sum());
        for l in &scene.layers {
            for s in &l.solids {
                corners_into(&s.model, &mut bounds);
            }
        }
        Ok(Frames {
            doc: if fast.is_some() {
                Value::Null
            } else {
                doc.clone()
            },
            look: look.clone(),
            program,
            state,
            scene,
            fast,
            bounds,
            changed: true,
        })
    }

    /// Whether frames after the first allocate nothing.
    pub fn is_fast(&self) -> bool {
        self.fast.is_some()
    }

    /// The scene the last [`Frames::at`] gave.
    pub fn scene(&self) -> &Scene {
        &self.scene
    }

    /// The solids (layer, index) a frame on the fast path may rewrite: everything else in its
    /// scene but the size and the camera is as [`Frames::new`] evaluated it. `None` when every
    /// frame is evaluated whole.
    pub fn moved(&self) -> Option<&[(usize, usize)]> {
        self.fast.as_ref().map(|f| f.moved.as_slice())
    }

    /// Whether the last [`Frames::at`] changed the scene: a still scene settles and draws
    /// nothing (#421).
    pub fn changed(&self) -> bool {
        self.changed
    }

    /// The scene at `t` (flicks) on a frame of `size` px, the view turned by `offsets`.
    pub fn at(
        &mut self,
        t: i64,
        size: [u32; 2],
        offsets: &Offsets,
        labels: &mut Labels,
    ) -> Result<&Scene, Refused> {
        let Some(Fast {
            solids,
            overrides,
            camera: cam,
            ..
        }) = self.fast.as_mut()
        else {
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
        let mut changed = self.scene.size != size;
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
            self.bounds[s.corner..s.corner + 8].copy_from_slice(&corners8(&model));
            let solid = &mut self.scene.layers[s.layer].solids[s.index];
            changed |= solid.model != model;
            solid.model = model;
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
        let camera = turned(
            &cam.spec,
            &cam.path,
            offsets,
            size,
            cam.near,
            cam.far,
            &self.bounds,
        )?;
        self.changed = changed || self.scene.camera != camera;
        self.scene.camera = camera;
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
        let mut scene = evaluate(&doc, t, &self.look, labels)?;
        if *offsets != Offsets::default() {
            scene.camera = self.turned_whole(&doc, &scene, t, size, offsets)?;
        }
        self.changed = scene != self.scene;
        self.scene = scene;
        Ok(&self.scene)
    }

    /// The camera at `t` turned by `offsets`, around `scene`'s solids.
    fn turned_whole(
        &mut self,
        doc: &Value,
        scene: &Scene,
        t: i64,
        size: [u32; 2],
        offsets: &Offsets,
    ) -> Result<crate::scene::Camera, Refused> {
        turned_camera(doc, &self.program, scene, t, size, offsets)
    }
}

/// `doc`'s camera at `t` turned by a viewer's `offsets` on a frame of `size`, around `scene`'s
/// solids: the view a hand turned, as [`Frames::at`] draws it (#173's `view3d`).
pub fn turned_camera(
    doc: &Value,
    program: &Program,
    scene: &Scene,
    t: i64,
    size: [u32; 2],
    offsets: &Offsets,
) -> Result<crate::scene::Camera, Refused> {
    let map = doc.as_object().ok_or(Refused {
        code: "out_of_range",
        path: String::new(),
    })?;
    let mut state = program.state();
    program.evaluate(t, Validity::Full, &mut state);
    let items = deep_canvas_motion::eval::items(map, program, &state);
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
    for l in &scene.layers {
        for s in &l.solids {
            corners_into(&s.model, &mut bounds);
        }
    }
    turned(
        &spec,
        &path,
        offsets,
        size,
        num(params.get("near")),
        num(params.get("far")),
        &bounds,
    )
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
fn fast_path(map: &Map<String, Value>, program: &Program, scene: &Scene) -> Option<Fast> {
    // A light's place and power (#421) and another module's items (#380) move with fields
    // this path doesn't follow, so a scene holding one is evaluated whole.
    if !scene.overlays.is_empty()
        || !scene.lights.is_empty()
        || !scene.others.is_empty()
        // A builder's solid isn't a unit mesh its size scales (#420).
        || scene.layers.iter().any(|l| l.solids.iter().any(|s| s.mesh.is_some()))
        || scene
            .layers
            .iter()
            .any(|l| !l.lines.is_empty() || !l.points.is_empty() || !l.labels.is_empty())
    {
        return None;
    }
    let items = map.get("items")?.as_object()?;
    // Each item's first index in the program, looked up once per solid and parent.
    let mut indices: BTreeMap<&str, usize> = BTreeMap::new();
    for (i, id) in program.items.iter().enumerate() {
        indices.entry(id.as_str()).or_insert(i);
    }
    let index = |id: &str| indices.get(id).copied();
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
    let mut corner = 0;
    // A solid's chain, built here and copied out only for a solid that moves.
    let mut chain = Vec::new();
    for (l, layer) in scene.layers.iter().enumerate() {
        for (i, s) in layer.solids.iter().enumerate() {
            corner += 8;
            chain.clear();
            chain.push(index(&s.id)?);
            // The parents passed, after the solid itself.
            let mut seen: Vec<&str> = Vec::new();
            let item = items.get(&s.id)?;
            // A pivot moves the matrix the fast path rebuilds from slots alone: evaluate whole.
            if crate::scene::pivot_of(item).is_some() {
                return None;
            }
            let mut parent = item.get("parent").and_then(Value::as_str);
            while let Some(p) = parent {
                if p == s.id || seen.contains(&p) || !items.contains_key(p) {
                    break;
                }
                if crate::scene::pivot_of(&items[p]).is_some() {
                    return None;
                }
                chain.push(index(p)?);
                seen.push(p);
                parent = items[p].get("parent").and_then(Value::as_str);
            }
            let size =
                crate::scene::size3(item.get("params").and_then(|p| p.get("size")), [1.0; 3])?;
            let moves = |c: usize| {
                program.writes(c * TRANSFORM..(c + 1) * TRANSFORM)
                    || overrides.iter().any(|o| o.item == c)
            };
            if !chain.iter().any(|&c| moves(c)) {
                continue;
            }
            solids.push(Solid {
                layer: l,
                index: i,
                corner: corner - 8,
                chain: chain.clone(),
                size,
            });
        }
    }
    Some(Fast {
        moved: solids.iter().map(|s| (s.layer, s.index)).collect(),
        solids,
        overrides,
        camera: Camera {
            spec,
            path,
            near: num(params.get("near")),
            far: num(params.get("far")),
            fields,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn look() -> Look3 {
        Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap()
    }

    /// Boxes, one sliding by a channel, one riding it as a child and one far off that nothing
    /// moves, under a camera whose orbit a second channel turns.
    fn doc(orbit: bool) -> Value {
        let mut d = json!({
            "format": 1, "profile": "scene", "title": "T", "size": [128, 96], "camera": "cam",
            "transport": {"span": "60s"},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "C", "order": "a0",
                        "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 30, "elevation": 35, "distance": 14}, "fov": 40}},
                "a": {"id": "a", "kind": "mark.box@1", "name": "A", "order": "b0", "params": {"size": [1, 2, 1], "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [-2, 0.5, 0], "rot": [0, 30, 0]}},
                "b": {"id": "b", "kind": "mark.box@1", "name": "B", "order": "b1", "parent": "a", "params": {"size": 0.5, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 1, 0]}},
                "c": {"id": "c", "kind": "mark.box@1", "name": "C", "order": "b2", "params": {"size": 1, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [9, 0.5, -40]}}
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

    /// A lamp riding the sliding box, a material whose roughness a channel keys, and a flicker
    /// channel on the lamp (#421): every frame is the whole evaluation, the lamp where its box is
    /// at t, the material's number and the flicker at their channels' values.
    #[test]
    fn lights_and_material_channels_follow_each_frame() {
        for keyed in [false, true] {
            let mut d = doc(false);
            d["items"]["lamp"] = json!({"id": "lamp", "kind": "light.point@1", "name": "L", "order": "c0", "parent": "a", "params": {"power": 800}, "at": {"pos": [0, 2, 0]}});
            d["items"]["m"] = json!({"id": "m", "kind": "material@1", "name": "M", "order": "c1", "params": {"roughness": 0.5}});
            d["items"]["c"]["material"] = json!("m");
            if keyed {
                d["items"]["lamp"]["params"]["flicker"] = json!("buzz");
                d["channels"]["rough"] = json!({"target": "items/m/params/roughness", "type": "f32", "keys": {"k0": {"t": "0s", "value": 0.1, "interp": "linear"}, "k1": {"t": "60s", "value": 0.9, "interp": "linear"}}});
                d["channels"]["buzz"] = json!({"target": "items/lamp/params/gain", "type": "f32", "keys": {"k0": {"t": "0s", "value": 1, "interp": "linear"}, "k1": {"t": "60s", "value": 0, "interp": "linear"}}});
            }
            let mut labels = Labels::new();
            let mut frames = Frames::new(&d, &look(), &mut labels).unwrap();
            for n in [0i64, 1800, 3599] {
                let t = n * 705_600_000 / 60;
                let got = frames
                    .at(t, [128, 96], &Offsets::default(), &mut labels)
                    .unwrap()
                    .clone();
                assert_eq!(
                    got,
                    evaluate(&d, t, &look(), &mut labels).unwrap(),
                    "keyed {keyed}, frame {n}"
                );
                let lamp = &got.lights[0];
                let s = n as f64 / 3600.0;
                assert!(
                    (lamp.pos[0] - (-3.0 + 6.0 * s)).abs() < 1e-6,
                    "keyed {keyed}, frame {n}: {:?}",
                    lamp.pos
                );
                if keyed {
                    let want = (1.0 - s) * 800.0 / (4.0 * std::f64::consts::PI);
                    assert!(
                        (lamp.intensity - want).abs() < 1e-6,
                        "frame {n}: {}",
                        lamp.intensity
                    );
                    let rough = got
                        .layers
                        .iter()
                        .flat_map(|l| &l.solids)
                        .find(|s| s.id == "c")
                        .and_then(|s| s.material)
                        .map(|m| m.roughness);
                    assert!(
                        rough.is_some_and(|r| (r - (0.1 + 0.8 * s)).abs() < 1e-6),
                        "frame {n}: {rough:?}"
                    );
                }
            }
        }
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
