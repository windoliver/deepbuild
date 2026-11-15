//! #468 (Export: glTF): a 3D document evaluated at one time and written as one binary glTF file:
//! the view's camera as a glTF camera at its evaluated pose, and each drawn box and built mesh as
//! a mesh node at its world matrix. Anything the file doesn't hold is listed by item in the
//! receipt's warnings, never dropped silently: a camera's lens shift among them, since a glTF
//! camera carries none.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use deep_canvas::ops::atan;
use deep_canvas_scene3d::scene::{Camera, Scene, Shape, Solid};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::{hex, name_of, temp_of, Guard, Job, Span};
use crate::hub::Hub;

/// glTF's component types and buffer view targets.
const FLOAT: u32 = 5126;
const UNSIGNED_INT: u32 = 5125;
const ARRAY_BUFFER: u32 = 34962;
const ELEMENT_ARRAY_BUFFER: u32 = 34963;

/// What the file holds besides the camera, in each warning that lists an item it leaves out.
const HOLDS: &str =
    "the glTF export holds the view's camera and the geometry of boxes and built meshes";

/// The file's binary chunk, with its buffer views and accessors.
#[derive(Default)]
struct Bin {
    bytes: Vec<u8>,
    views: Vec<Value>,
    accessors: Vec<Value>,
}

impl Bin {
    /// `data` as a buffer view of `target`, read by `accessor`; the accessor's index.
    fn push(&mut self, data: &[u8], target: u32, mut accessor: Value) -> usize {
        while self.bytes.len() % 4 != 0 {
            self.bytes.push(0);
        }
        self.views.push(json!({"buffer": 0, "byteOffset": self.bytes.len(), "byteLength": data.len(), "target": target}));
        self.bytes.extend_from_slice(data);
        accessor["bufferView"] = json!(self.views.len() - 1);
        self.accessors.push(accessor);
        self.accessors.len() - 1
    }

    /// Vectors as f32 VEC3s, with their bounds when `bounded` (glTF wants them on positions).
    fn vec3s(&mut self, v: &[[f64; 3]], bounded: bool) -> usize {
        let f: Vec<[f32; 3]> = v.iter().map(|p| p.map(|x| x as f32)).collect();
        let data: Vec<u8> = f.iter().flatten().flat_map(|x| x.to_le_bytes()).collect();
        let mut accessor = json!({"componentType": FLOAT, "count": f.len(), "type": "VEC3"});
        if bounded {
            let fold = |pick: fn(f32, f32) -> f32| {
                (0..3)
                    .map(|k| f.iter().map(|p| p[k]).reduce(pick).unwrap_or(0.0))
                    .collect::<Vec<_>>()
            };
            accessor["min"] = json!(fold(f32::min));
            accessor["max"] = json!(fold(f32::max));
        }
        self.push(&data, ARRAY_BUFFER, accessor)
    }

    fn indices(&mut self, i: &[u32]) -> usize {
        let data: Vec<u8> = i.iter().flat_map(|x| x.to_le_bytes()).collect();
        let accessor = json!({"componentType": UNSIGNED_INT, "count": i.len(), "type": "SCALAR"});
        self.push(&data, ELEMENT_ARRAY_BUFFER, accessor)
    }

    /// A triangle mesh named `name`: its primitive's positions, normals when there is one per
    /// position, and indices.
    fn mesh(
        &mut self,
        name: &str,
        positions: &[[f64; 3]],
        normals: &[[f64; 3]],
        indices: &[u32],
    ) -> Value {
        let mut attributes = Map::new();
        attributes.insert("POSITION".into(), json!(self.vec3s(positions, true)));
        if normals.len() == positions.len() {
            attributes.insert("NORMAL".into(), json!(self.vec3s(normals, false)));
        }
        let indices = self.indices(indices);
        json!({"name": name, "primitives": [{"attributes": attributes, "indices": indices, "mode": 4}]})
    }
}

