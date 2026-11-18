//! camera.framing's occluded share (#457; canvas primitives: Check input: loop kinds: occluded
//! share): rays from the camera to sample points on each kept item's true shape, cast in f64 on
//! evaluated data, never read from pixels. A point is hidden when the first item its ray meets is
//! another item; glass, blended and additive items, items in the check input's `except` and
//! geometry the cutaway in effect hides never stop a ray.

use deep_canvas::ops::sqrt;
use deep_canvas_scene3d::light::AlphaMode;
use deep_canvas_scene3d::scene::{Scene, Solid};

use crate::scene::is_of;

type V3 = [f64; 3];

/// The planted wrong programs: an additive item stops rays as an opaque one does; each kept
/// item's pattern is seeded by its place in the document's item order; an item a cutaway in
/// effect reaches never occludes, whichever side of its planes it lies on.
pub const PLANTED_ADD_OCCLUDES: &str = "occluders_count_add";
pub const PLANTED_BY_ORDER: &str = "occluded_samples_by_order";
pub const PLANTED_CUT_WHOLE: &str = "cutaway_hides_whole_items";

/// One kept item's reading at one checked time.
pub(crate) struct Share {
    pub item: String,
    /// Hidden points over the points inside the frame; 0 with none inside it.
    pub share: f64,
    /// The items whose surfaces stop the hidden points' rays, in ID order.
    pub occluders: Vec<String>,
    /// Every sample point, in the pattern's order, in world metres.
    pub points: Vec<V3>,
    pub in_frame: usize,
}

/// A pattern seeded by `id` alone: the three offsets of a Kronecker sequence, from the ID's
/// FNV-1a hash stirred by splitmix64.
fn seed(id: &str) -> [f64; 3] {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in id.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    std::array::from_fn(|_| {
        h = h.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = h;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    })
}

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn len(a: V3) -> f64 {
    sqrt(dot(a, a))
}

/// The solids that draw `id` (its own or its parts), drawn in the frame passes.
fn solids_of<'a>(scene: &'a Scene, id: &'a str) -> impl Iterator<Item = &'a Solid> + 'a {
    scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(move |s| !s.cast_only && is_of(&s.id, id))
}

/// `n` points on the kept item's true shape, spread by area: a stratified sequence whose offsets
/// only `id` sets, so adding an item elsewhere moves none of them.
pub(crate) fn samples(scene: &Scene, id: &str, n: usize, seed_by: &str) -> Vec<V3> {
    let tris: Vec<[V3; 3]> = solids_of(scene, id)
        .flat_map(deep_canvas_scene3d::shore::triangles)
        .collect();
    let mut cum = Vec::with_capacity(tris.len());
    let mut total = 0.0;
    for [a, b, c] in &tris {
        total += len(cross(sub(*b, *a), sub(*c, *a))) / 2.0;
        cum.push(total);
    }
    if tris.is_empty() || total <= 0.0 {
        return Vec::new();
    }
    // The plastic number's Kronecker steps, the most even in three dimensions.
    const G: f64 = 1.220_744_084_605_759_5;
    let step = [1.0 / G, 1.0 / (G * G), 1.0 / (G * G * G)];
    let off = seed(seed_by);
    (0..n)
        .map(|k| {
            let u: [f64; 3] =
                std::array::from_fn(|j| (off[j] + step[j] * (k as f64 + 1.0)).fract());
            let at = u[0] * total;
            let i = cum.partition_point(|&c| c < at).min(tris.len() - 1);
            let [a, b, c] = tris[i];
            let r = sqrt(u[1]);
            let (wa, wb, wc) = (1.0 - r, r * (1.0 - u[2]), r * u[2]);
            std::array::from_fn(|j| a[j] * wa + b[j] * wb + c[j] * wc)
        })
        .collect()
}

/// A solid a ray may stop at, with its triangles and world box.
struct Stop<'a> {
    solid: &'a Solid,
    tris: Vec<[V3; 3]>,
    lo: V3,
    hi: V3,
}

struct Node {
    lo: V3,
    hi: V3,
    /// Leaf: stops `start..end` of the order; inner: children at `start` and `end`.
    start: usize,
    end: usize,
    leaf: bool,
}

/// The surfaces that may hide a point: a bounding-volume hierarchy over their solids' boxes, the
/// exact triangles at its leaves.
pub(crate) struct Occluders<'a> {
    stops: Vec<Stop<'a>>,
    nodes: Vec<Node>,
    cut: Option<&'a deep_canvas_scene3d::cut::Cutaway>,
}

