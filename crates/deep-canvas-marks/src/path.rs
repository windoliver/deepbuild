//! Paths (canvas primitives: Path `path@1`): the SVG `d` string read into verbs and points,
//! flattened at 0.1 device px for its zoom bucket (2× steps), and tessellated into triangles, a
//! stroke's with miter joins (bevelled past the miter limit) and butt caps, a fill's by ear
//! clipping each closed sub-path. The tessellation depends only on the geometry and the bucket, so
//! moving, recoloring or zooming within a bucket reuses it.

use deep_canvas::ops;

/// A path verb with its points, absolute, in u.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Verb {
    Move([f64; 2]),
    Line([f64; 2]),
    Quad([f64; 2], [f64; 2]),
    Cubic([f64; 2], [f64; 2], [f64; 2]),
    Close,
}

/// Reads an SVG path string's M, L, H, V, Q, C and Z commands, absolute and relative.
pub fn parse(d: &str) -> Option<Vec<Verb>> {
    let mut tokens = Tokens {
        s: d.as_bytes(),
        at: 0,
    };
    let mut verbs = Vec::new();
    let mut cur = [0.0, 0.0];
    let mut start = [0.0, 0.0];
    let mut command = None;
    while let Some(next) = tokens.peek() {
        let c = if next.is_ascii_alphabetic() {
            tokens.at += 1;
            next
        } else {
            // A number repeats the last command; after a move it repeats as a line.
            match command? {
                b'M' => b'L',
                b'm' => b'l',
                c => c,
            }
        };
        let rel = c.is_ascii_lowercase();
        let base = if rel { cur } else { [0.0, 0.0] };
        let point = |tokens: &mut Tokens<'_>| -> Option<[f64; 2]> {
            let x = tokens.number()?;
            let y = tokens.number()?;
            Some([base[0] + x, base[1] + y])
        };
        match c.to_ascii_uppercase() {
            b'M' => {
                cur = point(&mut tokens)?;
                start = cur;
                verbs.push(Verb::Move(cur));
            }
            b'L' => {
                cur = point(&mut tokens)?;
                verbs.push(Verb::Line(cur));
            }
            b'H' => {
                let x = tokens.number()?;
                cur = [if rel { cur[0] + x } else { x }, cur[1]];
                verbs.push(Verb::Line(cur));
            }
            b'V' => {
                let y = tokens.number()?;
                cur = [cur[0], if rel { cur[1] + y } else { y }];
                verbs.push(Verb::Line(cur));
            }
            b'Q' => {
                let p1 = point(&mut tokens)?;
                cur = point(&mut tokens)?;
                verbs.push(Verb::Quad(p1, cur));
            }
            b'C' => {
                let p1 = point(&mut tokens)?;
                let p2 = point(&mut tokens)?;
                cur = point(&mut tokens)?;
                verbs.push(Verb::Cubic(p1, p2, cur));
            }
            b'Z' => {
                cur = start;
                verbs.push(Verb::Close);
            }
            _ => return None,
        }
        command = Some(c);
        if verbs.first().is_some_and(|v| !matches!(v, Verb::Move(_))) {
            return None;
        }
    }
    let finite = |p: &[f64; 2]| p[0].is_finite() && p[1].is_finite();
    let all_finite = verbs.iter().all(|v| match v {
        Verb::Move(p) | Verb::Line(p) => finite(p),
        Verb::Quad(a, b) => finite(a) && finite(b),
        Verb::Cubic(a, b, c) => finite(a) && finite(b) && finite(c),
        Verb::Close => true,
    });
    (all_finite && !verbs.is_empty()).then_some(verbs)
}

struct Tokens<'a> {
    s: &'a [u8],
    at: usize,
}

