//! Level of detail in 3D (issue #425; canvas primitives: Level of detail, Level of detail: levels
//! by error): each item's bands by its projected size in device px, a blend through
//! complementary masks inside a threshold's margin, and a mesh asset's index-only levels chosen by
//! their error projected through the view. Every choice is a pure function of the view the scene
//! was evaluated at, in f64 on the CPU: no session state, no time, no earlier frame.

use std::sync::Arc;

use serde_json::Value;

use crate::geom::{Mesh, V3};
use crate::scene::{matmul, Affine3, Camera, Refused, Scene, Shape, Solid};

/// The blend's buckets: inside a margin the less detailed band keeps `level` of every `OF`
/// pixels, by a hash of the pixel and the item.
pub const OF: u32 = 64;

/// The largest projected error a level may have, device px (each budget class's `lod_px`).
pub const LOD_PX: f64 = 1.0;

/// What a band draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Show {
    Full,
    Proxy,
    Box,
    Dot,
    LabelOnly,
    None,
}

impl Show {
    pub fn name(self) -> &'static str {
        match self {
            Show::Full => "full",
            Show::Proxy => "proxy",
            Show::Box => "box",
            Show::Dot => "dot",
            Show::LabelOnly => "label_only",
            Show::None => "none",
        }
    }

    fn parse(s: &str) -> Option<Show> {
        [
            Show::Full,
            Show::Proxy,
            Show::Box,
            Show::Dot,
            Show::LabelOnly,
            Show::None,
        ]
        .into_iter()
        .find(|b| b.name() == s)
    }
}

/// One mesh level: its mesh (the full one's vertices, its own indices), the hash the renderer
/// keys it by, and its error as a fraction of the mesh's extent.
#[derive(Clone, Debug, PartialEq)]
pub struct Level {
    pub mesh: Arc<Mesh>,
    pub hash: u64,
    pub error: f64,
}

/// An item's level of detail: its bands (largest `below_px` first) and margin, its bounds in its
/// own space, and its mesh's levels by error with the extent their errors are fractions of.
#[derive(Clone, Debug, PartialEq)]
pub struct Lod {
    pub bands: Vec<(f64, Show)>,
    pub margin: f64,
    pub bounds: [V3; 2],
    pub levels: Vec<Level>,
    pub extent: f64,
    /// The largest projected error a level may have, device px: the class's 1, or lower where
    /// the document's `budget.lod_px` lowers it.
    pub lod_px: f64,
    /// A proxy band's `params`: the share of triangles it keeps and the error it allows.
    pub proxy: Option<Proxy>,
    /// For a mesh without levels, the proxy the simplify step made of it once per content key.
    pub proxy_mesh: Option<Level>,
    /// A terrain plate's tile, its column and row (#2017): its levels' errors are in m, and
    /// project at its nearest point.
    pub tile: Option<[u32; 2]>,
}

/// A proxy band's `params` (Level of detail: proxies): `ratio`, the share of triangles kept,
/// and `error`, the deviation it allows as a fraction of the bounds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Proxy {
    pub ratio: f64,
    pub error: Option<f64>,
}

/// An item's `lod` field as read: its bands, margin and proxy params.
pub struct Bands {
    pub bands: Vec<(f64, Show)>,
    pub margin: f64,
    pub proxy: Option<Proxy>,
}

/// The document's lod_px: each class's 1 device px, which `budget.lod_px` may only lower.
pub fn lod_px(doc: &serde_json::Map<String, Value>) -> f64 {
    doc.get("budget")
        .and_then(|b| b.get("lod_px"))
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && *v > 0.0)
        .map_or(LOD_PX, |v| v.min(LOD_PX))
}

/// A solid's mask inside a band margin: the blend level, and whether it is the less detailed
/// band's draw.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mask {
    pub level: u32,
    pub lower: bool,
}

