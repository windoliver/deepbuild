//! 3D axes `axes3d@1` and their deform `mod.axes@1` (issue #226; canvas primitives: Marks in 3D:
//! axes `axes3d@1`): three scales, linear or log, over lengths in metres, centred on the item's
//! origin. With `up: z` the math z is world +Y and the math y world −Z, as a reader of
//! z = f(x, y) expects. The data module draws the axes' lines, ticks, labels, tips, titles and
//! grid planes as marks in 3D through the core's fills, and its deform maps an item's points
//! through the three scales, so scene3d names no chart kind and this module no scene3d kind.

use deep_canvas::contributed::{Mark, Request};
use deep_canvas::outline::Refusal;
use deep_canvas::registry::{Raised, Registrar};
use serde_json::{json, Map, Value};

use crate::data::{Scale, ScaleKind};

pub const KIND: &str = "axes3d@1";
pub const DEFORM: &str = "mod.axes@1";
const NAMES: [&str; 3] = ["x", "y", "z"];
/// The look roles the axes draw in, never a status color: their lines, ticks and labels in ink,
/// their grid planes muted.
const INK: &str = "ink";
const MUTED: &str = "muted";
/// A tick label's size, in tick lengths: 0.25 m at the default 0.05 m.
const LABEL: f64 = 5.0;

/// The wrong programs a test build plants by name (#226): a deform that adds the axes' own
/// place as well as mapping through their scales, so a point moves twice as far as its axes;
/// and axes with a tick rule of their own, every tick at full opacity.
pub const PLANTED: [&str; 2] = ["axes_mod_applies_transform", "axes3d_own_tick_rule"];

/// Registers the axes' marks and their deform with the data module.
pub fn register(r: &mut Registrar) {
    r.deform(
        DEFORM,
        json!({"class": "deform", "fixture": {"vertices_in": 8, "vertices_out": 8}}),
        deform,
    );
    r.marks3d(KIND, marks);
    r.rule("axes3d", rule);
}

/// 3D axes as read at a time: their scales (each over the unit range), lengths and options.
pub struct Axes {
    pub scales: [Scale; 3],
    pub lengths: [f64; 3],
    pub up_z: bool,
    tick: f64,
    facing: &'static str,
    tips: bool,
    titles: [Option<String>; 3],
    planes: Vec<[usize; 2]>,
}

fn refusal(code: &'static str, path: String) -> Refusal {
    Refusal {
        code,
        what: path.clone(),
        path,
    }
}

/// Axes item `id` (`item` as at t), its scales read through `item_of` and followed through the
/// document's `channels`.
pub fn read<'d>(
    id: &str,
    item: &Value,
    item_of: &dyn Fn(&str) -> Option<&'d Value>,
    channels: Option<&Value>,
) -> Result<Axes, Refusal> {
    let path = format!("items/{id}/params");
    let p = item.get("params").cloned().unwrap_or(Value::Null);
    let bad = |f: &str| refusal("bad_axis", format!("{path}/{f}"));
    let mut scales = Vec::new();
    for name in NAMES {
        let at = format!("{path}/{name}");
        let sid = p
            .get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| bad(name))?;
        let s = item_of(sid)
            .filter(|s| s.get("kind").and_then(Value::as_str) == Some("scale@1"))
            .ok_or_else(|| refusal("ref_unresolved", at.clone()))?;
        // The axis's length is its range: the scale's own is read as the unit range.
        let mut unit = s.clone();
        unit["params"]["range"] = json!([0, 1]);
        let scale = Scale::read(sid, &unit, &Map::new()).map_err(|r| refusal(r.code, r.path))?;
        if !matches!(scale.kind, ScaleKind::Linear | ScaleKind::Log) {
            return Err(refusal("scale_type", at));
        }
        scales.push(crate::follow::keyed(
            scale,
            sid,
            &unit,
            &Map::new(),
            channels,
        ));
    }
    let lengths = match p
        .get("lengths")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
    {
        Some([a, b, c]) => [a, b, c].map(|v| v.as_f64().filter(|l| l.is_finite() && *l > 0.0)),
        _ => [None; 3],
    };
    let [Some(lx), Some(ly), Some(lz)] = lengths else {
        return Err(bad("lengths"));
    };
    let up_z = match p.get("up").and_then(Value::as_str) {
        None | Some("z") => true,
        Some("y") => false,
        Some(_) => return Err(bad("up")),
    };
    let tick = match p.pointer("/ticks/size") {
        None => 0.05,
        Some(v) => v
            .as_f64()
            .filter(|s| *s > 0.0)
            .ok_or_else(|| bad("ticks/size"))?,
    };
    let facing = match p.pointer("/ticks/labels").and_then(Value::as_str) {
        None | Some("camera") => "camera",
        Some("upright") => "upright",
        Some(_) => return Err(bad("ticks/labels")),
    };
    let tips = match p.get("tips") {
        None => true,
        Some(v) => v.as_bool().ok_or_else(|| bad("tips"))?,
    };
    let mut titles = [None, None, None];
    for (a, name) in NAMES.iter().enumerate() {
        let Some(t) = p.pointer(&format!("/titles/{name}")) else {
            continue;
        };
        let t = t.as_str().ok_or_else(|| bad(&format!("titles/{name}")))?;
        // A title naming a vector item would draw it facing the camera: not drawn yet.
        if item_of(t).is_some() {
            return Err(bad(&format!("titles/{name}")));
        }
        titles[a] = Some(t.to_string());
    }
    let mut planes = Vec::new();
    for (k, v) in p
        .get("planes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        planes.push(match v.as_str() {
            Some("xy") => [0, 1],
            Some("yz") => [1, 2],
            Some("xz") => [0, 2],
            _ => return Err(bad(&format!("planes/{k}"))),
        });
    }
    let [x, y, z]: [Scale; 3] = scales.try_into().map_err(|_| bad("x"))?;
    Ok(Axes {
        scales: [x, y, z],
        lengths: [lx, ly, lz],
        up_z,
        tick,
        facing,
        tips,
        titles,
        planes,
    })
}

