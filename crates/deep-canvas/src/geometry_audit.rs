//! Issue #405: the core's `geometry.audit` check kind on a figure (canvas primitives: Geometry
//! audit) and the search a control sweep runs between its samples (Control sweep). It reads true
//! shapes placed in world metres, never pixels: nothing passes into anything past `sunk`, every
//! part is held, and every wire and tube end lands within `land`. All math is f64 on the CPU.

use std::collections::BTreeSet;

use crate::ops::sqrt;

pub type V3 = [f64; 3];

/// One piece of a part's true shape, placed in the world.
#[derive(Clone, Debug, PartialEq)]
pub enum Shape {
    /// An oriented box: its centre, its three unit axes and its half extents along them.
    Obb { c: V3, axes: [V3; 3], half: V3 },
    Ball { c: V3, r: f64 },
    /// A segment swept by a ball: a wire, a tube or a rod.
    Capsule { a: V3, b: V3, r: f64 },
}

/// A part: its ID, its true shape, the ends a wire or tube must land, and whether motion (a
/// driver, a channel or an assembly's value) places it, which holds it.
#[derive(Clone, Debug, PartialEq)]
pub struct Solid {
    pub id: String,
    pub shapes: Vec<Shape>,
    pub ends: Vec<V3>,
    pub moved: bool,
}

/// What the audit allows (Geometry audit: Fields): the tolerances, the items declared floating,
/// and the contacts relations allow, as unordered pairs.
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub sunk: f64,
    pub touch: f64,
    pub land: f64,
    pub floating: BTreeSet<String>,
    pub relations: BTreeSet<(String, String)>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            sunk: 0.002,
            touch: 0.005,
            land: 0.005,
            floating: BTreeSet::new(),
            relations: BTreeSet::new(),
        }
    }
}

impl Config {
    fn related(&self, a: &str, b: &str) -> bool {
        let key = if a <= b { (a.to_string(), b.to_string()) } else { (b.to_string(), a.to_string()) };
        self.relations.contains(&key)
    }
}

/// One failure: its code, the part IDs, how deep or how far, and a fix.
#[derive(Clone, Debug, PartialEq)]
pub struct Fault {
    pub code: &'static str,
    pub ids: Vec<String>,
    pub by: f64,
    pub fix: String,
}