/// An item's `lod` field (`{bands: [{below_px, show, params}], margin = 0.1}`), or none.
pub fn bands_of(item: &Value, path: &str) -> Result<Option<Bands>, Refused> {
    let Some(lod) = item.get("lod").filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let bad = |p: &str| Refused {
        code: "out_of_range",
        path: format!("{path}/lod{p}"),
    };
    let mut bands = Vec::new();
    let mut proxy = None;
    for (i, b) in lod
        .get("bands")
        .and_then(Value::as_array)
        .ok_or_else(|| bad("/bands"))?
        .iter()
        .enumerate()
    {
        let below = b
            .get("below_px")
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite() && *v > 0.0)
            .ok_or_else(|| bad(&format!("/bands/{i}/below_px")))?;
        let show = b
            .get("show")
            .and_then(Value::as_str)
            .and_then(Show::parse)
            .ok_or_else(|| bad(&format!("/bands/{i}/show")))?;
        if show == Show::Proxy {
            let num = |k: &str| b.pointer(&format!("/params/{k}")).and_then(Value::as_f64);
            let ratio = num("ratio").unwrap_or(0.5);
            if !(ratio > 0.0 && ratio <= 1.0) {
                return Err(bad(&format!("/bands/{i}/params/ratio")));
            }
            let error = num("error");
            if error.is_some_and(|e| e.is_nan() || e < 0.0) {
                return Err(bad(&format!("/bands/{i}/params/error")));
            }
            proxy = Some(Proxy { ratio, error });
        }
        bands.push((below, show));
    }
    bands.sort_by(|a, b| b.0.total_cmp(&a.0));
    let margin = match lod.get("margin") {
        None | Some(Value::Null) => 0.1,
        Some(m) => m
            .as_f64()
            .filter(|m| (0.0..1.0).contains(m))
            .ok_or_else(|| bad("/margin"))?,
    };
    Ok(Some(Bands {
        bands,
        margin,
        proxy,
    }))
}

/// What one item draws at a view.
#[derive(Clone, Debug, PartialEq)]
pub struct Choice {
    pub item: String,
    /// Its projected size, device px.
    pub size_px: f64,
    /// The bands it draws, the more detailed first; two inside a margin.
    pub bands: Vec<Show>,
    /// Inside a margin, the blend level of [`OF`].
    pub blend: Option<u32>,
    /// With levels: the level drawn, every level's projected error in device px, and the
    /// triangles the drawn bands hold.
    pub level: Option<usize>,
    pub errors_px: Option<Vec<f64>>,
    pub triangles: Option<u64>,
    /// With levels, the level the shadow passes draw: chosen by the light's projection, the
    /// camera's band kept.
    pub shadow_level: Option<usize>,
    /// A terrain plate's tile, its column and row (#2017).
    pub tile: Option<[u32; 2]>,
}

/// The item's world bounds' centre and largest extent, m.
fn world_bounds(model: &Affine3, lod: &Lod) -> (V3, f64) {
    let [lo, hi] = lod.bounds;
    let c = [0, 1, 2].map(|k| (lo[k] + hi[k]) / 2.0);
    let d = [0, 1, 2].map(|k| hi[k] - lo[k]);
    let centre = [0, 1, 2]
        .map(|r| model[r][0] * c[0] + model[r][1] * c[1] + model[r][2] * c[2] + model[r][3]);
    let extent = (0..3)
        .map(|r| (0..3).map(|k| model[r][k].abs() * d[k]).sum::<f64>())
        .fold(0.0, f64::max);
    (centre, extent)
}

/// Px per m at the item's centre, through the view.
fn px_per_m(camera: &Camera, centre: V3) -> f64 {
    camera.px_per_m(camera.to_view(centre)[2])
}

/// The item's projected size: its bounds' largest extent at its centre's depth, device px.
pub fn size_px(camera: &Camera, model: &Affine3, lod: &Lod) -> f64 {
    let (centre, extent) = world_bounds(model, lod);
    extent * px_per_m(camera, centre)
}

/// The bands at `size` px: one, or two inside a threshold's margin with the blend level, the
/// share of [`OF`] the less detailed band keeps, from 0 at the margin's top to `OF` at its foot.
pub fn bands_at(bands: &[(f64, Show)], margin: f64, size: f64) -> (Vec<Show>, Option<u32>) {
    let show = |k: usize| if k == 0 { Show::Full } else { bands[k - 1].1 };
    for (k, &(t, lower)) in bands.iter().enumerate() {
        let (lo, hi) = (t * (1.0 - margin), t * (1.0 + margin));
        if margin > 0.0 && size >= lo && size <= hi {
            let share = ((hi - size) / (hi - lo)).clamp(0.0, 1.0);
            let level = (share * f64::from(OF)).round() as u32;
            return (vec![show(k), lower], Some(level));
        }
    }
    (
        vec![show(bands.iter().filter(|b| size < b.0).count())],
        None,
    )
}