/// The unit cube a box's world matrix places: four vertices a face, each with the face's normal,
/// and two triangles a face wound counter-clockwise seen from outside.
fn cube() -> (Vec<[f64; 3]>, Vec<[f64; 3]>, Vec<u32>) {
    let (mut p, mut n, mut idx) = (Vec::new(), Vec::new(), Vec::new());
    for axis in 0..3 {
        // (u, v, axis) is a cyclic order of (x, y, z), so u × v points along +axis.
        let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
        for sign in [-1.0, 1.0] {
            let base = p.len() as u32;
            let mut normal = [0.0; 3];
            normal[axis] = sign;
            for (a, b) in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)] {
                let mut q = [0.0; 3];
                q[axis] = 0.5 * sign;
                q[u] = a;
                q[v] = b;
                p.push(q);
                n.push(normal);
            }
            let quad: [u32; 6] = if sign > 0.0 {
                [0, 1, 2, 0, 2, 3]
            } else {
                [0, 2, 1, 0, 3, 2]
            };
            idx.extend(quad.iter().map(|k| base + k));
        }
    }
    (p, n, idx)
}

/// A 3×4 world matrix (rows) as glTF's column-major 4×4.
fn columns(m: &[[f64; 4]; 3]) -> Vec<f64> {
    (0..4)
        .flat_map(|c| [m[0][c], m[1][c], m[2][c], if c == 3 { 1.0 } else { 0.0 }])
        .collect()
}

/// A number as a warning shows it: to six places, with no negative zero.
fn shown(x: f64) -> f64 {
    (x * 1e6).round() / 1e6 + 0.0
}

/// The camera's shift off the frame's centre, as fractions of the frame's width and height:
/// what its `shift` and its lens's `shift` move the optical axis by.
fn frame_shift(cam: &Camera) -> [f64; 2] {
    let [w, h] = cam.size;
    [
        shown((cam.centre[0] - w / 2.0) / w),
        shown((cam.centre[1] - h / 2.0) / h),
    ]
}

/// The view's camera as a glTF camera, and its node's column-major matrix: glTF's camera looks
/// down its −Z with +Y up, so the node's axes are the view's right and up (turned by its roll)
/// and its backward axis, at the eye. A warning for each part of it the file can't hold.
fn camera(cam: &Camera, id: &str, warnings: &mut Vec<Value>) -> (Value, Vec<f64>) {
    let [w, h] = cam.size;
    let [c, s] = cam.roll;
    let along = |a: [f64; 3], k: f64, b: [f64; 3], l: f64| -> [f64; 3] {
        [
            a[0] * k + b[0] * l,
            a[1] * k + b[1] * l,
            a[2] * k + b[2] * l,
        ]
    };
    let right = along(cam.right, c, cam.up, s);
    let up = along(cam.right, -s, cam.up, c);
    let back = cam.forward.map(|x| -x);
    let matrix: Vec<f64> = [right, up, back, cam.eye]
        .iter()
        .enumerate()
        .flat_map(|(k, a)| [a[0], a[1], a[2], if k == 3 { 1.0 } else { 0.0 }])
        .collect();
    let gltf = if cam.perspective {
        json!({"name": id, "type": "perspective", "perspective": {
            "yfov": 2.0 * atan((h / 2.0) / cam.scale), "aspectRatio": w / h, "znear": cam.near, "zfar": cam.far}})
    } else {
        // glTF's orthographic near plane is never behind the eye.
        if cam.near < 0.0 {
            warnings.push(json!({"item": id, "what": format!(
                "near plane {} m behind the eye dropped: glTF's orthographic znear is 0 or more", shown(-cam.near))}));
        }
        json!({"name": id, "type": "orthographic", "orthographic": {
            "xmag": (w / 2.0) / cam.scale, "ymag": (h / 2.0) / cam.scale, "znear": cam.near.max(0.0), "zfar": cam.far}})
    };
    (gltf, matrix)
}

