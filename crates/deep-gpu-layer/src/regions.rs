//! Look regions in a 3D view (#462; tests/acceptance/462/README.md, The surface under test;
//! canvas primitives: Look `look@1`: regions and edges). One look per shot, the document's by
//! default; a shot's regions give what each one's mask (a box, cylinder or sphere item, at its
//! evaluated pose) holds another look. Each look renders the whole frame, then one composite mixes
//! them per pixel by coverage that sums to one: a region's coverage passes from the outer look to
//! its own along the mask's boundary as seen, shaped by the edge (straight, torn, pixel or brush,
//! the incoming look's own by default) and seeded from the region, never from playback. Inside a
//! transition window both sides draw, each with its own looks, mixed by the transition's progress.
//! Status draws in every render from the document's status map after tone mapping, so it is the
//! same in each, and the mix leaves it exact. Outside a transition window at most two looks draw
//! in one frame: the check refuses a shot where a third would, naming the shot and the time.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas_motion::program::Program;
use deep_canvas_motion::shots::{Edge, Region, Transition};
use deep_canvas_scene3d::look::{Basis, Look3};
use deep_canvas_scene3d::scene::{Camera, Shape};
use serde_json::{json, Value};

use crate::refused;

const FLICKS_PER_SECOND: i64 = 705_600_000;

/// A look the call names for shots and regions, as `view3d` reads its own `look`.
#[derive(Clone)]
pub struct Named {
    pub look: Look3,
    pub json: Value,
}

/// The call's `looks`, by name.
pub fn looks_of(call: &Value, theme: &str) -> Result<BTreeMap<String, Named>, Value> {
    let mut out = BTreeMap::new();
    let Some(all) = call.get("looks").filter(|l| !l.is_null()) else {
        return Ok(out);
    };
    let Some(all) = all.as_object() else {
        return Err(refused("bad_input", "looks maps names to look@1s"));
    };
    for (name, def) in all {
        let json = crate::status::themed(def, theme);
        let look =
            Look3::read(&json).map_err(|e| refused("bad_input", format!("looks/{name}: {e}")))?;
        out.insert(name.clone(), Named { look, json });
    }
    Ok(out)
}

/// A shot's looks: its own (`None`, the document's) and its regions.
struct ShotLooks {
    id: String,
    start: i64,
    end: i64,
    look: Option<String>,
    regions: Vec<Region>,
}

/// The document's shots and transition windows, as the motion program compiles them.
pub struct Timeline {
    shots: Vec<ShotLooks>,
    windows: Vec<Transition>,
    /// Each region's edge where it names none: the incoming look's own.
    edges: BTreeMap<String, Edge>,
    /// The document's frame rate, the frames the check reads.
    rate: (u32, u32),
}

/// One side of a frame: a shot's looks and its share of the frame.
pub struct Side<'a> {
    pub weight: f64,
    /// Its shot's ID; empty outside every shot.
    pub shot: &'a str,
    pub look: Option<&'a str>,
    pub regions: &'a [Region],
}

/// A mask's volume: its shape and world matrix (its size applied).
pub type Volume = (Shape, [[f64; 4]; 3]);

/// A look's own edge: a pixel look's steps, a drawing's torn paper, a stroke look's brush, and a
/// physical look's straight line.
fn own_edge(look: &Look3, json: &Value) -> Edge {
    match look.basis {
        Basis::Indexed => Edge::Pixel,
        _ if json.get("strokes").is_some_and(|s| !s.is_null()) => Edge::Brush,
        Basis::Drawing => Edge::Torn,
        Basis::Physical => Edge::Straight,
    }
}