/// Each level's error projected through the view at the item's centre, device px; a terrain
/// tile's at its nearest point (#2017).
pub fn errors_px(camera: &Camera, model: &Affine3, lod: &Lod) -> Vec<f64> {
    if lod.tile.is_some() {
        return errors_at(model, lod, nearest_px_per_m(camera, model, lod.bounds));
    }
    let (centre, _) = world_bounds(model, lod);
    errors_at(model, lod, px_per_m(camera, centre))
}

/// Px per m at the nearest point of `bounds` (#2017, as a chunk tree projects its chunks): at
/// the least view depth of its corners, held at the near plane, widened by the frame's corner,
/// where a ray leaves the view's axis most. A move of e m anywhere in the bounds moves its point
/// on screen by at most e times this.
pub fn nearest_px_per_m(camera: &Camera, model: &Affine3, bounds: [V3; 2]) -> f64 {
    if !camera.perspective {
        return camera.scale;
    }
    let [lo, hi] = bounds;
    let depth = (0..8)
        .map(|c| {
            let p = [0, 1, 2].map(|k| if c & (1 << k) == 0 { lo[k] } else { hi[k] });
            camera.to_view(crate::scene::apply(model, p))[2]
        })
        .fold(f64::INFINITY, f64::min)
        .max(camera.near);
    let [w, h] = camera.size;
    let [cx, cy] = camera.centre;
    let corner = [(0.0, 0.0), (w, 0.0), (0.0, h), (w, h)]
        .map(|(x, y)| (x - cx).hypot(y - cy))
        .into_iter()
        .fold(0.0, f64::max)
        / camera.scale.max(1e-9);
    camera.px_per_m(depth) * (1.0 + corner * corner).sqrt()
}

/// Each level's error at `px_per_m` px per m, device px.
fn errors_at(model: &Affine3, lod: &Lod, px_per_m: f64) -> Vec<f64> {
    let scale = (0..3)
        .map(|c| {
            (0..3)
                .map(|r| model[r][c] * model[r][c])
                .sum::<f64>()
                .sqrt()
        })
        .fold(0.0, f64::max);
    let k = lod.extent * scale * px_per_m;
    lod.levels.iter().map(|l| l.error * k).collect()
}

/// The coarsest level whose projected error is at most `lod_px`.
pub fn level_at(errors: &[f64], lod_px: f64) -> usize {
    errors.iter().rposition(|e| *e <= lod_px).unwrap_or(0)
}

/// Every item's choice at the scene's view, in layer and solid order.
pub fn select(scene: &Scene) -> Vec<Choice> {
    let mut out = Vec::new();
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        if let Some(lod) = &s.lod {
            out.push(choose(&scene.camera, s, lod, None));
        }
    }
    out
}

/// One item's choice at `camera`; `bands` given, from the caller's own rule, else by its size.
pub fn choose(
    camera: &Camera,
    s: &Solid,
    lod: &Lod,
    bands: Option<(Vec<Show>, Option<u32>)>,
) -> Choice {
    let size = size_px(camera, &s.model, lod);
    let (bands, blend) = bands.unwrap_or_else(|| bands_at(&lod.bands, lod.margin, size));
    let (level, errors_px) = if lod.levels.len() > 1 || lod.tile.is_some() {
        let e = errors_px(camera, &s.model, lod);
        (Some(level_at(&e, lod.lod_px)), Some(e))
    } else {
        (None, None)
    };
    let mut c = Choice {
        item: s.id.clone(),
        size_px: size,
        bands,
        blend,
        level,
        errors_px,
        triangles: None,
        shadow_level: None,
        tile: lod.tile,
    };
    c.triangles = c.level.map(|l| triangles(&c, lod, l));
    c
}

/// Each leveled choice's shadow level: the coarsest level whose error, projected through the
/// key light's shadow map at the item's centre (`texels_per_m`, none where no map covers it),
/// is at most lod_px, and never finer than the level the camera draws, which is what receives
/// the shadow: a finer caster would shadow the coarser surface it stands out of. Choices are in
/// `select`'s order.
pub fn shadow_levels(
    scene: &Scene,
    choices: &mut [Choice],
    texels_per_m: impl Fn(V3) -> Option<f64>,
) {
    let solids = scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter_map(|s| Some((s, s.lod.as_ref()?)));
    for ((s, lod), c) in solids.zip(choices.iter_mut()) {
        // A terrain tile casts as it draws, so its shadow lands on its own surface (#2017).
        if c.level.is_none() || lod.tile.is_some() {
            continue;
        }
        let (centre, _) = world_bounds(&s.model, lod);
        c.shadow_level = texels_per_m(centre)
            .map(|k| level_at(&errors_at(&s.model, lod, k), lod.lod_px).max(c.level.unwrap_or(0)));
    }
}

