//! The `tree` builder (issue #1636; canvas primitives: Builder): a trunk, branches and twigs grown
//! from a seed as tapered tubes along curves with rotation-minimizing frames, leaf cards at the
//! twigs, and a `wind` point attribute sway reads as its weight. A fork's children take the pipe
//! model, parentᵉ = Σ childᵉ for the declared exponent e. Every branch has the same rings and
//! every fork the same split, so the vertex count is a closed form of the params, known before
//! the build. Everything is f64 through the ops module and one seeded hash, in branch order on
//! one thread, so the same params build the same vertices on every machine.

use deep_canvas::ops::{cos, pow, rad, sin};
use serde_json::{json, Value};

use crate::builders::Fault;
use crate::curve::transport;
use crate::geom::{add, cross, dot, length, scale, sub, unit, Mesh, V3};
use crate::stack::mix;

/// The most vertices a tree may build (Builder: "at most 262,144 vertices per build").
pub const BOUND: u64 = 262_144;

/// Where a twig's leaf cards start along it: its last fifth.
const LEAF_FROM: f64 = 0.8;

/// The share of a branch's start radius left at its end.
const TAPER: f64 = 0.8;

/// Each level's length as a share of its parent's.
const FALLOFF: f64 = 0.62;

/// How far a branch's heading wanders from its course, at most, across a seeded direction: one
/// whole sine along its length, so it ends where its course does and bends both ways between.
const WANDER: f64 = 0.16;

/// A child's clearance from every branch it shares no fork with, and from its parent and
/// siblings away from their fork, m.
const CLEARANCE: f64 = 0.0005;

/// The fork's neighbourhood, in its parent's end radii, where siblings and parent may meet: the
/// design allows 1.5, and the builder keeps inside 1.4.
const NEAR: f64 = 1.4;

/// The planted wrong programs #1636's criteria name, reachable only through a plant switch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Plants {
    /// Each child takes its parent's end radius (AC2's twin).
    pub equal_radius: bool,
    /// Each ring's frame from the curve's curvature, which flips at an inflection (AC3's twin).
    pub curvature_frames: bool,
}

impl Plants {
    pub fn named(name: &str) -> Option<Plants> {
        let mut p = Plants::default();
        match name {
            "tree_child_keeps_parent_radius" => p.equal_radius = true,
            "tree_curvature_frames" => p.curvature_frames = true,
            _ => return None,
        }
        Some(p)
    }
}

/// Leaf cards: how many on each twig and their side, m.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Leaves {
    pub per_twig: u64,
    pub size: f64,
}

/// A tree's params, checked.
#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub seed: u64,
    pub levels: usize,
    /// Each level's length, m: the trunk's `length` first, each next `FALLOFF` of the last.
    pub lengths: Vec<f64>,
    pub radius: f64,
    pub exponent: f64,
    pub split: usize,
    /// A child's angle from its parent's end tangent, and the turn about the parent between one
    /// fork's children and the next's, deg.
    pub angle: f64,
    pub roll: f64,
    pub gravity: f64,
    pub leaves: Leaves,
    /// Vertices round each ring, and rings along each branch.
    pub segments: usize,
    pub rings: usize,
}

fn bad(name: &str) -> Fault {
    format!("params/{name}")
}

fn num(p: &Value, name: &str, default: f64, lo: f64, hi: f64) -> Result<f64, Fault> {
    let x = match p.get(name) {
        None => default,
        Some(v) => v.as_f64().ok_or_else(|| bad(name))?,
    };
    (x.is_finite() && (lo..=hi).contains(&x))
        .then_some(x)
        .ok_or_else(|| bad(name))
}

fn whole(p: &Value, name: &str, default: u64, lo: u64, hi: u64) -> Result<u64, Fault> {
    let n = match p.get(name) {
        None => default,
        Some(v) => v.as_u64().ok_or_else(|| bad(name))?,
    };
    (lo..=hi).contains(&n).then_some(n).ok_or_else(|| bad(name))
}