impl Timeline {
    /// The document's timeline, or `None` when no shot names a look or a region. A look no
    /// entry of `looks` holds is refused, naming where.
    pub fn of(doc: &Value, looks: &BTreeMap<String, Named>) -> Result<Option<Timeline>, Value> {
        let names = |s: &Value| s.get("look").is_some() || s.get("regions").is_some();
        if !doc["shots"]
            .as_object()
            .is_some_and(|shots| shots.values().any(names))
        {
            return Ok(None);
        }
        let map = doc.as_object().expect("an object: it has shots");
        let program = Program::compile(map).map_err(|r| refused(r.code, r.path))?;
        let Some(plan) = program.shots.as_ref() else {
            return Ok(None);
        };
        let mut edges = BTreeMap::new();
        let mut shots = Vec::new();
        for s in &plan.shots {
            let known = |name: &str, path: String| -> Result<(), Value> {
                match looks.contains_key(name) {
                    true => Ok(()),
                    false => Err(refused("look_unknown", format!("{path}: {name}"))),
                }
            };
            if let Some(l) = &s.look {
                known(l, format!("shots/{}/look", s.id))?;
            }
            for (k, r) in s.regions.iter().enumerate() {
                known(&r.look, format!("shots/{}/regions/{k}/look", s.id))?;
                let n = &looks[&r.look];
                edges.insert(r.look.clone(), own_edge(&n.look, &n.json));
            }
            shots.push(ShotLooks {
                id: s.id.clone(),
                start: s.start,
                end: s.end,
                look: s.look.clone(),
                regions: s.regions.clone(),
            });
        }
        Ok(Some(Timeline {
            shots,
            windows: plan
                .transitions
                .iter()
                .filter(|w| w.end > w.start)
                .cloned()
                .collect(),
            edges,
            rate: program.motion.frame_rate,
        }))
    }

    fn shot(&self, i: usize) -> Side<'_> {
        let s = &self.shots[i];
        Side {
            weight: 1.0,
            shot: &s.id,
            look: s.look.as_deref(),
            regions: &s.regions,
        }
    }

    /// What the frame at `t` draws: inside a transition window both its shots, by the
    /// transition's progress; else the shot whose span holds `t`; else the document's look.
    pub fn sides(&self, t: i64) -> Vec<Side<'_>> {
        if let Some(w) = self.windows.iter().find(|w| w.start <= t && t < w.end) {
            let p = w.progress(t).clamp(0.0, 1.0);
            let (mut a, mut b) = (self.shot(w.from), self.shot(w.to));
            a.weight = 1.0 - p;
            b.weight = p;
            return vec![a, b];
        }
        match self.shots.iter().rposition(|s| s.start <= t && t < s.end) {
            Some(i) => vec![self.shot(i)],
            None => vec![Side {
                weight: 1.0,
                shot: "",
                look: None,
                regions: &[],
            }],
        }
    }

    /// The edge a region draws.
    pub fn edge(&self, r: &Region) -> Edge {
        r.edge
            .or_else(|| self.edges.get(&r.look).copied())
            .unwrap_or(Edge::Straight)
    }

    /// The check: at each frame of each shot outside every transition window, at the document's
    /// frame rate, the looks that draw (the shot's and each region's whose mask is in view) are
    /// at most two; a third is refused, naming the shot and the time. `at` evaluates the camera
    /// and the volumes at a time.
    pub fn check(
        &self,
        mut at: impl FnMut(i64) -> Result<(Camera, BTreeMap<String, Volume>), Value>,
    ) -> Result<(), Value> {
        let rate = self.rate;
        for s in &self.shots {
            if s.regions.is_empty() {
                continue;
            }
            let mut k: i64 = 0;
            loop {
                let t = s.start
                    + (i128::from(k) * i128::from(FLICKS_PER_SECOND) * i128::from(rate.1)
                        / i128::from(rate.0.max(1))) as i64;
                if t >= s.end {
                    break;
                }
                k += 1;
                if self.windows.iter().any(|w| w.start <= t && t < w.end) {
                    continue;
                }
                let (camera, volumes) = at(t)?;
                let mut drawing: BTreeSet<Option<&str>> = BTreeSet::from([s.look.as_deref()]);
                for r in &s.regions {
                    let v = volume(&volumes, &r.mask, &s.id)?;
                    if in_view(&camera, &v) {
                        drawing.insert(Some(r.look.as_str()));
                    }
                }
                if drawing.len() > 2 {
                    let names: Vec<String> = drawing
                        .iter()
                        .map(|l| l.map_or_else(|| "document".to_string(), str::to_string))
                        .collect();
                    return Err(json!({
                        "code": "too_many_looks",
                        "issues": [{
                            "code": "look.three_in_frame",
                            "path": format!("shots/{}/regions", s.id),
                            "shot": s.id,
                            "t": t,
                            "looks": names,
                            "why": "at most two looks draw in one frame outside a transition window",
                        }],
                    }));
                }
            }
        }
        Ok(())
    }
}

/// A region's mask volume, refused when it names no box, cylinder or sphere.
pub fn volume(volumes: &BTreeMap<String, Volume>, mask: &str, shot: &str) -> Result<Volume, Value> {
    volumes.get(mask).copied().ok_or_else(|| {
        refused(
            "mask_unresolved",
            format!("shots/{shot}/regions: {mask} is no box, cylinder or sphere item"),
        )
    })
}