impl Tokens<'_> {
    fn skip(&mut self) {
        while self
            .s
            .get(self.at)
            .is_some_and(|c| c.is_ascii_whitespace() || *c == b',')
        {
            self.at += 1;
        }
    }

    fn peek(&mut self) -> Option<u8> {
        self.skip();
        self.s.get(self.at).copied()
    }

    fn number(&mut self) -> Option<f64> {
        self.skip();
        let start = self.at;
        let mut seen_dot = false;
        let mut seen_e = false;
        while let Some(&c) = self.s.get(self.at) {
            let sign_ok = self.at == start || matches!(self.s[self.at - 1], b'e' | b'E');
            match c {
                b'0'..=b'9' => {}
                b'+' | b'-' if sign_ok => {}
                b'.' if !seen_dot && !seen_e => seen_dot = true,
                b'e' | b'E' if !seen_e && self.at > start => seen_e = true,
                _ => break,
            }
            self.at += 1;
        }
        std::str::from_utf8(&self.s[start..self.at])
            .ok()?
            .parse::<f64>()
            .ok()
    }
}

/// The zoom bucket a zoom falls in: ⌊log2 zoom⌋, so buckets step by 2×.
pub fn bucket(zoom: f64) -> i32 {
    let mut b = 0;
    while ops::powi(2.0, b + 1) <= zoom {
        b += 1;
    }
    while b > -16 && ops::powi(2.0, b) > zoom {
        b -= 1;
    }
    b
}

/// The flattening tolerance in u for a bucket: 0.1 device px at the bucket's scale.
pub fn tolerance(bucket: i32) -> f64 {
    0.1 / ops::powi(2.0, bucket)
}

fn lerp(a: [f64; 2], b: [f64; 2], s: f64) -> [f64; 2] {
    [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]
}

fn len(v: [f64; 2]) -> f64 {
    ops::hypot(v[0], v[1])
}

fn steps(deviation: f64, tol: f64) -> u32 {
    let n = ops::sqrt(deviation / tol).ceil();
    if n.is_finite() {
        n.clamp(1.0, 1_000.0) as u32
    } else {
        1
    }
}

/// One flattened sub-path: its points and whether it closes.
#[derive(Clone, Debug, PartialEq)]
pub struct Polyline {
    pub points: Vec<[f64; 2]>,
    pub closed: bool,
}

/// Flattens the verbs into polylines within `tol` of the curves.
pub fn flatten(verbs: &[Verb], tol: f64) -> Vec<Polyline> {
    let mut lines: Vec<Polyline> = Vec::new();
    let mut cur = [0.0, 0.0];
    let push = |lines: &mut Vec<Polyline>, p: [f64; 2]| {
        if let Some(line) = lines.last_mut() {
            if line.points.last() != Some(&p) {
                line.points.push(p);
            }
        }
    };
    for verb in verbs {
        match *verb {
            Verb::Move(p) => {
                lines.push(Polyline {
                    points: vec![p],
                    closed: false,
                });
                cur = p;
            }
            Verb::Line(p) => {
                push(&mut lines, p);
                cur = p;
            }
            Verb::Quad(p1, p2) => {
                let dd = [cur[0] - 2.0 * p1[0] + p2[0], cur[1] - 2.0 * p1[1] + p2[1]];
                let n = steps(0.25 * len(dd), tol);
                for k in 1..=n {
                    let s = f64::from(k) / f64::from(n);
                    push(&mut lines, lerp(lerp(cur, p1, s), lerp(p1, p2, s), s));
                }
                cur = p2;
            }
            Verb::Cubic(p1, p2, p3) => {
                let d1 = [cur[0] - 2.0 * p1[0] + p2[0], cur[1] - 2.0 * p1[1] + p2[1]];
                let d2 = [p1[0] - 2.0 * p2[0] + p3[0], p1[1] - 2.0 * p2[1] + p3[1]];
                let n = steps(0.75 * len(d1).max(len(d2)), tol);
                for k in 1..=n {
                    let s = f64::from(k) / f64::from(n);
                    let a = lerp(cur, p1, s);
                    let b = lerp(p1, p2, s);
                    let c = lerp(p2, p3, s);
                    push(&mut lines, lerp(lerp(a, b, s), lerp(b, c, s), s));
                }
                cur = p3;
            }
            Verb::Close => {
                if let Some(line) = lines.last_mut() {
                    line.closed = true;
                    if line.points.len() > 1 && line.points.first() == line.points.last() {
                        line.points.pop();
                    }
                    cur = line.points[0];
                }
                // A command after Z starts at the sub-path's start.
                lines.push(Polyline {
                    points: vec![cur],
                    closed: false,
                });
            }
        }
    }
    lines.retain(|l| l.points.len() > 1);
    lines
}

