//! #1935: geometry.shading's readings of one UV set (Check input: loop kinds): its charts, the
//! triangles flipped against their chart, the share of covered area two or more charts cover,
//! the share of UV area outside the unit square, the fill, the smallest gap between two charts
//! and the texel density's percentiles.

use std::collections::BTreeMap;

use deep_canvas::ops::sqrt;

pub type V2 = [f64; 2];

/// The largest raster side, pixels. A larger `resolution` is BLOCKED, never read coarser.
pub const RASTER_MAX: f64 = 4096.0;

/// A row distance meaning no covered pixel in the row: past any raster's side.
const FAR: u32 = u16::MAX as u32;

/// One triangle of a UV set: its index across the read primitives, its corners' UVs, its
/// corners' welded vertices and its surface area, m².
pub struct Face {
    pub f: usize,
    pub uv: [V2; 3],
    pub v: [u32; 3],
    pub area: f64,
}

/// The input's numbers for a UV set, and whether the planted reading rasterizes each chart as
/// its bounding box.
pub struct Opts {
    pub resolution: f64,
    pub padding: f64,
    pub min_gap_px: Option<f64>,
    pub texel: Option<[f64; 2]>,
    pub boxes: bool,
}

/// What a UV set reads. Charts are numbered in the order of their first face; every list is
/// ascending.
#[derive(Debug, Default)]
pub struct Reading {
    /// Each chart's faces, by index across the read primitives.
    pub charts: Vec<Vec<usize>>,
    pub flipped: Vec<usize>,
    pub overlap: f64,
    pub overlapping: Vec<usize>,
    pub out_of_unit: f64,
    pub outside: Vec<usize>,
    pub fill: f64,
    pub min_gap_px: Option<f64>,
    /// The charts closer than the input's `min_gap_px` to another chart; none without one.
    pub close: Vec<usize>,
    pub texel_p5: Option<f64>,
    pub texel_p95: Option<f64>,
    /// The charts whose own texel density lies outside the input's `texel`, with that density.
    pub off_texel: Vec<(usize, f64)>,
}

fn sub(a: V2, b: V2) -> V2 {
    [a[0] - b[0], a[1] - b[1]]
}

fn cross(a: V2, b: V2) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

/// Twice a triangle's signed area, positive counter-clockwise.
fn area2(t: &[V2; 3]) -> f64 {
    cross(sub(t[1], t[0]), sub(t[2], t[0]))
}

/// A corner as the charts join it: its welded vertex and its UV's bits (−0 read as 0).
type Corner = (u32, u64, u64);

fn corner(f: &Face, k: usize) -> Corner {
    (
        f.v[k],
        (f.uv[k][0] + 0.0).to_bits(),
        (f.uv[k][1] + 0.0).to_bits(),
    )
}

/// Each face's chart: faces that share a corner (one welded vertex at one UV) are one chart.
fn charts(faces: &[Face]) -> Vec<usize> {
    let mut parent: Vec<usize> = (0..faces.len()).collect();
    fn root(p: &mut [usize], mut i: usize) -> usize {
        while p[i] != i {
            p[i] = p[p[i]];
            i = p[i];
        }
        i
    }
    let mut seen: BTreeMap<Corner, usize> = BTreeMap::new();
    for (i, f) in faces.iter().enumerate() {
        for k in 0..3 {
            match seen.get(&corner(f, k)) {
                Some(&j) => {
                    let (a, b) = (root(&mut parent, i), root(&mut parent, j));
                    parent[a.max(b)] = a.min(b);
                }
                None => {
                    seen.insert(corner(f, k), i);
                }
            }
        }
    }
    let mut number: BTreeMap<usize, usize> = BTreeMap::new();
    (0..faces.len())
        .map(|i| {
            let r = root(&mut parent, i);
            let n = number.len();
            *number.entry(r).or_insert(n)
        })
        .collect()
}

