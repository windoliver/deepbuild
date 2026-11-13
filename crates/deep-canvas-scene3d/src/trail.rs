//! #450: a trail on any item (canvas primitives: Marks in 3D: trail). A `mark.line@1` with
//! `trail` draws its source's world position at earlier times, each read through the same pure
//! evaluation as the frame (channels, drivers, parents, or a physics bake's outputs), so nothing
//! is recorded between frames and a seek draws what a play draws.
//!
//! Its window is the last `span` seconds; or `since` the matches of an occurrence list, each
//! start's path to t or to its end once that has passed (its `until` match, or else the next
//! start), the last `keep` of them side by side; or `whole`, samples taken once at check at
//! `rate` from `from` to the transport's end and kept by the source chain's content, of which a
//! frame draws those before t and a last segment ending at the source at t, so the trace is the
//! same at every frame rate.

use std::collections::BTreeMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Arc;

use deep_canvas::camera::{Vec3, FLICKS_PER_SECOND};
use deep_canvas_motion::program::Program;
use serde_json::{Map, Value};

use crate::scene::{Line, Refused, Segment};

const F: f64 = FLICKS_PER_SECOND as f64;
/// The most segments a trace takes, and the most traces a `since` window keeps.
pub const MAX_SEGMENTS: u64 = 64;
pub const MAX_KEEP: u64 = 8;

/// Which stretch of the source's path a trail draws.
#[derive(Clone, Debug, PartialEq)]
pub enum Window {
    /// The last `span` seconds up to t.
    Span,
    /// From each match of `on` to t, or to its end once that has passed.
    Since {
        on: Value,
        until: Option<Value>,
        keep: usize,
    },
    /// Samples at `rate` from `from` (a number of seconds, a time literal or `{marker}`; the
    /// transport's start when unset) to the transport's end, baked at check.
    Whole { from: Value },
}

/// A trail as written, defaults filled.
#[derive(Clone, Debug, PartialEq)]
pub struct Trail {
    /// The source item's ID, or `<world>#<body>` for a physics bake's body; an `#anchor` on an
    /// item reads the item's origin.
    pub of: String,
    pub span: f64,
    pub segments: usize,
    pub width: f64,
    pub taper: f64,
    pub fade: f64,
    /// `space: local`: the trace rides the source's parent, drawn where the parent is at t.
    pub local: bool,
    pub window: Window,
    pub rate: f64,
    pub max_points: u64,
}

/// One drawn trace: when it starts, the last time it draws, and its points (world m) with the
/// times they were evaluated at, oldest first.
#[derive(Clone, Debug, PartialEq)]
pub struct Trace {
    pub start: i64,
    pub end: i64,
    pub times: Vec<i64>,
    pub points: Vec<Vec3>,
}

/// What a trail draws at t: the trail, its source's place at t, its traces, the whole window's
/// baked samples, and each segment's alpha at its two ends, in the line's segment order.
#[derive(Clone, Debug, PartialEq)]
pub struct Drawn {
    pub trail: Trail,
    pub source: Vec3,
    pub traces: Vec<Trace>,
    pub samples: Option<Arc<Vec<(i64, Vec3)>>>,
    pub alpha: Vec<[f64; 2]>,
}

fn bad<T>(path: &str) -> Result<T, Refused> {
    Err(Refused {
        code: "out_of_range",
        path: path.to_string(),
    })
}