impl Axes {
    /// A point in the axes' numbers, in metres in the axes' own space; the axis whose log scale
    /// can't take its value, where one can't.
    pub fn place(&self, p: [f64; 3]) -> Result<[f64; 3], usize> {
        let mut m = [0.0; 3];
        for a in 0..3 {
            if self.scales[a].kind == ScaleKind::Log && (p[a].is_nan() || p[a] <= 0.0) {
                return Err(a);
            }
            m[a] = (self.scales[a].map(p[a]) - 0.5) * self.lengths[a];
        }
        Ok(self.world(m))
    }

    /// A math direction or offset in the axes' own space.
    fn world(&self, m: [f64; 3]) -> [f64; 3] {
        if self.up_z {
            [m[0], m[2], -m[1]]
        } else {
            m
        }
    }

    /// Where the other axes cross axis `a`: their zero, held in their domain, or a log axis's
    /// low end.
    fn cross(&self, a: usize) -> [f64; 3] {
        let mut c = [0.0; 3];
        for (b, s) in self.scales.iter().enumerate().filter(|(b, _)| *b != a) {
            let [lo, hi] = s.domain;
            c[b] = match s.kind {
                ScaleKind::Log => lo,
                _ => 0.0_f64.clamp(lo.min(hi), lo.max(hi)),
            };
        }
        c
    }

    /// Each axis's ticks with their labels and opacities now: the 2D axis's rule, through the
    /// same scale; with the planted own rule, the domain's ticks at full opacity.
    pub fn ticks(&self, planted: Option<&str>) -> [Vec<(f64, String, f64)>; 3] {
        self.scales.clone().map(|s| {
            if planted == Some(PLANTED[1]) {
                s.ticks().into_iter().map(|(v, l)| (v, l, 1.0)).collect()
            } else {
                s.faded_ticks()
            }
        })
    }

    /// The math direction axis `a`'s ticks and labels stand out along, `tick` long: below the x
    /// and y axes, beside the z axis.
    fn beside(&self, a: usize) -> [f64; 3] {
        let mut d = [0.0; 3];
        d[if a == 2 { 0 } else { 2 }] = -self.tick;
        self.world(d)
    }

    /// Each axis's ticks it draws now (opacity above 0), in the axes' own space.
    pub fn shown(&self, planted: Option<&str>) -> [Vec<Tick>; 3] {
        let ticks = self.ticks(planted);
        [0, 1, 2].map(|a| {
            let off = self.beside(a);
            ticks[a]
                .iter()
                .enumerate()
                .filter(|(_, t)| t.2 > 0.0)
                .filter_map(|(k, (value, label, opacity))| {
                    let mut p = self.cross(a);
                    p[a] = *value;
                    let at = self.place(p).ok()?;
                    Some(Tick {
                        k,
                        value: *value,
                        label: label.clone(),
                        opacity: *opacity,
                        at,
                        end: add(at, off, 1.0),
                        label_at: add(at, off, 3.0),
                    })
                })
                .collect()
        })
    }