/// The triangles a choice draws at mesh level `level`.
pub fn triangles(c: &Choice, lod: &Lod, level: usize) -> u64 {
    c.bands
        .iter()
        .map(|b| match b {
            Show::Full => lod.levels[level].mesh.triangles() as u64,
            Show::Proxy => proxy_level(lod, Some(level)).map_or(0, |l| l.mesh.triangles() as u64),
            Show::Box => 12,
            _ => 0,
        })
        .sum()
}

/// The scene with each item drawn as its choice says, in `choices`' order: its level's mesh, its
/// box, or a dot, and inside a margin both bands, each masked.
pub fn resolve(scene: &mut Scene, choices: &[Choice]) {
    let mut next = choices.iter();
    let camera = scene.camera.clone();
    for layer in &mut scene.layers {
        if layer.solids.iter().all(|s| s.lod.is_none()) {
            continue;
        }
        let solids = std::mem::take(&mut layer.solids);
        for s in solids {
            let Some(lod) = s.lod.clone() else {
                layer.solids.push(s);
                continue;
            };
            let Some(c) = next.next() else { break };
            let two = c.bands.len() == 2;
            for (k, show) in c.bands.iter().enumerate() {
                let mask = c.blend.filter(|_| two).map(|level| Mask {
                    level,
                    lower: k == 1,
                });
                if let Some(mut d) = drawn(&camera, &s, &lod, *show, c.level) {
                    d.mask = mask;
                    // The shadow passes draw the level the light's projection chose (#425).
                    let shadow = c
                        .shadow_level
                        .filter(|_| d.cast_shadow && matches!(show, Show::Full | Show::Proxy))
                        .and_then(|l| drawn(&camera, &s, &lod, *show, Some(l)))
                        .filter(|sh| sh.shape != d.shape);
                    if let Some(mut sh) = shadow {
                        d.cast_shadow = false;
                        sh.mask = mask;
                        sh.cast_only = true;
                        // The coarser caster drawn inside the surface by its error (at most a
                        // shadow texel), so none of it stands out of what the camera draws.
                        let level = c.shadow_level.and_then(|l| lod.levels.get(l));
                        sh.inset = level.map_or(0.0, |l| l.error * lod.extent);
                        layer.solids.push(sh);
                    }
                    layer.solids.push(d);
                }
            }
        }
    }
}

/// What one band draws of a solid.
fn drawn(camera: &Camera, s: &Solid, lod: &Lod, show: Show, level: Option<usize>) -> Option<Solid> {
    let mut d = s.clone();
    match show {
        Show::Full => {
            if let Some(l) = level.and_then(|l| lod.levels.get(l)) {
                d.mesh = Some(l.mesh.clone());
                d.shape = Shape::Built(l.hash);
            }
        }
        Show::Proxy => {
            if let Some(l) = proxy_level(lod, level) {
                d.mesh = Some(l.mesh.clone());
                d.shape = Shape::Built(l.hash);
            }
        }
        Show::Box | Show::Dot => {
            let [lo, hi] = lod.bounds;
            let size = if show == Show::Box {
                [0, 1, 2].map(|k| (hi[k] - lo[k]).max(1e-6))
            } else {
                // A dot 4 px across at the item's centre.
                let (centre, _) = world_bounds(&s.model, lod);
                let m = 4.0 / px_per_m(camera, centre).max(1e-9);
                let scale = (0..3)
                    .map(|c| (0..3).map(|r| s.model[r][c].powi(2)).sum::<f64>().sqrt())
                    .fold(0.0, f64::max)
                    .max(1e-9);
                [m / scale; 3]
            };
            let c = [0, 1, 2].map(|k| (lo[k] + hi[k]) / 2.0);
            d.model = matmul(
                &s.model,
                &[
                    [size[0], 0.0, 0.0, c[0]],
                    [0.0, size[1], 0.0, c[1]],
                    [0.0, 0.0, size[2], c[2]],
                ],
            );
            d.shape = if show == Show::Box {
                Shape::Box
            } else {
                Shape::Sphere
            };
            d.mesh = None;
            d.stroke = None;
        }
        Show::LabelOnly | Show::None => return None,
    }
    d.lod = None;
    Some(d)
}