/// The line's trail, or `None` when it has none; a field out of its range is refused, naming it.
pub fn read(params: &Value, path: &str) -> Result<Option<Trail>, Refused> {
    let Some(t) = params.get("trail").filter(|t| !t.is_null()) else {
        return Ok(None);
    };
    let path = format!("{path}/trail");
    let Some(t) = t.as_object() else {
        return bad(&path);
    };
    let at = |f: &str| format!("{path}/{f}");
    let num = |f: &str, d: f64| match t.get(f) {
        None => Ok(d),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite())
            .map_or_else(|| bad(&at(f)), Ok),
    };
    let whole = |f: &str, d: u64, max: u64| match t.get(f) {
        None => Ok(d),
        Some(v) => v
            .as_u64()
            .filter(|&n| (1..=max).contains(&n))
            .map_or_else(|| bad(&at(f)), Ok),
    };
    let Some(of) = t.get("of").and_then(Value::as_str) else {
        return bad(&at("of"));
    };
    let span = num("span", 0.5)?;
    let rate = num("rate", 60.0)?;
    if span <= 0.0 {
        return bad(&at("span"));
    }
    if rate <= 0.0 {
        return bad(&at("rate"));
    }
    let local = match t.get("space").and_then(Value::as_str) {
        None | Some("world") if t.get("space").is_none_or(Value::is_string) => false,
        Some("local") => true,
        _ => return bad(&at("space")),
    };
    let window = match t.get("window") {
        None => Window::Span,
        Some(Value::String(s)) if s == "span" => Window::Span,
        Some(Value::Object(w)) if w.len() == 1 => {
            let (name, body) = w.iter().next().expect("one key");
            let wpath = format!("{path}/window/{name}");
            match (name.as_str(), body) {
                ("since", Value::Object(s)) => Window::Since {
                    on: s
                        .get("on")
                        .cloned()
                        .map_or_else(|| bad(&format!("{wpath}/on")), Ok)?,
                    until: s.get("until").cloned(),
                    keep: match s.get("keep") {
                        None => 3,
                        Some(k) => k
                            .as_u64()
                            .filter(|&n| (1..=MAX_KEEP).contains(&n))
                            .map_or_else(|| bad(&format!("{wpath}/keep")), Ok)?
                            as usize,
                    },
                },
                ("whole", Value::Object(s)) => Window::Whole {
                    from: s.get("from").cloned().unwrap_or(Value::Null),
                },
                _ => return bad(&wpath),
            }
        }
        Some(_) => return bad(&at("window")),
    };
    Ok(Some(Trail {
        of: of.to_string(),
        span,
        segments: whole("segments", 16, MAX_SEGMENTS)? as usize,
        width: num("width", 2.0)?.max(0.0),
        taper: num("taper", 1.0)?.max(0.0),
        fade: num("fade", 1.0)?.max(0.0),
        local,
        window,
        rate,
        max_points: whole("max_points", 36_000, u64::from(u32::MAX))?,
    }))
}

/// Where `item` stood (world m) at each of `times`, read through the chain a trail reads (#450;
/// #166's wake reads it in the water's plane): its channels and parents, or a physics bake's
/// output kept through the world's span, `<world>#<body>`, never an earlier frame
/// ([`crate::water::logic_moved`] refuses an item a logic array moves). An `#anchor` on an item
/// reads the item's origin; a source that resolves to nothing is refused at `path`.
pub(crate) fn path_at(
    map: &Map<String, Value>,
    program: &Program,
    items: &crate::scene::Items<'_>,
    item: &str,
    times: &[i64],
    path: &str,
) -> Result<Vec<Vec3>, Refused> {
    let unresolved = || {
        Err(Refused {
            code: "ref_unresolved",
            path: path.to_string(),
        })
    };
    if let Some((owner, body)) = item.split_once('#') {
        let world = items.get(owner);
        if world.is_some_and(|w| w.get("kind").and_then(Value::as_str) == Some("fixture.world@1")) {
            let params = world.map_or(Value::Null, |w| w["params"].clone());
            let bake = crate::fixtures::bake(&params, &format!("items/{owner}/params"))?;
            let Some(k) = bake.bodies.iter().position(|b| b.id == body) else {
                return unresolved();
            };
            return Ok(times.iter().map(|&at| bake.at(at)[k]).collect());
        }
    }
    let id = item.split('#').next().unwrap_or(item);
    if items.get(id).is_none() {
        return unresolved();
    }
    let at = |t| crate::scene::origin_at(map, program, id, t);
    Ok(times.iter().map(|&t| at(t)).collect())
}

/// `count + 1` times spread evenly over `[a, b]`, in flicks, oldest first.
fn spread(a: i64, b: i64, count: usize) -> Vec<i64> {
    let n = count.max(1) as i128;
    (0..=n)
        .map(|i| a + ((i128::from(b - a) * i) / n) as i64)
        .collect()
}

/// The transport's start and end in flicks; its end is `None` with no span.
fn transport(program: &Program) -> (i64, Option<i64>) {
    let tr = &program.motion.transport;
    (tr.start, tr.span.map(|s| tr.start + s))
}

/// When a whole window starts: the transport's start, a number of seconds, a time literal or
/// `{marker}`, a marker's start.
fn from_of(program: &Program, from: &Value, path: &str) -> Result<i64, Refused> {
    let markers = &program.motion.markers;
    match from {
        Value::Null => Ok(transport(program).0),
        Value::Object(m) => m
            .get("marker")
            .and_then(Value::as_str)
            .and_then(|id| markers.iter().find(|k| k.id == id))
            .map(|k| k.start)
            .ok_or(Refused {
                code: "ref_unresolved",
                path: path.to_string(),
            }),
        Value::Number(n) => n
            .as_f64()
            .filter(|x| x.is_finite())
            .map_or_else(|| bad(path), |s| Ok((s * F).round() as i64)),
        Value::String(s) => {
            let ctx = deep_canvas::grammar::TimeContext {
                frame_rate: program.motion.frame_rate,
                markers: markers
                    .iter()
                    .map(|m| (m.id.clone(), (m.start, m.end)))
                    .collect(),
            };
            deep_canvas::grammar::Time::parse(s)
                .and_then(|time| time.resolve(&ctx))
                .map_err(|_| Refused {
                    code: "ref_unresolved",
                    path: path.to_string(),
                })
        }
        _ => bad(path),
    }
}

