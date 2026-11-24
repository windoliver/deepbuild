//! Timber halls in the building module (canvas primitives: Building module; issue #1219): a bay
//! frame's columns and beams on its grid, bracket sets that step out and up from a column head
//! or a beam, and the hipped, gabled and pyramid roofs a frame carries, whose profile folds
//! toward the ridge by the stated rule and whose eaves rise toward each corner. Every number a
//! build reports (a column's place, a purlin's height, the ridge, the eave line, a bracket
//! set's reach and height) is a closed form of the fields, and the kind rules ([`rules`]) hold
//! each build to that form again, worked from the fields alone.
//!
//! A frame's own space: x across its bays from its first column, z front to back, y up from
//! its base. A bracket set and a roof are built in their frame's space, from where that frame
//! stands, as a slab reads a stair's well. Members are sized from the column's diameter.

use deep_canvas::camera::ease_in_out_cubic;
use deep_canvas::document::Issue;
use deep_canvas::geometry_audit::{depth, Shape};
use deep_canvas::ops::{cos, rad, sin, sqrt};
use serde_json::{json, Value};

use super::{items, kind_of, pos};
use crate::builders::{prism, Fault};
use crate::geom::{add, cross, dot, length, scale, sub, unit, Mesh, V2, V3};

pub const FRAME: &str = "arch.bay_frame@1";
pub const BRACKET: &str = "arch.bracket@1";
/// The roof types that stand on a frame.
pub const ROOFS: [&str; 5] = [
    "hip_ridge",
    "hip_gable",
    "overhang_gable",
    "flush_gable",
    "pyramid",
];

/// The wrong programs #1219's criteria plant: a frame that gives every bay the first bay's
/// width, a folded roof built straight, an eave whose rise falls back to level at the corner
/// over the last fifth of its reach, and a bracket set built one step short of the purlin it
/// carries.
pub const PLANTED: [&str; 4] = [
    "bay_frame_even_columns",
    "roof_straight_as_folded",
    "eave_rise_falls_back",
    "bracket_misses_purlin",
];

/// A column on a grid point within this, m (Building module: kind rules).
const ON_GRID: f64 = 1e-6;
/// A purlin's height on the folding rule within this, m.
const ON_RULE: f64 = 1e-6;
/// A bracket set's top on what it carries within this, m.
const MEETS: f64 = 1e-3;
/// How many samples the eave line's rise is read at toward each corner.
const SAMPLES: usize = 50;

// A member's size as a share of the column's diameter.
const PURLIN: f64 = 0.25;
const RAFTER: f64 = 0.35;
const RAFTER_WIDE: f64 = 0.25;
const RAFTER_LEAST: f64 = 0.05;
const RAFTER_APART: f64 = 2.0;
const TILES: f64 = 0.15;
const RIDGE: [f64; 2] = [0.6, 0.8];
const HIP: [f64; 2] = [0.4, 0.5];
const BEAM: [f64; 2] = [0.5, 0.8];
/// A round column's and a purlin's sides.
const ROUND: usize = 16;

fn number(p: &Value, name: &str) -> Result<Option<f64>, Fault> {
    match p.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite())
            .map(Some)
            .ok_or_else(|| format!("params/{name}")),
    }
}

/// One to `most` lengths over 0, m.
fn lengths(p: &Value, name: &str, most: usize) -> Result<Vec<f64>, Fault> {
    let list = p.get(name).and_then(Value::as_array);
    let list = list.filter(|l| !l.is_empty() && l.len() <= most);
    let list = list.ok_or_else(|| format!("params/{name}"))?;
    let at = |(k, v): (usize, &Value)| {
        let x = v.as_f64().filter(|x| x.is_finite() && *x > 0.0);
        x.ok_or_else(|| format!("params/{name}/{k}"))
    };
    list.iter().enumerate().map(at).collect()
}

/// The grid lines `bays` stand between, from 0.
fn lines(bays: &[f64]) -> Vec<f64> {
    let mut out = vec![0.0];
    for b in bays {
        out.push(out[out.len() - 1] + b);
    }
    out
}

/// A straight member: its bottom line from `a` to `b`, `w` wide across it and `h` deep above
/// it, square to it.
#[derive(Clone, Copy)]
struct Member {
    a: V3,
    b: V3,
    w: f64,
    h: f64,
}

/// A line's unit direction, the direction square to it nearest +Y (+X for a plumb line), and
/// the one across both.
fn axes(a: V3, b: V3) -> [V3; 3] {
    let axis = unit(sub(b, a));
    let y = if axis[1].abs() > 0.999 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let up = unit(sub(y, scale(axis, dot(y, axis))));
    [axis, up, cross(axis, up)]
}

impl Member {
    fn mesh(&self) -> Mesh {
        let [_, up, side] = axes(self.a, self.b);
        let (w, h) = (self.w / 2.0, self.h);
        prism(&[[-w, 0.0], [w, 0.0], [w, h], [-w, h]], &[], |q, cap| {
            let c = if cap == 0 { self.a } else { self.b };
            add(c, add(scale(side, q[0]), scale(up, q[1])))
        })
    }

    fn shape(&self) -> Shape {
        let [axis, up, side] = axes(self.a, self.b);
        let mid = scale(add(self.a, self.b), 0.5);
        Shape::Obb {
            c: add(mid, scale(up, self.h / 2.0)),
            axes: [axis, up, side],
            half: [
                length(sub(self.b, self.a)) / 2.0,
                self.h / 2.0,
                self.w / 2.0,
            ],
        }
    }
}

/// A round or many-sided member about the line from `a` to `b`, `ra` in radius at `a` and
/// `rb` at `b`.
fn round(a: V3, b: V3, ra: f64, rb: f64, sides: usize) -> Mesh {
    let [_, up, side] = axes(a, b);
    let ring: Vec<V2> = (0..sides)
        .map(|k| {
            let t = rad(360.0 * k as f64 / sides as f64);
            [cos(t), sin(t)]
        })
        .collect();
    prism(&ring, &[], |q, cap| {
        let (c, r) = if cap == 0 { (a, ra) } else { (b, rb) };
        add(c, add(scale(side, q[0] * r), scale(up, q[1] * r)))
    })
}

/// A slab between two lines of as many points, `lower` and `upper`, each point its top; `t`
/// thick, straight down.
fn ribbon(lower: &[V3], upper: &[V3], t: f64) -> Mesh {
    let mut m = Mesh::default();
    let down = |p: V3| [p[0], p[1] - t, p[2]];
    let quad = |m: &mut Mesh, c: [V3; 4]| {
        let n = crate::geom::newell(&c);
        let base = m.positions.len() as u32;
        for p in c {
            m.vertex(p, n);
        }
        let face = m.next_face();
        m.quad(base, base + 1, base + 2, base + 3, face);
    };
    let last = lower.len() - 1;
    for k in 0..last {
        let (l0, l1, u0, u1) = (lower[k], lower[k + 1], upper[k], upper[k + 1]);
        quad(&mut m, [l0, u0, u1, l1]);
        quad(&mut m, [down(l0), down(l1), down(u1), down(u0)]);
        quad(&mut m, [l0, l1, down(l1), down(l0)]);
        quad(&mut m, [u0, down(u0), down(u1), u1]);
    }
    quad(&mut m, [lower[0], down(lower[0]), down(upper[0]), upper[0]]);
    quad(
        &mut m,
        [
            lower[last],
            upper[last],
            down(upper[last]),
            down(lower[last]),
        ],
    );
    m.close("solid", 0, 0);
    m
}