/// The faces whose signed UV area opposes their chart's majority, by count, ties to the summed
/// area.
fn flipped(faces: &[Face], chart: &[usize], n: usize) -> Vec<usize> {
    let mut tally = vec![(0usize, 0usize, 0.0f64); n];
    for (f, &c) in faces.iter().zip(chart) {
        let s = area2(&f.uv);
        let t = &mut tally[c];
        if s > 0.0 {
            t.0 += 1;
        } else if s < 0.0 {
            t.1 += 1;
        }
        t.2 += s;
    }
    faces
        .iter()
        .zip(chart)
        .filter(|(f, &c)| {
            let (pos, neg, sum) = tally[c];
            let up = if pos != neg { pos > neg } else { sum >= 0.0 };
            let s = area2(&f.uv);
            (up && s < 0.0) || (!up && s > 0.0)
        })
        .map(|(f, _)| f.f)
        .collect()
}

/// A triangle's area inside the unit square: the triangle clipped against each side in turn.
fn inside_unit(t: &[V2; 3]) -> f64 {
    let mut poly: Vec<V2> = t.to_vec();
    // Each side as (axis, bound, keep below).
    for (axis, bound, below) in [
        (0, 0.0, false),
        (0, 1.0, true),
        (1, 0.0, false),
        (1, 1.0, true),
    ] {
        let keep = |p: V2| {
            if below {
                p[axis] <= bound
            } else {
                p[axis] >= bound
            }
        };
        let mut out = Vec::with_capacity(poly.len() + 2);
        for i in 0..poly.len() {
            let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
            if keep(a) {
                out.push(a);
            }
            if keep(a) != keep(b) {
                let s = (bound - a[axis]) / (b[axis] - a[axis]);
                out.push([a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])]);
            }
        }
        poly = out;
        if poly.is_empty() {
            return 0.0;
        }
    }
    let mut a = 0.0;
    for i in 1..poly.len().saturating_sub(1) {
        a += cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0]));
    }
    a.abs() / 2.0
}

/// The pixels of a raster window `[x0, x1) × [y0, y1)` whose centres a triangle in pixel units
/// covers, either winding, a centre on an edge going to one side of it only.
fn cover(t: [V2; 3], win: [usize; 4], out: &mut Vec<usize>) {
    let [x0, x1, y0, y1] = win;
    let mut t = t;
    let a = area2(&t);
    if a == 0.0 {
        return;
    }
    if a < 0.0 {
        t.swap(1, 2);
    }
    let lo = |k: usize| t.iter().map(|p| p[k]).fold(f64::INFINITY, f64::min);
    let hi = |k: usize| t.iter().map(|p| p[k]).fold(f64::NEG_INFINITY, f64::max);
    let span = |l: f64, h: f64, a: usize, b: usize| {
        let s = (l - 0.5).ceil().max(a as f64) as usize;
        let e = ((h - 0.5).floor() + 1.0).clamp(a as f64, b as f64) as usize;
        s..e.max(s)
    };
    for y in span(lo(1), hi(1), y0, y1) {
        for x in span(lo(0), hi(0), x0, x1) {
            let c = [x as f64 + 0.5, y as f64 + 0.5];
            let inside = (0..3).all(|k| {
                let (p, q) = (t[k], t[(k + 1) % 3]);
                let d = sub(q, p);
                let e = cross(d, sub(c, p));
                e > 0.0 || (e == 0.0 && (d[1] > 0.0 || (d[1] == 0.0 && d[0] < 0.0)))
            });
            if inside {
                out.push((y - y0) * (x1 - x0) + (x - x0));
            }
        }
    }
}