/// What a proxy band draws: of a mesh with levels, the coarser of the level by error and the
/// coarsest level that keeps at least the proxy's share of triangles within its error; of a mesh
/// without, its proxy mesh; none for a primitive, which draws in full.
fn proxy_level(lod: &Lod, level: Option<usize>) -> Option<&Level> {
    let p = lod.proxy?;
    if lod.levels.len() > 1 {
        let full = lod.levels[0].mesh.triangles() as f64;
        let by_ratio = lod
            .levels
            .iter()
            .rposition(|l| {
                l.mesh.triangles() as f64 >= p.ratio * full && p.error.is_none_or(|e| l.error <= e)
            })
            .unwrap_or(0);
        return lod.levels.get(by_ratio.max(level.unwrap_or(0)));
    }
    lod.proxy_mesh.as_ref()
}

/// The proxy of `mesh` (keyed by `hash`) that keeps `p.ratio` of its triangles within `p.error`,
/// made once per content key by meshoptimizer and stored by hash in `memo`, the host's, never
/// per frame.
pub fn proxy_of(mesh: &Mesh, hash: u64, p: Proxy, memo: &crate::memo::Memo) -> Option<Level> {
    let key = (hash, p.ratio.to_bits(), p.error.unwrap_or(-1.0).to_bits());
    let made = &memo.proxies;
    if let Some(l) = made.lock().ok()?.get(&key) {
        return l.clone();
    }
    let positions: Vec<f32> = mesh
        .positions
        .iter()
        .flat_map(|q| q.map(|v| v as f32))
        .collect();
    let level = meshopt::VertexDataAdapter::new(meshopt::typed_to_bytes(&positions), 12, 0)
        .ok()
        .and_then(|adapter| {
            let target = ((mesh.indices.len() / 3) as f64 * p.ratio) as usize * 3;
            let mut error = 0.0f32;
            let indices = meshopt::simplify(
                &mesh.indices,
                &adapter,
                target.max(3),
                p.error.unwrap_or(1.0) as f32,
                meshopt::SimplifyOptions::None,
                Some(&mut error),
            );
            if indices.is_empty() {
                return None;
            }
            let leveled = Mesh {
                lods: vec![(indices, f64::from(error))],
                ..mesh.clone()
            };
            levels(&Arc::new(leveled), hash ^ 0x5052_4f58_5900_0000).pop()
        });
    if let Ok(mut m) = made.lock() {
        m.insert(key, level.clone());
    }
    level
}