/// `pieces` appended to `m` as the part `name`.
fn part(m: &mut Mesh, name: &str, pieces: &[Mesh]) {
    let from = m.triangles();
    for (k, piece) in pieces.iter().enumerate() {
        m.append(piece, &format!(".{name}.{k}"));
    }
    m.part(name, from);
}

/// A bay frame as its fields give it.
struct Frame {
    /// The grid lines across and front to back, from 0.
    xs: Vec<f64>,
    zs: Vec<f64>,
    /// The column heads' height.
    eave: f64,
    dia: f64,
    sides: usize,
    taper: f64,
    /// A plinth's height and width.
    plinth: Option<[f64; 2]>,
    omit: Vec<[usize; 2]>,
    per_bay: usize,
}

impl Frame {
    fn read(p: &Value, planted: Option<&str>) -> Result<Frame, Fault> {
        let mut bays = lengths(p, "bays", 15)?;
        let depth = lengths(p, "depth_bays", 8)?;
        if planted == Some(PLANTED[0]) {
            bays = vec![bays[0]; bays.len()];
        }
        let eave = number(p, "eave_height")?.filter(|h| *h > 0.0);
        let eave = eave.ok_or("params/eave_height")?;
        let c = p.get("column").filter(|c| c.is_object());
        let c = c.ok_or("params/column")?;
        let over_0 = |v: &Value| v.as_f64().filter(|x| x.is_finite() && *x > 0.0);
        let dia = c.get("diameter").and_then(over_0);
        let dia = dia.ok_or("params/column/diameter")?;
        let sides = match c.get("sides") {
            None => ROUND,
            Some(Value::String(s)) if s == "round" => ROUND,
            Some(v) if v.as_u64() == Some(8) => 8,
            Some(_) => return Err("params/column/sides".into()),
        };
        let taper = match c.get("taper") {
            None => 0.0,
            Some(v) => {
                let t = v.as_f64().filter(|t| (0.0..=0.1).contains(t));
                t.ok_or("params/column/taper")?
            }
        };
        let plinth = match c.get("plinth") {
            None | Some(Value::Null) => None,
            Some(pl) => {
                let side = |name: &str| {
                    let x = pl.get(name).and_then(over_0);
                    x.ok_or_else(|| format!("params/column/plinth/{name}"))
                };
                Some([side("height")?, side("width")?])
            }
        };
        if plinth.is_some_and(|pl| pl[0] >= eave) {
            return Err("params/column/plinth/height".into());
        }
        let (xs, zs) = (lines(&bays), lines(&depth));
        let mut omit = Vec::new();
        let listed = match p.get("omit") {
            None | Some(Value::Null) => &[][..],
            Some(v) => v.as_array().ok_or("params/omit")?.as_slice(),
        };
        for (k, o) in listed.iter().enumerate() {
            let at = |n: usize, most: usize| {
                let i = o.get(n).and_then(Value::as_u64).map(|i| i as usize);
                i.filter(|i| *i < most)
                    .ok_or_else(|| format!("params/omit/{k}"))
            };
            omit.push([at(0, xs.len())?, at(1, zs.len())?]);
        }
        let per_bay = match p.get("purlins_per_bay") {
            None => 1,
            Some(v) => {
                let n = v.as_u64().filter(|n| (1..=4).contains(n));
                n.ok_or("params/purlins_per_bay")? as usize
            }
        };
        Ok(Frame {
            xs,
            zs,
            eave,
            dia,
            sides,
            taper,
            plinth,
            omit,
            per_bay,
        })
    }

    fn width(&self) -> f64 {
        self.xs[self.xs.len() - 1]
    }

    fn depth(&self) -> f64 {
        self.zs[self.zs.len() - 1]
    }

    /// Each column's grid point, front row first, across each row.
    fn columns(&self) -> Vec<[usize; 2]> {
        let rows = (0..self.zs.len()).flat_map(|j| (0..self.xs.len()).map(move |i| [i, j]));
        rows.filter(|at| !self.omit.contains(at)).collect()
    }

    /// Its beams, one along each grid line with its top at the column heads.
    fn beams(&self) -> Vec<Member> {
        let (w, h) = (BEAM[0] * self.dia, BEAM[1] * self.dia);
        let y = self.eave - h;
        let (x1, z1) = (self.width(), self.depth());
        let across = self.zs.iter().map(|z| Member {
            a: [0.0, y, *z],
            b: [x1, y, *z],
            w,
            h,
        });
        let along = self.xs.iter().map(|x| Member {
            a: [*x, y, 0.0],
            b: [*x, y, z1],
            w,
            h,
        });
        across.chain(along).collect()
    }

    /// The plinth under each column, where the frame has them.
    fn plinths(&self) -> Vec<Member> {
        let Some([h, w]) = self.plinth else {
            return Vec::new();
        };
        let under = |[i, j]: [usize; 2]| Member {
            a: [self.xs[i] - w / 2.0, 0.0, self.zs[j]],
            b: [self.xs[i] + w / 2.0, 0.0, self.zs[j]],
            w,
            h,
        };
        self.columns().into_iter().map(under).collect()
    }

    /// The purlin lines from the front columns to mid-depth, as far in from the column line.
    fn purlins(&self) -> Vec<f64> {
        let half = self.depth() / 2.0;
        let mut out = Vec::new();
        for bay in self.zs.windows(2) {
            for k in 0..self.per_bay {
                let z = bay[0] + (bay[1] - bay[0]) * k as f64 / self.per_bay as f64;
                if z > 1e-9 && z < half - 1e-9 {
                    out.push(z);
                }
            }
        }
        out
    }
}

/// The frame `p.frame` names, as its fields give it, and where its space stands from `item`'s:
/// the frame's own space for its child, as far as the two stand apart for any other item.
fn frame_of(doc: &Value, item: &Value, p: &Value) -> Result<(Frame, V3), Fault> {
    let id = p.get("frame").and_then(Value::as_str);
    let found = id.and_then(|id| doc.get("items")?.get(id));
    let found = found.filter(|f| kind_of(f) == FRAME);
    let found = found.ok_or("params/frame")?;
    let frame = Frame::read(found.get("params").unwrap_or(&Value::Null), None);
    let frame = frame.map_err(|_| "params/frame".to_string())?;
    let child = item.get("parent").and_then(Value::as_str) == id;
    let from = if child { [0.0; 3] } else { pos(found) };
    Ok((frame, sub(from, pos(item))))
}

/// Builds a bay frame: a column on each grid point `omit` doesn't name, each head an anchor
/// `column.<i>.<j>`, and a beam along each grid line at the eave height.
pub fn frame(p: &Value, planted: Option<&str>) -> Result<Mesh, Fault> {
    let f = Frame::read(p, planted)?;
    let foot = f.plinth.map_or(0.0, |pl| pl[0]);
    let r = f.dia / 2.0;
    let mut m = Mesh::default();
    let columns: Vec<Mesh> = f
        .columns()
        .into_iter()
        .map(|[i, j]| {
            let (x, z) = (f.xs[i], f.zs[j]);
            let (a, b) = ([x, foot, z], [x, f.eave, z]);
            round(a, b, r, r * (1.0 - f.taper), f.sides)
        })
        .collect();
    part(&mut m, "columns", &columns);
    let beams: Vec<Mesh> = f.beams().iter().map(Member::mesh).collect();
    part(&mut m, "beams", &beams);
    let plinths: Vec<Mesh> = f.plinths().iter().map(Member::mesh).collect();
    part(&mut m, "plinths", &plinths);
    // Each column's head: where a bracket set sits.
    for [i, j] in f.columns() {
        let head = [f.xs[i], f.eave, f.zs[j]];
        let axes = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        m.anchors
            .insert(format!("column.{i}.{j}"), [head, axes[0], axes[1], axes[2]]);
    }
    Ok(m)
}