/// Each pixel of the raster window `win`, how many charts cover its centre; whether each chart
/// shares a pixel with another; and whether each covers none. With `boxes`, the planted
/// reading, each chart's bounding box stands for its triangles.
fn coverage(
    px: &[[V2; 3]],
    members: &[Vec<usize>],
    win: [usize; 4],
    boxes: bool,
) -> (Vec<u8>, Vec<bool>, Vec<bool>) {
    let (w, h) = (win[1].saturating_sub(win[0]), win[3].saturating_sub(win[2]));
    let mut count = vec![0u8; w * h];
    // The last chart, plus one, that counted each pixel: a chart counts a pixel once.
    let mut stamp = vec![0u32; w * h];
    let mut over = vec![false; members.len()];
    let mut bare = vec![false; members.len()];
    let mut cells = Vec::new();
    for (c, fs) in members.iter().enumerate() {
        cells.clear();
        if boxes {
            let (mut l, mut u) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
            for p in fs.iter().flat_map(|&i| px[i]) {
                for k in 0..2 {
                    l[k] = l[k].min(p[k]);
                    u[k] = u[k].max(p[k]);
                }
            }
            cover([l, [u[0], l[1]], u], win, &mut cells);
            cover([l, u, [l[0], u[1]]], win, &mut cells);
        } else {
            for &i in fs {
                cover(px[i], win, &mut cells);
            }
        }
        bare[c] = cells.is_empty();
        let mark = c as u32 + 1;
        for &p in &cells {
            if stamp[p] == mark {
                continue;
            }
            if count[p] == 1 {
                over[(stamp[p] - 1) as usize] = true;
            }
            if count[p] > 0 {
                over[c] = true;
            }
            stamp[p] = mark;
            count[p] = count[p].saturating_add(1);
        }
    }
    (count, over, bare)
}

/// The pairs `(c, d)` where chart `c` covers no pixel centre and its first corner lies in a
/// triangle of chart `d`: two charts at gap 0 that neither the raster nor their edges show.
/// Triangles are found through a grid of 16 px cells.
fn inside_other(
    px: &[[V2; 3]],
    chart: &[usize],
    members: &[Vec<usize>],
    bare: &[bool],
    side: f64,
) -> Vec<(usize, usize)> {
    const CELL: f64 = 16.0;
    let g = (side / CELL).ceil().max(1.0) as usize;
    let at = |v: f64| ((v / CELL).floor().max(0.0) as usize).min(g - 1);
    let mut grid: Vec<Vec<usize>> = vec![Vec::new(); g * g];
    for (i, t) in px.iter().enumerate() {
        let (lo, hi) = (
            |k: usize| t.iter().map(|p| p[k]).fold(f64::INFINITY, f64::min),
            |k: usize| t.iter().map(|p| p[k]).fold(f64::NEG_INFINITY, f64::max),
        );
        for y in at(lo(1))..=at(hi(1)) {
            for x in at(lo(0))..=at(hi(0)) {
                grid[y * g + x].push(i);
            }
        }
    }
    let mut pairs = Vec::new();
    for c in (0..members.len()).filter(|c| bare[*c]) {
        let q = px[members[c][0]][0];
        let mut hits: Vec<usize> = grid[at(q[1]) * g + at(q[0])]
            .iter()
            .filter(|&&i| chart[i] != c)
            .filter(|&&i| {
                // Inside or on an edge, either winding; a triangle with no area holds nothing.
                let t = px[i];
                let s = [0, 1, 2].map(|k| cross(sub(t[(k + 1) % 3], t[k]), sub(q, t[k])));
                area2(&t) != 0.0 && (s.iter().all(|&e| e >= 0.0) || s.iter().all(|&e| e <= 0.0))
            })
            .map(|&i| chart[i])
            .collect();
        hits.sort_unstable();
        hits.dedup();
        pairs.extend(hits.into_iter().map(|d| (c, d)));
    }
    pairs
}

