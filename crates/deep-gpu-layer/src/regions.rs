//! Look regions (#462; tests/acceptance/462/README.md, The surface under test; canvas primitives:
//! Look `look@1`: regions and edges). One look per shot, the document's by default; a shot's
//! regions give what each one's mask (in 3D a box, cylinder or sphere item at its evaluated pose,
//! in 2D a rect or circle item's shape in page u) holds another look. Each look renders the whole
//! frame, then one composite pass on the device ([`Composite`], `regions.wgsl`) mixes them per
//! pixel by coverage that sums to one: a region's coverage passes from the outer look to its own
//! along the mask's boundary as seen, shaped by the edge (straight, torn, pixel or brush, the
//! incoming look's own by default) and seeded from the region, never from playback. Inside a
//! transition window both sides draw, each with its own looks, mixed by the transition's
//! progress. Status draws in every render from the document's status map after tone mapping, so
//! it is the same in each, and the mix leaves it exact. Outside a transition window at most two
//! looks draw in one frame: the check refuses a shot where a third would, naming the shot and the
//! time. `view3d` mixes its read-back renders, the live and canonical views their renders on the
//! device, and `film2d` its looks' 2D frames.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas_motion::program::Program;
use deep_canvas_motion::shots::{Edge, Region, Transition};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{Camera, Shape};
use deep_gpu::counted::{Queue, Wgpu};
use serde_json::{json, Map, Value};

use crate::refused;

const FLICKS_PER_SECOND: i64 = 705_600_000;

/// A look the call names for shots and regions, as `view3d` reads its own `look`.
#[derive(Clone)]
pub struct Named {
    pub look: Look3,
    pub json: Value,
}