/// Two parts pass into each other past `sunk`.
pub const OVERLAP: &str = "geometry.overlap";
/// A part nothing holds that isn't declared floating.
pub const FLOATING: &str = "geometry.floating";
/// A wire's or tube's end lands on no part.
pub const UNLANDED: &str = "geometry.unlanded";

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn len(a: V3) -> f64 {
    sqrt(dot(a, a))
}
fn lerp(a: V3, b: V3, t: f64) -> V3 {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

impl Shape {
    /// Its world bounds.
    pub fn aabb(&self) -> [V3; 2] {
        match self {
            Shape::Obb { c, axes, half } => {
                let mut e = [0.0; 3];
                for (k, ek) in e.iter_mut().enumerate() {
                    *ek = (0..3).map(|j| (axes[j][k] * half[j]).abs()).sum();
                }
                [sub(*c, e), [c[0] + e[0], c[1] + e[1], c[2] + e[2]]]
            }
            Shape::Ball { c, r } => [sub(*c, [*r; 3]), [c[0] + r, c[1] + r, c[2] + r]],
            Shape::Capsule { a, b, r } => {
                let lo = [a[0].min(b[0]) - r, a[1].min(b[1]) - r, a[2].min(b[2]) - r];
                let hi = [a[0].max(b[0]) + r, a[1].max(b[1]) + r, a[2].max(b[2]) + r];
                [lo, hi]
            }
        }
    }
}

/// The signed distance from `p` to an oriented box: negative inside.
fn box_sdf(p: V3, c: V3, axes: &[V3; 3], half: V3) -> f64 {
    let q = sub(p, c);
    let d: Vec<f64> = (0..3).map(|k| dot(q, axes[k]).abs() - half[k]).collect();
    let out = sqrt(d.iter().map(|x| x.max(0.0) * x.max(0.0)).sum());
    let inside = d[0].max(d[1]).max(d[2]).min(0.0);
    out + inside
}

/// The distance from `p` to the segment `ab`.
fn seg_point(a: V3, b: V3, p: V3) -> f64 {
    let ab = sub(b, a);
    let l = dot(ab, ab);
    let t = if l > 0.0 { (dot(sub(p, a), ab) / l).clamp(0.0, 1.0) } else { 0.0 };
    len(sub(p, lerp(a, b, t)))
}

/// The distance between two segments (Ericson, Real-Time Collision Detection 5.1.9).
fn seg_seg(p1: V3, q1: V3, p2: V3, q2: V3) -> f64 {
    let (d1, d2, r) = (sub(q1, p1), sub(q2, p2), sub(p1, p2));
    let (a, e, f) = (dot(d1, d1), dot(d2, d2), dot(d2, r));
    let (s, t);
    if a <= 1e-18 && e <= 1e-18 {
        return len(r);
    }
    if a <= 1e-18 {
        s = 0.0;
        t = (f / e).clamp(0.0, 1.0);
    } else {
        let c = dot(d1, r);
        if e <= 1e-18 {
            t = 0.0;
            s = (-c / a).clamp(0.0, 1.0);
        } else {
            let b = dot(d1, d2);
            let den = a * e - b * b;
            let s0 = if den > 0.0 { ((b * f - c * e) / den).clamp(0.0, 1.0) } else { 0.0 };
            let t0 = (b * s0 + f) / e;
            if t0 < 0.0 {
                t = 0.0;
                s = (-c / a).clamp(0.0, 1.0);
            } else if t0 > 1.0 {
                t = 1.0;
                s = ((b - c) / a).clamp(0.0, 1.0);
            } else {
                t = t0;
                s = s0;
            }
        }
    }
    len(sub(lerp(p1, q1, s), lerp(p2, q2, t)))
}

/// The least signed distance from the segment `ab` to a box: convex along the segment, so a
/// golden-section search finds it.
fn seg_box(a: V3, b: V3, c: V3, axes: &[V3; 3], half: V3) -> f64 {
    let f = |t: f64| box_sdf(lerp(a, b, t), c, axes, half);
    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    for _ in 0..80 {
        let m1 = lo + (hi - lo) * 0.381_966_011_250_105;
        let m2 = hi - (hi - lo) * 0.381_966_011_250_105;
        if f(m1) <= f(m2) {
            hi = m2;
        } else {
            lo = m1;
        }
    }
    f(0.0).min(f(1.0)).min(f((lo + hi) / 2.0))
}

/// How far `x` passes into `y`: positive is the depth, negative the gap. For two boxes it is the
/// least overlap over the separating axes, whose negative bounds the gap from below.
pub fn depth(x: &Shape, y: &Shape) -> f64 {
    use Shape::*;
    match (x, y) {
        (Ball { c: a, r: ra }, Ball { c: b, r: rb }) => ra + rb - len(sub(*a, *b)),
        (Ball { c: p, r }, Obb { c, axes, half }) | (Obb { c, axes, half }, Ball { c: p, r }) => {
            r - box_sdf(*p, *c, axes, *half)
        }
        (Capsule { a, b, r: ra }, Ball { c, r: rb }) | (Ball { c, r: rb }, Capsule { a, b, r: ra }) => {
            ra + rb - seg_point(*a, *b, *c)
        }
        (Capsule { a: a1, b: b1, r: r1 }, Capsule { a: a2, b: b2, r: r2 }) => r1 + r2 - seg_seg(*a1, *b1, *a2, *b2),
        (Capsule { a, b, r }, Obb { c, axes, half }) | (Obb { c, axes, half }, Capsule { a, b, r }) => {
            r - seg_box(*a, *b, *c, axes, *half)
        }
        (Obb { c: ca, axes: aa, half: ha }, Obb { c: cb, axes: ab, half: hb }) => {
            let d = sub(*cb, *ca);
            let mut axes: Vec<V3> = aa.iter().chain(ab.iter()).copied().collect();
            for u in aa {
                for v in ab {
                    let w = cross(*u, *v);
                    let l = len(w);
                    if l > 1e-9 {
                        axes.push([w[0] / l, w[1] / l, w[2] / l]);
                    }
                }
            }
            axes.iter()
                .map(|l| {
                    let ra: f64 = (0..3).map(|k| (dot(aa[k], *l) * ha[k]).abs()).sum();
                    let rb: f64 = (0..3).map(|k| (dot(ab[k], *l) * hb[k]).abs()).sum();
                    ra + rb - dot(d, *l).abs()
                })
                .fold(f64::INFINITY, f64::min)
        }
    }
}

/// How far part `a` passes into part `b`: the deepest of their pieces' pairs.
pub fn pair_depth(a: &Solid, b: &Solid) -> f64 {
    a.shapes
        .iter()
        .flat_map(|x| b.shapes.iter().map(move |y| depth(x, y)))
        .fold(f64::NEG_INFINITY, f64::max)
}

/// A part's world bounds.
pub fn bounds(s: &Solid) -> [V3; 2] {
    let mut out = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
    for sh in &s.shapes {
        let [lo, hi] = sh.aabb();
        for k in 0..3 {
            out[0][k] = out[0][k].min(lo[k]);
            out[1][k] = out[1][k].max(hi[k]);
        }
    }
    for e in &s.ends {
        for k in 0..3 {
            out[0][k] = out[0][k].min(e[k]);
            out[1][k] = out[1][k].max(e[k]);
        }
    }
    out
}

/// Every pair of parts whose bounds, grown by `margin`, meet: sorted on x and swept, so
/// O(n log n + pairs) (the broad phase).
pub fn near_pairs(solids: &[Solid], margin: f64) -> Vec<(usize, usize)> {
    let b: Vec<[V3; 2]> = solids.iter().map(bounds).collect();
    let mut order: Vec<usize> = (0..solids.len()).filter(|&i| b[i][0][0].is_finite()).collect();
    order.sort_by(|&i, &j| b[i][0][0].total_cmp(&b[j][0][0]).then(i.cmp(&j)));
    let mut out = Vec::new();
    for (k, &i) in order.iter().enumerate() {
        for &j in &order[k + 1..] {
            if b[j][0][0] > b[i][1][0] + margin {
                break;
            }
            if (1..3).all(|a| b[j][0][a] <= b[i][1][a] + margin && b[i][0][a] <= b[j][1][a] + margin) {
                out.push((i.min(j), i.max(j)));
            }
        }
    }
    out.sort_unstable();
    out
}

/// Whether end `e` lands on part `s`: within `land` of its surface or inside it.
fn lands(e: V3, s: &Solid, land: f64) -> bool {
    let p = Shape::Ball { c: e, r: 0.0 };
    s.shapes.iter().any(|sh| depth(&p, sh) >= -land)
}

/// The audit of one state: each fault names its part IDs in document order (Geometry audit).
pub fn audit(solids: &[Solid], cfg: &Config) -> Vec<Fault> {
    let n = solids.len();
    let margin = cfg.touch.max(cfg.land).max(0.0);
    let pairs = near_pairs(solids, margin);
    let mut out = Vec::new();
    // Each end of a wire or tube lands on some other part; the part it lands on may hold it.
    let mut landed_on: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut end_ok: Vec<Vec<bool>> = solids.iter().map(|s| vec![false; s.ends.len()]).collect();
    for &(i, j) in &pairs {
        for (w, o) in [(i, j), (j, i)] {
            for (k, e) in solids[w].ends.iter().enumerate() {
                if lands(*e, &solids[o], cfg.land) {
                    end_ok[w][k] = true;
                    landed_on.insert((i, j));
                }
            }
        }
    }
    let mut contact: Vec<Vec<usize>> = vec![Vec::new(); n];
    for &(i, j) in &pairs {
        let (a, b) = (&solids[i], &solids[j]);
        let d = pair_depth(a, b);
        let allowed = cfg.related(&a.id, &b.id) || landed_on.contains(&(i, j));
        if d > cfg.sunk && !allowed {
            out.push(Fault {
                code: OVERLAP,
                ids: vec![a.id.clone(), b.id.clone()],
                by: d,
                fix: format!("move {} or {} apart by {:.4} m", a.id, b.id, d),
            });
        }
        if d >= -cfg.touch || allowed {
            contact[i].push(j);
            contact[j].push(i);
        }
    }
    for (i, s) in solids.iter().enumerate() {
        for (k, e) in s.ends.iter().enumerate() {
            if !end_ok[i][k] {
                out.push(Fault {
                    code: UNLANDED,
                    ids: vec![s.id.clone()],
                    by: k as f64,
                    fix: format!("end {}'s end {k} at ({:.4}, {:.4}, {:.4}) m on a part", s.id, e[0], e[1], e[2]),
                });
            }
        }
    }
    // Held: joined by contacts or relations to a part motion places or to one declared floating
    // (Geometry audit: scenes: every item rests on something unless declared floating).
    let mut held = vec![false; n];
    let mut stack: Vec<usize> = (0..n)
        .filter(|&i| solids[i].moved || cfg.floating.contains(&solids[i].id))
        .collect();
    for &i in &stack {
        held[i] = true;
    }
    for (i, a) in solids.iter().enumerate().filter(|_| !cfg.relations.is_empty()) {
        for (j, b) in solids.iter().enumerate().skip(i + 1) {
            if cfg.related(&a.id, &b.id) && !contact[i].contains(&j) {
                contact[i].push(j);
                contact[j].push(i);
            }
        }
    }
    while let Some(i) = stack.pop() {
        for &j in &contact[i] {
            if !held[j] {
                held[j] = true;
                stack.push(j);
            }
        }
    }
    for (i, s) in solids.iter().enumerate() {
        if !held[i] {
            out.push(Fault {
                code: FLOATING,
                ids: vec![s.id.clone()],
                by: 0.0,
                fix: format!("rest {} on a part, relate it to one, or declare it floating", s.id),
            });
        }
    }
    out
}

/// What a sweep found over a control's range: each value where the audit failed with its faults,
/// the values it audited, and the stretches between samples where some part has no bound, each
/// with those parts: there the sweep only sampled, an estimate that never decides a check.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Swept {
    pub failed: Vec<(f64, Vec<Fault>)>,
    pub audited: Vec<f64>,
    pub estimates: Vec<([f64; 2], Vec<String>)>,
}

