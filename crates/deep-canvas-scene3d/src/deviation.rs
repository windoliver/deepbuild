//! The simplify job's measure (issue #427; canvas primitives: Level of detail: chunk trees, "a
//! two-sided sampled distance in meters between positions only, run by the probe in pinned math"):
//! how far an item's surface lies from a reference surface, sampled both ways. Each triangle is
//! sampled on a fixed barycentric grid (its corners, points along its edges and inside it, its
//! centroid always among them), denser on larger triangles, and each sample's exact distance to
//! the other surface is found through a bounding-volume hierarchy, in f64 with only `sqrt`, so
//! the simplify job's probe and deep_show's deviation mode give the same number for the same
//! positions. Ties go to the lower face index.

type V3 = [f64; 3];

/// One way's distances: the largest and the mean over its samples, in m.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Way {
    pub largest_m: f64,
    pub mean_m: f64,
}

/// What [`measure`] found.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Deviation {
    /// The larger way's largest distance, m.
    pub largest_m: f64,
    /// The mean over both ways' samples, m.
    pub mean_m: f64,
    /// The item's samples to the reference surface.
    pub to_reference: Way,
    /// The reference's samples to the item's surface.
    pub from_reference: Way,
    /// Per item face, its worst distance either way: its own samples', and those of the
    /// reference samples it is nearest to.
    pub faces: Vec<f64>,
    /// Per item vertex, its distance to the reference surface.
    pub per_vertex: Vec<f64>,
}

/// The most barycentric steps along a triangle's edge, so one huge triangle can't run away.
const MAX_STEPS: usize = 48;
/// Sample spacing as a share of the two meshes' joint bounding-box diagonal.
const SPACING: f64 = 1.0 / 128.0;

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn len(a: V3) -> f64 {
    deep_canvas::ops::sqrt(dot(a, a))
}