impl Spec {
    pub fn read(p: &Value) -> Result<Spec, Fault> {
        let levels = whole(p, "levels", 4, 1, 5)? as usize;
        let l0 = num(p, "length", 4.0, 1e-3, 1e3)?;
        let lengths = (0..levels).map(|k| l0 * pow(FALLOFF, k as f64)).collect();
        let leaves = match p.get("leaves") {
            None | Some(Value::Null) => Leaves {
                per_twig: 0,
                size: 0.1,
            },
            Some(l) => Leaves {
                per_twig: whole(l, "per_twig", 0, 0, 64).map_err(|_| bad("leaves/per_twig"))?,
                size: num(l, "size", 0.1, 1e-4, 10.0).map_err(|_| bad("leaves/size"))?,
            },
        };
        Ok(Spec {
            seed: whole(p, "seed", 0, 0, u64::from(u32::MAX))?,
            levels,
            lengths,
            radius: num(p, "radius", 0.15, 1e-4, 100.0)?,
            exponent: num(p, "exponent", 2.0, 1.0, 4.0)?,
            split: whole(p, "split", 3, 1, 8)? as usize,
            angle: num(p, "angle", 40.0, 0.0, 90.0)?,
            roll: num(p, "roll", 137.5, -360.0, 360.0)?,
            gravity: num(p, "gravity", 0.0, -4.0, 4.0)?,
            leaves,
            segments: whole(p, "segments", 8, 3, 64)? as usize,
            rings: whole(p, "rings", 8, 2, 64)? as usize,
        })
    }

    /// Branches at `level` (0 the trunk).
    fn at_level(&self, level: usize) -> u64 {
        (self.split as u64).pow(level as u32)
    }

    pub fn branches(&self) -> u64 {
        (0..self.levels).map(|k| self.at_level(k)).sum()
    }

    /// Twigs: the branches of level 3 and up (the trunk level 1), which hold the leaf cards and
    /// which `drop: [twigs]` removes.
    pub fn twigs(&self) -> u64 {
        (2..self.levels).map(|k| self.at_level(k)).sum()
    }

    /// The vertices and triangles the tree builds, from its params alone: each branch's rings
    /// and its two flat caps, and four corners and two triangles per leaf card.
    pub fn counts(&self) -> (u64, u64) {
        let (seg, rings) = (self.segments as u64, self.rings as u64);
        let per_branch = rings * (seg + 1) + 2 * (1 + seg + 1);
        let tris_branch = 2 * seg * (rings - 1) + 2 * seg;
        let cards = self.twigs() * self.leaves.per_twig;
        (
            self.branches() * per_branch + 4 * cards,
            self.branches() * tris_branch + 2 * cards,
        )
    }
}

/// The vertices and triangles a tree declares; past [`BOUND`] it is refused, naming the bound.
pub fn counts(p: &Value) -> Result<(u64, u64), Fault> {
    let s = Spec::read(p)?;
    let c = s.counts();
    if c.0 > BOUND {
        return Err(format!(
            "params: {} vertices past the bound of {BOUND}",
            c.0
        ));
    }
    Ok(c)
}

/// A number in [0, 1) from the seed, a branch and a salt.
fn draw(seed: u64, branch: usize, salt: u64) -> f64 {
    (mix(seed ^ mix((branch as u64) << 8 ^ salt)) >> 11) as f64 / (1u64 << 53) as f64
}

/// One branch of the grown tree: its level (0 the trunk), its parent and place among its
/// siblings, its ring centres, tangents, normals and radii, and its path length from the root
/// at its first ring.
#[derive(Clone, Debug)]
pub struct Branch {
    pub level: usize,
    pub parent: Option<usize>,
    pub slot: usize,
    pub points: Vec<V3>,
    pub tangents: Vec<V3>,
    pub normals: Vec<V3>,
    pub radii: Vec<f64>,
    pub from_root: f64,
}

impl Branch {
    /// The arc length from the first ring to ring k.
    fn run(&self) -> Vec<f64> {
        let mut out = vec![0.0];
        for w in self.points.windows(2) {
            out.push(out[out.len() - 1] + length(sub(w[1], w[0])));
        }
        out
    }

    pub fn length(&self) -> f64 {
        self.run().last().copied().unwrap_or(0.0)
    }

    fn end(&self) -> V3 {
        self.points[self.points.len() - 1]
    }

    /// The capsules along it, one per span, each as thick as its thicker end.
    fn capsules(&self) -> Vec<(V3, V3, f64)> {
        (1..self.points.len())
            .map(|k| {
                (
                    self.points[k - 1],
                    self.points[k],
                    self.radii[k - 1].max(self.radii[k]),
                )
            })
            .collect()
    }
}