/// How far each part can move over a stretch of a sweep's values, given the stretch and its
/// start's parts: `None` for a part no interval form bounds.
pub type Reach<'a> = dyn FnMut(f64, f64, &[Solid]) -> Vec<Option<f64>> + 'a;

/// The most stretches a sweep holds and the narrowest it splits, as camera paths settle.
pub const MAX_PIECES: usize = 4096;
pub const MIN_WIDTH: f64 = 1e-9;

/// A control's sweep (Control sweep): the audit at each of `samples`, then, between each two
/// neighbours, a bound on how far each pair of parts can pass into each other: their depth at the
/// stretch's start plus the most any point of either moves over it (`reach`). A pair whose bound
/// exceeds `sunk` splits the stretch, with the audit run at the split, until the bound clears it
/// or the audit fails it; a pair that fails once is found and stops splitting. A part `reach`
/// can't bound makes its samples' stretch an estimate; the other pairs are still bounded. What
/// `MAX_PIECES` or `MIN_WIDTH` leaves open is an estimate too.
pub fn sweep(samples: &[f64], cfg: &Config, state_at: &mut dyn FnMut(f64) -> Vec<Solid>, reach: &mut Reach<'_>) -> Swept {
    let mut out = Swept::default();
    let mut found: BTreeSet<(String, String)> = BTreeSet::new();
    let mut audit_at = |v: f64, out: &mut Swept, found: &mut BTreeSet<(String, String)>| {
        let solids = state_at(v);
        let faults = audit(&solids, cfg);
        for f in faults.iter().filter(|f| f.code == OVERLAP) {
            found.insert((f.ids[0].clone(), f.ids[1].clone()));
        }
        out.audited.push(v);
        if !faults.is_empty() {
            out.failed.push((v, faults));
        }
        solids
    };
    let mut vs: Vec<f64> = samples.to_vec();
    vs.sort_by(f64::total_cmp);
    vs.dedup();
    let states: Vec<Vec<Solid>> = vs.iter().map(|&v| audit_at(v, &mut out, &mut found)).collect();
    // Each piece: its stretch, its start's parts, and the samples' stretch it lies in.
    let mut pieces: Vec<(f64, f64, Vec<Solid>, usize)> = vs
        .windows(2)
        .zip(states)
        .enumerate()
        .map(|(k, (w, s))| (w[0], w[1], s, k))
        .collect();
    pieces.reverse();
    let mut unbounded: Vec<BTreeSet<String>> = vec![BTreeSet::new(); pieces.len()];
    let mut unsettled: Vec<bool> = vec![false; pieces.len()];
    let mut count = pieces.len();
    while let Some((a, b, start, root)) = pieces.pop() {
        let r = reach(a, b, &start);
        for (s, _) in start.iter().zip(&r).filter(|(_, r)| r.is_none()) {
            unbounded[root].insert(s.id.clone());
        }
        let grow = r.iter().flatten().copied().fold(0.0, f64::max) * 2.0;
        let open = near_pairs(&start, grow).into_iter().any(|(i, j)| {
            let (x, y) = (&start[i], &start[j]);
            let (Some(ri), Some(rj)) = (r[i], r[j]) else {
                return false;
            };
            ri + rj > 0.0
                && !cfg.related(&x.id, &y.id)
                && !found.contains(&(x.id.clone(), y.id.clone()))
                && pair_depth(x, y) + ri + rj > cfg.sunk
        });
        if !open {
            continue;
        }
        if b - a < MIN_WIDTH || count >= MAX_PIECES {
            unsettled[root] = true;
            continue;
        }
        let m = a + (b - a) / 2.0;
        let mid = audit_at(m, &mut out, &mut found);
        count += 1;
        pieces.push((m, b, mid, root));
        pieces.push((a, m, start, root));
    }
    for (k, w) in vs.windows(2).enumerate() {
        if !unbounded[k].is_empty() || unsettled[k] {
            out.estimates.push(([w[0], w[1]], unbounded[k].iter().cloned().collect()));
        }
    }
    out.failed.sort_by(|x, y| x.0.total_cmp(&y.0));
    out.audited.sort_by(f64::total_cmp);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::exp;

    const I3: [V3; 3] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];

    fn cube(id: &str, c: V3, half: V3) -> Solid {
        Solid { id: id.into(), shapes: vec![Shape::Obb { c, axes: I3, half }], ends: vec![], moved: false }
    }

    #[test]
    fn a_stack_passes_and_each_fault_names_its_parts() {
        let base = cube("base", [0.0, 0.05, 0.0], [0.5, 0.05, 0.5]);
        let top = cube("top", [0.0, 0.15, 0.0], [0.1, 0.05, 0.1]);
        let cfg = Config { floating: ["base".to_string()].into(), ..Config::default() };
        assert!(audit(&[base.clone(), top.clone()], &cfg).is_empty());
        let sunk = cube("sunk", [0.3, 0.12, 0.0], [0.1, 0.05, 0.1]);
        let loose = cube("loose", [2.0, 1.0, 0.0], [0.1, 0.1, 0.1]);
        let wire = Solid {
            id: "wire".into(),
            shapes: vec![Shape::Capsule { a: [0.0, 0.2, 0.0], b: [0.0, 0.6, 0.0], r: 0.01 }],
            ends: vec![[0.0, 0.2, 0.0], [0.0, 0.6, 0.0]],
            moved: false,
        };
        let f = audit(&[base, top, sunk, loose, wire], &cfg);
        let got: Vec<(&str, Vec<&str>)> = f.iter().map(|f| (f.code, f.ids.iter().map(String::as_str).collect())).collect();
        assert_eq!(
            got,
            vec![
                (OVERLAP, vec!["base", "sunk"]),
                (UNLANDED, vec!["wire"]),
                (FLOATING, vec!["loose"])
            ]
        );
    }

    #[test]
    fn a_lid_that_peaks_between_samples_is_found() {
        // The lid's top at 0.1 m, the shelf 0.03 m above it; lift 0.05·exp(−((s − 0.6)/0.05)²).
        let lift = |s: f64| 0.05 * exp(-((s - 0.6) / 0.05) * ((s - 0.6) / 0.05));
        let state = |s: f64| {
            let mut lid = cube("lid", [0.0, 0.09 + lift(s), 0.0], [0.1, 0.01, 0.1]);
            lid.moved = true;
            vec![lid, cube("shelf", [0.0, 0.14, 0.0], [0.3, 0.01, 0.3])]
        };
        let samples = [0.0, 0.25, 0.5, 0.75, 1.0];
        assert!(samples.iter().all(|&s| lift(s) < 0.001));
        let cfg = Config { floating: ["shelf".to_string()].into(), ..Config::default() };
        // The lift's interval form over [a, b]: its peak where the stretch holds 0.6.
        let mut reach = |a: f64, b: f64, _: &[Solid]| {
            let hi = if a <= 0.6 && 0.6 <= b { 0.05 } else { lift(a).max(lift(b)) };
            let lo = lift(a).min(lift(b));
            vec![Some(hi - lo), Some(0.0)]
        };
        let swept = sweep(&samples, &cfg, &mut |s| state(s), &mut reach);
        let (s, faults) = &swept.failed[0];
        assert!((0.56..=0.64).contains(s), "{s}");
        assert_eq!(faults[0].ids, vec!["lid", "shelf"]);
        assert!(swept.estimates.is_empty());
        // A part no form bounds leaves its stretches an estimate.
        let swept = sweep(&samples, &cfg, &mut |s| state(s), &mut |_, _, _| vec![None, Some(0.0)]);
        assert!(swept.failed.is_empty());
        assert_eq!(swept.estimates.len(), 4);
        assert_eq!(swept.estimates[0].1, vec!["lid"]);
    }

    #[test]
    fn a_rotated_box_and_a_capsule_meet_only_when_they_do() {
        let s = sqrt(0.5);
        let turned = Shape::Obb { c: [0.0; 3], axes: [[s, s, 0.0], [-s, s, 0.0], [0.0, 0.0, 1.0]], half: [0.5; 3] };
        let rod = |x: f64| Shape::Capsule { a: [x, -1.0, 0.0], b: [x, 1.0, 0.0], r: 0.05 };
        assert!(depth(&turned, &rod(0.75)) > 0.0);
        assert!(depth(&turned, &rod(0.8)) < 0.0);
    }
}