/// Whether a gabled roof names the frame `p.frame` names: its ends then carry no eave.
fn gabled(doc: &Value, p: &Value) -> bool {
    let frame = p.get("frame").and_then(Value::as_str);
    items(doc).any(|(_, r)| {
        let ty = r.pointer("/params/type").and_then(Value::as_str);
        kind_of(r) == "arch.roof@1"
            && frame.is_some()
            && r.pointer("/params/frame").and_then(Value::as_str) == frame
            && matches!(ty, Some("overhang_gable" | "flush_gable"))
    })
}

/// A bracket's sets as its fields give them: where each stands on its frame, the way it
/// reaches out, and its steps. A set stands under an eave: on the front and back rows, and
/// with `ends` on the frame's two ends as well.
struct Sets {
    /// Each set's place on the column line and the way it reaches, one per axis it reaches on.
    at: Vec<[V2; 2]>,
    steps: usize,
    /// The steps it builds: all of them, but for the planted set.
    built: usize,
    reach: f64,
    height: f64,
    /// The column heads' height.
    base: f64,
}

impl Sets {
    fn read(frame: &Frame, p: &Value, ends: bool, planted: Option<&str>) -> Result<Sets, Fault> {
        let steps = p.get("steps").and_then(Value::as_u64);
        let steps = steps.filter(|s| (1..=4).contains(s));
        let steps = steps.ok_or("params/steps")? as usize;
        let over_0 = |name: &str| {
            let x = number(p, name)?.filter(|x| *x > 0.0);
            x.ok_or_else(|| format!("params/{name}"))
        };
        let (reach, height) = (over_0("reach")?, over_0("height")?);
        let (nx, nz) = (frame.xs.len() - 1, frame.zs.len() - 1);
        let out = |i: usize, n: usize| match i {
            0 => -1.0,
            i if i == n => 1.0,
            _ => 0.0,
        };
        let at: Vec<[V2; 2]> = match p.get("on").and_then(Value::as_str) {
            Some("column") => frame
                .columns()
                .into_iter()
                .filter(|[i, j]| (ends && (*i == 0 || *i == nx)) || *j == 0 || *j == nz)
                .map(|[i, j]| {
                    let across = if ends { out(i, nx) } else { 0.0 };
                    [[frame.xs[i], frame.zs[j]], [across, out(j, nz)]]
                })
                .collect(),
            Some("between") => {
                let mid = |l: &[f64], k: usize| (l[k] + l[k + 1]) / 2.0;
                let front = (0..nx).flat_map(|i| {
                    let x = mid(&frame.xs, i);
                    [[[x, 0.0], [0.0, -1.0]], [[x, frame.depth()], [0.0, 1.0]]]
                });
                let sides = (0..nz).flat_map(|j| {
                    let z = mid(&frame.zs, j);
                    [[[0.0, z], [-1.0, 0.0]], [[frame.width(), z], [1.0, 0.0]]]
                });
                front.chain(sides.filter(|_| ends)).collect()
            }
            _ => return Err("params/on".into()),
        };
        Ok(Sets {
            at,
            steps,
            // Planted: one step fewer, so the top stops a step under the purlin.
            built: steps - usize::from(planted == Some(PLANTED[3])),
            reach,
            height,
            base: frame.eave,
        })
    }

    /// Where the top it builds stands above the column heads.
    fn top(&self) -> f64 {
        self.built as f64 * self.height
    }

    /// Each set's blocks and arms: a block under each step, and over it an arm that reaches
    /// one more step out and one across.
    fn members(&self) -> Vec<Member> {
        let (block, arm) = (0.5 * self.reach, 0.3 * self.reach);
        let mut out = Vec::new();
        for [p, o] in &self.at {
            let far = sqrt(o[0] * o[0] + o[1] * o[1]);
            let u = [o[0] / far, o[1] / far];
            let on = |s: f64, y: f64| [p[0] + u[0] * s, y, p[1] + u[1] * s];
            for k in 0..self.built {
                let y = self.base + k as f64 * self.height;
                let (from, to) = (
                    far * self.reach * k as f64,
                    far * self.reach * (k + 1) as f64,
                );
                out.push(Member {
                    a: on(from - block / 2.0, y),
                    b: on(from + block / 2.0, y),
                    w: block,
                    h: 0.4 * self.height,
                });
                let y = y + 0.4 * self.height;
                out.push(Member {
                    a: on(from - block / 2.0, y),
                    b: on(to + block / 2.0, y),
                    w: arm,
                    h: 0.6 * self.height,
                });
                let c = on(from, y);
                let v = [-u[1] * 0.8 * self.reach, 0.0, u[0] * 0.8 * self.reach];
                out.push(Member {
                    a: sub(c, v),
                    b: add(c, v),
                    w: arm,
                    h: 0.6 * self.height,
                });
            }
        }
        out
    }
}

/// Builds a bracket's sets on its frame; its total reach and height are outputs.
pub fn bracket(doc: &Value, item: &Value, p: &Value, planted: Option<&str>) -> Result<Mesh, Fault> {
    let (frame, shift) = frame_of(doc, item, p)?;
    let sets = Sets::read(&frame, p, !gabled(doc, p), planted)?;
    let mut m = Mesh::default();
    let members: Vec<Mesh> = sets.members().iter().map(Member::mesh).collect();
    part(&mut m, "sets", &members);
    let mut m = m.mapped(|q| add(q, shift), |_, n| n);
    let steps = sets.steps as f64;
    m.outputs
        .insert("total_reach".into(), json!(steps * sets.reach));
    m.outputs
        .insert("total_height".into(), json!(steps * sets.height));
    Ok(m)
}

/// How far the brackets that name the frame `id` reach, and how high they stand: the most of
/// each, as their fields give them.
fn carried(doc: &Value, id: &str) -> [f64; 2] {
    let mut out = [0.0; 2];
    for (_, b) in items(doc).filter(|(_, b)| kind_of(b) == BRACKET) {
        if b.pointer("/params/frame").and_then(Value::as_str) != Some(id) {
            continue;
        }
        let of = |name: &str| b.pointer(name).and_then(Value::as_f64).unwrap_or(0.0);
        let steps = of("/params/steps");
        out[0] = f64::max(out[0], steps * of("/params/reach"));
        out[1] = f64::max(out[1], steps * of("/params/height"));
    }
    out
}

