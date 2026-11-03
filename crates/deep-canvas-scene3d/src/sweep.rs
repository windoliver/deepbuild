//! Builder `extrude`: sweep along a curve (canvas primitives; issue #441): one outline, with its
//! holes, carried along a `curve@1` between two fractions of its arc length. Each ring is the
//! outline set across the curve on curve@1's own frame at u (x on the binormal, y on the
//! normal), turned by twist × u and scaled by `scale` at u. Rings fall at even steps of arc
//! length, and a linear curve adds a mitered one at each point between: it lies in the plane
//! that bisects the corner, stretched across it by 1 ÷ cos(half the turn). A closed curve swept
//! whole welds its seam and takes no caps; an open sweep takes flat caps or none.

use deep_canvas::document::packs::{postfix, ExprStep};
use deep_canvas::ops::{cos, rad, sin};
use serde_json::{json, Value};

use crate::curve::{Curve, Frame};
use crate::geom::{add, dot, scale, sub, triangulate, unit, Mesh, V2, V3};

/// The longest a mitered ring may stretch across its corner.
pub const MAX_MITER: f64 = 4.0;

/// The most rings a sweep takes.
pub const MAX_RINGS: u64 = 4096;

/// Pieces the range is split into when `scale`'s interval form is checked.
const PIECES: usize = 64;

/// The wrong programs #441's criteria plant in the sweep and the curve.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Plants {
    /// Frames from the curvature (Frenet), turned once to match the first ring's, in place of
    /// curve@1's (AC4).
    pub frenet: bool,
    /// Each corner's ring set square to the segment into it, unstretched, not mitered (AC5).
    pub square_corners: bool,
    /// u read as the span's share of the span count, not of arc length (AC6).
    pub u_by_span: bool,
    /// A closed curve's closure left unspread (AC2).
    pub seam_twist: bool,
}

/// `scale`: a number, or an expression over u.
#[derive(Clone, Debug)]
enum Scale {
    Number(f64),
    Expr(Vec<ExprStep>),
}

impl Scale {
    fn at(&self, u: f64) -> f64 {
        match self {
            Scale::Number(x) => *x,
            Scale::Expr(steps) => interval(steps, (u, u)).map_or(f64::NAN, |r| r.0),
        }
    }

    /// The least it can be over `[a, b]`, by its interval form on fixed pieces.
    fn least(&self, a: f64, b: f64) -> Option<f64> {
        match self {
            Scale::Number(x) => Some(*x),
            Scale::Expr(steps) => (0..PIECES)
                .map(|k| {
                    let lo = a + (b - a) * k as f64 / PIECES as f64;
                    let hi = a + (b - a) * (k + 1) as f64 / PIECES as f64;
                    interval(steps, (lo, hi)).map(|r| r.0)
                })
                .try_fold(f64::INFINITY, |m, x| x.map(|x| m.min(x))),
        }
    }
}

type Iv = (f64, f64);

/// The interval an expression over u takes for u in `u`, in postfix order; `None` for a name
/// other than u, a function off the closed list, or a division whose divisor's interval holds 0.
fn interval(steps: &[ExprStep], u: Iv) -> Option<Iv> {
    let mut st: Vec<Iv> = Vec::new();
    for s in steps {
        let v = match s {
            ExprStep::Num(n) => (*n, *n),
            ExprStep::Name(n) if n == "u" => u,
            ExprStep::Name(_) => return None,
            ExprStep::Neg => {
                let a = st.pop()?;
                (-a.1, -a.0)
            }
            ExprStep::Bin(op) => {
                let b = st.pop()?;
                let a = st.pop()?;
                let corners = |f: fn(f64, f64) -> f64| {
                    let c = [f(a.0, b.0), f(a.0, b.1), f(a.1, b.0), f(a.1, b.1)];
                    (
                        c.iter().copied().fold(f64::INFINITY, f64::min),
                        c.iter().copied().fold(f64::NEG_INFINITY, f64::max),
                    )
                };
                match op {
                    '+' => (a.0 + b.0, a.1 + b.1),
                    '-' => (a.0 - b.1, a.1 - b.0),
                    '*' => corners(|x, y| x * y),
                    '/' if b.0 > 0.0 || b.1 < 0.0 => corners(|x, y| x / y),
                    _ => return None,
                }
            }
            ExprStep::Call(name, 1) => {
                let a = st.pop()?;
                match name.as_str() {
                    "abs" if a.0 >= 0.0 => a,
                    "abs" if a.1 <= 0.0 => (-a.1, -a.0),
                    "abs" => (0.0, a.1.max(-a.0)),
                    "floor" => (a.0.floor(), a.1.floor()),
                    "ceil" => (a.0.ceil(), a.1.ceil()),
                    "round" => (a.0.round(), a.1.round()),
                    _ => return None,
                }
            }
            ExprStep::Call(name, 2) => {
                let b = st.pop()?;
                let a = st.pop()?;
                match name.as_str() {
                    "min" => (a.0.min(b.0), a.1.min(b.1)),
                    "max" => (a.0.max(b.0), a.1.max(b.1)),
                    _ => return None,
                }
            }
            ExprStep::Call(..) => return None,
        };
        st.push(v);
    }
    (st.len() == 1).then(|| st[0])
}