/// Triangles in u: vertices as f32 pairs and indices into them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Mesh {
    pub vertices: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
}

impl Mesh {
    fn vertex(&mut self, p: [f64; 2]) -> u32 {
        self.vertices.push([p[0] as f32, p[1] as f32]);
        (self.vertices.len() - 1) as u32
    }

    fn triangle(&mut self, a: [f64; 2], b: [f64; 2], c: [f64; 2]) {
        let (a, b, c) = (self.vertex(a), self.vertex(b), self.vertex(c));
        self.indices.extend([a, b, c]);
    }

    /// The bytes the cache serves: every vertex's x and y as little-endian f32, then every index
    /// as little-endian u32.
    pub fn bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.vertices.len() * 8 + self.indices.len() * 4);
        for v in &self.vertices {
            out.extend(v[0].to_le_bytes());
            out.extend(v[1].to_le_bytes());
        }
        for i in &self.indices {
            out.extend(i.to_le_bytes());
        }
        out
    }

    /// Each triangle's three corners, in u.
    pub fn triangles(&self) -> impl Iterator<Item = [[f32; 2]; 3]> + '_ {
        self.indices.as_chunks::<3>().0.iter().map(|t| {
            [
                self.vertices[t[0] as usize],
                self.vertices[t[1] as usize],
                self.vertices[t[2] as usize],
            ]
        })
    }
}

/// The stroke paint's default miter limit (Paint: `miter_limit: f32 = 4`).
const MITER_LIMIT: f64 = 4.0;

/// Tessellates a centered stroke of `width` u along each polyline.
pub fn stroke(lines: &[Polyline], width: f64, mesh: &mut Mesh) {
    let hw = 0.5 * width;
    for line in lines {
        let pts = &line.points;
        let n = pts.len();
        let segments = if line.closed { n } else { n - 1 };
        let normal = |i: usize| -> [f64; 2] {
            let a = pts[i % n];
            let b = pts[(i + 1) % n];
            let d = [b[0] - a[0], b[1] - a[1]];
            let l = len(d);
            [-d[1] / l * hw, d[0] / l * hw]
        };
        for i in 0..segments {
            let (a, b) = (pts[i % n], pts[(i + 1) % n]);
            let m = normal(i);
            let (a0, a1) = ([a[0] + m[0], a[1] + m[1]], [a[0] - m[0], a[1] - m[1]]);
            let (b0, b1) = ([b[0] + m[0], b[1] + m[1]], [b[0] - m[0], b[1] - m[1]]);
            mesh.triangle(a0, b0, b1);
            mesh.triangle(a0, b1, a1);
        }
        // Joins at every interior point, and at the start of a closed line.
        let joins = if line.closed { 0..n } else { 1..n - 1 };
        for j in joins {
            let prev = normal((j + n - 1) % n);
            let next = normal(j);
            let p = pts[j];
            let cross = prev[0] * next[1] - prev[1] * next[0];
            if cross == 0.0 {
                continue;
            }
            // The outer side of the turn.
            let s = if cross > 0.0 { -1.0 } else { 1.0 };
            let o1 = [p[0] + s * prev[0], p[1] + s * prev[1]];
            let o2 = [p[0] + s * next[0], p[1] + s * next[1]];
            let bis = [prev[0] + next[0], prev[1] + next[1]];
            let bl = len(bis);
            let cos_half = bl / (2.0 * hw);
            if bl > 0.0 && 1.0 / cos_half <= MITER_LIMIT {
                let reach = hw / cos_half;
                let miter = [
                    p[0] + s * bis[0] / bl * reach,
                    p[1] + s * bis[1] / bl * reach,
                ];
                mesh.triangle(p, o1, miter);
                mesh.triangle(p, miter, o2);
            } else {
                mesh.triangle(p, o1, o2);
            }
        }
    }
}