/// The squared distance from `p` to triangle `abc` (Ericson, Real-Time Collision Detection 5.1.5).
fn dist2(p: V3, [a, b, c]: [V3; 3]) -> f64 {
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ap = sub(p, a);
    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    let at = |q: V3| dot(sub(p, q), sub(p, q));
    let lerp = |o: V3, d: V3, t: f64| [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    if d1 <= 0.0 && d2 <= 0.0 {
        return at(a);
    }
    let bp = sub(p, b);
    let d3 = dot(ab, bp);
    let d4 = dot(ac, bp);
    if d3 >= 0.0 && d4 <= d3 {
        return at(b);
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return at(lerp(a, ab, d1 / (d1 - d3)));
    }
    let cp = sub(p, c);
    let d5 = dot(ab, cp);
    let d6 = dot(ac, cp);
    if d6 >= 0.0 && d5 <= d6 {
        return at(c);
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return at(lerp(a, ac, d2 / (d2 - d6)));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        return at(lerp(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
    }
    let denom = 1.0 / (va + vb + vc);
    let (v, w) = (vb * denom, vc * denom);
    at([
        a[0] + ab[0] * v + ac[0] * w,
        a[1] + ab[1] * v + ac[1] * w,
        a[2] + ab[2] * v + ac[2] * w,
    ])
}

struct Node {
    min: V3,
    max: V3,
    /// Leaf: `start..end` into `order`; inner: children at `start` and `end`.
    start: usize,
    end: usize,
    leaf: bool,
}

/// A bounding-volume hierarchy over a mesh's triangles, for nearest-surface and ray queries.
pub(crate) struct Bvh {
    tris: Vec<[V3; 3]>,
    order: Vec<usize>,
    nodes: Vec<Node>,
}

impl Bvh {
    pub(crate) fn new(tris: Vec<[V3; 3]>) -> Bvh {
        let mut bvh = Bvh {
            order: (0..tris.len()).collect(),
            tris,
            nodes: Vec::new(),
        };
        if !bvh.tris.is_empty() {
            bvh.build(0, bvh.tris.len());
        }
        bvh
    }

    fn bounds(&self, range: &[usize]) -> (V3, V3) {
        let mut min = [f64::INFINITY; 3];
        let mut max = [f64::NEG_INFINITY; 3];
        for &t in range {
            for v in self.tris[t] {
                for k in 0..3 {
                    min[k] = min[k].min(v[k]);
                    max[k] = max[k].max(v[k]);
                }
            }
        }
        (min, max)
    }

    fn build(&mut self, start: usize, end: usize) -> usize {
        let (min, max) = self.bounds(&self.order[start..end]);
        let at = self.nodes.len();
        self.nodes.push(Node {
            min,
            max,
            start,
            end,
            leaf: true,
        });
        if end - start <= 4 {
            return at;
        }
        let axis = (0..3)
            .max_by(|&a, &b| (max[a] - min[a]).total_cmp(&(max[b] - min[b])))
            .unwrap_or(0);
        let tris = &self.tris;
        let centre = |t: usize| tris[t][0][axis] + tris[t][1][axis] + tris[t][2][axis];
        self.order[start..end].sort_by(|&a, &b| centre(a).total_cmp(&centre(b)).then(a.cmp(&b)));
        let mid = (start + end) / 2;
        let left = self.build(start, mid);
        let right = self.build(mid, end);
        let node = &mut self.nodes[at];
        node.start = left;
        node.end = right;
        node.leaf = false;
        at
    }

    fn box_dist2(node: &Node, p: V3) -> f64 {
        (0..3)
            .map(|k| {
                let d = (node.min[k] - p[k]).max(0.0).max(p[k] - node.max[k]);
                d * d
            })
            .sum()
    }

    /// Whether the ray from `o` along `d` meets a triangle past `near` (Möller-Trumbore, against
    /// each box by slabs).
    pub(crate) fn blocks(&self, o: V3, d: V3, near: f64) -> bool {
        let mut stack = if self.nodes.is_empty() {
            Vec::new()
        } else {
            vec![0usize]
        };
        while let Some(n) = stack.pop() {
            let node = &self.nodes[n];
            let (mut lo, mut hi) = (0.0f64, f64::INFINITY);
            for k in 0..3 {
                let inv = 1.0 / d[k];
                let (a, b) = ((node.min[k] - o[k]) * inv, (node.max[k] - o[k]) * inv);
                let (a, b) = if a <= b { (a, b) } else { (b, a) };
                // A NaN slab (d[k] = 0 with o on the slab's plane) leaves the range as it was.
                lo = if a > lo { a } else { lo };
                hi = if b < hi { b } else { hi };
            }
            if lo > hi {
                continue;
            }
            if !node.leaf {
                stack.push(node.start);
                stack.push(node.end);
                continue;
            }
            for &t in &self.order[node.start..node.end] {
                let [a, b, c] = self.tris[t];
                let (e1, e2) = (sub(b, a), sub(c, a));
                let p = [
                    d[1] * e2[2] - d[2] * e2[1],
                    d[2] * e2[0] - d[0] * e2[2],
                    d[0] * e2[1] - d[1] * e2[0],
                ];
                let det = dot(e1, p);
                if det.abs() < 1e-18 {
                    continue;
                }
                let s = sub(o, a);
                let u = dot(s, p) / det;
                let q = [
                    s[1] * e1[2] - s[2] * e1[1],
                    s[2] * e1[0] - s[0] * e1[2],
                    s[0] * e1[1] - s[1] * e1[0],
                ];
                let v = dot(d, q) / det;
                if u < 0.0 || v < 0.0 || u + v > 1.0 {
                    continue;
                }
                if dot(e2, q) / det > near {
                    return true;
                }
            }
        }
        false
    }

    /// The nearest triangle to `p`: its squared distance and its index, the lower on a tie.
    fn nearest(&self, p: V3) -> (f64, Option<usize>) {
        let mut best = (f64::INFINITY, None);
        if self.nodes.is_empty() {
            return best;
        }
        let mut stack = vec![0usize];
        while let Some(n) = stack.pop() {
            let node = &self.nodes[n];
            if Bvh::box_dist2(node, p) > best.0 {
                continue;
            }
            if node.leaf {
                for &t in &self.order[node.start..node.end] {
                    let d = dist2(p, self.tris[t]);
                    if d < best.0 || (d == best.0 && best.1.is_some_and(|b| t < b)) {
                        best = (d, Some(t));
                    }
                }
            } else {
                let (l, r) = (node.start, node.end);
                let (dl, dr) = (
                    Bvh::box_dist2(&self.nodes[l], p),
                    Bvh::box_dist2(&self.nodes[r], p),
                );
                // The nearer child last, so it's searched first.
                if dl <= dr {
                    stack.push(r);
                    stack.push(l);
                } else {
                    stack.push(l);
                    stack.push(r);
                }
            }
        }
        best
    }
}

fn triangles(pos: &[V3], idx: &[u32]) -> Vec<[V3; 3]> {
    idx.as_chunks::<3>()
        .0
        .iter()
        .map(|t| t.map(|i| pos[i as usize]))
        .collect()
}

/// A triangle's samples: a barycentric grid of `n` steps a side, `n` a multiple of 3 so the
/// centroid is one, from how long its longest edge is against `spacing`.
fn samples([a, b, c]: [V3; 3], spacing: f64) -> Vec<V3> {
    let longest = len(sub(b, a)).max(len(sub(c, b))).max(len(sub(a, c)));
    let steps = if spacing > 0.0 {
        (longest / spacing).ceil() as usize
    } else {
        3
    };
    let n = steps.clamp(3, MAX_STEPS).div_ceil(3) * 3;
    let mut out = Vec::with_capacity((n + 1) * (n + 2) / 2);
    for i in 0..=n {
        for j in 0..=n - i {
            let (u, v) = (i as f64 / n as f64, j as f64 / n as f64);
            let w = 1.0 - u - v;
            out.push([
                a[0] * w + b[0] * u + c[0] * v,
                a[1] * w + b[1] * u + c[1] * v,
                a[2] * w + b[2] * u + c[2] * v,
            ]);
        }
    }
    out
}

/// How far the item's surface (`item_pos`, `item_idx`) lies from the reference's, both ways, in
/// the positions' units. `one_way` is the planted `deviation_one_way`: only the reference's
/// samples to the item's surface count.
pub fn measure(
    item_pos: &[[f64; 3]],
    item_idx: &[u32],
    ref_pos: &[[f64; 3]],
    ref_idx: &[u32],
    one_way: bool,
) -> Deviation {
    let item = triangles(item_pos, item_idx);
    let reference = triangles(ref_pos, ref_idx);
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for v in item.iter().chain(&reference).flatten() {
        for k in 0..3 {
            min[k] = min[k].min(v[k]);
            max[k] = max[k].max(v[k]);
        }
    }
    let spacing = if min[0].is_finite() {
        len(sub(max, min)) * SPACING
    } else {
        0.0
    };
    let mut faces = vec![0.0f64; item.len()];
    let mut out = Deviation::default();
    let (mut sum, mut count) = (0.0, 0usize);

    let item_bvh = Bvh::new(item.clone());
    let ref_bvh = Bvh::new(reference.clone());

    if !one_way {
        let (mut largest, mut s, mut c) = (0.0f64, 0.0, 0usize);
        for (f, tri) in item.iter().enumerate() {
            for p in samples(*tri, spacing) {
                let d = deep_canvas::ops::sqrt(ref_bvh.nearest(p).0);
                if d.is_finite() {
                    largest = largest.max(d);
                    faces[f] = faces[f].max(d);
                    s += d;
                    c += 1;
                }
            }
        }
        out.to_reference = Way {
            largest_m: largest,
            mean_m: if c > 0 { s / c as f64 } else { 0.0 },
        };
        sum += s;
        count += c;
    }

    let (mut largest, mut s, mut c) = (0.0f64, 0.0, 0usize);
    for tri in &reference {
        for p in samples(*tri, spacing) {
            let (d2, Some(f)) = item_bvh.nearest(p) else {
                continue;
            };
            let d = deep_canvas::ops::sqrt(d2);
            largest = largest.max(d);
            faces[f] = faces[f].max(d);
            s += d;
            c += 1;
        }
    }
    out.from_reference = Way {
        largest_m: largest,
        mean_m: if c > 0 { s / c as f64 } else { 0.0 },
    };
    sum += s;
    count += c;

    out.per_vertex = item_pos
        .iter()
        .map(|&p| deep_canvas::ops::sqrt(ref_bvh.nearest(p).0))
        .collect();
    out.largest_m = out.to_reference.largest_m.max(out.from_reference.largest_m);
    out.mean_m = if count > 0 { sum / count as f64 } else { 0.0 };
    out.faces = faces;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 2 × 2 m plate of 4 × 4 quads in the XY plane, vertex (i, j) lifted by `lift`.
    fn plate(lift: impl Fn(usize, usize) -> f64) -> (Vec<V3>, Vec<u32>) {
        let mut pos = Vec::new();
        for j in 0..=4 {
            for i in 0..=4 {
                let z = f64::from(lift(i, j) as f32);
                pos.push([i as f64 / 2.0 - 1.0, j as f64 / 2.0 - 1.0, z]);
            }
        }
        let at = |i: u32, j: u32| j * 5 + i;
        let mut idx = Vec::new();
        for j in 0..4 {
            for i in 0..4 {
                idx.extend([at(i, j), at(i + 1, j), at(i + 1, j + 1)]);
                idx.extend([at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
            }
        }
        (pos, idx)
    }

    #[test]
    fn deviation_bulge_measures_both_ways() {
        let (flat, idx) = plate(|_, _| 0.0);
        let (bulged, _) = plate(|i, j| if (i, j) == (1, 1) { 0.1 } else { 0.0 });
        let peak = 6u32;
        let around: Vec<usize> = (0..idx.len() / 3)
            .filter(|t| idx[3 * t..3 * t + 3].contains(&peak))
            .collect();

        let d = measure(&bulged, &idx, &flat, &idx, false);
        assert!((d.largest_m - 0.1).abs() < 1e-6, "largest {}", d.largest_m);
        assert!(d.mean_m > 0.0 && d.mean_m <= d.largest_m);
        let worst = (0..d.faces.len())
            .max_by(|&a, &b| d.faces[a].total_cmp(&d.faces[b]).then(b.cmp(&a)))
            .unwrap();
        assert!(
            around.contains(&worst),
            "worst face {worst}, around {around:?}"
        );
        assert!((d.per_vertex[peak as usize] - 0.1).abs() < 1e-6);

        // The planted one-way measure, the reference to the item alone, falls short.
        let one = measure(&bulged, &idx, &flat, &idx, true);
        assert!(one.largest_m < 0.0996, "one way {}", one.largest_m);

        // Identical surfaces are 0 apart.
        let same = measure(&flat, &idx, &flat, &idx, false);
        assert!(same.largest_m < 1e-12, "same {}", same.largest_m);
    }

    #[test]
    fn deviation_point_to_triangle_regions() {
        let t = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        assert_eq!(dist2([0.25, 0.25, 2.0], t), 4.0);
        assert_eq!(dist2([-1.0, -1.0, 0.0], t), 2.0);
        assert_eq!(dist2([2.0, 0.0, 0.0], t), 1.0);
        assert!((dist2([1.0, 1.0, 0.0], t) - 0.5).abs() < 1e-15);
    }
}