    /// The axes' marks in their own space.
    fn marks(&self, planted: Option<&str>) -> Vec<Mark> {
        let mut out = Vec::new();
        let line = |sub: String, points: Vec<[f64; 3]>, width: Value, role: &str, opacity: f64| {
            Mark {
                sub,
                kind: "mark.line@1",
                at: [0.0; 3],
                params: json!({"points": points, "width": width, "paint": {"stroke": {"role": role}}}),
                opacity,
            }
        };
        let text = |sub: String, at: [f64; 3], text: &str, opacity: f64| Mark {
            sub,
            kind: "mark.text@1",
            at,
            params: json!({"text": text, "font": "body", "size": LABEL * self.tick,
                           "size_space": "world", "facing": self.facing,
                           "paint": {"fill": {"role": INK}}}),
            opacity,
        };
        let at = |p: [f64; 3]| self.place(p).unwrap_or([0.0; 3]);
        for (a, shown) in self.shown(planted).iter().enumerate() {
            let name = NAMES[a];
            let [lo, hi] = self.scales[a].domain;
            let ends = [lo, hi].map(|v| {
                let mut p = self.cross(a);
                p[a] = v;
                at(p)
            });
            out.push(line(
                format!("{name}.line"),
                ends.to_vec(),
                json!(1.5),
                INK,
                1.0,
            ));
            let mut unit = [0.0; 3];
            unit[a] = 1.0;
            let along = self.world(unit);
            let tip = 3.0 * self.tick;
            if self.tips {
                let points = vec![ends[1], add(ends[1], along, tip)];
                out.push(line(
                    format!("{name}.tip"),
                    points,
                    json!([6.0, 0.0]),
                    INK,
                    1.0,
                ));
            }
            if let Some(t) = &self.titles[a] {
                let place = add(ends[1], along, tip + LABEL * self.tick);
                out.push(text(format!("{name}.title"), place, t, 1.0));
            }
            for t in shown {
                let points = vec![t.at, t.end];
                out.push(line(
                    format!("{name}.tick{}", t.k),
                    points,
                    json!(1.0),
                    INK,
                    t.opacity,
                ));
                out.push(text(
                    format!("{name}.label{}", t.k),
                    t.label_at,
                    &t.label,
                    t.opacity,
                ));
            }
        }
        // Grid planes through the third axis's crossing: a line at each tick of their two axes,
        // faded as that tick is.
        let ticks = self.ticks(planted);
        for [a, b] in &self.planes {
            let c = 3 - a - b;
            let level = self.cross(c)[c];
            for (along, across) in [(*a, *b), (*b, *a)] {
                for (k, (v, _, opacity)) in ticks[along].iter().enumerate() {
                    let [lo, hi] = self.scales[across].domain;
                    let ends = [lo, hi].map(|w| {
                        let mut p = [0.0; 3];
                        p[along] = *v;
                        p[across] = w;
                        p[c] = level;
                        self.place(p)
                    });
                    let ([Ok(e0), Ok(e1)], true) = (ends, *opacity > 0.0) else {
                        continue;
                    };
                    let sub = format!("{}{}.grid.{}{k}", NAMES[*a], NAMES[*b], NAMES[along]);
                    out.push(line(sub, vec![e0, e1], json!(1.0), MUTED, *opacity));
                }
            }
        }
        out
    }
}

/// One tick an axis draws now: its index among the axis's ticks, its value, label and opacity,
/// where it meets the axis, where it ends and where its label stands, in the axes' own space.
#[derive(Clone, Debug, PartialEq)]
pub struct Tick {
    pub k: usize,
    pub value: f64,
    pub label: String,
    pub opacity: f64,
    pub at: [f64; 3],
    pub end: [f64; 3],
    pub label_at: [f64; 3],
}