/// How many of a raster column's pixels lie within `r2` (squared) of a covered pixel's centre,
/// given each row's squared distance `f` to its nearest covered pixel: the lower envelope of
/// the parabolas `f[q] + (y − q)²`, so the cost doesn't grow with the padding.
fn within(f: &[f64], r2: f64, v: &mut Vec<usize>, z: &mut Vec<f64>) -> usize {
    v.clear();
    z.clear();
    for (q, &fq) in f.iter().enumerate() {
        if !fq.is_finite() {
            continue;
        }
        let qf = q as f64;
        // Drop each parabola the new one is under from where it starts; `s` is where the new one
        // starts. The first never drops: it starts at −∞.
        let mut s = f64::NEG_INFINITY;
        while let Some(&p) = v.last() {
            let pf = p as f64;
            s = ((fq + qf * qf) - (f[p] + pf * pf)) / (2.0 * (qf - pf));
            if s > z[z.len() - 1] {
                break;
            }
            v.pop();
            z.pop();
        }
        z.push(s);
        v.push(q);
    }
    let (mut j, mut n) = (0, 0);
    for y in 0..f.len() {
        if v.is_empty() {
            break;
        }
        let yf = y as f64;
        while j + 1 < v.len() && z[j + 1] < yf {
            j += 1;
        }
        let d = yf - v[j] as f64;
        if d * d + f[v[j]] <= r2 {
            n += 1;
        }
    }
    n
}

/// The smallest distance between two segments (0 where they cross or touch).
fn segment_gap(a: [V2; 2], b: [V2; 2]) -> f64 {
    let orient = |p: V2, q: V2, r: V2| cross(sub(q, p), sub(r, p));
    let (d1, d2) = (orient(b[0], b[1], a[0]), orient(b[0], b[1], a[1]));
    let (d3, d4) = (orient(a[0], a[1], b[0]), orient(a[0], a[1], b[1]));
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
    {
        return 0.0;
    }
    let to = |p: V2, s: [V2; 2]| {
        let d = sub(s[1], s[0]);
        let l = d[0] * d[0] + d[1] * d[1];
        let t = if l > 0.0 {
            ((p[0] - s[0][0]) * d[0] + (p[1] - s[0][1]) * d[1]) / l
        } else {
            0.0
        };
        let t = t.clamp(0.0, 1.0);
        let e = sub(p, [s[0][0] + t * d[0], s[0][1] + t * d[1]]);
        sqrt(e[0] * e[0] + e[1] * e[1])
    };
    to(a[0], b)
        .min(to(a[1], b))
        .min(to(b[0], a))
        .min(to(b[1], a))
}

/// A value's percentile `q` over `(value, weight)` rows, by nearest rank on the weights.
fn percentile(rows: &[(f64, f64)], q: f64) -> Option<f64> {
    let total: f64 = rows.iter().map(|r| r.1).sum();
    if total <= 0.0 {
        return None;
    }
    let mut cum = 0.0;
    for r in rows {
        cum += r.1;
        if cum >= q * total * (1.0 - 1e-12) {
            return Some(r.0);
        }
    }
    rows.last().map(|r| r.0)
}

