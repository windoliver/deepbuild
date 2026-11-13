//! Emission on a mesh's surface (#449: `emit.shape: surface {of: item | collection}`). Particle
//! i's birth point is hash(seed, i) mapped to a triangle chosen by cumulative area, from a table
//! built at check (whole numbers, so the CPU and the GPU choose the same triangle among a million),
//! then to a uniform point on that triangle by the square-root map. The point rides on the named
//! items' evaluation at the particle's birth time (through the skin on a skinned item), its
//! velocity is its change over the step about the birth, and with `follow` the particle keeps its
//! triangle and its place on it and is placed on the surface as evaluated at t.

use deep_canvas_scene3d::label::Labels;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Scene};
use deep_canvas_scene3d::shore;
use serde_json::{json, Value};

use super::spec::Refusal;
use super::{len, sub, V3};
use crate::interp::{hash, hash1};

/// At most this many triangles a surface holds.
pub const MAX_TRIANGLES: usize = 1_048_576;
/// Flicks a second (Units and axes: time).
const FLICKS: f64 = 705_600_000.0;

/// A surface: the named items' triangles (vertex indices into a pose), the area table, and the
/// poses its particles read, each the vertices' world places at a time the bake evaluated.
#[derive(Clone, Debug, PartialEq)]
pub struct Surface {
    pub tris: Vec<[u32; 3]>,
    pub cdf: Vec<u32>,
    /// (time s, world vertices), by time.
    pub poses: Vec<(f64, Vec<V3>)>,
    /// Half the document's frame step, s.
    pub half_step: f64,
    /// The box every vertex reaches over the span, and the fastest a vertex moves, m/s.
    pub reach: [V3; 2],
    pub speed: f64,
    /// The box of the bind pose (the planted bounds), when asked.
    pub bind: Option<[V3; 2]>,
    /// The members in order: each item's ID and its first vertex's index.
    pub members: Vec<(String, u32)>,
}

fn area(t: &[V3; 3]) -> f64 {
    let (a, b) = (sub(t[1], t[0]), sub(t[2], t[0]));
    0.5 * len(cross(a, b))
}

fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// The cumulative area table: entry i is ⌊(area of triangles 0 to i) ÷ total × 2³²⌋, the last
/// 2³² − 1, so a triangle's share of the hash's range is its share of the area.
pub fn table(triangles: &[[V3; 3]]) -> Vec<u32> {
    let total: f64 = triangles.iter().map(area).sum();
    let mut run = 0.0;
    let mut out: Vec<u32> = triangles
        .iter()
        .map(|t| {
            run += area(t);
            let x = if total > 0.0 { run / total } else { 1.0 };
            (x * 4_294_967_296.0).floor().min(4_294_967_295.0) as u32
        })
        .collect();
    if let Some(last) = out.last_mut() {
        *last = u32::MAX;
    }
    out
}

/// The triangle a particle of key `h` is born on: the first whose cumulative entry passes its
/// hash (or, planted, one chosen uniformly, whatever its area).
pub fn pick(cdf: &[u32], h: u32, uniform: bool) -> usize {
    let x = hash1(hash(&[h, 13]));
    if uniform {
        return x as usize % cdf.len().max(1);
    }
    cdf.partition_point(|c| *c < x)
        .min(cdf.len().saturating_sub(1))
}

/// A uniform point's weights on a triangle from two uniform draws (the square-root map).
pub fn weights(r5: f64, r6: f64) -> [f64; 3] {
    let s = deep_canvas::ops::sqrt(r5);
    [1.0 - s, s * (1.0 - r6), s * r6]
}

impl Surface {
    /// Triangle `tri`'s corners in `pose`.
    fn corners(&self, tri: usize, pose: &[V3]) -> [V3; 3] {
        self.tris[tri].map(|i| pose[i as usize])
    }

    /// The point of `w` on triangle `tri` of the vertices `pose`.
    pub fn point_in(&self, tri: usize, w: [f64; 3], pose: &[V3]) -> V3 {
        let c = self.corners(tri, pose);
        [0, 1, 2].map(|k| w[0] * c[0][k] + w[1] * c[1][k] + w[2] * c[2][k])
    }