/// One ring as the `geometry` call reports it (a sweep's or a tube's).
pub fn ring_row(u: f64, scale: f64, turn: f64, f: &Frame, vertices: Vec<u32>) -> Value {
    json!({"u": u, "scale": scale, "turn": turn,
           "frame": {"point": f.point, "tangent": f.tangent, "normal": f.normal, "binormal": f.binormal()},
           "vertices": vertices})
}

/// One ring: where along the curve it falls (u, a fraction of arc length), the scale and turn
/// it takes there, its frame, and on a corner the plane it miters in.
#[derive(Clone, Debug)]
pub struct Ring {
    pub u: f64,
    pub scale: f64,
    pub turn: f64,
    pub frame: Frame,
    /// The plane a mitered ring lies in, through the frame's point: its normal.
    miter: Option<V3>,
}

/// A sweep made at check: its curve, its rings, its outline and holes (each made one way round),
/// and whether it closes on itself or takes caps.
pub struct Sweep {
    pub rings: Vec<Ring>,
    pub welded: bool,
    pub caps: bool,
    loops: Vec<Vec<V2>>,
}

fn bad(name: &str) -> String {
    format!("params/{name}")
}

/// The curve item `id` names in `doc`, made.
fn curve_of(doc: &Value, id: &str, plants: Plants) -> Result<Curve, String> {
    let item = doc
        .get("items")
        .and_then(|i| i.get(id))
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some("curve@1"))
        .ok_or_else(|| bad("along/curve"))?;
    let mut c =
        Curve::new(item.get("params").unwrap_or(&Value::Null)).map_err(|_| bad("along/curve"))?;
    c.seam_twist = plants.seam_twist;
    Ok(c)
}

/// The Frenet frame at u (normal along the curvature), or curve@1's where it has none.
fn frenet(c: &Curve, u: f64) -> Frame {
    let f = c.frame(u);
    let (_, _, d) = c.derivatives_at(u);
    let along = sub(d[1], scale(f.tangent, dot(d[1], f.tangent)));
    if crate::geom::length(along) < 1e-12 {
        return f;
    }
    Frame {
        normal: unit(along),
        ..f
    }
}

/// The frame `f` turned about its tangent by `a` radians.
fn turned(f: Frame, a: f64) -> Frame {
    let n = add(
        scale(f.normal, cos(a)),
        scale(crate::geom::cross(f.tangent, f.normal), sin(a)),
    );
    Frame { normal: n, ..f }
}

/// u as the planted program reads it: the span's index plus its parameter, over the span count.
fn by_span(c: &Curve, u: f64) -> f64 {
    let (k, t, _) = c.derivatives_at(u);
    (k as f64 + t) / c.spans.len() as f64
}