/// The closest distance between segments ab and cd, with the closest points.
fn segments(a: V3, b: V3, c: V3, d: V3) -> (f64, V3, V3) {
    let (u, v, w) = (sub(b, a), sub(d, c), sub(a, c));
    let (aa, bb, cc, dd, ee) = (dot(u, u), dot(u, v), dot(v, v), dot(u, w), dot(v, w));
    let den = aa * cc - bb * bb;
    let clamp = |x: f64| x.clamp(0.0, 1.0);
    let mut s = if den > 1e-18 {
        clamp((bb * ee - cc * dd) / den)
    } else {
        0.0
    };
    let mut t = if cc > 1e-18 { (bb * s + ee) / cc } else { 0.0 };
    if t < 0.0 || t > 1.0 {
        t = clamp(t);
        s = if aa > 1e-18 {
            clamp((bb * t - dd) / aa)
        } else {
            0.0
        };
    }
    let (p, q) = (add(a, scale(u, s)), add(c, scale(v, t)));
    (length(sub(p, q)), p, q)
}

/// How far `new` passes into the branches already grown, m (negative: its clearance), its
/// parent and siblings only where the midpoint of their closest points lies past [`NEAR`] parent
/// radii of their shared fork.
fn depth(new: &Branch, grown: &[Branch]) -> f64 {
    let fork = new.points[0];
    let near = new
        .parent
        .map_or(0.0, |p| NEAR * grown[p].radii[grown[p].radii.len() - 1]);
    let mine = new.capsules();
    let reach = new.length() + new.radii[0];
    let mut worst = f64::NEG_INFINITY;
    for (i, other) in grown.iter().enumerate() {
        let kin = Some(i) == new.parent || (other.parent.is_some() && other.parent == new.parent);
        let far = length(sub(other.points[0], fork)) - other.length() - other.radii[0];
        if far > reach + CLEARANCE {
            continue;
        }
        for &(a, b, r) in &mine {
            for &(c, d, q) in &other.capsules() {
                let (dist, p, s) = segments(a, b, c, d);
                if kin && length(sub(scale(add(p, s), 0.5), fork)) <= near {
                    continue;
                }
                worst = worst.max(r + q - dist);
            }
        }
    }
    worst
}

/// The centres along a branch from `start` in direction `d0`, `n` rings over `len`, bent by
/// gravity (the part of down across its start direction, growing along its length) and by a
/// wander of its heading across `side`, one whole sine of `WANDER` along it.
fn curve(start: V3, d0: V3, len: f64, gravity: f64, side: V3, n: usize) -> Vec<V3> {
    let down = [0.0, -1.0, 0.0];
    let across = sub(down, scale(d0, dot(down, d0)));
    let step = len / (n - 1) as f64;
    let mut out = vec![start];
    for k in 1..n {
        let u = (k as f64 - 0.5) / (n - 1) as f64;
        let wander = WANDER * sin(core::f64::consts::TAU * u);
        let d = unit(add(
            add(d0, scale(across, gravity * u)),
            scale(side, wander),
        ));
        out.push(add(out[k - 1], scale(d, step)));
    }
    out
}

/// A seeded unit vector across `d`.
fn side(seed: u64, branch: usize, d: V3) -> V3 {
    let a = across(d);
    let b = cross(d, a);
    let turn = core::f64::consts::TAU * draw(seed, branch, 7);
    add(scale(a, cos(turn)), scale(b, sin(turn)))
}

/// Each ring's tangent: along the span after it at the first ring, before it at the last, and
/// their mean between.
fn tangents(points: &[V3]) -> Vec<V3> {
    let n = points.len();
    (0..n)
        .map(|k| {
            let (a, b) = (points[k.saturating_sub(1)], points[(k + 1).min(n - 1)]);
            unit(sub(b, a))
        })
        .collect()
}

/// Rotation-minimizing normals from `n0`, by double reflection between rings; or with the
/// planted curvature frames, each ring's normal toward its curve's bend, held where it is
/// straight.
fn normals(points: &[V3], t: &[V3], n0: V3, curvature: bool) -> Vec<V3> {
    let mut out = vec![n0];
    for k in 1..points.len() {
        let carried = transport(out[k - 1], points[k - 1], t[k - 1], points[k], t[k]);
        if !curvature {
            out.push(carried);
            continue;
        }
        let bend = sub(t[(k + 1).min(points.len() - 1)], t[k - 1]);
        let across = sub(bend, scale(t[k], dot(bend, t[k])));
        out.push(if length(across) > 1e-9 {
            unit(across)
        } else {
            carried
        });
    }
    out
}