    /// The point of `w` on triangle `tri` at time `tau`: exact at a pose's time, linear between
    /// the poses about it, held past the first and the last.
    pub fn point_at(&self, tri: usize, w: [f64; 3], tau: f64) -> V3 {
        let i = self.poses.partition_point(|(t, _)| *t <= tau).max(1) - 1;
        let a = self.point_in(tri, w, &self.poses[i].1);
        let Some((t1, p1)) = self.poses.get(i + 1) else {
            return a;
        };
        let t0 = self.poses[i].0;
        let f = ((tau - t0) / (t1 - t0)).clamp(0.0, 1.0);
        if f == 0.0 {
            return a;
        }
        let b = self.point_in(tri, w, p1);
        [0, 1, 2].map(|k| a[k] + (b[k] - a[k]) * f)
    }

    /// Triangle `tri`'s unit normal at `tau` (counterclockwise front).
    pub fn normal_at(&self, tri: usize, tau: f64) -> V3 {
        let i = self.poses.partition_point(|(t, _)| *t <= tau).max(1) - 1;
        let c = self.corners(tri, &self.poses[i].1);
        let n = cross(sub(c[1], c[0]), sub(c[2], c[0]));
        let l = len(n);
        if l > 0.0 {
            n.map(|x| x / l)
        } else {
            [0.0, 1.0, 0.0]
        }
    }

    /// The vertices of the named items in `scene`, in the bake's order.
    pub fn now(&self, scene: &Scene) -> Vec<V3> {
        world(scene, self.members.iter().map(|(m, _)| m.as_str())).0
    }
}

/// The named items' world vertices and triangles in `scene`, members in order.
fn world<'a>(scene: &Scene, members: impl Iterator<Item = &'a str>) -> (Vec<V3>, Vec<[u32; 3]>) {
    let (mut verts, mut tris) = (Vec::new(), Vec::new());
    for m in members {
        for s in scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .filter(|s| s.id == m)
        {
            let base = verts.len() as u32;
            // A mesh keeps its own indices, so corners stay shared; a unit primitive is placed
            // triangle by triangle.
            match &s.mesh {
                Some(mesh) => {
                    let mm = &s.model;
                    verts.extend(mesh.positions.iter().map(|q| {
                        std::array::from_fn(|r| {
                            mm[r][0] * q[0] + mm[r][1] * q[1] + mm[r][2] * q[2] + mm[r][3]
                        })
                    }));
                    tris.extend(
                        mesh.indices
                            .as_chunks::<3>()
                            .0
                            .iter()
                            .map(|t| [base + t[0], base + t[1], base + t[2]]),
                    );
                }
                None => {
                    for (k, t) in shore::triangles(s).iter().enumerate() {
                        verts.extend(t.iter().copied());
                        let b = base + 3 * k as u32;
                        tris.push([b, b + 1, b + 2]);
                    }
                }
            }
        }
    }
    (verts, tris)
}

/// The members `of` names: a collection's, in order, or the item itself.
pub fn members(doc: &Value, of: &str) -> Vec<String> {
    match doc["collections"][of]["members"].as_array() {
        Some(m) => m
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        None => vec![of.to_string()],
    }
}

/// The refusal of a surface past the cap: the count read from the document where its items hold
/// their triangles, else from the evaluated scene; naming the mesh and the particles item.
pub fn over_cap(doc: &Value, id: &str, of: &str, scene: Option<&Scene>) -> Option<Refusal> {
    let mut total = 0usize;
    let mut largest: Option<(usize, String)> = None;
    for m in members(doc, of) {
        let item = &doc["items"][&m];
        let n = match item["params"]["triangles"].as_array() {
            Some(t) if item["kind"] == "fixture.skin@1" => t.len(),
            _ => scene.map_or(0, |s| world(s, std::iter::once(m.as_str())).1.len()),
        };
        total += n;
        if largest.as_ref().is_none_or(|(l, _)| n > *l) {
            largest = Some((n, m));
        }
    }
    let (_, mesh) = largest?;
    (total > MAX_TRIANGLES).then(|| {
        Refusal::new(
            "out_of_range",
            format!("items/{id}/params/emit/shape/surface/of"),
            format!(
                "{id}: its surface {of} holds {total} triangles, past the cap of {MAX_TRIANGLES}"
            ),
        )
        .with(json!({"triangles": total, "cap": MAX_TRIANGLES}))
        .naming(&mesh)
    })
}

/// The document as its bind pose: every bone of the members at rest and nothing keying them.
fn bind_pose(doc: &Value, members: &[String]) -> Value {
    let mut d = doc.clone();
    let touches = |target: &str| {
        members
            .iter()
            .any(|m| target.starts_with(&format!("items/{m}/params/bones")))
    };
    for key in ["channels", "drivers"] {
        if let Some(map) = d.get_mut(key).and_then(Value::as_object_mut) {
            map.retain(|_, c| !touches(c["target"].as_str().unwrap_or("")));
        }
    }
    for m in members {
        if let Some(bones) = d
            .pointer_mut(&format!("/items/{m}/params/bones"))
            .and_then(Value::as_array_mut)
        {
            for b in bones {
                b["rot"] = json!([0.0, 0.0, 0.0]);
            }
        }
    }
    d
}