/// The folding rule (Building module): each purlin's height above the eave purlin, where `x`
/// is how far in from the eave purlin each stands, the last the ridge. The purlin below the
/// ridge is lowered from the line between the ridge and the eave purlin by a tenth of the
/// ridge's height, and each next one down from the line between the purlin above it and the
/// eave purlin by half the drop before.
fn folded(x: &[f64], ridge: f64) -> Vec<f64> {
    let n = x.len() - 1;
    let mut h = vec![0.0; n + 1];
    h[n] = ridge;
    let mut drop = ridge / 10.0;
    for i in (1..n).rev() {
        h[i] = h[i + 1] * x[i] / x[i + 1] - drop;
        drop /= 2.0;
    }
    h
}

#[derive(Clone, Copy, PartialEq)]
enum Ty {
    HipRidge,
    HipGable,
    OverhangGable,
    FlushGable,
    Pyramid,
}

/// One line of a slope: its span along the eave, how far in from the column line it runs and
/// its height.
#[derive(Clone, Copy)]
struct Line {
    lo: f64,
    hi: f64,
    q: f64,
    y: f64,
}

/// A roof on a frame, in the frame's space.
struct Roof {
    ty: Ty,
    w: f64,
    d: f64,
    /// Each purlin ring from the eave purlin to the ridge: how far in from the column line it
    /// runs front to back and across, and its centre's height.
    rings: Vec<[f64; 3]>,
    /// How far in from the eave purlin each ring stands, and how high its purlin builds above
    /// the eave purlin.
    x: Vec<f64>,
    h: Vec<f64>,
    /// How far the rafters reach past the eave purlin.
    over: f64,
    /// The eave's reach past the column line.
    eave: f64,
    /// The ring a hip_gable's gable stands on.
    gable: usize,
    /// The eave's rise at a corner, and how far from the corner it starts.
    rise: f64,
    reach: f64,
    /// The column's diameter, which sizes the members.
    dia: f64,
    falls_back: bool,
}

impl Roof {
    fn read(
        doc: &Value,
        item: &Value,
        p: &Value,
        planted: Option<&str>,
    ) -> Result<(Roof, V3), Fault> {
        let ty = match p.get("type").and_then(Value::as_str) {
            Some("hip_ridge") => Ty::HipRidge,
            Some("hip_gable") => Ty::HipGable,
            Some("overhang_gable") => Ty::OverhangGable,
            Some("flush_gable") => Ty::FlushGable,
            Some("pyramid") => Ty::Pyramid,
            _ => return Err("params/type".into()),
        };
        let (frame, shift) = frame_of(doc, item, p)?;
        let (w, d) = (frame.width(), frame.depth());
        let raise = number(p, "raise")?.filter(|r| *r > 0.0);
        let raise = raise.ok_or("params/raise")?;
        let fold = match p.get("profile").and_then(Value::as_str) {
            None | Some("straight") => false,
            Some("folded") => true,
            Some(_) => return Err("params/profile".into()),
        };
        let at_least_0 = |name: &str| match number(p, name)? {
            Some(x) if x < 0.0 => Err(format!("params/{name}")),
            x => Ok(x),
        };
        let id = p.get("frame").and_then(Value::as_str).unwrap_or("");
        let [out, up] = carried(doc, id);
        let eave = match at_least_0("eave_reach")? {
            Some(e) if e < out => return Err("params/eave_reach".into()),
            Some(e) => e,
            None => out + at_least_0("overhang")?.unwrap_or(0.0),
        };
        let rise = at_least_0("corner_rise")?.unwrap_or(0.0);
        let reach = number(p, "corner_reach")?.unwrap_or(0.0);
        if rise > 0.0 && reach <= 0.0 {
            return Err("params/corner_reach".into());
        }
        // The eave purlin on the brackets' reach, then the frame's purlin lines to the ridge.
        let half = d / 2.0;
        let mut iz = vec![-out];
        if out > 0.0 {
            iz.push(0.0);
        }
        iz.extend(frame.purlins());
        iz.push(half);
        let n = iz.len() - 1;
        let hipped = matches!(ty, Ty::HipRidge | Ty::HipGable);
        if hipped && half > w / 2.0 {
            return Err("params/frame".into());
        }
        let x: Vec<f64> = iz.iter().map(|q| q + out).collect();
        let ridge = raise * d;
        let h = if fold && planted != Some(PLANTED[1]) {
            folded(&x, ridge)
        } else {
            x.iter().map(|v| ridge * v / x[n]).collect()
        };
        let r = PURLIN * frame.dia;
        let rings = (0..=n)
            .map(|i| {
                let ix = match ty {
                    Ty::Pyramid if iz[i] > 0.0 => iz[i] * w / d,
                    _ => iz[i],
                };
                [iz[i], ix, frame.eave + up + h[i] + r]
            })
            .collect();
        let gable = (0..n).find(|i| iz[*i] > 0.0).unwrap_or(n);
        let roof = Roof {
            ty,
            w,
            d,
            rings,
            x,
            h,
            over: eave - out,
            eave,
            gable,
            rise,
            reach,
            dia: frame.dia,
            falls_back: planted == Some(PLANTED[2]),
        };
        Ok((roof, shift))
    }

    /// Its sides: the front and the back, and for a hipped or pyramid roof the two ends.
    fn sides(&self) -> usize {
        match self.ty {
            Ty::OverhangGable | Ty::FlushGable => 2,
            _ => 4,
        }
    }

    /// A point of side `side`: `a` along its eave, `q` in from the column line, `y` up.
    fn place(&self, side: usize, a: f64, q: f64, y: f64) -> V3 {
        match side {
            0 => [a, y, q],
            1 => [self.w - a, y, self.d - q],
            2 => [q, y, self.d - a],
            _ => [self.w - q, y, a],
        }
    }

    /// Ring `i`'s line on `side`, where the side has one.
    fn line(&self, side: usize, i: usize) -> Option<Line> {
        let [iz, ix, y] = self.rings[i];
        let ends = side >= 2;
        let (lo, far, q) = match self.ty {
            Ty::OverhangGable if !ends => (-self.eave, self.w, iz),
            Ty::FlushGable if !ends => (0.0, self.w, iz),
            Ty::HipGable if !ends => (self.rings[i.min(self.gable)][1], self.w, iz),
            Ty::HipGable if i > self.gable => return None,
            Ty::HipRidge | Ty::HipGable | Ty::Pyramid if ends => (iz, self.d, ix),
            Ty::HipRidge | Ty::Pyramid => (ix, self.w, iz),
            _ => return None,
        };
        Some(Line {
            lo,
            hi: far - lo,
            q,
            y,
        })
    }

    /// The eave's line on `side`: the rafters' ends, level but for its rise.
    fn edge(&self, side: usize) -> Option<Line> {
        let l = self.line(side, 0)?;
        let slope = (self.rings[1][2] - self.rings[0][2]) / (self.rings[1][0] - self.rings[0][0]);
        let out = if self.sides() == 4 { self.over } else { 0.0 };
        Some(Line {
            lo: l.lo - out,
            hi: l.hi + out,
            q: l.q - self.over,
            y: l.y - slope * self.over,
        })
    }

    /// How far the eave line stands above its level at `a` along `side`'s eave: by the rise at
    /// each corner, eased to nothing over the reach.
    fn lift(&self, side: usize, a: f64) -> f64 {
        let Some(e) = self.edge(side).filter(|_| self.rise > 0.0) else {
            return 0.0;
        };
        let from = f64::min(a - e.lo, e.hi - a);
        let u = (1.0 - from / self.reach).clamp(0.0, 1.0);
        // Planted: as shipped for four fifths of the reach, then straight back to level.
        if self.falls_back && u > 0.8 {
            return self.rise * ease_in_out_cubic(0.8) * (1.0 - u) / 0.2;
        }
        self.rise * ease_in_out_cubic(u)
    }

