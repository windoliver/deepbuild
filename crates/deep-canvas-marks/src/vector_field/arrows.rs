use super::*;

/// An expression over x, y (and z) and `magnitude`, for a color.
#[derive(Clone, Debug)]
pub struct Comp3 {
    pub(super) expr: Expr,
    /// Each var: an axis, the magnitude (3) or a number.
    pub(super) slots: Vec<(Option<usize>, f64)>,
}

impl Comp3 {
    pub(super) fn compile(
        text: &str,
        dim: usize,
        vars: &BTreeMap<String, f64>,
        path: &str,
    ) -> Result<Comp3, Refused> {
        let expr = Expr::compile(text, &Nothing, NODES).or_else(|_| refused("bad_doc", path))?;
        let axes = ["x", "y", "z"];
        let slots = expr
            .vars
            .iter()
            .map(|n| {
                if let Some(i) = axes[..dim].iter().position(|a| a == n) {
                    return Ok((Some(i), 0.0));
                }
                if n == "magnitude" {
                    return Ok((Some(3), 0.0));
                }
                vars.get(n).map(|v| (None, *v)).ok_or_else(|| Refused {
                    code: "ref_unresolved",
                    path: format!("{path}: {n}"),
                })
            })
            .collect::<Result<_, _>>()?;
        Ok(Comp3 { expr, slots })
    }

    pub(super) fn at(&self, p: &P3, magnitude: f64) -> f64 {
        let v: Vec<f64> = self
            .slots
            .iter()
            .map(|(axis, n)| match axis {
                Some(3) => magnitude,
                Some(i) => p[*i],
                None => *n,
            })
            .collect();
        self.expr.eval_num(&v)
    }
}

/// The field's arrows: where, how long and how colored.
#[derive(Clone, Debug)]
pub struct Arrows {
    pub grid: Grid,
    pub length: Length,
    pub max: f64,
    pub color: ColorBy,
    pub ramp: Vec<String>,
    pub domain: [f64; 2],
}

/// One arrow as drawn: its tail, its tip, its length (a zero vector's arrow keeps the length its
/// rule gives, with no direction to draw it in), its vector's magnitude and its color's value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Arrow {
    pub tail: P3,
    pub tip: P3,
    pub length: f64,
    pub magnitude: f64,
    pub value: f64,
}

/// The logistic function.
pub fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + deep_canvas::ops::exp(-x))
}

pub(super) fn norm(v: &P3) -> f64 {
    deep_canvas::ops::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

impl Arrows {
    /// Each grid point's arrow, from its tail at the point along the field's vector there; one
    /// whose vector is zero has no direction, its tip at its tail, and one whose vector isn't
    /// finite is left out.
    pub fn at(&self, field: &Field) -> Vec<Arrow> {
        let points = self.grid.points();
        let vs: Vec<P3> = points.iter().map(|p| field.at(p)).collect();
        let longest = vs
            .iter()
            .map(norm)
            .filter(|m| m.is_finite())
            .fold(0.0, f64::max);
        points
            .iter()
            .zip(&vs)
            .filter_map(|(p, v)| {
                let m = norm(v);
                if !m.is_finite() {
                    return None;
                }
                let len = match self.length {
                    Length::Sigmoid => self.max * sigmoid(m),
                    Length::Linear if longest > 0.0 => self.max * m / longest,
                    Length::Linear => 0.0,
                    Length::Constant => self.max,
                };
                let value = match &self.color {
                    ColorBy::Magnitude => m,
                    ColorBy::Expression(e) => e.at(p, m),
                };
                Some(Arrow {
                    tail: *p,
                    tip: if m == 0.0 { *p } else { add(p, v, len / m) },
                    length: len,
                    magnitude: m,
                    value,
                })
            })
            .collect()
    }
}

/// How the flow's phases are set.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Phase {
    Hashed,
    Zero,
}

/// The flow: a trim window over each stream.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Flow {
    pub speed: f64,
    pub flash: f64,
    pub phase: Phase,
    pub warm_up: bool,
}