/// The GLB container: the header, the JSON chunk padded with spaces, and the binary chunk
/// padded with zeros when there is one.
fn glb(gltf: &Value, bin: &[u8]) -> Result<Vec<u8>, String> {
    let mut text = serde_json::to_vec(gltf).map_err(|e| e.to_string())?;
    while text.len() % 4 != 0 {
        text.push(b' ');
    }
    let mut data = bin.to_vec();
    while data.len() % 4 != 0 {
        data.push(0);
    }
    let total = 12 + 8 + text.len() + if data.is_empty() { 0 } else { 8 + data.len() };
    let word = |n: usize| {
        u32::try_from(n)
            .map(u32::to_le_bytes)
            .map_err(|_| "larger than 4 GB".to_string())
    };
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&word(total)?);
    out.extend_from_slice(&word(text.len())?);
    out.extend_from_slice(b"JSON");
    out.extend_from_slice(&text);
    if !data.is_empty() {
        out.extend_from_slice(&word(data.len())?);
        out.extend_from_slice(b"BIN\0");
        out.extend_from_slice(&data);
    }
    Ok(out)
}

/// What one export writes: the file's bytes, its mesh nodes, triangles and warnings.
struct Written {
    bytes: Vec<u8>,
    meshes: usize,
    triangles: usize,
    warnings: Vec<Value>,
}

/// `scene`, `doc` evaluated, as a GLB; `drops_shift` is the planted exporter that leaves a
/// camera's shift out of the warnings.
fn write(doc: &Value, scene: &Scene, drops_shift: bool) -> Result<Written, String> {
    let mut warnings = Vec::new();
    let mut bin = Bin::default();
    let (mut nodes, mut meshes, mut cameras) = (Vec::new(), Vec::new(), Vec::new());
    // The view's camera, when the document names one.
    let cam_id = doc
        .get("camera")
        .and_then(Value::as_str)
        .filter(|c| doc.pointer(&format!("/items/{c}")).is_some());
    if let Some(id) = cam_id {
        let (gltf, matrix) = camera(&scene.camera, id, &mut warnings);
        let [x, y] = frame_shift(&scene.camera);
        if [x, y] != [0.0, 0.0] && !drops_shift {
            warnings.push(json!({"item": id, "what": format!(
                "lens shift [{x}, {y}] (fractions of the frame) dropped: glTF cameras carry no shift, so the file's camera looks along the unshifted axis")}));
        }
        cameras.push(gltf);
        nodes.push(json!({"name": id, "camera": 0, "matrix": matrix}));
    }
    // Each drawn box and built mesh at its world matrix; a box's mesh is the one unit cube.
    let mut written: BTreeSet<&str> = BTreeSet::new();
    let mut shapes: BTreeMap<Option<u64>, usize> = BTreeMap::new();
    let mut triangles = 0;
    let solids = scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| !s.cast_only);
    for s in solids {
        let key = match (&s.shape, &s.mesh) {
            (Shape::Box, _) => None,
            (Shape::Built(h), Some(m)) if !m.indices.is_empty() => Some(*h),
            _ => continue,
        };
        let mesh = match shapes.get(&key) {
            Some(k) => *k,
            None => {
                let k = meshes.len();
                meshes.push(match (key, &s.mesh) {
                    (Some(_), Some(m)) => bin.mesh(&s.id, &m.positions, &m.normals, &m.indices),
                    _ => {
                        let (p, n, i) = cube();
                        bin.mesh("box", &p, &n, &i)
                    }
                });
                shapes.insert(key, k);
                k
            }
        };
        triangles += match &s.mesh {
            Some(m) if key.is_some() => m.indices.len() / 3,
            _ => 12,
        };
        nodes.push(json!({"name": s.id, "mesh": mesh, "matrix": columns(&s.model)}));
        written.insert(item_of(s));
    }
    let mesh_nodes = nodes.len() - cameras.len();
    // Every other item, by what the file leaves out of it.
    let empty = Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    for (id, item) in items {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("item");
        let what = if Some(id.as_str()) == cam_id || kind == "group@1" {
            // A group's place is in its members' matrices.
            continue;
        } else if written.contains(id.as_str()) {
            if item.get("material").is_some_and(|m| !m.is_null()) {
                continue;
            }
            format!("its paint is not written: {HOLDS}, with no materials")
        } else if kind == "material@1" {
            format!("material@1 not written: {HOLDS}, with no materials")
        } else {
            format!("{kind} not written: {HOLDS}")
        };
        warnings.push(json!({"item": id, "what": what}));
    }
    let mut gltf = Map::new();
    gltf.insert(
        "asset".into(),
        json!({"version": "2.0", "generator": "deep-show export"}),
    );
    gltf.insert("scene".into(), json!(0));
    let roots: Vec<usize> = (0..nodes.len()).collect();
    gltf.insert("scenes".into(), json!([{"nodes": roots}]));
    for (key, list) in [("nodes", nodes), ("meshes", meshes), ("cameras", cameras)] {
        if !list.is_empty() {
            gltf.insert(key.into(), Value::Array(list));
        }
    }
    if !bin.accessors.is_empty() {
        gltf.insert("accessors".into(), Value::Array(bin.accessors));
        gltf.insert("bufferViews".into(), Value::Array(bin.views));
        gltf.insert("buffers".into(), json!([{"byteLength": bin.bytes.len()}]));
    }
    Ok(Written {
        bytes: glb(&Value::Object(gltf), &bin.bytes)?,
        meshes: mesh_nodes,
        triangles,
        warnings,
    })
}