fn inverse(m: &[[f64; 4]; 3]) -> Option<[[f64; 4]; 3]> {
    let a = |r: usize, c: usize| m[r][c];
    let det = a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1))
        - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0))
        + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
    if det.abs() < 1e-18 {
        return None;
    }
    let inv = |r: usize, c: usize| {
        let (r1, r2) = ((c + 1) % 3, (c + 2) % 3);
        let (c1, c2) = ((r + 1) % 3, (r + 2) % 3);
        (a(r1, c1) * a(r2, c2) - a(r1, c2) * a(r2, c1)) / det
    };
    let mut out = [[0.0; 4]; 3];
    for (r, row) in out.iter_mut().enumerate() {
        for (c, x) in row.iter_mut().take(3).enumerate() {
            *x = inv(r, c);
        }
        row[3] = -(0..3).map(|c| row[c] * m[c][3]).sum::<f64>();
    }
    Some(out)
}

fn apply(m: &[[f64; 4]; 3], p: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}

fn axis_len(m: &[[f64; 4]; 3], c: usize) -> f64 {
    (m[0][c] * m[0][c] + m[1][c] * m[1][c] + m[2][c] * m[2][c]).sqrt()
}

/// The signed distance from `p` to the volume's surface, world m, negative inside.
fn signed_distance(v: &Volume, inv: &[[f64; 4]; 3], p: [f64; 3]) -> f64 {
    let (shape, m) = v;
    let q = apply(inv, p);
    let l = [axis_len(m, 0), axis_len(m, 1), axis_len(m, 2)];
    let boxed = |d: &[f64]| {
        let inside = d.iter().copied().fold(f64::MIN, f64::max);
        if inside <= 0.0 {
            inside
        } else {
            d.iter().map(|x| x.max(0.0).powi(2)).sum::<f64>().sqrt()
        }
    };
    match shape {
        Shape::Sphere => {
            (q[0] * q[0] + q[1] * q[1] + q[2] * q[2]).sqrt() * (l[0] + l[1] + l[2]) / 3.0
                - 0.5 * (l[0] + l[1] + l[2]) / 3.0
        }
        Shape::Cylinder => {
            let r = (q[0] * q[0] + q[2] * q[2]).sqrt();
            boxed(&[(r - 0.5) * (l[0] + l[2]) / 2.0, (q[1].abs() - 0.5) * l[1]])
        }
        _ => boxed(&[
            (q[0].abs() - 0.5) * l[0],
            (q[1].abs() - 0.5) * l[1],
            (q[2].abs() - 0.5) * l[2],
        ]),
    }
}

/// Whether any of the volume is in the camera's frame.
pub fn in_view(camera: &Camera, v: &Volume) -> bool {
    let Some(inv) = inverse(&v.1) else {
        return false;
    };
    if signed_distance(v, &inv, camera.eye) <= 0.0 {
        return true;
    }
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    let mut any = false;
    for c in 0..8 {
        let corner = [
            if c & 1 == 0 { -0.5 } else { 0.5 },
            if c & 2 == 0 { -0.5 } else { 0.5 },
            if c & 4 == 0 { -0.5 } else { 0.5 },
        ];
        let Some(p) = camera.project(apply(&v.1, corner)) else {
            continue;
        };
        if p[2] <= camera.near {
            continue;
        }
        any = true;
        for a in 0..2 {
            lo[a] = lo[a].min(p[a]);
            hi[a] = hi[a].max(p[a]);
        }
    }
    any && hi[0] >= 0.0 && lo[0] <= camera.size[0] && hi[1] >= 0.0 && lo[1] <= camera.size[1]
}

/// A fixed hash of `(seed, x, y, z)` → [0, 1).
fn hash(seed: u64, x: i64, y: i64, z: i64) -> f64 {
    let mut h = seed ^ 0x9e37_79b9_7f4a_7c15;
    for v in [x, y, z] {
        h ^= (v as u64).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        h = (h ^ (h >> 31)).wrapping_mul(0x94d0_49bb_1331_11eb);
    }
    (h >> 11) as f64 / (1u64 << 53) as f64
}