/// A mesh's levels as the simplify job stored them (`Mesh::lods`), each a mesh over the full
/// one's vertices keyed by `hash`'s level, the full mesh first at error 0.
pub fn levels(mesh: &Arc<Mesh>, hash: u64) -> Vec<Level> {
    let mut out = vec![Level {
        mesh: mesh.clone(),
        hash,
        error: 0.0,
    }];
    for (i, (indices, error)) in mesh.lods.iter().enumerate() {
        let mut m = Mesh {
            positions: mesh.positions.clone(),
            normals: mesh.normals.clone(),
            uv0: mesh.uv0.clone(),
            uv1: mesh.uv1.clone(),
            tangents: mesh.tangents.clone(),
            ..Mesh::default()
        };
        for t in indices.as_chunks::<3>().0 {
            m.tri(t[0], t[1], t[2], 0);
        }
        out.push(Level {
            mesh: Arc::new(m),
            hash: hash ^ ((i as u64 + 1) << 56) ^ (i as u64 + 1),
            error: *error,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::look::Look3;
    use crate::scene::{evaluate, Labels};
    use serde_json::json;

    /// A 64-segment ball 10 m from the camera, with `lod` as given, under `budget`.
    fn scene(lod: Value, budget: Value) -> Scene {
        let look = Look3::read(&json!({"roles": {"block": "#808080", "ground": "#ffffff"}}))
            .expect("the look reads");
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "description": "D", "size": [320, 240],
            "camera": "cam", "budget": budget,
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0",
                    "params": {"projection": "perspective", "target": [0, 0, 0], "position": [0, 0, 10], "fov": 40}},
                "ball": {"id": "ball", "kind": "ball@1", "layer": "main", "name": "B", "order": "a1",
                    "params": {"radius": 1, "segments": 64, "paint": {"fill": {"role": "block"}}}, "lod": lod},
            }
        });
        evaluate(&doc, 0, &look, &mut Labels::new()).expect("the scene evaluates")
    }

    fn ball(scene: &Scene) -> &Solid {
        scene.layers[0]
            .solids
            .iter()
            .find(|s| s.id == "ball")
            .expect("the ball")
    }

    #[test]
    fn a_proxy_band_draws_the_simplified_mesh_at_its_ratio() {
        let mut s = scene(
            json!({"bands": [{"below_px": 1000, "show": "proxy", "params": {"ratio": 0.25}}]}),
            json!({"class": "work_product"}),
        );
        let full = ball(&s).mesh.as_ref().expect("a built mesh").triangles();
        let choices = select(&s);
        assert_eq!(choices[0].bands, vec![Show::Proxy]);
        resolve(&mut s, &choices);
        let drawn = ball(&s).mesh.as_ref().expect("the proxy").triangles();
        assert!(
            drawn > 0 && drawn as f64 <= 0.3 * full as f64,
            "{drawn} of {full} triangles"
        );
    }

    #[test]
    fn a_document_may_only_lower_lod_px() {
        let px = |lod_px: f64| {
            ball(&scene(
                json!({"bands": []}),
                json!({"class": "showpiece", "lod_px": lod_px}),
            ))
            .lod
            .as_ref()
            .expect("its lod")
            .lod_px
        };
        assert_eq!(px(0.5), 0.5);
        assert_eq!(px(4.0), LOD_PX);
    }

    #[test]
    fn the_shadow_passes_draw_the_level_the_light_projection_chose() {
        let mut s = scene(json!({"bands": []}), json!({"class": "work_product"}));
        // Give the ball a second, coarser level over its own vertices: every other triangle.
        let solid = &mut s.layers[0].solids[0];
        let mesh = solid.mesh.clone().expect("a built mesh");
        let mut leveled = (*mesh).clone();
        let half: Vec<u32> = mesh
            .indices
            .as_chunks::<3>()
            .0
            .iter()
            .step_by(2)
            .flatten()
            .copied()
            .collect();
        leveled.lods = vec![(half, 0.1)];
        leveled.lod_extent = 2.0;
        let hash = 7;
        solid.lod = Some(Arc::new(Lod {
            bands: Vec::new(),
            margin: 0.1,
            bounds: mesh.bounds(),
            levels: levels(&Arc::new(leveled), hash),
            extent: 2.0,
            lod_px: LOD_PX,
            proxy: None,
            proxy_mesh: None,
            tile: None,
        }));
        let mut choices = select(&s);
        // At 10 m the camera has about 33 px per m, so level 1's error (0.1 of 2 m) is 6.6 px and
        // it draws level 0; a shadow map of 2 texels per m sees 0.4 texels and draws level 1.
        assert_eq!(choices[0].level, Some(0));
        shadow_levels(&s, &mut choices, |_| Some(2.0));
        assert_eq!(choices[0].shadow_level, Some(1));
        // A light that wants a finer level than the camera's draws the camera's own.
        let mut close = select(&s);
        close[0].level = Some(1);
        shadow_levels(&s, &mut close, |_| Some(1000.0));
        assert_eq!(close[0].shadow_level, Some(1));
        resolve(&mut s, &choices);
        let drawn: Vec<&Solid> = s.layers[0]
            .solids
            .iter()
            .filter(|x| x.id == "ball")
            .collect();
        let caster = drawn
            .iter()
            .find(|x| x.cast_only)
            .expect("a cast-only level");
        let seen = drawn
            .iter()
            .find(|x| !x.cast_only)
            .expect("the camera's level");
        assert!(
            !seen.cast_shadow,
            "the camera's level casts no shadow of its own"
        );
        assert_eq!(
            caster.mesh.as_ref().map(|m| m.triangles()),
            Some(mesh.triangles() / 2)
        );
        assert!(
            (caster.inset - 0.2).abs() < 1e-12,
            "inset by its error, {}",
            caster.inset
        );
        assert_eq!(
            seen.mesh.as_ref().map(|m| m.triangles()),
            Some(mesh.triangles())
        );
    }
}