/// A unit vector across `t`.
fn across(t: V3) -> V3 {
    let up = if t[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    unit(sub(up, scale(t, dot(up, t))))
}

/// The tree's branches, grown in level order from the trunk.
pub fn grow(s: &Spec, plants: Plants) -> Vec<Branch> {
    let n = s.rings;
    let up = [0.0, 1.0, 0.0];
    let trunk_pts = curve(
        [0.0; 3],
        up,
        s.lengths[0],
        s.gravity,
        side(s.seed, 0, up),
        n,
    );
    let t = tangents(&trunk_pts);
    let nrm = normals(&trunk_pts, &t, across(t[0]), false);
    let mut out = vec![Branch {
        level: 0,
        parent: None,
        slot: 0,
        radii: taper(s.radius, TAPER, n),
        points: trunk_pts,
        tangents: t,
        normals: nrm,
        from_root: 0.0,
    }];
    let mut level_start = 0;
    for level in 1..s.levels {
        let level_end = out.len();
        for p in level_start..level_end {
            let parent = out[p].clone();
            let end_r = parent.radii[n - 1];
            // The pipe model: seeded shares w, each child's radius end_r × w ÷ (Σ wᵉ)^(1/e).
            let w: Vec<f64> = (0..s.split)
                .map(|i| 1.0 + 0.25 * draw(s.seed, p, 16 + i as u64))
                .collect();
            let sum = w.iter().map(|x| pow(*x, s.exponent)).sum::<f64>();
            let norm = pow(sum, 1.0 / s.exponent);
            let (ft, fn_) = (parent.tangents[n - 1], parent.normals[n - 1]);
            let fb = cross(ft, fn_);
            let fork = parent.end();
            let from_root = parent.from_root + parent.length();
            for (i, share) in w.iter().enumerate() {
                let r0 = if plants.equal_radius {
                    end_r
                } else {
                    end_r * share / norm
                };
                // A tip narrows to half its start, every other branch by `TAPER`.
                let tip = level + 1 == s.levels;
                let r_end = r0 * if tip { 0.5 } else { TAPER };
                let base_len = s.lengths[level] * (0.85 + 0.3 * draw(s.seed, out.len(), 1));
                let index = out.len();
                // Try k's heading: the children spread evenly about their parent, turned by
                // `roll` from fork to fork, each jittered by the seed; later tries wider.
                let heading = |k: u64| {
                    let jitter = draw(s.seed, index, 32 + k) - 0.5;
                    let spread = if k == 0 {
                        0.0
                    } else {
                        0.6 * (draw(s.seed, index, 64 + k) - 0.5)
                    };
                    let az = rad(s.roll) * (parent.slot as f64 + 1.0)
                        + core::f64::consts::TAU * (i as f64 + 0.35 * jitter) / s.split as f64
                        + spread;
                    let polar = rad(s.angle) * (1.0 + 0.3 * (draw(s.seed, index, 96 + k) - 0.5));
                    unit(add(
                        scale(ft, cos(polar)),
                        scale(add(scale(fn_, cos(az)), scale(fb, sin(az))), sin(polar)),
                    ))
                };
                let make = |dir: V3, len: f64| {
                    let ends = (r0, r_end, from_root);
                    child(s, index, &parent, (p, i, level), fork, dir, len, ends)
                };
                // The first heading that clears every branch grown so far; when none does, the
                // clearest, shortened until it clears.
                let mut chosen = None;
                let mut clearest: Option<(f64, V3)> = None;
                for k in 0..12u64 {
                    let dir = heading(k);
                    let b = make(dir, base_len);
                    let d = depth(&b, &out);
                    if d <= -CLEARANCE {
                        chosen = Some(b);
                        break;
                    }
                    if clearest.is_none_or(|(c, _)| d < c) {
                        clearest = Some((d, dir));
                    }
                }
                let b = chosen.unwrap_or_else(|| {
                    let dir = clearest.expect("twelve tries").1;
                    let mut len = base_len;
                    let mut b = make(dir, len);
                    for _ in 0..8 {
                        if depth(&b, &out) <= -CLEARANCE {
                            break;
                        }
                        len *= 0.8;
                        b = make(dir, len);
                    }
                    b
                });
                out.push(b);
            }
        }
        level_start = level_end;
    }
    out
}

/// Radii from `r0` down to `r0 × end` over `n` rings, linear in the ring index.
fn taper(r0: f64, end: f64, n: usize) -> Vec<f64> {
    (0..n)
        .map(|k| r0 * (1.0 + (end - 1.0) * k as f64 / (n - 1) as f64))
        .collect()
}

/// Child `slot` of branch `p` at `level`, from `fork` along `dir` for `len`, its radius from
/// `r0` to `r_end`, `from_root` along the path from the root at its fork.
#[allow(clippy::too_many_arguments)]
fn child(
    s: &Spec,
    index: usize,
    parent: &Branch,
    (p, slot, level): (usize, usize, usize),
    fork: V3,
    dir: V3,
    len: f64,
    (r0, r_end, from_root): (f64, f64, f64),
) -> Branch {
    let n = s.rings;
    let pts = curve(fork, dir, len, s.gravity, side(s.seed, index, dir), n);
    let t = tangents(&pts);
    // The parent's end normal turned onto the child's first tangent, then carried along it.
    let pn = parent.normals[n - 1];
    let n0 = transport(pn, fork, parent.tangents[n - 1], fork, t[0]);
    let nrm = normals(&pts, &t, n0, false);
    let mut radii = vec![r0; n];
    for (k, r) in radii.iter_mut().enumerate() {
        *r = r0 + (r_end - r0) * k as f64 / (n - 1) as f64;
    }
    Branch {
        level,
        parent: Some(p),
        slot,
        points: pts,
        tangents: t,
        normals: nrm,
        radii,
        from_root,
    }
}

/// The part a branch at `level` (0 the trunk) belongs to.
pub fn part_of(level: usize) -> &'static str {
    match level {
        0 => "trunk",
        1 => "branches",
        _ => "twigs",
    }
}