/// The call's `looks`, by name, each in `theme` where the call resolves its own look in one.
pub fn looks_of(call: &Value, theme: Option<&str>) -> Result<BTreeMap<String, Named>, Value> {
    let mut out = BTreeMap::new();
    let Some(all) = call.get("looks").filter(|l| !l.is_null()) else {
        return Ok(out);
    };
    let Some(all) = all.as_object() else {
        return Err(refused("bad_input", "looks maps names to look@1s"));
    };
    for (name, def) in all {
        let json = theme.map_or_else(|| def.clone(), |t| crate::status::themed(def, t));
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

/// A look's own edge, from its definition: a pixel look's steps, a stroke look's brush, a
/// physical look's straight line, and a drawing's torn paper.
fn own_edge(def: &Value) -> Edge {
    match def.get("basis").and_then(Value::as_str) {
        Some("indexed") => Edge::Pixel,
        _ if def.get("strokes").is_some_and(|s| !s.is_null()) => Edge::Brush,
        Some("physical") => Edge::Straight,
        _ => Edge::Torn,
    }
}

impl Timeline {
    /// The document's timeline, or `None` when no shot names a look or a region. `def` gives a
    /// named look's definition; a look it doesn't know is refused, naming where.
    pub fn of<'a>(
        doc: &Value,
        def: impl Fn(&str) -> Option<&'a Value>,
    ) -> Result<Option<Timeline>, Value> {
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
            let known = |name: &str, path: String| -> Result<&Value, Value> {
                def(name).ok_or_else(|| refused("look_unknown", format!("{path}: {name}")))
            };
            if let Some(l) = &s.look {
                known(l, format!("shots/{}/look", s.id))?;
            }
            for (k, r) in s.regions.iter().enumerate() {
                let d = known(&r.look, format!("shots/{}/regions/{k}/look", s.id))?;
                edges.insert(r.look.clone(), own_edge(d));
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

    /// Whether a shot or a region names the look `name`.
    pub fn names(&self, name: &str) -> bool {
        self.shots
            .iter()
            .any(|s| s.look.as_deref() == Some(name) || s.regions.iter().any(|r| r.look == name))
    }

    /// The edge a region draws.
    pub fn edge(&self, r: &Region) -> Edge {
        r.edge
            .or_else(|| self.edges.get(&r.look).copied())
            .unwrap_or(Edge::Straight)
    }

    /// The check: at each frame of each shot outside every transition window, at the document's
    /// frame rate, the looks that draw (the shot's and each region's whose mask is in view) are
    /// at most two; a third is refused, naming the shot and the time. `at` evaluates how the
    /// frame sees and the volumes at a time.
    pub fn check(
        &self,
        mut at: impl FnMut(i64) -> Result<(Seen, BTreeMap<String, Volume>), Value>,
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
                let (seen, volumes) = at(t)?;
                let mut drawing: BTreeSet<Option<&str>> = BTreeSet::from([s.look.as_deref()]);
                for r in &s.regions {
                    let v = volume(&volumes, &r.mask, &s.id)?;
                    if in_view(&seen, &v) {
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

/// A region's mask volume, refused when it names no box, cylinder or sphere (in 2D, no rect or
/// circle).
pub fn volume(volumes: &BTreeMap<String, Volume>, mask: &str, shot: &str) -> Result<Volume, Value> {
    volumes.get(mask).copied().ok_or_else(|| {
        refused(
            "mask_unresolved",
            format!(
                "shots/{shot}/regions: {mask} is no box, cylinder, sphere, rect or circle item"
            ),
        )
    })
}

/// How a frame sees its masks: through a 3D camera, or as a 2D film's page, where
/// `u = px ÷ k + offset` (`drawn::View::to_world`) on a frame of `size` px.
#[derive(Clone)]
pub enum Seen {
    Camera(Camera),
    Page {
        k: f64,
        offset: [f64; 2],
        size: [u32; 2],
    },
}

impl Seen {
    fn size(&self) -> [f64; 2] {
        match self {
            Seen::Camera(c) => c.size,
            Seen::Page { size, .. } => size.map(f64::from),
        }
    }

    /// Where the frame draws `p`, px; `None` at or behind a 3D camera's near plane.
    fn project(&self, p: [f64; 3]) -> Option<[f64; 2]> {
        match self {
            Seen::Camera(c) => c.project(p).filter(|q| q[2] > c.near).map(|q| [q[0], q[1]]),
            Seen::Page { k, offset, .. } => Some([(p[0] - offset[0]) * k, (p[1] - offset[1]) * k]),
        }
    }
}

/// A 2D film's evaluated masks in page u, by item ID: each rect and circle as a volume, its shape
/// lying in z = 0 with a depth no page point reaches the end of.
pub fn volumes_2d(items: &Map<String, Value>) -> BTreeMap<String, Volume> {
    const DEEP: f64 = 1e6;
    let num = |v: Option<&Value>, i: usize, d: f64| {
        v.and_then(|v| v.get(i))
            .and_then(Value::as_f64)
            .unwrap_or(d)
    };
    let mut out = BTreeMap::new();
    for (id, item) in items {
        let at = item.get("at");
        let (pos, rot, scale) = (
            at.and_then(|a| a.get("pos")),
            at.and_then(|a| a.get("rot")),
            at.and_then(|a| a.get("scale")),
        );
        let p = item.get("params");
        let (shape, centre, half) = match item.get("kind").and_then(Value::as_str) {
            Some("rect@1") => {
                let b = p.and_then(|p| p.get("box"));
                let [x, y, w, h] = [0, 1, 2, 3].map(|i| num(b, i, 0.0));
                (Shape::Box, [x + w / 2.0, y + h / 2.0], [w, h])
            }
            Some("circle@1") => {
                let c = p.and_then(|p| p.get("center"));
                let r = p
                    .and_then(|p| p.get("r"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                (
                    Shape::Cylinder,
                    [num(c, 0, 0.0), num(c, 1, 0.0)],
                    [2.0 * r, 2.0 * r],
                )
            }
            _ => continue,
        };
        let (sx, sy) = (num(scale, 0, 1.0), num(scale, 1, 1.0));
        let a = num(rot, 2, 0.0).to_radians();
        let (c, sn) = (a.cos(), a.sin());
        let turn = |x: f64, y: f64| [x * c - y * sn, x * sn + y * c];
        let o = turn(centre[0] * sx, centre[1] * sy);
        let ex = turn(half[0] * sx, 0.0);
        let ey = turn(0.0, half[1] * sy);
        let t = [num(pos, 0, 0.0) + o[0], num(pos, 1, 0.0) + o[1]];
        // A circle is a cylinder whose axis (its local y) points out of the page.
        let m = match shape {
            Shape::Cylinder => [
                [ex[0], 0.0, ey[0], t[0]],
                [ex[1], 0.0, ey[1], t[1]],
                [0.0, DEEP, 0.0, 0.0],
            ],
            _ => [
                [ex[0], ey[0], 0.0, t[0]],
                [ex[1], ey[1], 0.0, t[1]],
                [0.0, 0.0, DEEP, 0.0],
            ],
        };
        out.insert(id.clone(), (shape, m));
    }
    out
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

/// Whether any of the volume is in the frame.
pub fn in_view(seen: &Seen, v: &Volume) -> bool {
    let Some(inv) = inverse(&v.1) else {
        return false;
    };
    if let Seen::Camera(c) = seen {
        if signed_distance(v, &inv, c.eye) <= 0.0 {
            return true;
        }
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
        let Some(p) = seen.project(apply(&v.1, corner)) else {
            continue;
        };
        any = true;
        for a in 0..2 {
            lo[a] = lo[a].min(p[a]);
            hi[a] = hi[a].max(p[a]);
        }
    }
    let size = seen.size();
    any && hi[0] >= 0.0 && lo[0] <= size[0] && hi[1] >= 0.0 && lo[1] <= size[1]
}

/// A look's key in a frame: `None` is the document's own.
pub type Key = Option<String>;

/// The looks a frame's sides draw: each side's own and each region's whose mask is in view.
pub fn keys_in_view(
    sides: &[Side<'_>],
    seen: &Seen,
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
            if !keys.contains(&k) && in_view(seen, &volume(volumes, &r.mask, side.shot)?) {
                keys.push(k);
            }
        }
    }
    Ok(keys)
}

/// The most looks one frame mixes: a transition window's two sides, each with a region in view.
const MOST_LOOKS: usize = 4;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct FrameU {
    eye: [f32; 4],
    right: [f32; 4],
    up: [f32; 4],
    forward: [f32; 4],
    view: [f32; 4],
    page: [f32; 4],
    size: [f32; 4],
    sides: [f32; 4],
    counts: [u32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct RegionU {
    inv: [[f32; 4]; 3],
    lens: [f32; 4],
    centre: [f32; 4],
    tag: [u32; 4],
    seed_hi: [u32; 4],
    params: [f32; 4],
}

/// A frame's mix as the composite pass reads it: the looks it mixes, by key, in the order their
/// renders bind (the first side's own first), and each side's and region's share of the pass.
pub struct Mix {
    pub keys: Vec<Key>,
    frame: FrameU,
    regions: Vec<RegionU>,
}

/// The frame at `t`'s mix: its sides and their regions in view as `seen` sees `volumes`. A
/// planted wrong program clips the outer look by its own copy of the edge, moved half the edge's
/// width outward.
pub fn mix(
    timeline: &Timeline,
    sides: &[Side<'_>],
    seen: &Seen,
    volumes: &BTreeMap<String, Volume>,
    t: i64,
    independent: bool,
) -> Result<Mix, Value> {
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
    let f = |x: f64| x as f32;
    let mut regions = Vec::new();
    let mut bases = [0.0f32; 4];
    for (s, side) in sides.iter().enumerate().take(2) {
        bases[2 * s] = key_of(&mut keys, side.look.map(str::to_string)) as f32;
        bases[2 * s + 1] = f(side.weight);
        for r in side.regions {
            let v = volume(volumes, &r.mask, side.shot)?;
            if !in_view(seen, &v) {
                continue;
            }
            let Some(inv) = inverse(&v.1) else { continue };
            let key = key_of(&mut keys, Some(r.look.clone()));
            let edge = match timeline.edge(r) {
                Edge::Straight => 0,
                Edge::Torn => 1,
                Edge::Pixel => 2,
                Edge::Brush => 3,
            };
            let shape = match v.0 {
                Shape::Cylinder => 1.0,
                Shape::Sphere => 2.0,
                _ => 0.0,
            };
            regions.push(RegionU {
                inv: inv.map(|row| row.map(f)),
                lens: [
                    f(axis_len(&v.1, 0)),
                    f(axis_len(&v.1, 1)),
                    f(axis_len(&v.1, 2)),
                    shape,
                ],
                centre: [f(v.1[0][3]), f(v.1[1][3]), f(v.1[2][3]), 0.0],
                tag: [edge, key as u32, s as u32, r.seed as u32],
                seed_hi: [(r.seed >> 32) as u32, 0, 0, 0],
                params: [f(r.width), 0.0, 0.0, 0.0],
            });
        }
    }
    if keys.len() > MOST_LOOKS {
        return Err(json!({
            "code": "too_many_looks",
            "issues": [{
                "code": "look.too_many_in_frame",
                "path": format!("shots/{}/regions", sides[0].shot),
                "shot": sides[0].shot,
                "t": t,
                "why": "a frame mixes at most four looks, two a side of a transition window",
            }],
        }));
    }
    let size = seen.size();
    let mut frame = FrameU {
        eye: [0.0; 4],
        right: [0.0; 4],
        up: [0.0; 4],
        forward: [0.0; 4],
        view: [0.0; 4],
        page: [0.0; 4],
        size: [f(size[0]), f(size[1]), 1.0, 1.0],
        sides: bases,
        counts: [
            0,
            regions.len() as u32,
            sides.len().min(2) as u32,
            u32::from(independent),
        ],
    };
    match seen {
        Seen::Camera(c) => {
            let v4 = |v: [f64; 3], w: f64| [f(v[0]), f(v[1]), f(v[2]), f(w)];
            frame.eye = v4(c.eye, if c.perspective { 1.0 } else { 0.0 });
            frame.right = v4(c.right, c.scale);
            frame.up = v4(c.up, c.near);
            frame.forward = v4(c.forward, c.far);
            frame.view = [f(c.centre[0]), f(c.centre[1]), f(c.roll[0]), f(c.roll[1])];
        }
        Seen::Page { k, offset, .. } => {
            frame.page = [f(1.0 / k), f(offset[0]), f(offset[1]), f(*k)];
            frame.counts[0] = 1;
        }
    }
    Ok(Mix {
        keys,
        frame,
        regions,
    })
}

/// What the composite reads a frame's view depths from.
pub enum Depth<'a> {
    /// A renderer's own depth target, reversed Z, and its size.
    Target(&'a wgpu::TextureView, [u32; 2]),
    /// View depths in m read back, `R32Float`, 0 where nothing drew, and their size.
    ViewZ(&'a wgpu::TextureView, [u32; 2]),
    /// A 2D frame's: none.
    None,
}

/// The composite pass on one device: its pipelines by how they read depth, made once each.
#[derive(Default)]
pub struct Composite {
    target: Option<(wgpu::BindGroupLayout, wgpu::RenderPipeline)>,
    view_z: Option<(wgpu::BindGroupLayout, wgpu::RenderPipeline)>,
    blank: Option<wgpu::TextureView>,
}

const SOURCE: &str = include_str!("regions.wgsl");
pub const PASS: &str = "look.regions";

fn pipeline(device: &Wgpu, raw: bool) -> (wgpu::BindGroupLayout, wgpu::RenderPipeline) {
    let fs = wgpu::ShaderStages::FRAGMENT;
    let texture = |binding, sample_type| wgpu::BindGroupLayoutEntry {
        binding,
        visibility: fs,
        ty: wgpu::BindingType::Texture {
            sample_type,
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    };
    let float = wgpu::TextureSampleType::Float { filterable: false };
    let buffer = |binding, ty| wgpu::BindGroupLayoutEntry {
        binding,
        visibility: fs,
        ty: wgpu::BindingType::Buffer {
            ty,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    };
    let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some(PASS),
        entries: &[
            buffer(0, wgpu::BufferBindingType::Uniform),
            buffer(1, wgpu::BufferBindingType::Storage { read_only: true }),
            texture(2, float),
            texture(3, float),
            texture(4, float),
            texture(5, float),
            texture(
                6,
                if raw {
                    wgpu::TextureSampleType::Depth
                } else {
                    float
                },
            ),
        ],
    });
    let depth = if raw {
        "texture_depth_2d;\nfn view_z(at: vec2<i32>) -> f32 { return from_depth(textureLoad(depth, at, 0)); }"
    } else {
        "texture_2d<f32>;\nfn view_z(at: vec2<i32>) -> f32 { return textureLoad(depth, at, 0).r; }"
    };
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(PASS),
        source: wgpu::ShaderSource::Wgsl(SOURCE.replace("DEPTH;", depth).into()),
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(PASS),
        bind_group_layouts: &[Some(&layout)],
        immediate_size: 0,
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(PASS),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: &module,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("fs"),
            compilation_options: Default::default(),
            targets: &[Some(deep_gpu::surface::FORMAT.into())],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    });
    (layout, pipeline)
}

impl Composite {
    /// Records the mix of `renders` (one per key of `mix`, in its order, each the target's size
    /// and format) into `target`, reading view depths from `depth`.
    #[allow(clippy::too_many_arguments)]
    pub fn record(
        &mut self,
        device: &Wgpu,
        encoder: &mut wgpu::CommandEncoder,
        mix: &Mix,
        renders: &[&wgpu::TextureView],
        depth: Depth<'_>,
        target: &wgpu::TextureView,
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        let mut frame = mix.frame;
        let (view, at) = match depth {
            Depth::Target(v, at) => (Some(v), at),
            Depth::ViewZ(v, at) => (Some(v), at),
            Depth::None => (None, [1, 1]),
        };
        if view.is_some() {
            frame.size[2] = at[0] as f32 / frame.size[0];
            frame.size[3] = at[1] as f32 / frame.size[1];
        }
        let raw = matches!(depth, Depth::Target(..));
        let slot = if raw {
            &mut self.target
        } else {
            &mut self.view_z
        };
        let (layout, pipeline) = slot.get_or_insert_with(|| pipeline(device, raw)).clone();
        let blank = self
            .blank
            .get_or_insert_with(|| {
                device
                    .create_texture(&wgpu::TextureDescriptor {
                        label: Some("look.regions no depth"),
                        size: wgpu::Extent3d {
                            width: 1,
                            height: 1,
                            depth_or_array_layers: 1,
                        },
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format: wgpu::TextureFormat::R32Float,
                        usage: wgpu::TextureUsages::TEXTURE_BINDING,
                        view_formats: &[],
                    })
                    .create_view(&Default::default())
            })
            .clone();
        let init = |label, contents: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents,
                usage,
            })
        };
        let uniform = init(
            "look.regions frame",
            bytemuck::bytes_of(&frame),
            wgpu::BufferUsages::UNIFORM,
        );
        let none = [<RegionU as bytemuck::Zeroable>::zeroed()];
        let regions = init(
            "look.regions regions",
            bytemuck::cast_slice(if mix.regions.is_empty() {
                &none
            } else {
                &mix.regions
            }),
            wgpu::BufferUsages::STORAGE,
        );
        let look = |j: usize| renders.get(j).unwrap_or(&renders[0]);
        let depth_view = view.unwrap_or(&blank);
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(PASS),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: regions.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(look(0)),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(look(1)),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::TextureView(look(2)),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: wgpu::BindingResource::TextureView(look(3)),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: wgpu::BindingResource::TextureView(depth_view),
                },
            ],
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(PASS),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            timestamp_writes: timestamps,
            ..Default::default()
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }
}

/// A texture of the slot's format a look renders into for the composite to read: `size`, drawn
/// into and sampled.
pub fn scratch(device: &Wgpu, size: [u32; 2], label: &'static str) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: deep_gpu::surface::FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}

/// `view3d`'s composite: its looks' read-back renders (BGRA rows, `size`, one per key of `mix`)
/// mixed on the device through the view depths `view_z` read back with the first, read back.
pub fn mix_read_back(
    device: &Wgpu,
    queue: &Queue,
    composite: &mut Composite,
    mix: &Mix,
    renders: &[&[u8]],
    view_z: Option<&[u8]>,
    size: [u32; 2],
) -> Result<Vec<u8>, String> {
    let extent = wgpu::Extent3d {
        width: size[0],
        height: size[1],
        depth_or_array_layers: 1,
    };
    let upload = |texture: &wgpu::Texture, bytes: &[u8]| {
        queue.write_texture(
            texture.as_image_copy(),
            bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * size[0]),
                rows_per_image: None,
            },
            extent,
        );
    };
    let textures: Vec<wgpu::Texture> = renders
        .iter()
        .map(|bytes| {
            let t = scratch(device, size, "look.regions render");
            upload(&t, bytes);
            t
        })
        .collect();
    let views: Vec<wgpu::TextureView> = textures
        .iter()
        .map(|t| t.create_view(&Default::default()))
        .collect();
    let depth = view_z.map(|z| {
        let t = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("look.regions view depth"),
            size: extent,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R32Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        // Nothing drew where the depth is infinite: 0, which the pass reads as open ground.
        let finite: Vec<u8> = z
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|b| {
                let v = f32::from_le_bytes(*b);
                (if v.is_finite() { v } else { 0.0 }).to_le_bytes()
            })
            .collect();
        upload(&t, &finite);
        t.create_view(&Default::default())
    });
    let out = scratch(device, size, "look.regions mix");
    let out_view = out.create_view(&Default::default());
    let mut encoder = device.create_command_encoder(&Default::default());
    let refs: Vec<&wgpu::TextureView> = views.iter().collect();
    composite.record(
        device,
        &mut encoder,
        mix,
        &refs,
        depth
            .as_ref()
            .map_or(Depth::None, |d| Depth::ViewZ(d, size)),
        &out_view,
        None,
    );
    let row = (size[0] * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("look.regions read back"),
        size: u64::from(row) * u64::from(size[1]),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    encoder.copy_texture_to_buffer(
        out.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: None,
            },
        },
        extent,
    );
    queue.submit([encoder.finish()]);
    crate::print2d::map_rows(
        device,
        &buffer,
        row as usize,
        (size[0] * 4) as usize,
        size[1] as usize,
    )
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
}