/// The whole window's sample times, from `from` at `rate` to the transport's end; refused past
/// `max_points`, naming the trail.
pub fn sample_times(
    trail: &Trail,
    program: &Program,
    from: &Value,
    path: &str,
) -> Result<Vec<i64>, Refused> {
    let from = from_of(program, from, &format!("{path}/trail/window/whole/from"))?;
    let Some(end) = transport(program).1 else {
        return bad(&format!("{path}/trail/window"));
    };
    let last = ((end - from).max(0) as f64 * trail.rate / F + 1e-9).floor() as u64;
    if last + 1 > trail.max_points {
        return bad(&format!("{path}/trail/max_points"));
    }
    Ok((0..=last)
        .map(|k| from + (k as f64 * F / trail.rate).round() as i64)
        .collect())
}

/// The source's world places at the times asked, or why it can't be read.
pub type Places<'a> = dyn Fn(&[i64]) -> Result<Vec<Vec3>, Refused> + 'a;

/// Whole windows' samples by key, as a session keeps them.
pub type Held = BTreeMap<u64, Arc<Vec<(i64, Vec3)>>>;

/// The whole window's samples, kept in `held` by key once taken.
fn baked(
    key: u64,
    held: &mut Held,
    take: impl FnOnce() -> Result<Vec<(i64, Vec3)>, Refused>,
) -> Result<Arc<Vec<(i64, Vec3)>>, Refused> {
    if let Some(s) = held.get(&key) {
        return Ok(s.clone());
    }
    let samples = Arc::new(take()?);
    // A long session's bakes stay bounded: the oldest are let go together.
    if held.len() >= 64 {
        held.clear();
    }
    held.insert(key, samples.clone());
    Ok(samples)
}

/// The whole window's key: the trail as written, its source chain's items (the source, its
/// parents, or the world a body belongs to) and everything else the evaluation reads but the
/// other items and the arrays a frame writes.
fn key(map: &Map<String, Value>, line: &str, trail: &Value) -> u64 {
    let mut h = DefaultHasher::new();
    line.hash(&mut h);
    trail.to_string().hash(&mut h);
    let items = map.get("items").and_then(Value::as_object);
    let of = trail["of"].as_str().unwrap_or("");
    let mut at = of.split('#').next();
    let mut seen = Vec::new();
    while let Some(id) = at.filter(|id| !seen.contains(id)) {
        seen.push(id);
        let item = items.and_then(|i| i.get(id));
        item.map(Value::to_string).hash(&mut h);
        at = item.and_then(|i| i.get("parent")).and_then(Value::as_str);
    }
    for (k, v) in map {
        if k != "items" && k != "arrays" {
            k.hash(&mut h);
            v.to_string().hash(&mut h);
        }
    }
    h.finish()
}