/// Stream i's phase, hashed from its index alone, in [0, 1).
pub fn phase_of(i: usize) -> f64 {
    // splitmix64.
    let mut z = (i as u64).wrapping_add(0x9e37_79b9_7f4a_7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

impl Flow {
    /// Stream i's window [p, p + flash] of its length at `seconds`, unclamped: p =
    /// fract(t × speed ÷ time + phase_i).
    pub fn window(&self, i: usize, seconds: f64, time: f64) -> [f64; 2] {
        let phase = match self.phase {
            Phase::Hashed => phase_of(i),
            Phase::Zero => 0.0,
        };
        let u = seconds * self.speed / time + phase;
        let p = u - u.floor();
        [p, p + self.flash]
    }

    /// Whether the flow is still warming up at `seconds`: without `warm_up`, before its first lap
    /// a window draws nothing that wraps past a stream's end, so the flow enters from the starts.
    pub fn warming(&self, seconds: f64, time: f64) -> bool {
        !self.warm_up && seconds * self.speed / time < 1.0
    }
}

/// A field's streams: where they start and how they're integrated.
#[derive(Clone, Debug)]
pub struct Streams {
    pub starts: Vec<P3>,
    pub how: Integration,
}

/// A vector field as read from its params, with its vars' values.
#[derive(Clone, Debug)]
pub struct VectorField {
    pub field: Field,
    pub arrows: Option<Arrows>,
    pub streams: Option<Streams>,
    pub flow: Option<Flow>,
    pub scales: Option<[String; 2]>,
    pub axes: Option<String>,
}

/// mulberry32 from `seed`, in [−1, 1).
pub(super) fn jitters(seed: u32, n: usize) -> Vec<f64> {
    let mut s = seed;
    (0..n)
        .map(|_| {
            s = s.wrapping_add(0x6d2b_79f5);
            let mut t = s;
            t = (t ^ (t >> 15)).wrapping_mul(t | 1);
            t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
            ((t ^ (t >> 14)) as f64 / 4_294_967_296.0) * 2.0 - 1.0
        })
        .collect()
}

pub(super) fn vec3(v: &Value) -> Option<P3> {
    let a = v.as_array()?;
    if !(2..=3).contains(&a.len()) {
        return None;
    }
    let mut p = [0.0; 3];
    for (o, x) in p.iter_mut().zip(a) {
        *o = num(Some(x))?;
    }
    Some(p)
}

/// The vars' values: each a number, or as `value` reads its path (a control's, a channel's or a
/// data value's) at the frame.
pub fn var_values(
    params: &Value,
    path: &str,
    value: &dyn Fn(&str) -> Option<f64>,
) -> Result<BTreeMap<String, f64>, Refused> {
    let mut out = BTreeMap::new();
    let Some(vars) = params.get("vars") else {
        return Ok(out);
    };
    let Some(vars) = vars.as_object() else {
        return refused("bad_doc", format!("{path}/vars"));
    };
    for (name, v) in vars {
        let at = format!("{path}/vars/{name}");
        let n = match v {
            Value::Number(_) => num(Some(v)),
            Value::String(p) => value(p),
            _ => None,
        };
        let Some(n) = n else {
            return refused("ref_unresolved", at);
        };
        out.insert(name.clone(), n);
    }
    Ok(out)
}

impl VectorField {
    /// The field's params read with its vars' values; `path` names its params.
    pub fn read(
        params: &Value,
        vars: &BTreeMap<String, f64>,
        path: &str,
        method: Method,
    ) -> Result<VectorField, Refused> {
        let at = |k: &str| format!("{path}/{k}");
        let field = Field::compile(params.get("fn").unwrap_or(&Value::Null), vars, &at("fn"))?;
        let dim = field.dim();
        let scales = match params.get("scales") {
            None => None,
            Some(s) => {
                let x = s.get("x").and_then(Value::as_str);
                let y = s.get("y").and_then(Value::as_str);
                match (x, y) {
                    (Some(x), Some(y)) => Some([x.to_string(), y.to_string()]),
                    _ => return refused("bad_doc", at("scales")),
                }
            }
        };
        let axes = match params.get("axes") {
            None => None,
            Some(a) => Some(
                a.as_str()
                    .map(str::to_string)
                    .map_or_else(|| refused("bad_doc", at("axes")), Ok)?,
            ),
        };
        if scales.is_some() && axes.is_some() {
            return refused("bad_doc", at("axes"));
        }
        let arrows = match params.get("arrows") {
            None => None,
            Some(a) => Some(arrows_of(a, &field, vars, &at("arrows"))?),
        };
        let streams = match params.get("streams") {
            None => None,
            Some(s) => Some(streams_of(s, dim, arrows.as_ref(), &at("streams"), method)?),
        };
        let flow = match params.get("flow") {
            None => None,
            Some(f) => Some(flow_of(f, &at("flow"))?),
        };
        Ok(VectorField {
            field,
            arrows,
            streams,
            flow,
            scales,
            axes,
        })
    }

    /// Each stream's points, from the cache when the same field and streams were integrated
    /// before.
    pub fn streams(&self) -> Arc<Vec<Vec<P3>>> {
        self.streams_timed().0
    }

    /// Each stream's points and the milliseconds their integration took, by the host's clock.
    pub fn streams_timed(&self) -> (Arc<Vec<Vec<P3>>>, f64) {
        let Some(s) = &self.streams else {
            return (Arc::new(Vec::new()), 0.0);
        };
        integrated(&self.field, s)
    }

    /// The field's stream table in data layout `streams@1`: a 2D field's with streams only, as
    /// the layout holds x, y.
    pub fn table(&self) -> Option<streams::Table> {
        if self.field.dim() != 2 {
            return None;
        }
        let s = self.streams.as_ref()?;
        Some(streams::Table {
            fn_x: self.field.texts[0].clone(),
            fn_y: self.field.texts[1].clone(),
            vars: self
                .field
                .vars
                .iter()
                .map(|(k, v)| (k.clone(), *v))
                .collect(),
            step: s.how.step,
            streams: self
                .streams()
                .iter()
                .map(|p| p.iter().map(|q| [q[0], q[1]]).collect())
                .collect(),
        })
    }
}

pub(super) fn arrows_of(
    a: &Value,
    field: &Field,
    vars: &BTreeMap<String, f64>,
    path: &str,
) -> Result<Arrows, Refused> {
    let at = |k: &str| format!("{path}/{k}");
    let grid = Grid::read(
        a.get("grid").unwrap_or(&Value::Null),
        field.dim(),
        &at("grid"),
    )?;
    if grid.len() > MAX_ARROWS {
        return refused("out_of_range", at("grid"));
    }
    let l = a.get("length");
    let length = match l.and_then(|l| l.get("by")).and_then(Value::as_str) {
        None | Some("sigmoid") => Length::Sigmoid,
        Some("linear") => Length::Linear,
        Some("constant") => Length::Constant,
        Some(_) => return refused("bad_doc", at("length/by")),
    };
    let max = match l.and_then(|l| l.get("max")) {
        None => 0.45 * grid.step(),
        v => num(v)
            .filter(|m| *m > 0.0)
            .map_or_else(|| refused("out_of_range", at("length/max")), Ok)?,
    };
    let c = a.get("color");
    let color = match c.and_then(|c| c.get("by")) {
        None => ColorBy::Magnitude,
        Some(Value::String(s)) if s == "magnitude" => ColorBy::Magnitude,
        Some(Value::String(s)) if s == "expression" => {
            let Some(text) = c.and_then(|c| c.get("expression")).and_then(Value::as_str) else {
                return refused("bad_doc", at("color/expression"));
            };
            ColorBy::Expression(Comp3::compile(
                text,
                field.dim(),
                vars,
                &at("color/expression"),
            )?)
        }
        Some(_) => return refused("bad_doc", at("color/by")),
    };
    let ramp: Vec<String> = match c.and_then(|c| c.get("ramp")) {
        None => vec!["ink".into()],
        Some(Value::Array(r)) => r
            .iter()
            .map(|x| x.as_str().map(str::to_string))
            .collect::<Option<_>>()
            .map_or_else(|| refused("bad_doc", at("color/ramp")), Ok)?,
        Some(_) => return refused("bad_doc", at("color/ramp")),
    };
    if ramp.is_empty() || ramp.len() > MAX_RAMP {
        return refused("out_of_range", at("color/ramp"));
    }
    let domain = match c.and_then(|c| c.get("domain")) {
        None => [0.0, 2.0],
        Some(d) => match vec3(d) {
            Some([a, b, _]) if d.as_array().is_some_and(|d| d.len() == 2) && a != b => [a, b],
            _ => return refused("out_of_range", at("color/domain")),
        },
    };
    Ok(Arrows {
        grid,
        length,
        max,
        color,
        ramp,
        domain,
    })
}

pub(super) fn streams_of(
    s: &Value,
    dim: usize,
    arrows: Option<&Arrows>,
    path: &str,
    method: Method,
) -> Result<Streams, Refused> {
    let at = |k: &str| format!("{path}/{k}");
    let positive = |k: &str, d: f64| match s.get(k) {
        None => Ok(d),
        v => num(v)
            .filter(|x| *x > 0.0)
            .map_or_else(|| refused("out_of_range", at(k)), Ok),
    };
    let step = positive("step", 0.05)?;
    let time = positive("time", 3.0)?;
    let pad = match s.get("pad") {
        None => 3.0,
        v => num(v)
            .filter(|x| *x >= 0.0)
            .map_or_else(|| refused("out_of_range", at("pad")), Ok)?,
    };
    let starts = s.get("starts").unwrap_or(&Value::Null);
    // `points [vec3]`, written bare or as `{points}`, or a grid `{x, y, z, step}`.
    let starts = starts.get("points").unwrap_or(starts);
    let (mut points, grid) = match starts {
        Value::Array(list) => {
            if list.len() > MAX_STARTS {
                return refused("out_of_range", at("starts"));
            }
            let p = list
                .iter()
                .enumerate()
                .map(|(i, p)| vec3(p).ok_or(i))
                .collect::<Result<Vec<_>, _>>()
                .or_else(|i| refused("bad_doc", format!("{}/{i}", at("starts"))))?;
            (p, None)
        }
        Value::Object(g) => {
            // `{x, y, z, step}`: each axis [a, b] at the one step.
            let gstep = num(g.get("step"))
                .filter(|x| *x > 0.0)
                .map_or_else(|| refused("out_of_range", at("starts/step")), Ok)?;
            let mut axes = serde_json::Map::new();
            for name in &["x", "y", "z"][..dim] {
                let r = g.get(*name).and_then(Value::as_array);
                match r.map(|r| r.iter().filter_map(|x| num(Some(x))).collect::<Vec<_>>()) {
                    Some(v) if v.len() == 2 => {
                        axes.insert((*name).into(), serde_json::json!([v[0], v[1], gstep]));
                    }
                    _ if *name == "z" => {}
                    _ => return refused("bad_doc", format!("{}/{name}", at("starts"))),
                }
            }
            let grid = Grid::read(&Value::Object(axes), dim, &at("starts"))?;
            if grid.len() > MAX_STARTS {
                return refused("out_of_range", at("starts"));
            }
            (grid.points(), Some(grid))
        }
        _ => return refused("bad_doc", at("starts")),
    };
    let jitter = match s.get("jitter") {
        None => 0.0,
        v => num(v)
            .filter(|x| *x >= 0.0)
            .map_or_else(|| refused("out_of_range", at("jitter")), Ok)?,
    };
    if jitter > 0.0 {
        let seed = s.get("seed").and_then(Value::as_u64).unwrap_or(0) as u32;
        let j = jitters(seed, points.len() * dim);
        for (i, p) in points.iter_mut().enumerate() {
            for k in 0..dim {
                p[k] += jitter * j[i * dim + k];
            }
        }
    }
    let cap = if points.len() <= FEW_STARTS {
        MAX_POINTS_FEW
    } else {
        MAX_POINTS
    };
    let max_points = match s.get("max_points") {
        None => MAX_POINTS,
        v => v
            .and_then(Value::as_u64)
            .map(|n| n as usize)
            .filter(|n| (2..=cap).contains(n))
            .map_or_else(|| refused("out_of_range", at("max_points")), Ok)?,
    };
    if !matches!(s.get("method").and_then(Value::as_str), None | Some("rk4")) {
        return refused("bad_doc", at("method"));
    }
    // The grid's box: the starts' grid, else the arrows', else the box the start points span,
    // widened by `pad`.
    let bounds = match grid.as_ref().or(arrows.map(|a| &a.grid)) {
        Some(g) => Some(g.bounds(pad)),
        None => points.iter().fold(None, |b: Option<Bounds>, p| {
            let mut b = b.unwrap_or(Bounds {
                lo: [f64::INFINITY; 3],
                hi: [f64::NEG_INFINITY; 3],
            });
            for (k, v) in p.iter().enumerate().take(3) {
                b.lo[k] = b.lo[k].min(v - pad);
                b.hi[k] = b.hi[k].max(v + pad);
            }
            Some(b)
        }),
    };
    Ok(Streams {
        starts: points,
        how: Integration {
            step,
            time,
            bounds,
            max_points,
            method,
        },
    })
}

pub(super) fn flow_of(f: &Value, path: &str) -> Result<Flow, Refused> {
    let at = |k: &str| format!("{path}/{k}");
    let speed = match f.get("speed") {
        None => 1.0,
        v => num(v).map_or_else(|| refused("out_of_range", at("speed")), Ok)?,
    };
    let flash = match f.get("flash") {
        None => 0.3,
        v => num(v)
            .filter(|x| (0.0..=1.0).contains(x))
            .map_or_else(|| refused("out_of_range", at("flash")), Ok)?,
    };
    let phase = match f.get("phase").and_then(Value::as_str) {
        None | Some("hashed") => Phase::Hashed,
        Some("zero") => Phase::Zero,
        Some(_) => return refused("bad_doc", at("phase")),
    };
    let warm_up = match f.get("warm_up") {
        None => true,
        Some(Value::Bool(b)) => *b,
        Some(_) => return refused("bad_doc", at("warm_up")),
    };
    Ok(Flow {
        speed,
        flash,
        phase,
        warm_up,
    })
}
