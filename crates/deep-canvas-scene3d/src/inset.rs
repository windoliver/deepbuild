//! Insets (#506; canvas primitives: Inset, Inset: projected): 2D content set into a part's face
//! or cast onto the surfaces it names, and views of the same document from another camera.
//!
//! An inset's content is a 2D document scene3d writes here ([`Picture`]) and the host rasters,
//! since the painters are the hosts'; its picture reaches the renderer as straight-alpha sRGB
//! texels under the inset's key in [`crate::scene::Scene::texels`], converted once from the
//! premultiplied render the host draws, so an inset's edge matches the same content drawn
//! directly. A face inset draws as a window quad on the face, a solid with the inset's ID that
//! shades as the face does with the picture over its base color; nothing of the content falls
//! outside it, since the picture is the window's own size.

use std::collections::BTreeSet;
use std::sync::Arc;

use deep_canvas::camera::Vec3;
use serde_json::{json, Map, Value};

use crate::geom::Mesh;
use crate::light::{InsetMap, MapSlot, Maps, Wrap};
use crate::scene::{Affine3, Camera, Layer3, Refused, Shape};
use crate::views::{Eye, View};

/// The kind.
pub const KIND: &str = "inset@1";
/// At most this many projected insets in one view; the check refuses more, naming them.
pub const MAX_PROJECTED: usize = 8;
/// A projected inset's texels along its longer side when it gives no `px_per_unit`.
const DEFAULT_TEXELS: f64 = 1024.0;
/// How far a window stands proud of its face, m, so it never fights the face for depth.
const PROUD: f64 = 1e-4;

/// A picture's clear texels (straight alpha) take the mean color of their covered neighbours, so
/// a filter that reads them beside an edge blends the content's color, never black. Their alpha
/// stays 0, so nothing of them shows.
pub fn bleed(rgba: &mut [u8], size: [u32; 2]) {
    let [w, h] = size.map(|v| v as i64);
    let src = rgba.to_vec();
    for y in 0..h {
        for x in 0..w {
            let o = ((y * w + x) * 4) as usize;
            if src[o + 3] != 0 {
                continue;
            }
            let (mut sum, mut n) = ([0u32; 3], 0u32);
            for (dx, dy) in [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)] {
                let (nx, ny) = (x + dx, y + dy);
                if nx < 0 || ny < 0 || nx >= w || ny >= h {
                    continue;
                }
                let q = ((ny * w + nx) * 4) as usize;
                if src[q + 3] != 0 {
                    (0..3).for_each(|c| sum[c] += u32::from(src[q + c]));
                    n += 1;
                }
            }
            if n > 0 {
                (0..3).for_each(|c| rgba[o + c] = ((sum[c] + n / 2) / n) as u8);
            }
        }
    }
}

/// The key a view inset's picture has in its window's maps.
pub fn view_key(id: &str) -> String {
    format!("view:{id}")
}

/// The 2D content an inset's picture draws: its key in the scene's texels, the 2D document the
/// host rasters, and its size in texels.
#[derive(Clone, Debug, PartialEq)]
pub struct Picture {
    pub id: String,
    pub key: String,
    pub size: [u32; 2],
    pub document: Arc<Value>,
}

/// A projected inset at t as the renderer draws it.
#[derive(Clone, Debug, PartialEq)]
pub struct Projected {
    pub id: String,
    /// Its picture's key in the scene's texels.
    pub key: String,
    /// World to box, rows for u, v (0 to 1 across its size), depth through the box (0 to 1) and
    /// w (1, or the camera's depth for a camera's cast).
    pub to_box: [[f64; 4]; 4],
    /// The direction it casts along, a unit vector; for a camera's, its eye, from which each
    /// surface point's ray leaves.
    pub along: Vec3,
    pub eye: Option<Vec3>,
    /// The solids it lands on by ID, or every solid.
    pub onto: Option<Vec<String>>,
    /// The fade's width at the box's sides, as fractions of u and v.
    pub edge: [f64; 2],
    /// The cosine of `fade.angle`: a surface turned further from the cast fades out by 90°.
    pub cos_angle: f64,
    pub opacity: f64,
    /// Drawn after tone mapping and the grade on its surfaces' pixels, in its content's own
    /// colors; else it replaces their base color under the scene's lights.
    pub unlit: bool,
}