/// Reads one UV set's faces.
pub fn read(faces: &[Face], o: &Opts) -> Reading {
    let chart = charts(faces);
    let n = chart.iter().max().map_or(0, |c| c + 1);
    let mut r = Reading {
        charts: vec![Vec::new(); n],
        flipped: flipped(faces, &chart, n),
        ..Reading::default()
    };
    for (f, &c) in faces.iter().zip(&chart) {
        r.charts[c].push(f.f);
    }

    // Outside the unit square: exact area, from each triangle clipped against it.
    let (mut total, mut outside) = (0.0, 0.0);
    let mut out_by = vec![false; n];
    for (f, &c) in faces.iter().zip(&chart) {
        let a = area2(&f.uv).abs() / 2.0;
        let off = (a - inside_unit(&f.uv)).max(0.0);
        total += a;
        if off > 1e-9 * a {
            outside += off;
            out_by[c] = true;
        }
    }
    r.out_of_unit = if total > 0.0 { outside / total } else { 0.0 };
    r.outside = (0..n).filter(|c| out_by[*c]).collect();

    // The raster: the unit square at the resolution, over the window the set covers widened by
    // the padding. Each pixel counts the charts whose triangles cover its centre. The caller
    // blocks a resolution past RASTER_MAX; the clamp only bounds the memory.
    let side = o.resolution.clamp(1.0, RASTER_MAX).round();
    let pad = o.padding.max(0.0) * side / o.resolution.max(1.0);
    let px: Vec<[V2; 3]> = faces
        .iter()
        .map(|f| f.uv.map(|p| [p[0] * side, p[1] * side]))
        .collect();
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for p in px.iter().flatten() {
        for k in 0..2 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    let grow = pad.ceil() + 1.0;
    let edge = |v: f64| v.clamp(0.0, side) as usize;
    let win = [
        edge((lo[0] - grow).floor()),
        edge((hi[0] + grow).ceil()),
        edge((lo[1] - grow).floor()),
        edge((hi[1] + grow).ceil()),
    ];
    let (w, h) = (win[1].saturating_sub(win[0]), win[3].saturating_sub(win[2]));
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, &c) in chart.iter().enumerate() {
        members[c].push(i);
    }
    let (count, over, bare) = coverage(&px, &members, win, false);
    let multi = count.iter().filter(|&&k| k > 1).count();
    // The planted reading takes `uv_overlap`, and only it, from the charts' bounding boxes.
    let planted = o.boxes.then(|| coverage(&px, &members, win, true));
    let (oc, oo) = planted.as_ref().map_or((&count, &over), |(c, v, _)| (c, v));
    let covered = oc.iter().filter(|&&k| k > 0).count();
    let shared = oc.iter().filter(|&&k| k > 1).count();
    r.overlap = if covered > 0 {
        shared as f64 / covered as f64
    } else {
        0.0
    };
    r.overlapping = (0..n).filter(|c| oo[*c]).collect();

    // The fill: covered pixels dilated by the padding, a pixel filled when a covered pixel's
    // centre lies within it, over the whole square. `near` is each pixel's distance along its
    // row to the nearest covered pixel.
    let mut near = vec![FAR; w * h];
    for y in 0..h {
        let row = &count[y * w..(y + 1) * w];
        let mut last: Option<usize> = None;
        for x in 0..w {
            if row[x] > 0 {
                last = Some(x);
            }
            if let Some(l) = last {
                near[y * w + x] = (x - l) as u32;
            }
        }
        last = None;
        for x in (0..w).rev() {
            if row[x] > 0 {
                last = Some(x);
            }
            if let Some(l) = last {
                near[y * w + x] = near[y * w + x].min((l - x) as u32);
            }
        }
    }
    let mut filled = 0usize;
    let (mut f, mut v, mut z) = (vec![0.0; h], Vec::new(), Vec::new());
    for x in 0..w {
        for (y, fy) in f.iter_mut().enumerate() {
            let d = near[y * w + x];
            *fy = if d == FAR {
                f64::INFINITY
            } else {
                f64::from(d) * f64::from(d)
            };
        }
        filled += within(&f, pad * pad, &mut v, &mut z);
    }
    r.fill = filled as f64 / (side * side);

    // The smallest gap: 0 where two charts share a pixel, else between their boundary edges.
    // With a `min_gap_px` the edges are swept even beside an overlap, so every chart closer
    // than it is named.
    let mut edges: BTreeMap<(Corner, Corner), (usize, usize, [V2; 2])> = BTreeMap::new();
    for (i, f) in faces.iter().enumerate() {
        for k in 0..3 {
            let (a, b) = (corner(f, k), corner(f, (k + 1) % 3));
            let key = if a <= b { (a, b) } else { (b, a) };
            edges
                .entry(key)
                .or_insert((chart[i], 0, [f.uv[k], f.uv[(k + 1) % 3]]))
                .1 += 1;
        }
    }
    let mut segs: Vec<(usize, [V2; 2])> = edges
        .into_values()
        .filter(|e| e.1 == 1)
        .map(|e| (e.0, e.2))
        .collect();
    let x_lo = |s: &[V2; 2]| s[0][0].min(s[1][0]);
    let x_hi = |s: &[V2; 2]| s[0][0].max(s[1][0]);
    segs.sort_by(|a, b| x_lo(&a.1).total_cmp(&x_lo(&b.1)));
    let limit = o.min_gap_px.map(|t| t / o.resolution);
    let mut best: Option<f64> = None;
    let mut close = vec![false; n];
    if multi > 0 {
        best = Some(0.0);
        for c in (0..n).filter(|c| over[*c]) {
            close[c] = limit.is_some();
        }
    }
    // A chart too small to cover a pixel centre may lie inside another, its edges clear of it.
    if bare.iter().any(|b| *b) {
        for (c, d) in inside_other(&px, &chart, &members, &bare, side) {
            best = Some(0.0);
            close[c] = limit.is_some();
            close[d] = limit.is_some();
        }
    }
    if multi == 0 || limit.is_some() {
        for i in 0..segs.len() {
            for j in i + 1..segs.len() {
                let cut = best.unwrap_or(f64::INFINITY).max(limit.unwrap_or(0.0));
                if x_lo(&segs[j].1) > x_hi(&segs[i].1) + cut {
                    break;
                }
                let (ci, cj) = (segs[i].0, segs[j].0);
                if ci == cj {
                    continue;
                }
                let d = segment_gap(segs[i].1, segs[j].1);
                if best.is_none_or(|b| d < b) {
                    best = Some(d);
                }
                if limit.is_some_and(|t| d < t) {
                    close[ci] = true;
                    close[cj] = true;
                }
            }
        }
    }
    r.min_gap_px = best.map(|b| b * o.resolution);
    r.close = (0..n).filter(|c| close[*c]).collect();

    // Texel density, px/m: each face's, weighted by its surface area, and each chart's.
    let mut rows: Vec<(f64, f64)> = faces
        .iter()
        .filter(|f| f.area > 0.0)
        .map(|f| {
            let uv = area2(&f.uv).abs() / 2.0;
            (o.resolution * sqrt(uv / f.area), f.area)
        })
        .collect();
    rows.sort_by(|a, b| a.0.total_cmp(&b.0));
    r.texel_p5 = percentile(&rows, 0.05);
    r.texel_p95 = percentile(&rows, 0.95);
    if let Some([lo, hi]) = o.texel {
        let mut sums = vec![(0.0, 0.0); n];
        for (f, &c) in faces.iter().zip(&chart) {
            sums[c].0 += area2(&f.uv).abs() / 2.0;
            sums[c].1 += f.area;
        }
        r.off_texel = (0..n)
            .filter(|c| sums[*c].1 > 0.0)
            .map(|c| (c, o.resolution * sqrt(sums[c].0 / sums[c].1)))
            .filter(|(_, d)| *d < lo || *d > hi)
            .collect();
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> Opts {
        Opts {
            resolution: 1024.0,
            padding: 4.0,
            min_gap_px: None,
            texel: None,
            boxes: false,
        }
    }

    /// A face of unit surface area at `uv`, its corners the welded vertices `v`.
    fn face(f: usize, uv: [V2; 3], v: [u32; 3]) -> Face {
        Face {
            f,
            uv,
            v,
            area: 1.0,
        }
    }

    #[test]
    fn a_flipped_face_opposes_its_charts_majority_and_a_mirrored_chart_has_none() {
        let faces = [
            // One chart: two triangles counter-clockwise, and one beside them wound back.
            face(0, [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]], [0, 1, 2]),
            face(1, [[0.1, 0.1], [0.3, 0.3], [0.1, 0.3]], [0, 2, 3]),
            face(2, [[0.3, 0.1], [0.3, 0.3], [0.5, 0.1]], [1, 2, 4]),
            // A mirrored chart: every triangle clockwise, so none opposes its majority.
            face(3, [[0.6, 0.6], [0.8, 0.8], [0.8, 0.6]], [10, 12, 11]),
            face(4, [[0.6, 0.6], [0.6, 0.8], [0.8, 0.8]], [10, 13, 12]),
        ];
        let r = read(&faces, &opts());
        assert_eq!(r.charts, [vec![0, 1, 2], vec![3, 4]]);
        assert_eq!(r.flipped, [2]);
    }

    #[test]
    fn out_of_unit_is_the_exact_share_of_uv_area_outside_the_square() {
        let faces = [
            // Area 0.5, of which the square [0.5, 1]², 0.25, lies inside.
            face(0, [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5]], [0, 1, 2]),
            // Area 0.125, all inside.
            face(1, [[0.0, 0.0], [0.4, 0.0], [0.0, 0.625]], [3, 4, 5]),
        ];
        let r = read(&faces, &opts());
        assert!(
            (r.out_of_unit - 0.25 / 0.625).abs() < 1e-12,
            "{}",
            r.out_of_unit
        );
        assert_eq!(r.outside, [0]);
    }

    #[test]
    fn charts_closer_than_min_gap_px_are_named_though_two_others_overlap() {
        let d = 2.0 / 1024.0;
        let faces = [
            // Charts 0 and 1 lie on one another.
            face(0, [[0.1, 0.1], [0.3, 0.1], [0.1, 0.3]], [0, 1, 2]),
            face(1, [[0.1, 0.1], [0.3, 0.1], [0.1, 0.3]], [3, 4, 5]),
            // Charts 2 and 3, far from them, 2 px apart.
            face(2, [[0.6, 0.6], [0.8, 0.6], [0.6, 0.8]], [6, 7, 8]),
            face(3, [[0.8 + d, 0.6], [0.9, 0.6], [0.9, 0.8]], [9, 10, 11]),
        ];
        let r = read(
            &faces,
            &Opts {
                min_gap_px: Some(4.0),
                ..opts()
            },
        );
        assert_eq!(r.min_gap_px, Some(0.0));
        assert_eq!(r.close, [0, 1, 2, 3]);
    }

    #[test]
    fn a_padding_past_the_square_fills_all_of_it() {
        let faces = [face(0, [[0.1, 0.1], [0.3, 0.1], [0.1, 0.3]], [0, 1, 2])];
        let r = read(
            &faces,
            &Opts {
                padding: 1e30,
                ..opts()
            },
        );
        assert_eq!(r.fill, 1.0);
    }

    #[test]
    fn the_planted_bounding_boxes_change_uv_overlap_and_nothing_else() {
        // Two triangles whose bounding boxes overlap and whose areas don't: 0.05 / √2 apart.
        let faces = [
            face(0, [[0.1, 0.1], [0.5, 0.1], [0.1, 0.5]], [0, 1, 2]),
            face(1, [[0.5, 0.5], [0.15, 0.5], [0.5, 0.15]], [3, 4, 5]),
        ];
        let o = Opts {
            min_gap_px: Some(4.0),
            ..opts()
        };
        let shipped = read(&faces, &o);
        let planted = read(&faces, &Opts { boxes: true, ..o });
        assert_eq!(shipped.overlap, 0.0);
        assert!(planted.overlap > 0.0, "{}", planted.overlap);
        assert_eq!(planted.overlapping, [0, 1]);
        assert_eq!(planted.fill, shipped.fill);
        assert_eq!(planted.min_gap_px, shipped.min_gap_px);
        assert_eq!(planted.close, shipped.close);
    }

    #[test]
    fn a_chart_too_small_for_a_pixel_inside_another_is_at_gap_0() {
        let s = 1024.0;
        let faces = [
            // Chart 0: the square [0.1, 0.9]².
            face(0, [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]], [0, 1, 2]),
            face(1, [[0.1, 0.1], [0.9, 0.9], [0.1, 0.9]], [0, 2, 3]),
            // Chart 1: a triangle 0.2 px wide inside it, between pixel centres.
            face(
                2,
                [
                    [500.1 / s, 500.1 / s],
                    [500.3 / s, 500.1 / s],
                    [500.1 / s, 500.3 / s],
                ],
                [4, 5, 6],
            ),
        ];
        let r = read(
            &faces,
            &Opts {
                min_gap_px: Some(4.0),
                ..opts()
            },
        );
        assert_eq!(r.overlap, 0.0);
        assert_eq!(r.min_gap_px, Some(0.0));
        assert_eq!(r.close, [0, 1]);
    }
}