/// What `trail` on line `id` (at `path`) draws at `t`, the source read at earlier times through
/// `at`, a whole window's samples kept in `held`.
pub fn drawn(
    trail: &Trail,
    (map, program, t): (&Map<String, Value>, &Program, i64),
    (id, path): (&str, &str),
    at: &Places<'_>,
    held: &mut Held,
) -> Result<Drawn, Refused> {
    let trace = |start: i64, end: i64, times: Vec<i64>| -> Result<Trace, Refused> {
        let points = at(&times)?;
        Ok(Trace {
            start,
            end,
            times,
            points,
        })
    };
    let span = (trail.span * F).round() as i64;
    let mut samples = None;
    let traces = match &trail.window {
        // Point i at t − (segments − i) × span ÷ segments, the last at t.
        Window::Span => {
            let n = trail.segments as i128;
            let times = (0..=n)
                .map(|i| t - ((n - i) * i128::from(span) / n) as i64)
                .collect();
            vec![trace(t - span, t, times)?]
        }
        Window::Since { on, until, keep } => {
            let wpath = format!("{path}/trail/window/since");
            let starts =
                deep_canvas_motion::occurrence::matches(program, map, on, &format!("{wpath}/on"))
                    .map_err(|r| Refused {
                    code: r.code,
                    path: r.path,
                })?;
            let ends = match until {
                Some(u) => deep_canvas_motion::occurrence::matches(
                    program,
                    map,
                    u,
                    &format!("{wpath}/until"),
                )
                .map_err(|r| Refused {
                    code: r.code,
                    path: r.path,
                })?,
                None => Vec::new(),
            };
            let shown = starts.partition_point(|o| o.t <= t);
            let mut out = Vec::new();
            for k in shown.saturating_sub(*keep)..shown {
                let s = starts[k].t;
                let next = starts.get(k + 1).map(|o| o.t);
                let end = ends.iter().map(|o| o.t).find(|&e| e > s).or(next);
                let last = end.map_or(t, |e| e.min(t));
                out.push(trace(s, last, spread(s, last, trail.segments))?);
            }
            out
        }
        Window::Whole { from } => {
            let raw = map
                .get("items")
                .and_then(|i| i.pointer(&format!("/{id}/params/trail")));
            let raw = raw.cloned().unwrap_or_default();
            let times = sample_times(trail, program, from, path)?;
            let all = baked(key(map, id, &raw), held, || {
                let places = at(&times)?;
                Ok(times.iter().copied().zip(places).collect())
            })?;
            // The samples before t and not before t − span, then the source at t.
            let before: Vec<&(i64, Vec3)> = all
                .iter()
                .filter(|(s, _)| *s < t && *s >= t - span)
                .collect();
            let mut times: Vec<i64> = before.iter().map(|(s, _)| *s).collect();
            let mut points: Vec<Vec3> = before.iter().map(|(_, p)| *p).collect();
            times.push(t);
            points.extend(at(&[t])?);
            samples = Some(all.clone());
            let start = times.first().copied().unwrap_or(t);
            vec![Trace {
                start,
                end: t,
                times,
                points,
            }]
        }
    };
    let source = at(&[t])?.first().copied().unwrap_or_default();
    Ok(Drawn {
        trail: trail.clone(),
        source,
        traces,
        samples,
        alpha: Vec::new(),
    })
}

/// A `space: local` trail's traces moved with its source's parent: each point evaluated at τ is
/// taken into the parent's space as the parent stood then, and out again as it stands at t, so
/// the trace rides along; a source with no parent, or a world trail, is left as it is.
pub fn ride(
    trail: &Trail,
    drawn: &mut Drawn,
    world_at: impl Fn(&str, i64) -> crate::scene::Affine3,
    map: &Map<String, Value>,
    t: i64,
) {
    let source = trail.of.split('#').next().unwrap_or("");
    let parent = map
        .get("items")
        .and_then(|i| i.get(source))
        .and_then(|i| i.get("parent"))
        .and_then(Value::as_str);
    let Some(parent) = parent.filter(|_| trail.local) else {
        return;
    };
    let now = world_at(parent, t);
    for tr in &mut drawn.traces {
        for (p, &at) in tr.points.iter_mut().zip(&tr.times) {
            let then = crate::cut::inverse(&world_at(parent, at));
            *p = crate::scene::apply(&now, crate::scene::apply(&then, *p));
        }
    }
}

/// The line a trail draws: each trace's points joined in order, its width tapered and its alpha
/// faded toward the trace's oldest point, `(1 − u)^taper` and `(1 − u)^fade` at the share `u` of
/// the trace's time behind its newest point.
pub fn line(
    id: &str,
    trail: &Trail,
    mut drawn: Drawn,
    color: [u8; 3],
    world: bool,
    cap: crate::points::Cap,
) -> Line {
    let mut segments = Vec::new();
    let mut alpha = Vec::new();
    for tr in &drawn.traces {
        let (Some(&old), Some(&new)) = (tr.times.first(), tr.times.last()) else {
            continue;
        };
        let u = |k: usize| match new - old {
            0 => 0.0,
            d => (new - tr.times[k]) as f64 / d as f64,
        };
        let w = |k: usize| trail.width * (1.0 - u(k)).max(0.0).powf(trail.taper);
        let a = |k: usize| (1.0 - u(k)).max(0.0).powf(trail.fade);
        for k in 1..tr.points.len() {
            segments.push(Segment {
                a: tr.points[k - 1],
                b: tr.points[k],
                wa: w(k - 1),
                wb: w(k),
                hidden: false,
            });
            alpha.push([a(k - 1), a(k)]);
        }
    }
    drawn.alpha = alpha;
    Line {
        id: id.to_string(),
        segments,
        world,
        color,
        edges: None,
        over: false,
        joined: true,
        dash: [0.0; 2],
        dash_world: false,
        cap,
        trail: Some(Arc::new(drawn)),
    }
}