/// Whether a solid stops rays: not glass, blended or additive (the planted program counts
/// additive ones), and not drawn below full coverage.
fn opaque(s: &Solid, add_occludes: bool) -> bool {
    let m = s.material.as_ref();
    if add_occludes && m.is_some_and(|m| m.alpha_mode == AlphaMode::Add) {
        return true;
    }
    !(s.alpha < 1.0
        || s.per_pixel
        || m.is_some_and(|m| m.alpha_mode.see_through() || m.lobes.transmission > 0.0))
}

impl<'a> Occluders<'a> {
    pub(crate) fn new(
        scene: &'a Scene,
        except: &[String],
        add_occludes: bool,
        cut_whole: bool,
    ) -> Occluders<'a> {
        let cut = scene.cutaway.as_ref();
        Occluders::of(scene, |s| {
            opaque(s, add_occludes)
                && !except.iter().any(|e| is_of(&s.id, e))
                && !(cut_whole && s.cut && cut.is_some_and(|c| c.reaches(&s.id)))
        })
    }

    /// The index over the scene's solids that `keep` lets in, drawn in the frame passes.
    pub(crate) fn of(scene: &'a Scene, keep: impl Fn(&Solid) -> bool) -> Occluders<'a> {
        let mut stops: Vec<Stop<'a>> = scene
            .layers
            .iter()
            .flat_map(|l| &l.solids)
            .filter(|s| !s.cast_only && keep(s))
            .filter_map(|s| {
                let tris = deep_canvas_scene3d::shore::triangles(s);
                let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
                for p in tris.iter().flatten() {
                    for k in 0..3 {
                        lo[k] = lo[k].min(p[k]);
                        hi[k] = hi[k].max(p[k]);
                    }
                }
                lo[0].is_finite().then_some(Stop {
                    solid: s,
                    tris,
                    lo,
                    hi,
                })
            })
            .collect();
        let mut out = Occluders {
            nodes: Vec::new(),
            cut: scene.cutaway.as_ref(),
            stops: Vec::new(),
        };
        if !stops.is_empty() {
            let n = stops.len();
            out.build(&mut stops, 0, n);
        }
        out.stops = stops;
        out
    }

    fn build(&mut self, stops: &mut [Stop<'a>], start: usize, end: usize) -> usize {
        let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for s in &stops[start..end] {
            for k in 0..3 {
                lo[k] = lo[k].min(s.lo[k]);
                hi[k] = hi[k].max(s.hi[k]);
            }
        }
        let at = self.nodes.len();
        self.nodes.push(Node {
            lo,
            hi,
            start,
            end,
            leaf: true,
        });
        if end - start <= 2 {
            return at;
        }
        let axis = (0..3)
            .max_by(|&a, &b| (hi[a] - lo[a]).total_cmp(&(hi[b] - lo[b])))
            .unwrap_or(0);
        stops[start..end].sort_by(|a, b| {
            (a.lo[axis] + a.hi[axis])
                .total_cmp(&(b.lo[axis] + b.hi[axis]))
                .then_with(|| a.solid.id.cmp(&b.solid.id))
        });
        let mid = (start + end) / 2;
        let left = self.build(stops, start, mid);
        let right = self.build(stops, mid, end);
        let node = &mut self.nodes[at];
        node.start = left;
        node.end = right;
        node.leaf = false;
        at
    }

    /// The first solid the ray from `o` along unit `d` meets before `max`, at a point the
    /// cutaway keeps, with its distance; ties go to the lower ID.
    pub(crate) fn first(&self, o: V3, d: V3, max: f64) -> Option<(&'a Solid, f64)> {
        let mut best: Option<(&'a Solid, f64)> = None;
        let mut stack = if self.nodes.is_empty() {
            vec![]
        } else {
            vec![0]
        };
        while let Some(n) = stack.pop() {
            let node = &self.nodes[n];
            let reach = best.map_or(max, |b| b.1);
            if !slab(node.lo, node.hi, o, d, reach) {
                continue;
            }
            if !node.leaf {
                stack.push(node.start);
                stack.push(node.end);
                continue;
            }
            for stop in &self.stops[node.start..node.end] {
                let reach = best.map_or(max, |b| b.1);
                if !slab(stop.lo, stop.hi, o, d, reach) {
                    continue;
                }
                let cut = self
                    .cut
                    .filter(|c| stop.solid.cut && c.reaches(&stop.solid.id));
                for t in &stop.tris {
                    let Some(k) = meet(o, d, t) else { continue };
                    if k >= max {
                        continue;
                    }
                    if cut.is_some_and(|c| {
                        c.hides([o[0] + d[0] * k, o[1] + d[1] * k, o[2] + d[2] * k])
                    }) {
                        continue;
                    }
                    let better = match best {
                        None => true,
                        Some((s, b)) => k < b || (k == b && stop.solid.id < s.id),
                    };
                    if better {
                        best = Some((stop.solid, k));
                    }
                }
            }
        }
        best
    }
}

impl<'a> Occluders<'a> {
    /// The diagonal of the box that holds every solid it indexes.
    pub(crate) fn extent(&self) -> f64 {
        self.nodes.first().map_or(0.0, |n| len(sub(n.hi, n.lo)))
    }

    /// The solid nearest to `p` within `max`, and how far its surface is, measured to the part
    /// of its true shape the cutaway keeps; ties go to the lower ID.
    pub(crate) fn nearest(&self, p: V3, max: f64) -> Option<(&'a Solid, f64)> {
        let mut best: Option<(&'a Solid, f64)> = None;
        let mut stack = if self.nodes.is_empty() {
            vec![]
        } else {
            vec![0]
        };
        while let Some(n) = stack.pop() {
            let node = &self.nodes[n];
            let reach = best.map_or(max, |b| b.1);
            if box_dist(node.lo, node.hi, p) > reach {
                continue;
            }
            if !node.leaf {
                stack.push(node.start);
                stack.push(node.end);
                continue;
            }
            for stop in &self.stops[node.start..node.end] {
                let reach = best.map_or(max, |b| b.1);
                if box_dist(stop.lo, stop.hi, p) > reach {
                    continue;
                }
                let cut = self
                    .cut
                    .filter(|c| stop.solid.cut && c.reaches(&stop.solid.id));
                for t in &stop.tris {
                    let d = match cut {
                        None => tri_dist(p, t),
                        Some(c) => kept_dist(p, t, c),
                    };
                    let better = match best {
                        None => d <= max,
                        Some((s, b)) => d < b || (d == b && stop.solid.id < s.id),
                    };
                    if better {
                        best = Some((stop.solid, d));
                    }
                }
            }
        }
        best
    }
}

/// How far `p` lies from the box.
fn box_dist(lo: V3, hi: V3, p: V3) -> f64 {
    let d: V3 = std::array::from_fn(|k| (lo[k] - p[k]).max(0.0).max(p[k] - hi[k]));
    len(d)
}

/// How far `p` lies from the part of triangle `t` the cutaway keeps: the triangle clipped to the
/// kept side of each plane. Where every plane must hide a point (`intersect`), the kept part is
/// the union of the triangle's parts on the near side of each plane.
fn kept_dist(p: V3, t: &[V3; 3], c: &deep_canvas_scene3d::cut::Cutaway) -> f64 {
    let clip = |poly: Vec<V3>, (n, o): &(V3, f64)| -> Vec<V3> {
        let mut out = Vec::new();
        for i in 0..poly.len() {
            let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
            let (da, db) = (dot(*n, a) - o, dot(*n, b) - o);
            if da <= 0.0 {
                out.push(a);
            }
            if (da <= 0.0) != (db <= 0.0) {
                let k = da / (da - db);
                out.push(std::array::from_fn(|j| a[j] + (b[j] - a[j]) * k));
            }
        }
        out
    };
    let fan = |poly: &[V3]| -> f64 {
        (1..poly.len().saturating_sub(1))
            .map(|i| tri_dist(p, &[poly[0], poly[i], poly[i + 1]]))
            .fold(f64::INFINITY, f64::min)
    };
    if c.intersect && !c.planes.is_empty() {
        c.planes
            .iter()
            .map(|pl| fan(&clip(t.to_vec(), pl)))
            .fold(f64::INFINITY, f64::min)
    } else {
        fan(&c.planes.iter().fold(t.to_vec(), clip))
    }
}

/// How far `p` lies from triangle `t` (the closest point by its Voronoi regions).
pub(crate) fn tri_dist(p: V3, t: &[V3; 3]) -> f64 {
    let [a, b, c] = *t;
    let (ab, ac, ap) = (sub(b, a), sub(c, a), sub(p, a));
    let (d1, d2) = (dot(ab, ap), dot(ac, ap));
    let at = |q: V3| len(sub(p, q));
    if d1 <= 0.0 && d2 <= 0.0 {
        return at(a);
    }
    let bp = sub(p, b);
    let (d3, d4) = (dot(ab, bp), dot(ac, bp));
    if d3 >= 0.0 && d4 <= d3 {
        return at(b);
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let v = d1 / (d1 - d3);
        return at(std::array::from_fn(|k| a[k] + ab[k] * v));
    }
    let cp = sub(p, c);
    let (d5, d6) = (dot(ab, cp), dot(ac, cp));
    if d6 >= 0.0 && d5 <= d6 {
        return at(c);
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let w = d2 / (d2 - d6);
        return at(std::array::from_fn(|k| a[k] + ac[k] * w));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return at(std::array::from_fn(|k| b[k] + (c[k] - b[k]) * w));
    }
    let denom = 1.0 / (va + vb + vc);
    let (v, w) = (vb * denom, vc * denom);
    at(std::array::from_fn(|k| a[k] + ab[k] * v + ac[k] * w))
}

/// Whether the ray from `o` along `d` meets the box before `max`.
fn slab(lo: V3, hi: V3, o: V3, d: V3, max: f64) -> bool {
    let (mut a, mut b) = (0.0f64, max);
    for k in 0..3 {
        if d[k] == 0.0 {
            if o[k] < lo[k] || o[k] > hi[k] {
                return false;
            }
            continue;
        }
        let inv = 1.0 / d[k];
        let (x, y) = ((lo[k] - o[k]) * inv, (hi[k] - o[k]) * inv);
        let (x, y) = if x <= y { (x, y) } else { (y, x) };
        a = a.max(x);
        b = b.min(y);
        if a > b {
            return false;
        }
    }
    true
}

/// How far along `d` the ray from `o` meets triangle `t`, either face, ahead of `o`.
fn meet(o: V3, d: V3, t: &[V3; 3]) -> Option<f64> {
    let (e1, e2) = (sub(t[1], t[0]), sub(t[2], t[0]));
    let p = cross(d, e2);
    let det = dot(e1, p);
    if det == 0.0 {
        return None;
    }
    let s = sub(o, t[0]);
    let u = dot(s, p) / det;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = cross(s, e1);
    let v = dot(d, q) / det;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let k = dot(e2, q) / det;
    (k > 0.0).then_some(k)
}

/// The kept item `id`'s occluded share at the scene's time, from `n` sample points.
pub(crate) fn share(scene: &Scene, occ: &Occluders<'_>, id: &str, n: usize, seed: &str) -> Share {
    let cam = &scene.camera;
    let [w, h] = cam.size;
    let points = samples(scene, id, n, seed);
    // Points of the kept item that the cutaway hides aren't in frame.
    let own_cut = scene
        .cutaway
        .as_ref()
        .filter(|c| solids_of(scene, id).any(|s| s.cut && c.reaches(&s.id)));
    let (mut in_frame, mut hidden) = (0usize, 0usize);
    let mut occluders: Vec<String> = Vec::new();
    for &p in &points {
        if own_cut.is_some_and(|c| c.hides(p)) {
            continue;
        }
        let v = cam.to_view(p);
        if cam.perspective && v[2] <= 0.0 {
            continue;
        }
        let Some([x, y, _]) = cam.project(p) else {
            continue;
        };
        if !(0.0..=w).contains(&x) || !(0.0..=h).contains(&y) {
            continue;
        }
        in_frame += 1;
        // From the eye, or in an orthographic view from the eye's plane along the view.
        let (o, d, dist) = if cam.perspective {
            let to = sub(p, cam.eye);
            let l = len(to);
            (cam.eye, to.map(|x| x / l), l)
        } else {
            let back = v[2] + 1.0;
            let f = cam.forward;
            (
                [p[0] - f[0] * back, p[1] - f[1] * back, p[2] - f[2] * back],
                f,
                back,
            )
        };
        // A hair short of the point, so its own surface never counts.
        let max = dist - 1e-9 * dist.max(1.0) - 1e-7;
        if let Some((s, _)) = occ.first(o, d, max) {
            if !is_of(&s.id, id) {
                hidden += 1;
                if !occluders.contains(&s.id) {
                    occluders.push(s.id.clone());
                }
            }
        }
    }
    occluders.sort();
    Share {
        item: id.to_string(),
        share: if in_frame == 0 {
            0.0
        } else {
            hidden as f64 / in_frame as f64
        },
        occluders,
        points,
        in_frame,
    }
}