/// What evaluation hands the insets: the document, the items at t, each item's world transform
/// without its size, the scene's world bounds, the main camera and the build's planted name.
pub(crate) struct Ctx<'a> {
    pub doc: &'a Map<String, Value>,
    pub get: &'a dyn Fn(&str) -> Option<&'a Value>,
    pub world: &'a dyn Fn(&str) -> Affine3,
    pub bounds: &'a [Vec3],
    pub camera: &'a Camera,
    pub planted: Option<&'a str>,
}

/// The insets a scene draws.
#[derive(Default)]
pub(crate) struct Insets {
    pub pictures: Vec<Picture>,
    pub projected: Vec<Projected>,
    pub views: Vec<View>,
}

fn refused<T>(code: &'static str, path: String) -> Result<T, Refused> {
    Err(Refused { code, path })
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite())
}

fn pair(v: Option<&Value>) -> Option<[f64; 2]> {
    let a = v?.as_array()?;
    match a.as_slice() {
        [x, y] => Some([x.as_f64()?, y.as_f64()?]),
        _ => None,
    }
}

fn mul(a: &Affine3, b: &Affine3) -> Affine3 {
    crate::scene::matmul(a, b)
}

fn apply(m: &Affine3, p: Vec3) -> Vec3 {
    std::array::from_fn(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}

fn axis(m: &Affine3, k: usize) -> Vec3 {
    [m[0][k], m[1][k], m[2][k]]
}

fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn unit(a: Vec3) -> Vec3 {
    let l = dot(a, a).sqrt();
    if l > 0.0 {
        a.map(|x| x / l)
    } else {
        a
    }
}

/// A rigid frame: `x`, `y`, `z` as its columns at `origin`.
fn frame(origin: Vec3, x: Vec3, y: Vec3, z: Vec3) -> Affine3 {
    std::array::from_fn(|r| [x[r], y[r], z[r], origin[r]])
}

/// A rigid frame's inverse.
fn rigid_inverse(m: &Affine3) -> Affine3 {
    let o = [m[0][3], m[1][3], m[2][3]];
    let mut out = [[0.0; 4]; 3];
    for r in 0..3 {
        for c in 0..3 {
            out[r][c] = m[c][r];
        }
        out[r][3] = -(0..3).map(|c| m[c][r] * o[c]).sum::<f64>();
    }
    out
}

/// A frame made orthonormal about its y: its own y, then x as its x less its part along y.
fn orthonormal_y(m: &Affine3) -> Affine3 {
    let y = unit(axis(m, 1));
    let x0 = axis(m, 0);
    let x = unit([
        x0[0] - dot(x0, y) * y[0],
        x0[1] - dot(x0, y) * y[1],
        x0[2] - dot(x0, y) * y[2],
    ]);
    frame([m[0][3], m[1][3], m[2][3]], x, y, cross(x, y))
}

/// A frame made orthonormal: its own z, then x as its x less its part along z.
fn orthonormal(m: &Affine3) -> Affine3 {
    let z = unit(axis(m, 2));
    let x0 = axis(m, 0);
    let x = unit([
        x0[0] - dot(x0, z) * z[0],
        x0[1] - dot(x0, z) * z[1],
        x0[2] - dot(x0, z) * z[2],
    ]);
    frame([m[0][3], m[1][3], m[2][3]], x, cross(z, x), z)
}

/// `ID#name`'s frame in the world: the item's anchor `name` (`anchors: {name: {pos, rot}}` in
/// its own space), else its built part `name`'s face, centred on it, facing its normal, with the
/// item's x across it; `None` when it names neither.
fn named_frame(ctx: &Ctx, layers: &[Layer3], at: &str) -> Option<(Affine3, Option<usize>)> {
    let (id, name) = at.split_once('#')?;
    let item = (ctx.get)(id)?;
    if let Some(a) = item.get("anchors").and_then(|a| a.get(name)) {
        let pos = crate::scene::size3(a.get("pos"), [0.0; 3]).unwrap_or([0.0; 3]);
        let rot = crate::scene::size3(a.get("rot"), [0.0; 3]).unwrap_or([0.0; 3]);
        let local = crate::scene::local_of(pos, rot, [1.0; 3], [1.0; 3]);
        let layer = layers.iter().position(|l| l.solids.iter().any(|s| s.id == id));
        return Some((orthonormal(&mul(&(ctx.world)(id), &local)), layer));
    }
    for (k, layer) in layers.iter().enumerate() {
        for s in &layer.solids {
            let Some(mesh) = s.mesh.as_ref().filter(|_| s.id == id) else {
                continue;
            };
            let tris = mesh.parts.get(name)?;
            let (mut c, mut n, mut area) = ([0.0; 3], [0.0; 3], 0.0);
            for &t in tris {
                let i = |k: usize| mesh.positions[mesh.indices[3 * t as usize + k] as usize];
                let (a, b, d) = (i(0), i(1), i(2));
                let w = cross(
                    [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
                    [d[0] - a[0], d[1] - a[1], d[2] - a[2]],
                );
                let wa = dot(w, w).sqrt() / 2.0;
                for r in 0..3 {
                    c[r] += wa * (a[r] + b[r] + d[r]) / 3.0;
                    n[r] += w[r];
                }
                area += wa;
            }
            if area <= 0.0 {
                return None;
            }
            let z = unit(n);
            // The item's x across the face, or its y on a face that looks along x.
            let across = if z[0].abs() > 0.99 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
            let x = unit([
                across[0] - dot(across, z) * z[0],
                across[1] - dot(across, z) * z[1],
                across[2] - dot(across, z) * z[2],
            ]);
            let local = frame(c.map(|v| v / area), x, cross(z, x), z);
            return Some((orthonormal(&mul(&s.model, &local)), Some(k)));
        }
    }
    None
}

/// The items `names` keeps in `doc`: each item named, a collection's members (each collection
/// read once, so one that holds itself ends), and their children.
pub(crate) fn kept(doc: &Map<String, Value>, names: &[&str]) -> BTreeSet<String> {
    let collections = doc.get("collections").and_then(Value::as_object);
    let mut out = BTreeSet::new();
    let mut read: BTreeSet<String> = BTreeSet::new();
    let mut todo: Vec<String> = names.iter().map(|s| s.to_string()).collect();
    while let Some(n) = todo.pop() {
        match collections.and_then(|c| c.get(&n)) {
            Some(c) => {
                if read.insert(n) {
                    todo.extend(
                        c.get("members")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                            .map(str::to_string),
                    );
                }
            }
            None => {
                out.insert(n);
            }
        }
    }
    let items = doc.get("items").and_then(Value::as_object);
    loop {
        let more: Vec<String> = items
            .into_iter()
            .flatten()
            .filter(|(id, item)| {
                !out.contains(*id)
                    && item
                        .get("parent")
                        .and_then(Value::as_str)
                        .is_some_and(|p| out.contains(p))
            })
            .map(|(id, _)| id.clone())
            .collect();
        if more.is_empty() {
            return out;
        }
        out.extend(more);
    }
}

/// What a view's `include` and `exclude` keep: the items `include` names (every item with none)
/// less those `exclude` names; `None` for every item.
pub(crate) fn kept_view(doc: &Map<String, Value>, view: &Value) -> Option<BTreeSet<String>> {
    let (include, exclude) = (names(view.get("include")), names(view.get("exclude")));
    if include.is_empty() && exclude.is_empty() {
        return None;
    }
    let mut keep = match include.is_empty() {
        true => doc
            .get("items")
            .and_then(Value::as_object)
            .map(|i| i.keys().cloned().collect())
            .unwrap_or_default(),
        false => kept(doc, &include),
    };
    for x in kept(doc, &exclude) {
        keep.remove(&x);
    }
    Some(keep)
}

pub(crate) fn names(v: Option<&Value>) -> Vec<&str> {
    match v {
        Some(Value::String(s)) => vec![s.as_str()],
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    }
}

/// The 2D document an inset's content draws in: its entries as items of one layer, in texels
/// from the texture's top left, y down.
fn content_doc(id: &str, size: [u32; 2], content: &Map<String, Value>) -> Value {
    let items: Map<String, Value> = content
        .iter()
        .map(|(eid, e)| {
            let mut item = e.as_object().cloned().unwrap_or_default();
            item.insert("id".into(), json!(eid));
            item.insert("layer".into(), json!("inset"));
            item.entry("name").or_insert(json!(eid));
            (eid.clone(), Value::Object(item))
        })
        .collect();
    json!({
        "format": 1, "id": id, "profile": "figure", "title": id, "size": size,
        "layers": {"inset": {"writer": "inset", "title": "Inset", "order": "a0"}},
        "items": items,
    })
}

/// A picture's key: the inset's ID and a hash of what it draws.
fn picture_key(id: &str, doc: &Value) -> String {
    let mut h = deep_canvas::schedule::Hasher::new("scene3d.inset");
    h.text(&doc.to_string());
    let k = h.finish().0;
    let hex: String = k[..8].iter().map(|b| format!("{b:02x}")).collect();
    format!("inset:{id}:{hex}")
}

/// A unit window quad on the face's own x and y, `PROUD` along its z, uv (0, 0) at its top left.
fn window_mesh(size: [f64; 2]) -> Mesh {
    let (x, y) = (size[0] / 2.0, size[1] / 2.0);
    let mut m = Mesh {
        positions: vec![[-x, y, PROUD], [x, y, PROUD], [x, -y, PROUD], [-x, -y, PROUD]],
        normals: vec![[0.0, 0.0, 1.0]; 4],
        indices: vec![0, 3, 2, 0, 2, 1],
        faces: vec![0, 0],
        uv0: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        ..Mesh::default()
    };
    m.parts.insert("window".into(), vec![0, 1]);
    m
}

fn mesh_hash(mesh: &Mesh) -> u64 {
    let mut h = deep_canvas::schedule::Hasher::new("scene3d.mesh");
    h.bytes(&deep_canvas::schedule::Canonical::canonical_bytes(mesh));
    let k = h.finish().0;
    u64::from_le_bytes([k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7]])
}

/// The maps of a window whose base color slot reads `sha`.
fn window_maps(sha: String, inset: InsetMap) -> Arc<Maps> {
    let mut m = Maps {
        key: String::new(),
        base_color: Some(MapSlot {
            sha,
            uv: 0,
            transform: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            wrap: [Wrap::Clamp; 2],
            taps: Some(1),
        }),
        metallic_roughness: None,
        normal: None,
        occlusion: None,
        emission: None,
        normal_scale: 1.0,
        occlusion_strength: 1.0,
        alpha_cutoff: 0.5,
        inset,
    };
    m.key = format!("{m:?}");
    Arc::new(m)
}

/// An unlit white material: a view's picture drawn as it is, for the frame's output to tone map
/// once.
fn picture_material(look: &crate::look::Look3, id: &str) -> Result<Option<crate::light::Material>, Refused> {
    let mat = json!({"kind": "material@1", "params": {"base_color": [1, 1, 1, 1], "unlit": true, "double_sided": true}});
    let item = json!({"material": "picture"});
    crate::light::material(&item, |_| Some(&mat), look, id)
}

/// The insets of the document at t, their windows added to `layers`.
pub(crate) fn evaluate(
    ctx: &Ctx,
    look: &crate::look::Look3,
    layers: &mut [Layer3],
) -> Result<Insets, Refused> {
    let mut out = Insets::default();
    let items = ctx.doc.get("items").and_then(Value::as_object);
    for (id, _) in items.into_iter().flatten() {
        let Some(item) = (ctx.get)(id).filter(|i| i.get("kind").and_then(Value::as_str) == Some(KIND)) else {
            continue;
        };
        if item.get("visible") == Some(&Value::Bool(false)) {
            continue;
        }
        let path = format!("items/{id}/params");
        let empty = Map::new();
        let p = item.get("params").and_then(Value::as_object).unwrap_or(&empty);
        let Some(size) = pair(p.get("size")).filter(|s| s[0] > 0.0 && s[1] > 0.0) else {
            return refused("out_of_range", format!("{path}/size"));
        };
        let ppu = match p.get("px_per_unit") {
            None => DEFAULT_TEXELS / size[0].max(size[1]),
            v => num(v)
                .filter(|v| *v > 0.0)
                .ok_or_else(|| Refused {
                    code: "out_of_range",
                    path: format!("{path}/px_per_unit"),
                })?,
        };
        let texels = size.map(|s| (s * ppu).round().clamp(1.0, 8192.0) as u32);
        let picture = match p.get("content").and_then(Value::as_object) {
            Some(content) => {
                let document = content_doc(id, texels, content);
                let key = picture_key(id, &document);
                out.pictures.push(Picture {
                    id: id.clone(),
                    key: key.clone(),
                    size: texels,
                    document: Arc::new(document),
                });
                Some((key, content))
            }
            None => None,
        };
        if let Some(project) = p.get("project") {
            let Some((key, content)) = picture else {
                return refused("bad_input", format!("{path}/content"));
            };
            let data = content.values().any(|e| e.get("role").and_then(Value::as_str) == Some("data"));
            out.projected.push(projected(ctx, id, item, project, size, key, data, layers)?);
            continue;
        }
        let Some(face) = p.get("face").and_then(Value::as_str) else {
            return refused("bad_input", format!("{path}/face"));
        };
        let owner = face.split_once('#').map_or(face, |(o, _)| o);
        // A face on a part that doesn't draw at t (hidden, or a hidden parent's) hides with it.
        let drawn = layers.iter().flat_map(|l| &l.solids).any(|s| s.id == owner);
        if !drawn && (ctx.get)(owner).is_some() {
            continue;
        }
        let Some((at, layer)) = named_frame(ctx, layers, face) else {
            return refused("ref_unresolved", format!("{path}/face"));
        };
        let parent = layers
            .iter()
            .flat_map(|l| &l.solids)
            .find(|s| s.id == owner)
            .cloned();
        let Some(mut window) = parent else {
            return refused("ref_unresolved", format!("{path}/face"));
        };
        let mesh = window_mesh(size);
        window.id = id.clone();
        window.shape = Shape::Built(mesh_hash(&mesh));
        window.model = at;
        window.mesh = Some(Arc::new(mesh));
        window.stroke = None;
        window.lod = None;
        window.mask = None;
        window.sway = None;
        window.cast_shadow = false;
        window.op = None;
        match (&picture, p.get("view")) {
            (Some((key, _)), None) => {
                // The content over the face's own shading: a painted face takes a material of
                // its color, so the maps bind.
                if window.material.is_none() {
                    let c = window.color.map(|v| f64::from(v) / 255.0);
                    let mat = json!({"kind": "material@1", "params": {"base_color": [srgb(c[0]), srgb(c[1]), srgb(c[2]), 1]}});
                    window.material = crate::light::material(&json!({"material": "face"}), |_| Some(&mat), look, id)?;
                }
                window.maps = Some(window_maps(key.clone(), InsetMap::Over));
            }
            (None, Some(view)) => {
                let eye = view.get("map").and_then(Value::as_str) == Some("eye");
                let camera = view.get("camera").and_then(Value::as_str).filter(|c| *c != "none");
                let keep = kept_view(ctx.doc, view);
                window.material = picture_material(look, id)?;
                let plant = ctx.planted == Some("eye_inset_centred_frustum");
                if eye && !plant {
                    let by = match view.get("through").and_then(Value::as_str) {
                        Some(t) => {
                            let (to, _) = named_frame(ctx, layers, t).ok_or_else(|| Refused {
                                code: "ref_unresolved",
                                path: format!("{path}/view/through"),
                            })?;
                            mul(&to, &rigid_inverse(&at))
                        }
                        None => frame([0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
                    };
                    let place = mul(&by, &at);
                    let n = axis(&place, 2);
                    let o = [place[0][3], place[1][3], place[2][3]];
                    window.maps = Some(window_maps(view_key(id), InsetMap::AtPixel));
                    out.views.push(View {
                        id: id.clone(),
                        camera: ctx.camera.clone(),
                        size: [ctx.camera.size[0] as u32, ctx.camera.size[1] as u32],
                        keep,
                        eye: Some(Eye { by, plane: (n, dot(n, o)) }),
                    });
                } else {
                    let cam = if eye {
                        centred(ctx.camera, &at, size, texels)
                    } else {
                        let Some(c) = camera else {
                            return refused("bad_input", format!("{path}/view/camera"));
                        };
                        let params = (ctx.get)(c)
                            .and_then(|i| i.get("params"))
                            .and_then(Value::as_object)
                            .ok_or_else(|| Refused {
                                code: "ref_unresolved",
                                path: format!("{path}/view/camera"),
                            })?;
                        let s = texels.map(f64::from);
                        crate::scene::camera(params, s, ctx.bounds, &format!("items/{c}/params"))?
                    };
                    window.maps = Some(window_maps(view_key(id), InsetMap::Map));
                    out.views.push(View {
                        id: id.clone(),
                        camera: cam,
                        size: texels,
                        keep,
                        eye: None,
                    });
                }
            }
            _ => return refused("bad_input", format!("{path}/content")),
        }
        let k = layer.unwrap_or(0).min(layers.len().saturating_sub(1));
        if let Some(l) = layers.get_mut(k) {
            l.solids.push(window);
        }
    }
    Ok(out)
}

fn srgb(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// #506 criterion 6's planted wrong program: a camera at the viewing eye aimed at the window's
/// centre through a symmetric frustum just holding the window, its picture laid on the face's
/// corners.
fn centred(main: &Camera, at: &Affine3, size: [f64; 2], texels: [u32; 2]) -> Camera {
    let centre = [at[0][3], at[1][3], at[2][3]];
    let forward = unit([centre[0] - main.eye[0], centre[1] - main.eye[1], centre[2] - main.eye[2]]);
    let right = unit(cross(forward, [0.0, 1.0, 0.0]));
    let up = cross(right, forward);
    let mut c = Camera {
        size: texels.map(f64::from),
        eye: main.eye,
        right,
        up,
        forward,
        perspective: true,
        scale: 1.0,
        centre: [f64::from(texels[0]) / 2.0, f64::from(texels[1]) / 2.0],
        roll: [1.0, 0.0],
        near: main.near,
        far: main.far,
    };
    let mut half = 1e-9f64;
    for [x, y] in [[-1.0, 1.0], [1.0, 1.0], [1.0, -1.0], [-1.0, -1.0]] {
        let v = c.to_view(apply(at, [x * size[0] / 2.0, y * size[1] / 2.0, 0.0]));
        half = half.max((v[0] / v[2]).abs()).max((v[1] / v[2]).abs());
    }
    c.scale = f64::from(texels[0].min(texels[1])) / 2.0 / half;
    c
}

/// A projected inset's box and cast at t.
#[allow(clippy::too_many_arguments)]
fn projected(
    ctx: &Ctx,
    id: &str,
    item: &Value,
    project: &Value,
    size: [f64; 2],
    key: String,
    data: bool,
    layers: &[Layer3],
) -> Result<Projected, Refused> {
    let path = format!("items/{id}/params/project");
    let world = (ctx.world)(id);
    let origin = [world[0][3], world[1][3], world[2][3]];
    let onto = match project.get("onto") {
        None => item.get("parent").and_then(Value::as_str).map(|p| vec![p]),
        v => Some(names(v)),
    };
    let onto: Option<BTreeSet<String>> = onto.map(|n| kept(ctx.doc, &n));
    let solids: Vec<String> = layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| {
            let owner = s.id.split_once('#').map_or(s.id.as_str(), |(o, _)| o);
            onto.as_ref().is_none_or(|o| o.contains(owner))
        })
        .map(|s| s.id.clone())
        .collect();
    let from = project.get("from").and_then(Value::as_str).unwrap_or("down");
    // The box's own frame: x and z across its size, y against the cast.
    let (place, eye) = match from {
        "down" => (frame(origin, [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]), None),
        // Along its own −y, its x and z across.
        "axis" => (orthonormal_y(&world), None),
        c => {
            let params = (ctx.get)(c)
                .and_then(|i| i.get("params"))
                .and_then(Value::as_object)
                .ok_or_else(|| Refused {
                    code: "ref_unresolved",
                    path: format!("{path}/from"),
                })?;
            let cam = crate::scene::camera(params, size, ctx.bounds, &format!("items/{c}/params"))?;
            (frame(cam.eye, cam.right, cam.up, cam.forward.map(|v| -v)), Some(cam))
        }
    };
    let inv = rigid_inverse(&place);
    // How far the box reaches along its y: through everything it lands on (auto), or `depth`.
    let (lo, hi) = match project.get("depth") {
        None | Some(Value::String(_)) => {
            let ys = layers
                .iter()
                .flat_map(|l| &l.solids)
                .filter(|s| solids.contains(&s.id))
                .flat_map(crate::scene::corners_of)
                .map(|p| apply(&inv, p)[1]);
            let (lo, hi) = ys.fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), y| (a.min(y), b.max(y)));
            if lo.is_finite() {
                (lo - 1.0, hi + 1.0)
            } else {
                (-1e6, 1e6)
            }
        }
        v => {
            let d = num(v).filter(|d| *d > 0.0).ok_or_else(|| Refused {
                code: "out_of_range",
                path: format!("{path}/depth"),
            })?;
            (-d / 2.0, d / 2.0)
        }
    };
    let row = |k: usize, s: f64, o: f64| -> [f64; 4] {
        [inv[k][0] / s, inv[k][1] / s, inv[k][2] / s, (inv[k][3] - o) / s]
    };
    let to_box = match &eye {
        None => [
            row(0, size[0], -size[0] / 2.0),
            row(2, size[1], -size[1] / 2.0),
            row(1, hi - lo, lo),
            [0.0, 0.0, 0.0, 1.0],
        ],
        Some(cam) => {
            // The camera's clip, with u and v across its frame and depth from its near plane.
            let c = cam.clip(crate::scene::Depth::Forward { far: cam.far.max(cam.near + 1.0) });
            let w = c[3];
            [
                std::array::from_fn(|k| (c[0][k] + w[k]) / 2.0),
                std::array::from_fn(|k| (w[k] - c[1][k]) / 2.0),
                c[2],
                w,
            ]
        }
    };
    let fade = project.get("fade");
    let edge = num(fade.and_then(|f| f.get("edge"))).unwrap_or(0.5);
    let angle = num(fade.and_then(|f| f.get("angle"))).unwrap_or(75.0);
    if edge < 0.0 || !(0.0..=90.0).contains(&angle) {
        return refused("out_of_range", format!("{path}/fade"));
    }
    let unlit = match project.get("shading").and_then(Value::as_str) {
        None | Some("auto") => data,
        Some("unlit") => true,
        Some("lit") => false,
        Some(_) => return refused("out_of_range", format!("{path}/shading")),
    };
    let opacity = num(project.get("opacity")).unwrap_or(1.0).clamp(0.0, 1.0);
    Ok(Projected {
        id: id.to_string(),
        key,
        to_box,
        along: axis(&place, 1).map(|v| -v),
        eye: eye.map(|c| c.eye),
        onto: onto.map(|_| solids),
        edge: [edge / size[0], edge / size[1]],
        cos_angle: angle.to_radians().cos(),
        opacity,
        unlit,
    })
}

/// What the check refuses in a document's insets and view overlays before anything draws (#506),
/// each issue naming its items: more than [`MAX_PROJECTED`] projected insets in one view; an eye
/// inset that names a camera; a view overlay held in another view overlay's `include`.
pub fn refusals(doc: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return out;
    };
    let of = |kind: &str| -> Vec<(&String, &Value)> {
        items
            .iter()
            .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some(kind))
            .collect()
    };
    let projected: Vec<&String> = of(KIND)
        .into_iter()
        .filter(|(_, i)| i.pointer("/params/project").is_some())
        .map(|(id, _)| id)
        .collect();
    if projected.len() > MAX_PROJECTED {
        out.push(json!({"code": "over_budget", "severity": "error", "path": "items", "ids": projected,
            "what": format!("{} projected insets in one view, past the {MAX_PROJECTED} it holds: {}", projected.len(),
                projected.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "))}));
    }
    for (id, i) in of(KIND) {
        let view = i.pointer("/params/view");
        let eye = view.and_then(|v| v.get("map")).and_then(Value::as_str) == Some("eye");
        let camera = view.and_then(|v| v.get("camera")).and_then(Value::as_str).filter(|c| *c != "none");
        if eye && camera.is_some() {
            out.push(json!({"code": "bad_input", "severity": "error", "path": format!("items/{id}/params/view/camera"), "ids": [id],
                "what": format!("the eye inset {id} names a camera; an eye inset takes the viewing camera's eye")}));
        }
    }
    let views = of(crate::views::KIND);
    let map = doc.as_object().expect("items came from an object");
    for (id, v) in &views {
        let held = kept(map, &names(v.pointer("/params/include")));
        for (inner, _) in views.iter().filter(|(o, _)| o != id && held.contains(o.as_str())) {
            out.push(json!({"code": "nested_view", "severity": "error", "path": format!("items/{inner}"), "ids": [inner],
                "what": format!("the view overlay {inner} is inside the view overlay {id}; views nest one level deep")}));
        }
    }
    out
}