impl Sweep {
    /// An `extrude@1`'s params with `along`, checked and planned, or the path at fault.
    pub fn new(
        p: &Value,
        outline: Vec<V2>,
        holes: Vec<Vec<V2>>,
        doc: &Value,
        plants: Plants,
    ) -> Result<Sweep, String> {
        let along = p.get("along").ok_or_else(|| bad("along"))?;
        let id = along
            .get("curve")
            .and_then(Value::as_str)
            .ok_or_else(|| bad("along/curve"))?;
        let curve = curve_of(doc, id, plants)?;
        let (r0, r1) = match along.get("range") {
            None => (0.0, 1.0),
            Some(v) => {
                let r: Option<Vec<f64>> = v
                    .as_array()
                    .filter(|a| a.len() == 2)
                    .and_then(|a| a.iter().map(Value::as_f64).collect());
                let r = r
                    .filter(|r| 0.0 <= r[0] && r[0] < r[1] && r[1] <= 1.0)
                    .ok_or_else(|| bad("along/range"))?;
                (r[0], r[1])
            }
        };
        let rings = match along.get("rings") {
            None => 64,
            Some(v) => v
                .as_u64()
                .filter(|n| (2..=MAX_RINGS).contains(n))
                .ok_or_else(|| bad("along/rings"))?,
        };
        let sc = match along.get("scale") {
            None => Scale::Number(1.0),
            Some(Value::String(text)) => {
                Scale::Expr(postfix(text).map_err(|_| bad("along/scale"))?)
            }
            Some(v) => Scale::Number(
                v.as_f64()
                    .filter(|x| x.is_finite())
                    .ok_or_else(|| bad("along/scale"))?,
            ),
        };
        // The interval form over the range must stay above 0.
        if sc.least(r0, r1).is_none_or(|m| m <= 0.0) {
            return Err(bad("along/range"));
        }
        let twist = match p.get("twist") {
            None => 0.0,
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite())
                .ok_or_else(|| bad("twist"))?,
        };
        let caps = match p.get("caps") {
            None => true,
            Some(v) => match v.as_str() {
                Some("flat") => true,
                Some("none") => false,
                _ => return Err(bad("caps")),
            },
        };
        let welded = curve.closed && r0 == 0.0 && r1 == 1.0;
        if welded {
            if twist % 360.0 != 0.0 {
                return Err(bad("twist"));
            }
            if sc.at(0.0) != sc.at(1.0) {
                return Err(bad("along/scale"));
            }
        }
        // Even steps of arc length, and on a linear curve a ring at each point between.
        let mut us: Vec<(f64, Option<usize>)> = (0..rings)
            .map(|k| (r0 + (r1 - r0) * k as f64 / (rings - 1) as f64, None))
            .collect();
        if curve.mode == "linear" {
            let n = curve.points.len();
            for (k, at) in curve.starts.iter().enumerate().take(n) {
                let u = at / curve.length;
                let seam = curve.closed && k == 0;
                if !seam && k == 0 {
                    continue;
                }
                let inside = u > r0 + 1e-12 && u < r1 - 1e-12;
                if seam && welded {
                    us[0].1 = Some(0);
                } else if inside {
                    match us.iter_mut().find(|r| (r.0 - u).abs() < 1e-12) {
                        Some(r) => r.1 = Some(k),
                        None => us.push((u, Some(k))),
                    }
                }
            }
            us.sort_by(|a, b| a.0.total_cmp(&b.0));
        }
        if welded {
            us.pop();
        }
        let turn = rad(twist);
        // The planted Frenet frames, turned once by the angle that matches the first ring's.
        let match_first = {
            let (f, r) = (frenet(&curve, us[0].0), curve.frame(us[0].0));
            let c = crate::geom::cross(f.normal, r.normal);
            deep_canvas::ops::atan2(dot(c, f.tangent), dot(f.normal, r.normal))
        };
        let mut out = Vec::with_capacity(us.len());
        for (u, corner) in us {
            let read = if plants.u_by_span {
                by_span(&curve, u)
            } else {
                u
            };
            let mut frame = if plants.frenet {
                turned(frenet(&curve, u), match_first)
            } else {
                curve.frame(u)
            };
            let mut miter = None;
            if let Some(k) = corner {
                let span_in = if k == 0 { curve.spans.len() - 1 } else { k - 1 };
                let t_in = unit(sub(curve.spans[span_in][3], curve.spans[span_in][2]));
                let m = unit(add(t_in, frame.tangent));
                let c = dot(m, frame.tangent);
                if c <= 1.0 / MAX_MITER {
                    return Err(format!("params/along/curve#p{}", curve.ids[k]));
                }
                if plants.square_corners {
                    // Square to the segment into the corner: the frame turned back onto it.
                    let n = crate::curve::transport(
                        frame.normal,
                        frame.point,
                        frame.tangent,
                        frame.point,
                        t_in,
                    );
                    frame = Frame {
                        tangent: t_in,
                        normal: n,
                        ..frame
                    };
                } else {
                    miter = Some(m);
                }
            }
            out.push(Ring {
                u,
                scale: sc.at(read),
                turn: turn * read,
                frame,
                miter,
            });
        }
        let mut loops = vec![outline];
        loops.extend(holes);
        Ok(Sweep {
            rings: out,
            welded,
            caps: caps && !welded,
            loops,
        })
    }

    /// A loop's point `q` placed on ring `r`: turned and scaled in the outline's plane, set on
    /// the frame (x on the normal, y on the binormal), and on a mitered ring carried along the
    /// tangent onto the corner's bisecting plane.
    fn place(r: &Ring, q: V2) -> V3 {
        let (c, s) = (cos(r.turn), sin(r.turn));
        let x = r.scale * (q[0] * c - q[1] * s);
        let y = r.scale * (q[0] * s + q[1] * c);
        let f = &r.frame;
        let off = add(scale(f.normal, x), scale(f.binormal(), y));
        let off = match r.miter {
            Some(m) => sub(off, scale(f.tangent, dot(off, m) / dot(f.tangent, m))),
            None => off,
        };
        add(f.point, off)
    }

    /// Vertices and triangles, from the plan alone.
    pub fn counts(&self) -> (u64, u64) {
        let pts: u64 = self.loops.iter().map(|l| l.len() as u64).sum();
        let rings = self.rings.len() as u64;
        let bands = if self.welded { rings } else { rings - 1 };
        let mut v = pts * rings;
        let mut t = 2 * pts * bands;
        if self.caps {
            v += 2 * pts;
            t += 2 * triangulate(&self.loops[0], &self.loops[1..]).len() as u64;
        }
        (v, t)
    }

    /// The mesh: one vertex per loop point per ring, a band of quads between each two rings
    /// (and back to the first when welded), flat caps at an open sweep's ends.
    pub fn build(&self) -> Mesh {
        let mut m = Mesh::default();
        let mut starts = Vec::with_capacity(self.rings.len());
        for r in &self.rings {
            starts.push(m.positions.len() as u32);
            for l in &self.loops {
                for q in l {
                    let at = Self::place(r, *q);
                    m.vertex(at, unit(sub(at, r.frame.point)));
                }
            }
        }
        let n = self.rings.len();
        let bands = if self.welded { n } else { n - 1 };
        for i in 0..bands {
            let (a, b) = (starts[i], starts[(i + 1) % n]);
            let mut base = 0u32;
            for l in &self.loops {
                let len = l.len() as u32;
                for k in 0..len {
                    let j = (k + 1) % len;
                    let face = m.next_face();
                    m.quad(a + base + k, a + base + j, b + base + j, b + base + k, face);
                }
                base += len;
            }
        }
        if self.caps {
            for r in [&self.rings[0], &self.rings[n - 1]] {
                let ring =
                    |l: &Vec<V2>| -> Vec<V3> { l.iter().map(|q| Self::place(r, *q)).collect() };
                m.polygon(
                    &ring(&self.loops[0]),
                    &self.loops[1..].iter().map(ring).collect::<Vec<_>>(),
                );
            }
        }
        let genus = if self.welded {
            1
        } else {
            self.loops.len() as u32 - 1
        };
        m.close("solid", 0, genus);
        m.outputs.insert("rings".into(), self.rows(&starts));
        m
    }

    /// Each ring as the `geometry` call reports it: its u, scale, turn and frame, and its
    /// outline's vertices.
    fn rows(&self, starts: &[u32]) -> Value {
        let n = self.loops[0].len() as u32;
        Value::Array(
            self.rings
                .iter()
                .zip(starts)
                .map(|(r, s)| {
                    ring_row(
                        r.u,
                        r.scale,
                        r.turn.to_degrees(),
                        &r.frame,
                        (*s..s + n).collect(),
                    )
                })
                .collect(),
        )
    }
}