    /// How far from its corner sample `k` of a corner's reach lies along the eave `e`: sample 0
    /// where the rise starts, the last at the corner.
    fn sample(&self, e: Line, k: usize) -> f64 {
        let far = f64::min(self.reach, (e.hi - e.lo) / 2.0);
        far * (SAMPLES - 1 - k) as f64 / (SAMPLES - 1) as f64
    }

    /// A purlin's radius, the tiles' underside and top above a purlin's centre, and the tiles'
    /// thickness.
    fn sizes(&self) -> [f64; 4] {
        let r = PURLIN * self.dia;
        let under = r + RAFTER * self.dia;
        [r, under, under + TILES * self.dia, TILES * self.dia]
    }

    /// The lines a side's tiles run between, from the eave up.
    fn courses(&self, side: usize) -> Vec<Line> {
        let rings = (0..self.rings.len()).filter_map(|i| self.line(side, i));
        let edge = self.edge(side).filter(|_| self.over > 0.0);
        edge.into_iter().chain(rings).collect()
    }

    /// Where the lowest course's points stand along its eave: its ends, the ends of the line
    /// above it, and eight steps over each corner's reach.
    fn along(&self, low: Line, up: Line) -> Vec<f64> {
        let mut out = vec![low.lo, low.hi, up.lo, up.hi];
        if self.rise > 0.0 {
            for k in 1..=8 {
                let step = self.reach * k as f64 / 8.0;
                out.extend([low.lo + step, low.hi - step]);
            }
        }
        out.retain(|a| *a >= low.lo && *a <= low.hi);
        out.sort_by(f64::total_cmp);
        out.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
        out
    }

    /// The tiles: a slab between each two lines of each side, its top on each slope's profile,
    /// and a board under them at each gable.
    fn tiles(&self) -> Vec<Mesh> {
        let [_, under, top, thick] = self.sizes();
        let mut out = Vec::new();
        for side in 0..self.sides() {
            let lines = self.courses(side);
            for (k, pair) in lines.windows(2).enumerate() {
                let (low, up) = (pair[0], pair[1]);
                let along = if k == 0 {
                    self.along(low, up)
                } else {
                    vec![low.lo, low.hi]
                };
                let lift = |a: f64| if k == 0 { self.lift(side, a) } else { 0.0 };
                let lower: Vec<V3> = along
                    .iter()
                    .map(|a| self.place(side, *a, low.q, low.y + top + lift(*a)))
                    .collect();
                let upper: Vec<V3> = along
                    .iter()
                    .map(|a| self.place(side, a.max(up.lo).min(up.hi), up.q, up.y + top))
                    .collect();
                out.push(ribbon(&lower, &upper, thick));
            }
        }
        // A gable's board: under the two slopes, from the ring it stands on to the ridge.
        let (from, x) = match self.ty {
            Ty::HipGable => (self.gable, self.rings[self.gable][1]),
            Ty::OverhangGable | Ty::FlushGable => (0, 0.0),
            _ => return out,
        };
        let n = self.rings.len() - 1;
        let front = (from..=n).map(|i| [self.rings[i][0], self.rings[i][2] + under]);
        let back = (from..n)
            .rev()
            .map(|i| [self.d - self.rings[i][0], self.rings[i][2] + under]);
        let outline: Vec<V2> = front.chain(back).collect();
        if n > from {
            for (x, t) in [(x, thick), (self.w - x, -thick)] {
                out.push(prism(&outline, &[], |q, cap| {
                    [x + t * cap as f64, q[1], q[0]]
                }));
            }
        }
        out
    }

    /// The purlins: each ring's line on each side, and the ridge's once; under a pyramid's
    /// peak, where no ridge runs, the post its last ring's rafters meet on.
    fn purlins(&self) -> Vec<[V3; 2]> {
        let n = self.rings.len() - 1;
        let mut out = Vec::new();
        if self.ty == Ty::Pyramid {
            let peak = |y: f64| [self.w / 2.0, y, self.d / 2.0];
            out.push([peak(self.rings[n - 1][2]), peak(self.rings[n][2])]);
        }
        for i in 0..=n {
            let sides = if i == n { 1 } else { self.sides() };
            for side in 0..sides {
                let Some(l) = self.line(side, i).filter(|l| l.hi - l.lo > 1e-9) else {
                    continue;
                };
                out.push([
                    self.place(side, l.lo, l.q, l.y),
                    self.place(side, l.hi, l.q, l.y),
                ]);
            }
        }
        out
    }

    /// The rafters: on each side, under each course of tiles from its lower line to the purlin
    /// at its upper one, which each lies on; the lowest run from the eave to the eave purlin.
    /// Each stands where the whole of it lies clear of a hip.
    fn rafters(&self) -> Vec<Member> {
        let [r, under, ..] = self.sizes();
        let wide = RAFTER_WIDE * self.dia;
        let mut out = Vec::new();
        for side in 0..self.sides() {
            let Some(ring) = self.line(side, 0) else {
                continue;
            };
            let count = ((ring.hi - ring.lo) / (RAFTER_APART * self.dia)).ceil();
            let count = count.max(1.0) as usize;
            for pair in self.courses(side).windows(2) {
                let (low, up) = (pair[0], pair[1]);
                let slope = (up.y - low.y) / (up.q - low.q);
                let c = 1.0 / sqrt(1.0 + slope * slope);
                // As deep as lies between the purlin and the tiles; never under its least.
                let deep = f64::max(under * c - r, RAFTER_LEAST * self.dia);
                // Its top starts at the course's lower line and its foot ends on the purlin.
                let (from, to) = (low.q + deep * slope * c, up.q - r * slope * c);
                let y = |q: f64| low.y + under - deep / c + slope * (q - low.q);
                let (lo, hi) = (f64::max(low.lo, up.lo), f64::min(low.hi, up.hi));
                for k in 0..count {
                    let a = ring.lo + (k as f64 + 0.5) * (ring.hi - ring.lo) / count as f64;
                    if a - wide / 2.0 < lo - 1e-9 || a + wide / 2.0 > hi + 1e-9 || to <= from {
                        continue;
                    }
                    out.push(Member {
                        a: self.place(side, a, from, y(from)),
                        b: self.place(side, a, to, y(to)),
                        w: wide,
                        h: deep,
                    });
                }
            }
        }
        out
    }