fn area2(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/// Fills each polyline as a closed simple polygon, by ear clipping.
pub fn fill(lines: &[Polyline], mesh: &mut Mesh) {
    for line in lines {
        let pts = &line.points;
        if pts.len() < 3 {
            continue;
        }
        let signed: f64 = (0..pts.len())
            .map(|i| area2([0.0, 0.0], pts[i], pts[(i + 1) % pts.len()]))
            .sum();
        let mut ring: Vec<usize> = (0..pts.len()).collect();
        if signed < 0.0 {
            ring.reverse();
        }
        let mut guard = 0;
        while ring.len() > 3 && guard < pts.len() * pts.len() {
            guard += 1;
            let m = ring.len();
            let ear = (0..m).find(|&i| {
                let (a, b, c) = (
                    pts[ring[(i + m - 1) % m]],
                    pts[ring[i]],
                    pts[ring[(i + 1) % m]],
                );
                area2(a, b, c) > 0.0
                    && ring.iter().all(|&k| {
                        let p = pts[k];
                        p == a
                            || p == b
                            || p == c
                            || !(area2(a, b, p) >= 0.0
                                && area2(b, c, p) >= 0.0
                                && area2(c, a, p) >= 0.0)
                    })
            });
            let Some(i) = ear else { break };
            mesh.triangle(
                pts[ring[(i + m - 1) % m]],
                pts[ring[i]],
                pts[ring[(i + 1) % m]],
            );
            ring.remove(i);
        }
        if ring.len() == 3 {
            mesh.triangle(pts[ring[0]], pts[ring[1]], pts[ring[2]]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_reads_absolute_and_relative_commands() {
        let v = parse("M 1 2 l 3 4 H 10 v -2 Z").unwrap();
        assert_eq!(
            v,
            vec![
                Verb::Move([1.0, 2.0]),
                Verb::Line([4.0, 6.0]),
                Verb::Line([10.0, 6.0]),
                Verb::Line([10.0, 4.0]),
                Verb::Close
            ]
        );
        assert!(parse("L 1 2").is_none());
        assert!(parse("M 1").is_none());
    }

    #[test]
    fn a_finer_bucket_flattens_a_curve_into_more_points() {
        let v = parse("M 0 0 C 50 -40 100 40 150 0").unwrap();
        let coarse = flatten(&v, tolerance(bucket(1.0)));
        let fine = flatten(&v, tolerance(bucket(2.5)));
        assert_eq!(bucket(2.5), 1);
        assert_eq!(bucket(1.9), 0);
        assert!(fine[0].points.len() > coarse[0].points.len());
    }

    #[test]
    fn a_filled_triangle_is_one_triangle_and_a_square_two() {
        let mut mesh = Mesh::default();
        fill(
            &flatten(&parse("M 0 0 L 10 0 L 0 10 Z").unwrap(), 0.1),
            &mut mesh,
        );
        assert_eq!(mesh.indices.len(), 3);
        let mut mesh = Mesh::default();
        fill(
            &flatten(&parse("M 0 0 L 10 0 L 10 10 L 0 10 Z").unwrap(), 0.1),
            &mut mesh,
        );
        assert_eq!(mesh.indices.len(), 6);
    }
}