/// The point and frame at arc length `at` along a branch.
fn along(b: &Branch, run: &[f64], at: f64) -> (V3, V3, V3) {
    let k = run
        .iter()
        .rposition(|r| *r <= at)
        .unwrap_or(0)
        .min(run.len() - 2);
    let span = (run[k + 1] - run[k]).max(1e-15);
    let f = ((at - run[k]) / span).clamp(0.0, 1.0);
    let lerp = |a: V3, b: V3| add(a, scale(sub(b, a), f));
    (
        lerp(b.points[k], b.points[k + 1]),
        unit(lerp(b.tangents[k], b.tangents[k + 1])),
        unit(lerp(b.normals[k], b.normals[k + 1])),
    )
}

/// Builds the tree: each branch's rings, its two flat caps and its part; the leaf cards; the
/// `wind` attribute; each branch's rings and forks as outputs; and a capsule chain per branch
/// as its true shape.
pub fn build(p: &Value, plants: Plants) -> Result<Mesh, Fault> {
    let s = Spec::read(p)?;
    counts(p)?;
    let branches = grow(&s, plants);
    let tips: f64 = branches
        .iter()
        .map(|b| b.from_root + b.length())
        .fold(0.0, f64::max)
        .max(1e-12);
    let mut m = Mesh::default();
    let mut wind: Vec<f64> = Vec::new();
    let mut rows = Vec::new();
    let seg = s.segments;
    for (i, b) in branches.iter().enumerate() {
        let from = m.triangles();
        let run = b.run();
        // The planted curvature frames set the rings only: the branches grow as shipped.
        let ring_normals = if plants.curvature_frames {
            normals(&b.points, &b.tangents, b.normals[0], true)
        } else {
            b.normals.clone()
        };
        let mut bases = Vec::with_capacity(b.points.len());
        let last = b.points.len() - 1;
        for k in 0..b.points.len() {
            let (c, t, nrm) = (b.points[k], b.tangents[k], ring_normals[k]);
            let bn = cross(t, nrm);
            // The taper's slope: a tapered tube's surface normal leans along it by dr/ds.
            let (k0, k1) = (k.saturating_sub(1), (k + 1).min(last));
            let slope = (b.radii[k1] - b.radii[k0]) / (run[k1] - run[k0]).max(1e-15);
            let base = m.positions.len() as u32;
            for j in 0..=seg {
                let a = core::f64::consts::TAU * j as f64 / seg as f64;
                let dir = add(scale(nrm, cos(a)), scale(bn, sin(a)));
                m.vertex(
                    add(c, scale(dir, b.radii[k])),
                    unit(sub(dir, scale(t, slope))),
                );
                wind.push((b.from_root + run[k]) / tips);
            }
            bases.push(base);
        }
        for k in 1..bases.len() {
            let (a, c) = (bases[k - 1], bases[k]);
            let face = m.next_face();
            for j in 0..seg as u32 {
                m.quad(a + j, a + j + 1, c + j + 1, c + j, face);
            }
        }
        for (end, sign) in [(0usize, -1.0), (b.points.len() - 1, 1.0)] {
            let out = scale(b.tangents[end], sign);
            let centre = m.vertex(b.points[end], out);
            wind.push((b.from_root + run[end]) / tips);
            let base = m.positions.len() as u32;
            for j in 0..=seg {
                let q = m.positions[(bases[end] + j as u32) as usize];
                m.vertex(q, out);
                wind.push((b.from_root + run[end]) / tips);
            }
            let face = m.next_face();
            for j in 0..seg as u32 {
                let (x, y) = if sign > 0.0 { (j, j + 1) } else { (j + 1, j) };
                m.tri(centre, base + x, base + y, face);
            }
        }
        m.part(part_of(b.level), from);
        // Each ring as the `geometry` call reports it: its sides' vertices (the seam's copy left
        // out), its centre, frame and radius, and its share of the branch's length.
        rows.push(json!({
            "id": format!("b{i}"),
            "level": b.level + 1,
            "parent": b.parent.map(|p| format!("b{p}")),
            "part": part_of(b.level),
            "length": run[run.len() - 1],
            "from_root": b.from_root,
            "rings": (0..b.points.len()).map(|k| json!({
                "vertices": (bases[k]..bases[k] + seg as u32).collect::<Vec<_>>(),
                "centre": b.points[k],
                "tangent": b.tangents[k],
                "normal": ring_normals[k],
                "radius": b.radii[k],
                "u": run[k] / run[run.len() - 1].max(1e-15),
            })).collect::<Vec<_>>(),
        }));
    }
    let forks: Vec<Value> = (0..branches.len())
        .filter_map(|p| {
            let kids: Vec<String> = (0..branches.len())
                .filter(|c| branches[*c].parent == Some(p))
                .map(|c| format!("b{c}"))
                .collect();
            (!kids.is_empty()).then(
                || json!({"id": format!("f{p}"), "parent": format!("b{p}"), "children": kids}),
            )
        })
        .collect();
    // Leaf cards: per_twig squares on each twig, centred on its axis in its last fifth, each
    // turned about the twig by the golden angle from the last.
    let from = m.triangles();
    let mut cards = Vec::new();
    if s.leaves.per_twig > 0 {
        let h = s.leaves.size / 2.0;
        for (i, b) in branches.iter().enumerate().filter(|(_, b)| b.level >= 2) {
            let run = b.run();
            let len = run[run.len() - 1];
            for j in 0..s.leaves.per_twig {
                let u = LEAF_FROM + (1.0 - LEAF_FROM) * (j as f64 + 0.5) / s.leaves.per_twig as f64;
                let (c, t, nrm) = along(b, &run, u * len);
                let psi =
                    rad(137.507_764) * j as f64 + core::f64::consts::TAU * draw(s.seed, i, 200 + j);
                let a = add(scale(nrm, cos(psi)), scale(cross(t, nrm), sin(psi)));
                let normal = unit(cross(a, t));
                let base = m.positions.len() as u32;
                for (x, y) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                    m.vertex(add(c, add(scale(a, x * h), scale(t, y * h))), normal);
                    wind.push((b.from_root + u * len) / tips);
                }
                let face = m.next_face();
                m.quad(base, base + 1, base + 2, base + 3, face);
                cards.push(json!({"twig": format!("b{i}"), "vertices": [base, base + 1, base + 2, base + 3], "centre": c, "u": u}));
            }
        }
    }
    // Every part is named, empty or not, so `materials` may name it on any tree.
    m.part("leaves", from);
    for level in 0..3 {
        m.parts.entry(part_of(level).into()).or_default();
    }
    m.attributes.insert("wind".into(), wind);
    m.outputs.insert("branches".into(), Value::Array(rows));
    m.outputs.insert("forks".into(), Value::Array(forks));
    m.outputs.insert("cards".into(), Value::Array(cards));
    m.true_shape = branches
        .iter()
        .enumerate()
        .map(|(i, b)| {
            json!({"capsules": {"branch": format!("b{i}"), "points": b.points, "radii": b.capsules().iter().map(|c| c.2).collect::<Vec<_>>()}})
        })
        .collect();
    Ok(m)
}