/// What a surface bake reads: the times its particles are born and inherit at, and whether its
/// members move.
pub struct Times {
    pub at: Vec<f64>,
    pub span: f64,
    pub step: f64,
}

/// The surface `of` names, baked: its poses at every time `times` asks (and over the span when
/// a member moves), its area table from its first pose, its reach over the span.
pub fn bake(
    doc: &Value,
    id: &str,
    of: &str,
    times: &Times,
    bind: bool,
    bind_box: bool,
) -> Result<Surface, Refusal> {
    let members = members(doc, of);
    let moving = doc
        .as_object()
        .and_then(|d| shore::moving_member(d, members.iter().map(String::as_str)))
        .is_some();
    let posed = if bind {
        bind_pose(doc, &members)
    } else {
        doc.clone()
    };
    let look = Look3::read(&super::neutral_look(doc))
        .map_err(|e| Refusal::new("bad_doc", format!("items/{id}"), e))?;
    let mut labels = Labels::new();
    let mut at = |t: f64, d: &Value| -> Result<(Vec<V3>, Vec<[u32; 3]>), Refusal> {
        let scene = evaluate(d, (t * FLICKS).round() as i64, &look, &mut labels).map_err(|r| {
            Refusal::new(
                r.code,
                r.path,
                format!("{id}: its surface {of} doesn't evaluate"),
            )
        })?;
        Ok(world(&scene, members.iter().map(String::as_str)))
    };
    let mut wanted: Vec<f64> = times.at.iter().map(|t| t.max(0.0)).collect();
    wanted.push(0.0);
    if moving {
        let n = (times.span / times.step).ceil().min(1e5) as usize;
        wanted.extend((0..=n).map(|k| k as f64 * times.step));
    }
    wanted.sort_by(f64::total_cmp);
    wanted.dedup();
    if !moving {
        wanted.truncate(1);
    }
    let mut poses = Vec::with_capacity(wanted.len());
    let mut tris = Vec::new();
    for t in &wanted {
        let (verts, tr) = at(*t, &posed)?;
        if tris.is_empty() {
            tris = tr;
        }
        poses.push((*t, verts));
    }
    if tris.is_empty() {
        return Err(Refusal::new(
            "ref_unresolved",
            format!("items/{id}/params/emit/shape/surface/of"),
            format!("{id}: {of} holds no mesh to emit on"),
        ));
    }
    let first = &poses[0].1;
    let placed: Vec<[V3; 3]> = tris.iter().map(|t| t.map(|i| first[i as usize])).collect();
    let cdf = table(&placed);
    // The reach over the span, padded by the farthest a vertex moves between two poses.
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    let mut speed: f64 = 0.0;
    for (k, (t, p)) in poses.iter().enumerate() {
        for v in p {
            for i in 0..3 {
                lo[i] = lo[i].min(v[i]);
                hi[i] = hi[i].max(v[i]);
            }
        }
        if let Some((t0, p0)) = k.checked_sub(1).map(|j| &poses[j]) {
            let dt = t - t0;
            if dt > 0.0 {
                for (a, b) in p0.iter().zip(p) {
                    speed = speed.max(len(sub(*b, *a)) / dt);
                }
            }
        }
    }
    let pad = speed * times.step;
    let reach = [lo.map(|x| x - pad), hi.map(|x| x + pad)];
    let bind = if bind_box {
        let (v, _) = at(0.0, &bind_pose(doc, &members))?;
        let mut b = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for p in &v {
            for i in 0..3 {
                b[0][i] = b[0][i].min(p[i]);
                b[1][i] = b[1][i].max(p[i]);
            }
        }
        Some(b)
    } else {
        None
    };
    let mut starts = Vec::new();
    let mut base = 0u32;
    let scene0 = evaluate(&posed, 0, &look, &mut labels).ok();
    for m in &members {
        starts.push((m.clone(), base));
        base += scene0
            .as_ref()
            .map_or(0, |s| world(s, std::iter::once(m.as_str())).0.len() as u32);
    }
    Ok(Surface {
        tris,
        cdf,
        poses,
        half_step: 0.5 * times.step,
        reach,
        speed,
        bind,
        members: starts,
    })
}