/// The document item a solid draws: its ID before any `#` sub-address.
fn item_of(s: &Solid) -> &str {
    s.id.split('#').next().unwrap_or(&s.id)
}

impl Hub<'_> {
    /// `video: {codec: "gltf"}` with `range: {still: {t}}`: the document evaluated at t, written
    /// as a GLB under a temporary name beside `out` and renamed when whole; its receipt lists by
    /// item everything the file doesn't hold.
    pub(super) fn export_gltf(&mut self, job: &Job, doc: &Value) -> Result<Value, Value> {
        let Span::Still(at) = &job.range else {
            return Err(
                json!({"code": "range_unbuilt", "why": "a glTF export is one evaluation at a time: range {still: {t}}"}),
            );
        };
        if !deep_canvas_scene3d::scene::has_3d(doc) {
            return Err(
                json!({"code": "not_3d", "why": "a glTF export writes a 3D scene, and this document has none"}),
            );
        }
        let t = self
            .resolve_time(&job.doc, at)
            .map_err(|code| json!({"code": code}))?;
        let scene = crate::scene3d::scene_at(
            doc,
            t,
            &self.look.light,
            &self.startup.sealed,
            self.scenario.module_planted.as_deref(),
        )
        .map_err(|u| json!({"code": u.code, "path": u.path}))?;
        let drops_shift = self.guard_planted(Guard::GltfDropsShift);
        let w = write(doc, &scene, drops_shift)
            .map_err(|why| json!({"code": "export_unwritable", "why": why}))?;
        let out = PathBuf::from(&job.out);
        let temp = temp_of(&out);
        std::fs::write(&temp, &w.bytes).map_err(|_| json!({"code": "export_unwritable"}))?;
        std::fs::rename(&temp, &out).map_err(|_| json!({"code": "export_unwritable"}))?;
        Ok(
            json!({"target": "gltf", "format": "glb", "t": t, "bytes": w.bytes.len(),
            "files": {name_of(&out): hex(Sha256::digest(&w.bytes))},
            "meshes": w.meshes, "triangles": [w.triangles], "warnings": w.warnings}),
        )
    }
}