    /// The ridges, on the tiles: the main ridge (a finial on a pyramid), and one up each hip.
    fn ridges(&self) -> Vec<Member> {
        let [_, _, top, _] = self.sizes();
        let n = self.rings.len() - 1;
        let [w, h] = [RIDGE[0] * self.dia, RIDGE[1] * self.dia];
        let mut out = Vec::new();
        if let Some(l) = self.line(0, n) {
            let (lo, hi) = if l.hi - l.lo < w {
                ((l.lo + l.hi - w) / 2.0, (l.lo + l.hi + w) / 2.0)
            } else {
                (l.lo, l.hi)
            };
            out.push(Member {
                a: self.place(0, lo, l.q, l.y + top),
                b: self.place(0, hi, l.q, l.y + top),
                w,
                h,
            });
        }
        if self.sides() == 2 {
            return out;
        }
        // A hip runs as far up as the ends do: to the ridge, or to a hip_gable's gable.
        let hips = self.courses(2).len();
        for side in 0..4 {
            let lines = self.courses(side);
            let corner = |k: usize| {
                let l = lines[k];
                let lift = if k == 0 { self.lift(side, l.lo) } else { 0.0 };
                self.place(side, l.lo, l.q, l.y + top + lift)
            };
            for k in 0..hips - 1 {
                let (a, b) = (corner(k), corner(k + 1));
                if length(sub(b, a)) > 1e-9 {
                    out.push(Member {
                        a,
                        b,
                        w: HIP[0] * self.dia,
                        h: HIP[1] * self.dia,
                    });
                }
            }
        }
        out
    }

    /// The tiles as the audit reads them, course by course: a box on the slope that stays
    /// inside its course at both faces, and over it a skin 2 mm thick whose top is the course's
    /// own, so a ridge lies on the tiles and nothing reads as passing into a neighbour. A
    /// course's ends under a hip are three boxes that stop short of the hip, and a course that
    /// rises toward a corner is read between the corners' reaches only.
    fn slabs(&self) -> Vec<Member> {
        let [_, under, top, thick] = self.sizes();
        let skin = 0.002;
        let mut out = Vec::new();
        for side in 0..self.sides() {
            let lines = self.courses(side);
            for (k, pair) in lines.windows(2).enumerate() {
                let (low, up) = (pair[0], pair[1]);
                let run = up.q - low.q;
                let slope = (up.y - low.y) / run;
                let c = 1.0 / sqrt(1.0 + slope * slope);
                // A face stands this far up the slope from the one under it, in plan.
                let lean = |deep: f64| deep * slope * c;
                let keep = if k == 0 { self.reach } else { 0.0 };
                let keep = if self.rise > 0.0 { keep } else { 0.0 };
                let mut slab = |lo: f64, hi: f64, far: f64| {
                    if hi - lo <= 1e-9 {
                        return;
                    }
                    let a = (lo + hi) / 2.0;
                    let at = |q: f64, over: f64| {
                        self.place(side, a, low.q + q, low.y + over + slope * q)
                    };
                    let inset = lean(thick * c);
                    if far > inset + 1e-9 {
                        out.push(Member {
                            a: at(inset, under),
                            b: at(far, under),
                            w: hi - lo,
                            h: thick * c,
                        });
                    }
                    if far > 1e-9 {
                        out.push(Member {
                            a: at(lean(skin), top - skin / c),
                            b: at(far + lean(skin), top - skin / c),
                            w: hi - lo,
                            h: skin,
                        });
                    }
                };
                let (lo, hi) = (
                    f64::max(up.lo, low.lo + keep),
                    f64::min(up.hi, low.hi - keep),
                );
                slab(lo, hi, run);
                let wide = (up.lo - low.lo) / 3.0;
                for j in 1..3 {
                    if keep > 0.0 || wide <= 1e-9 {
                        break;
                    }
                    let far = run * j as f64 / 3.0;
                    slab(
                        low.lo + wide * j as f64,
                        low.lo + wide * (j + 1) as f64,
                        far,
                    );
                    slab(
                        low.hi - wide * (j + 1) as f64,
                        low.hi - wide * j as f64,
                        far,
                    );
                }
            }
        }
        out
    }
}

/// Builds a roof of one of the types that stand on a frame. Its outputs, in the frame's space:
/// `purlins`, one side's from the eave purlin up, each how far in from the eave purlin it stands
/// and the height it bears at; `ridge_height`; and `eave_line`, the points around its eave.
pub fn roof(doc: &Value, item: &Value, p: &Value, planted: Option<&str>) -> Result<Mesh, Fault> {
    let (roof, shift) = Roof::read(doc, item, p, planted)?;
    let [r, _, top, _] = roof.sizes();
    let mut m = Mesh::default();
    let purlins: Vec<Mesh> = roof
        .purlins()
        .iter()
        .map(|[a, b]| round(*a, *b, r, r, ROUND))
        .collect();
    part(&mut m, "purlins", &purlins);
    let rafters: Vec<Mesh> = roof.rafters().iter().map(Member::mesh).collect();
    part(&mut m, "rafters", &rafters);
    part(&mut m, "tiles", &roof.tiles());
    let ridges: Vec<Mesh> = roof.ridges().iter().map(Member::mesh).collect();
    part(&mut m, "ridge", &ridges);
    let mut m = m.mapped(|q| add(q, shift), |_, n| n);
    let n = roof.x.len() - 1;
    let purlins: Vec<Value> = (0..n)
        .map(|i| json!({"in": roof.x[i], "height": roof.rings[i][2] - r}))
        .collect();
    m.outputs.insert("purlins".into(), json!(purlins));
    m.outputs
        .insert("ridge_height".into(), json!(roof.rings[n][2] - r));
    // Around the eave: each side's corners, and the samples of each corner's reach.
    let around: &[usize] = if roof.sides() == 4 {
        &[0, 3, 1, 2]
    } else {
        &[0, 1]
    };
    let mut eave: Vec<V3> = Vec::new();
    for side in around {
        let Some(e) = roof.edge(*side) else {
            continue;
        };
        let mut along = vec![e.lo, e.hi];
        for k in 0..SAMPLES {
            let from = roof.sample(e, k);
            along.extend([e.lo + from, e.hi - from]);
        }
        along.sort_by(f64::total_cmp);
        along.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
        eave.extend(
            along
                .iter()
                .map(|a| roof.place(*side, *a, e.q, e.y + top + roof.lift(*side, *a))),
        );
    }
    m.outputs.insert("eave_line".into(), json!(eave));
    Ok(m)
}

/// The kind rules (Building module), in the order [`rules`] runs them: a frame's columns sit
/// on their grid points within 1e-6 m; a bracket set's top meets the purlin it carries within
/// 1 mm; each purlin of a folded roof is at the folding rule's height within 1e-6 m; the eave
/// line's rise never falls toward a corner; and no rafter passes through a purlin.
pub const RULES: [&str; 5] = [
    "arch.column_on_grid",
    "arch.bracket_meets",
    "arch.purlin_folding",
    "arch.eave_monotonic",
    "arch.rafter_clear",
];

/// One kind rule run on one item, with its issue where it fails.
pub struct Run {
    pub item: String,
    pub rule: &'static str,
    pub issue: Option<Issue>,
}