fn add(a: [f64; 3], b: [f64; 3], k: f64) -> [f64; 3] {
    [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
}

/// The marks fill: the axes' marks at the frame's time.
fn marks(req: &Request<'_, '_>) -> Result<Vec<Mark>, Refusal> {
    Ok(read(req.id, req.value, req.item, req.channels)?.marks(req.planted))
}

/// The deform fill: each point, in the axes' numbers, to its place in metres in the axes' own
/// space, which the item's parents then place in the world; a value a log axis can't take is
/// refused, naming its point.
fn deform(req: &Request<'_, '_>, points: &mut [[f64; 3]]) -> Result<(), Refusal> {
    let axes_id = req.value.pointer("/params/axes").and_then(Value::as_str);
    let item = axes_id
        .and_then(|a| (req.item)(a))
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some(KIND));
    let (Some(axes_id), Some(item)) = (axes_id, item) else {
        return Err(refusal("ref_unresolved", "params/axes".into()));
    };
    let axes = read(axes_id, item, req.item, req.channels)?;
    // The planted wrong program also adds the axes' own place, which their parents apply.
    let moved = (req.planted == Some(PLANTED[0]))
        .then(|| item.pointer("/at/pos").and_then(Value::as_array).cloned())
        .flatten()
        .map(|p| [0, 1, 2].map(|k| p.get(k).and_then(Value::as_f64).unwrap_or(0.0)));
    for (i, p) in points.iter_mut().enumerate() {
        let placed = axes.place(*p).map_err(|a| Refusal {
            code: "log_domain",
            path: i.to_string(),
            what: format!("{} = {} on a log scale", NAMES[a], p[a]),
        })?;
        *p = match moved {
            Some(m) => [placed[0] + m[0], placed[1] + m[1], placed[2] + m[2]],
            None => placed,
        };
    }
    Ok(())
}

/// The ticks each axis shows now, with their opacities, as a 2D axis's `ticks` reads them.
pub fn ticks_report(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    channels: Option<&Value>,
) -> Result<Value, Refusal> {
    let axes = read(id, item, &|k| items.get(k), channels)?;
    let [x, y, z] = axes.ticks(None).map(|t| {
        t.into_iter()
            .map(|(value, _, opacity)| json!({"value": value, "opacity": opacity}))
            .collect::<Vec<_>>()
    });
    Ok(json!({"x": x, "y": y, "z": z}))
}

/// Whether `doc` holds 3D axes, which a host draws in 3D.
pub fn holds(doc: &Value) -> bool {
    doc.get("items")
        .and_then(Value::as_object)
        .is_some_and(|items| {
            items
                .values()
                .any(|i| i.get("kind").and_then(Value::as_str) == Some(KIND))
        })
}

/// The check: the axes read, and every point an item maps through them that a log axis can't
/// take, named.
fn rule(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let raised = |code: &'static str, path: String, what: String| Raised {
        code,
        severity: "error",
        path,
        what,
        fix_ops: None,
    };
    let items = doc.get("items").and_then(Value::as_object);
    let item_of = |k: &str| items.and_then(|m| m.get(k));
    let axes = match read(id, item, &item_of, doc.get("channels")) {
        Ok(a) => a,
        Err(r) => return vec![raised(r.code, r.path, r.what)],
    };
    let mut out = Vec::new();
    for (cid, c) in items.into_iter().flatten() {
        let carries = c
            .get("modifiers")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|m| {
                m.get("kind").and_then(Value::as_str) == Some(DEFORM)
                    && m.pointer("/params/axes").and_then(Value::as_str) == Some(id)
                    && m.get("enabled") != Some(&Value::Bool(false))
            });
        if !carries {
            continue;
        }
        let mut points: Vec<(String, &Value)> = Vec::new();
        if let Some(pos) = c.pointer("/at/pos") {
            points.push((format!("items/{cid}/at/pos"), pos));
        }
        for (i, p) in c
            .pointer("/params/points")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            points.push((format!("items/{cid}/params/points/{i}"), p));
        }
        for (path, p) in points {
            let Some([x, y, z]) = p.as_array().and_then(|a| {
                (a.len() == 3).then(|| [0, 1, 2].map(|k| a[k].as_f64().unwrap_or(f64::NAN)))
            }) else {
                continue;
            };
            if let Err(a) = axes.place([x, y, z]) {
                let v = [x, y, z][a];
                out.push(raised(
                    "log_domain",
                    path,
                    format!("{} = {v} on a log scale", NAMES[a]),
                ));
            }
        }
    }
    out
}