/// Value noise in [−1, 1], smooth between lattice points.
fn noise(seed: u64, p: [f64; 3]) -> f64 {
    let i = p.map(|x| x.floor());
    let f = std::array::from_fn::<f64, 3, _>(|a| {
        let u = p[a] - i[a];
        u * u * (3.0 - 2.0 * u)
    });
    let c = i.map(|x| x as i64);
    let mut out = 0.0;
    for k in 0..8 {
        let o = [k & 1, (k >> 1) & 1, (k >> 2) & 1];
        let w: f64 = (0..3)
            .map(|a| if o[a] == 1 { f[a] } else { 1.0 - f[a] })
            .product();
        out += w * hash(
            seed,
            c[0] + o[0] as i64,
            c[1] + o[1] as i64,
            c[2] + o[2] as i64,
        );
    }
    out * 2.0 - 1.0
}

fn fbm(seed: u64, p: [f64; 3]) -> f64 {
    (0..3)
        .map(|o| {
            let k = f64::from(1u32 << o);
            noise(seed.wrapping_add(o), p.map(|x| x * k)) / k
        })
        .sum::<f64>()
        / 1.75
}

/// What one region covers of a pixel, 0 to 1: `sd` its signed distance in px (negative inside),
/// `p` the world point the pixel sees, `k` px per m there, `block_sd` the distance at the centre
/// of the pixel's block (the pixel edge's steps).
fn covered(edge: Edge, r: &Region, sd: f64, p: [f64; 3], k: f64, block_sd: f64) -> f64 {
    let w = r.width.max(1.0);
    // The edge's noise lives on the world point, scaled so a feature is about the edge's width.
    let at = p.map(|x| x * k / (1.5 * w));
    let ramp = |x: f64, soft: f64| (0.5 - x / soft).clamp(0.0, 1.0);
    match edge {
        Edge::Straight => ramp(sd, 1.0),
        Edge::Torn => {
            let tear =
                0.5 * w * fbm(r.seed, at) + 0.12 * w * noise(r.seed ^ 0xf1b, at.map(|x| x * 7.0));
            ramp(sd + tear, 1.5)
        }
        Edge::Brush => {
            let streak = noise(r.seed ^ 0xb7, [at[0] * 0.5, at[1] * 4.0, at[2] * 0.5]);
            ramp(
                sd + 0.4 * w * fbm(r.seed, at) + 0.2 * w * streak,
                (0.25 * w).max(1.0),
            )
        }
        Edge::Pixel => {
            if block_sd < 0.0 {
                1.0
            } else {
                0.0
            }
        }
    }
}

/// A look's key in a frame: `None` is the document's own.
pub type Key = Option<String>;

/// Each pixel's share of each look, by key, for the frame's sides: `depth` the view-axis depth
/// per pixel (infinite where nothing draws), `volumes` the masks at t. A planted wrong program
/// clips the outer look by its own copy of the edge, moved half the edge's width outward.
pub struct Coverage {
    pub keys: Vec<Key>,
    /// Per pixel, a weight per key in `keys`' order.
    pub weights: Vec<f32>,
}