/// Every kind rule run on every timber item of `doc`, each held to the build as `planted`
/// makes it and worked again from the fields alone. An item its fields refuse runs none: that
/// refusal is the build's own to report.
pub fn rules(doc: &Value, planted: Option<&str>) -> Vec<Run> {
    let mut out = Vec::new();
    let mut run = |item: &str, rule: &'static str, found: Found| {
        let issue = found.map(|(field, actual, what, fix)| {
            let path = format!("items/{item}/params/{field}");
            let mut issue = Issue::error(rule, item, path, actual, &what);
            issue.fix = fix.into();
            issue
        });
        out.push(Run {
            item: item.to_string(),
            rule,
            issue,
        });
    };
    for (id, item) in items(doc) {
        let p = item.get("params").cloned().unwrap_or(json!({}));
        let on_frame = p.get("type").and_then(Value::as_str);
        let on_frame = on_frame.is_some_and(|t| ROOFS.contains(&t));
        match kind_of(item) {
            FRAME => {
                if let Ok(built) = Frame::read(&p, planted) {
                    run(id, RULES[0], off_grid(&built, &p));
                }
            }
            BRACKET => {
                let read = frame_of(doc, item, &p);
                let ends = !gabled(doc, &p);
                let read = read.and_then(|(frame, _)| Sets::read(&frame, &p, ends, planted));
                if let Ok(sets) = read {
                    run(id, RULES[1], misses(doc, &sets, &p, planted));
                }
            }
            "arch.roof@1" if on_frame => {
                if let Ok((built, _)) = Roof::read(doc, item, &p, planted) {
                    run(id, RULES[2], off_rule(&built, &p));
                    run(id, RULES[3], falls(&built));
                    run(id, RULES[4], through(&built));
                }
            }
            _ => {}
        }
    }
    out
}

/// What a failed rule found: the field it names, what it found, in words, and the fix.
type Found = Option<(&'static str, Value, String, &'static str)>;

/// The first column, front row first, that a frame's build stands off its grid point.
fn off_grid(built: &Frame, p: &Value) -> Found {
    // The grid as the fields give it: each line the sum of the bays before it.
    let line = |name: &str, k: usize| -> f64 {
        let bays = p.get(name).and_then(Value::as_array);
        let before = bays.into_iter().flatten().take(k);
        before.filter_map(Value::as_f64).sum()
    };
    for [i, j] in built.columns() {
        let at = [line("bays", i), line("depth_bays", j)];
        let center = [built.xs[i], built.zs[j]];
        let off = f64::max((center[0] - at[0]).abs(), (center[1] - at[1]).abs());
        if off > ON_GRID {
            let found = json!({"column": [i, j], "at": at, "center": center, "off": off});
            let what = format!(
                "the column whose grid point is at x = {:.4} m, {:.4} m back, stands {off:.4} m off it",
                at[0], at[1]
            );
            let fix = "Stand each column on the sum of the bays before it.";
            return Some(("bays", found, what, fix));
        }
    }
    None
}

/// How far a bracket's sets' top stands from the eave purlin a roof on their frame lays on it.
fn misses(doc: &Value, sets: &Sets, p: &Value, planted: Option<&str>) -> Found {
    let name = p.get("frame").and_then(Value::as_str)?;
    for (other, roof) in items(doc).filter(|(_, r)| kind_of(r) == "arch.roof@1") {
        if roof.pointer("/params/frame").and_then(Value::as_str) != Some(name) {
            continue;
        }
        let q = roof.get("params").cloned().unwrap_or(json!({}));
        let Ok((built, _)) = Roof::read(doc, roof, &q, planted) else {
            continue;
        };
        let [r, ..] = built.sizes();
        let purlin = built.rings[0][2] - r - sets.base;
        let gap = purlin - sets.top();
        if gap.abs() > MEETS {
            let found = json!({"roof": other, "top": sets.top(), "purlin": purlin, "gap": gap});
            let what = format!(
                "the set's top stands {:.4} m above the column head, {:.4} m from the eave purlin of {other} it carries",
                sets.top(),
                gap.abs()
            );
            let fix = "Give every bracket on the frame the same steps and height.";
            return Some(("height", found, what, fix));
        }
    }
    None
}

/// The first purlin of a folded roof, from the ridge down, that stands off the folding rule.
fn off_rule(built: &Roof, p: &Value) -> Found {
    if p.get("profile").and_then(Value::as_str) != Some("folded") {
        return None;
    }
    // The rule as the fields give it: the ridge at `raise` of the frame's depth, and each
    // purlin under the line from the purlin above it, as built, to the eave purlin.
    let n = built.x.len() - 1;
    let ridge = p.get("raise").and_then(Value::as_f64).unwrap_or(0.0) * built.d;
    let mut drop = ridge / 10.0;
    for i in (1..n).rev() {
        let rule = built.h[i + 1] * built.x[i] / built.x[i + 1] - drop;
        drop /= 2.0;
        let difference = built.h[i] - rule;
        if difference.abs() > ON_RULE {
            let found = json!({"in": built.x[i], "difference": difference, "height": built.h[i], "rule": rule});
            let what = format!(
                "the purlin {:.4} m in from the eave stands {:.4} m above the eave purlin, {:.4} m off the folding rule's {rule:.4} m",
                built.x[i],
                built.h[i],
                difference.abs()
            );
            let fix = "Lower each purlin from the line between the purlin above it and the eave purlin: by a tenth of the ridge's height under the ridge, and by half the drop before under each next.";
            return Some(("profile", found, what, fix));
        }
    }
    None
}

/// The first of a corner's samples that stands under the one before it, on the first eave
/// and toward the first corner where one does.
fn falls(built: &Roof) -> Found {
    for side in 0..built.sides() {
        let Some(e) = built.edge(side).filter(|_| built.rise > 0.0) else {
            continue;
        };
        for end in [e.lo, e.hi] {
            let toward = if end == e.lo { 1.0 } else { -1.0 };
            let rise = |k: usize| built.lift(side, end + toward * built.sample(e, k));
            for k in 1..SAMPLES {
                let (before, here) = (rise(k - 1), rise(k));
                if here < before - 1e-9 {
                    let from = built.sample(e, k);
                    let found =
                        json!({"sample": k, "from_corner": from, "rise": here, "before": before});
                    let what = format!(
                        "sample {k} of {SAMPLES}, {from:.4} m from the corner, stands {here:.4} m up, under the {before:.4} m of the sample before it"
                    );
                    let fix = "Raise the eave line toward each corner by an ease that never falls.";
                    return Some(("corner_rise", found, what, fix));
                }
            }
        }
    }
    None
}

/// The first rafter that passes into a purlin.
fn through(built: &Roof) -> Found {
    let [r, ..] = built.sizes();
    let purlins = built.purlins();
    for (k, rafter) in built.rafters().iter().enumerate() {
        for (j, [a, b]) in purlins.iter().enumerate() {
            let purlin = Shape::Capsule { a: *a, b: *b, r };
            let by = depth(&rafter.shape(), &purlin);
            if by > ON_RULE {
                let found = json!({"rafter": k, "purlin": j, "by": by});
                let what = format!(
                    "rafter {k} passes {by:.4} m into purlin {j}: the slope leaves no room for a rafter between the purlin and the tiles"
                );
                let fix = "Lower the raise, or stand the purlins further apart.";
                return Some(("raise", found, what, fix));
            }
        }
    }
    None
}