/// The looks a frame's sides draw: each side's own and each region's whose mask is in view.
pub fn keys_in_view(
    sides: &[Side<'_>],
    camera: &Camera,
    volumes: &BTreeMap<String, Volume>,
) -> Result<Vec<Key>, Value> {
    let mut keys: Vec<Key> = Vec::new();
    for side in sides {
        let base = side.look.map(str::to_string);
        if !keys.contains(&base) {
            keys.push(base);
        }
        for r in side.regions {
            let k = Some(r.look.clone());
            if !keys.contains(&k) && in_view(camera, &volume(volumes, &r.mask, side.shot)?) {
                keys.push(k);
            }
        }
    }
    Ok(keys)
}

pub fn coverage(
    timeline: &Timeline,
    sides: &[Side<'_>],
    camera: &Camera,
    depth: Option<&[u8]>,
    volumes: &BTreeMap<String, Volume>,
    size: [u32; 2],
    independent: bool,
) -> Result<Coverage, Value> {
    let mut keys: Vec<Key> = Vec::new();
    let key_of = |keys: &mut Vec<Key>, k: Key| -> usize {
        match keys.iter().position(|x| *x == k) {
            Some(i) => i,
            None => {
                keys.push(k);
                keys.len() - 1
            }
        }
    };
    // Each side's base and its regions in view, with their keys.
    struct Part<'a> {
        base: usize,
        regions: Vec<(usize, &'a Region, Volume, [[f64; 4]; 3], Edge)>,
        weight: f64,
    }
    let mut parts = Vec::new();
    for side in sides {
        let base = key_of(&mut keys, side.look.map(str::to_string));
        let mut regions = Vec::new();
        for r in side.regions {
            let v = volume(volumes, &r.mask, side.shot)?;
            if !in_view(camera, &v) {
                continue;
            }
            let Some(inv) = inverse(&v.1) else { continue };
            regions.push((
                key_of(&mut keys, Some(r.look.clone())),
                r,
                v,
                inv,
                timeline.edge(r),
            ));
        }
        parts.push(Part {
            base,
            regions,
            weight: side.weight,
        });
    }
    let n = keys.len();
    let [w, h] = size.map(|x| x as usize);
    let mut weights = vec![0f32; w * h * n];
    let depth_at = |i: usize| -> f64 {
        depth
            .and_then(|d| d.get(4 * i..4 * i + 4))
            .map_or(f64::INFINITY, |b| {
                f64::from(f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            })
    };
    let mut share = vec![0f64; n];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            share.iter_mut().for_each(|s| *s = 0.0);
            let vz = depth_at(i);
            for part in &parts {
                let mut c = vec![0f64; n];
                c[part.base] = 1.0;
                for (key, r, v, inv, edge) in &part.regions {
                    // The world point the pixel sees, or on open ground the point at the mask's
                    // own depth.
                    let z = if vz.is_finite() && vz > 0.0 {
                        vz
                    } else {
                        let centre = [v.1[0][3], v.1[1][3], v.1[2][3]];
                        camera.to_view(centre)[2]
                    };
                    if z <= 0.0 {
                        continue;
                    }
                    let k = camera.px_per_m(z);
                    let sd_at =
                        |sx: f64, sy: f64| signed_distance(v, inv, camera.unproject(sx, sy, z)) * k;
                    let p = camera.unproject(x as f64 + 0.5, y as f64 + 0.5, z);
                    let sd = signed_distance(v, inv, p) * k;
                    let block = (r.width / 4.0).round().max(2.0);
                    let block_sd = match edge {
                        Edge::Pixel => sd_at(
                            ((x as f64) / block).floor() * block + block / 2.0,
                            ((y as f64) / block).floor() * block + block / 2.0,
                        ),
                        _ => sd,
                    };
                    let m = covered(*edge, r, sd, p, k, block_sd);
                    if independent {
                        // The planted twin: the outer look keeps only what its own copy of the
                        // edge, moved half the width outward, leaves outside.
                        let outer = 1.0
                            - covered(*edge, r, sd - r.width / 2.0, p, k, block_sd - r.width / 2.0);
                        c.iter_mut().for_each(|s| *s *= outer);
                    } else {
                        c.iter_mut().for_each(|s| *s *= 1.0 - m);
                    }
                    c[*key] += m;
                }
                for (s, ci) in share.iter_mut().zip(&c) {
                    *s += part.weight * ci;
                }
            }
            for (j, s) in share.iter().enumerate() {
                weights[i * n + j] = *s as f32;
            }
        }
    }
    Ok(Coverage { keys, weights })
}

/// The frame mixed from each look's render (BGRA, the same size) by its coverage.
pub fn composite(cov: &Coverage, renders: &[&[u8]], out: &mut [u8]) {
    let n = cov.keys.len();
    for (i, px) in out.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        let w = &cov.weights[i * n..i * n + n];
        for (ch, v) in px.iter_mut().enumerate() {
            let mixed: f64 = (0..n)
                .map(|j| f64::from(w[j]) * f64::from(renders[j][4 * i + ch]))
                .sum();
            *v = mixed.round().clamp(0.0, 255.0) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_box_volume_measures_its_distance_in_metres() {
        let m = [
            [4.0, 0.0, 0.0, 2.0],
            [0.0, 3.0, 0.0, 0.5],
            [0.0, 0.0, 3.0, 0.0],
        ];
        let v = (Shape::Box, m);
        let inv = inverse(&m).unwrap();
        assert!((signed_distance(&v, &inv, [-1.0, 0.5, 0.0]) - 1.0).abs() < 1e-12);
        assert!((signed_distance(&v, &inv, [0.5, 0.5, 0.0]) + 0.5).abs() < 1e-12);
    }

    #[test]
    fn every_edge_covers_inside_and_leaves_outside() {
        let r = Region {
            mask: "m".into(),
            look: "b".into(),
            edge: None,
            width: 16.0,
            seed: 3,
        };
        for e in [Edge::Straight, Edge::Torn, Edge::Pixel, Edge::Brush] {
            assert_eq!(covered(e, &r, -40.0, [0.1, 0.2, 0.3], 100.0, -40.0), 1.0);
            assert_eq!(covered(e, &r, 40.0, [0.1, 0.2, 0.3], 100.0, 40.0), 0.0);
        }
    }
}