/// An item's solids: each one's part, or none for an item that is one solid, and its pieces.
pub type Solids = Vec<(Option<&'static str>, Vec<Shape>)>;

/// A timber item's true shape as the geometry audit reads it, in the item's own space: a frame
/// and a bracket each one solid, and a roof its purlins, rafters, tiles and ridge, each a
/// solid of its own named `<part>`; none for any other item, and for one its fields refuse.
pub fn solids(doc: &Value, item: &Value) -> Option<Solids> {
    let p = item.get("params").cloned().unwrap_or(json!({}));
    let moved = |shapes: Vec<Shape>, by: V3| -> Vec<Shape> {
        let m = [
            [1.0, 0.0, 0.0, by[0]],
            [0.0, 1.0, 0.0, by[1]],
            [0.0, 0.0, 1.0, by[2]],
        ];
        shapes
            .iter()
            .map(|s| crate::shapes::placed(s, &m))
            .collect()
    };
    let boxes =
        |members: Vec<Member>| -> Vec<Shape> { members.iter().map(Member::shape).collect() };
    match kind_of(item) {
        FRAME => {
            let f = Frame::read(&p, None).ok()?;
            let foot = f.plinth.map_or(0.0, |pl| pl[0]);
            let columns = f.columns().into_iter().map(|[i, j]| Member {
                a: [f.xs[i] - f.dia / 2.0, foot, f.zs[j]],
                b: [f.xs[i] + f.dia / 2.0, foot, f.zs[j]],
                w: f.dia,
                h: f.eave - foot,
            });
            let all = columns.chain(f.beams()).chain(f.plinths()).collect();
            Some(vec![(None, boxes(all))])
        }
        BRACKET => {
            let (frame, shift) = frame_of(doc, item, &p).ok()?;
            let sets = Sets::read(&frame, &p, !gabled(doc, &p), None).ok()?;
            Some(vec![(None, moved(boxes(sets.members()), shift))])
        }
        "arch.roof@1" => {
            let (roof, shift) = Roof::read(doc, item, &p, None).ok()?;
            let [r, ..] = roof.sizes();
            let purlins = roof.purlins().into_iter();
            let purlins = purlins.map(|[a, b]| Shape::Capsule { a, b, r }).collect();
            Some(vec![
                (Some("purlins"), moved(purlins, shift)),
                (Some("rafters"), moved(boxes(roof.rafters()), shift)),
                (Some("tiles"), moved(boxes(roof.slabs()), shift)),
                (Some("ridge"), moved(boxes(roof.ridges()), shift)),
            ])
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A frame two bays across and two deep, with eight-sided tapered columns on plinths, a
    /// bracket and a roof on it.
    fn hall(roof: Value, sets: Value) -> Value {
        let column = json!({"diameter": 0.4, "sides": 8, "taper": 0.1, "plinth": {"height": 0.2, "width": 0.8}});
        json!({"items": {
            "f": {"kind": FRAME, "params": {"bays": [4, 5], "depth_bays": [3, 3], "eave_height": 3, "column": column}},
            "b": {"kind": BRACKET, "parent": "f", "params": sets},
            "r": {"kind": "arch.roof@1", "parent": "f", "params": roof},
        }})
    }

    #[test]
    fn a_frame_builds_tapered_eight_sided_columns_on_plinths_under_its_beams() {
        let doc = hall(json!({}), json!({}));
        let m = frame(&doc["items"]["f"]["params"], None).unwrap();
        let points = |part: &str| -> Vec<V3> {
            let corners = m.parts[part]
                .iter()
                .flat_map(|t| (0..3).map(move |k| 3 * *t as usize + k));
            corners
                .map(|k| m.positions[m.indices[k] as usize])
                .collect()
        };
        // The first column's ring at a height: how far each point stands from its axis.
        let ring = |y: f64| -> Vec<f64> {
            let all = points("columns").into_iter();
            let near =
                all.filter(|p| (p[1] - y).abs() < 1e-9 && p[0].abs() < 1.0 && p[2].abs() < 1.0);
            near.map(|p| sqrt(p[0] * p[0] + p[2] * p[2])).collect()
        };
        let (foot, head) = (ring(0.2), ring(3.0));
        assert!(
            !foot.is_empty() && foot.iter().all(|r| (r - 0.2).abs() < 1e-9),
            "{foot:?}"
        );
        assert!(
            !head.is_empty() && head.iter().all(|r| (r - 0.18).abs() < 1e-9),
            "{head:?}"
        );
        // Eight sides: 8 side quads and two caps of 6 triangles, on each of the 9 columns.
        assert_eq!(m.parts["columns"].len(), 9 * (16 + 12));
        let plinths = points("plinths");
        let low = |k: usize, v: &[V3]| v.iter().map(|p| p[k]).fold(f64::INFINITY, f64::min);
        let high = |k: usize, v: &[V3]| v.iter().map(|p| p[k]).fold(f64::NEG_INFINITY, f64::max);
        assert_eq!(
            [low(0, &plinths), low(1, &plinths), high(1, &plinths)],
            [-0.4, 0.0, 0.2]
        );
        // A beam along each of the three lines across and the three front to back, under the heads.
        let beams = points("beams");
        assert_eq!(m.parts["beams"].len(), 6 * 12);
        assert!((low(1, &beams) - 2.68).abs() < 1e-9 && (high(1, &beams) - 3.0).abs() < 1e-9);
        assert_eq!([low(0, &beams), high(0, &beams)], [-0.1, 9.1]);
    }

    #[test]
    fn a_roof_s_eave_projects_the_reach_it_is_given_and_never_less_than_its_brackets() {
        let roof_of = |reach: f64| json!({"type": "hip_ridge", "frame": "f", "raise": 0.25, "eave_reach": reach});
        let sets = json!({"on": "column", "frame": "f", "steps": 2, "reach": 0.45, "height": 0.3});
        let built = |reach: f64| {
            let doc = hall(roof_of(reach), sets.clone());
            roof(&doc, &doc["items"]["r"], &doc["items"]["r"]["params"], None)
        };
        let m = built(2.0).unwrap();
        let line = m.outputs["eave_line"].as_array().unwrap();
        let xs = line.iter().map(|p| p[0].as_f64().unwrap());
        let (lo, hi) = xs.fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), x| {
            (lo.min(x), hi.max(x))
        });
        assert!(
            (lo + 2.0).abs() < 1e-9 && (hi - 11.0).abs() < 1e-9,
            "{lo} to {hi}"
        );
        // Its brackets reach 0.9 m: an eave short of them is refused.
        assert_eq!(built(0.5).unwrap_err(), "params/eave_reach");
    }

    #[test]
    fn bracket_sets_stand_between_columns_too_and_only_under_an_eave() {
        let count = |ty: &str, on: &str| {
            let sets = json!({"on": on, "frame": "f", "steps": 1, "reach": 0.4, "height": 0.3});
            let doc = hall(json!({"type": ty, "frame": "f", "raise": 0.25}), sets);
            let m = bracket(&doc, &doc["items"]["b"], &doc["items"]["b"]["params"], None).unwrap();
            // One step is a block, an arm and a cross arm: three boxes of 12 triangles.
            m.triangles() / 36
        };
        // Eight columns stand on the outer lines, and eight places lie between them.
        assert_eq!(
            [count("hip_ridge", "column"), count("hip_ridge", "between")],
            [8, 8]
        );
        // A gabled roof's ends carry no eave: only the front and back rows hold a set.
        assert_eq!(
            [
                count("flush_gable", "column"),
                count("flush_gable", "between")
            ],
            [6, 4]
        );
    }

    #[test]
    fn the_folding_rule_gives_the_design_s_heights() {
        // An 8 m deep frame, raise 1/3, four purlins a side: 0.4444, 1.0222 and 1.7333 m.
        let h = folded(&[0.0, 1.0, 2.0, 3.0, 4.0], 8.0 / 3.0);
        for (got, want) in h.iter().zip([0.0, 0.4444, 1.0222, 1.7333, 2.6667]) {
            assert!((got - want).abs() < 1e-4, "{got} for {want}");
        }
    }
}
