//! #450: a trail on any item (canvas primitives: Marks in 3D: trail), on a 3D `mark.line@1` or a
//! 2D `path@1`. A trail draws its source's position at earlier times, each read through the same
//! pure evaluation as the frame (channels, drivers, parents, or a physics bake's outputs), so
//! nothing is recorded between frames and a seek draws what a play draws.
//!
//! Its window is the last `span` seconds; or `since` the matches of an occurrence list, each
//! start's path to t or to its end once that has passed (its `until` match, or else the next
//! start), the last `keep` of them side by side; or `whole`, samples taken once at check at
//! `rate` from `from` to the transport's end and kept by the source chain's content, of which a
//! frame draws those before t and a last segment ending at the source at t, so the trace is the
//! same at every frame rate.
//!
//! This module reads a trail and gives its traces from a reader of the source's places; scene3d
//! reads a 3D source and draws the line, and [`flat`] draws a 2D `path@1`'s trail into the
//! evaluated item as path data and per-point width and opacity columns (Path `path@1`).

use std::collections::BTreeMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, Mutex};

use deep_canvas::grammar::FLICKS_PER_SECOND;
use serde_json::{json, Map, Value};

use crate::doc::Refused;
use crate::program::{Program, State};

const F: f64 = FLICKS_PER_SECOND as f64;
/// The most segments a trace takes, and the most traces a `since` window keeps.
pub const MAX_SEGMENTS: u64 = 64;
pub const MAX_KEEP: u64 = 8;
/// One evaluation of a source's chain, ms (canvas primitives: Marks in 3D: trail, Cost: "about
/// 100 ns each", an estimate).
pub const CHAIN_MS: f64 = 100e-6;

/// A place: world m in 3D, or u in 2D with z = 0.
pub type P = [f64; 3];

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

/// One drawn trace: when it starts, the last time it draws, and its points with the times they
/// were evaluated at, oldest first.
#[derive(Clone, Debug, PartialEq)]
pub struct Trace {
    pub start: i64,
    pub end: i64,
    pub times: Vec<i64>,
    pub points: Vec<P>,
}

/// What a trail draws at t: its source's place at t, its traces and a whole window's samples.
#[derive(Clone, Debug, PartialEq)]
pub struct Traced {
    pub source: P,
    pub traces: Vec<Trace>,
    pub samples: Option<Arc<Vec<(i64, P)>>>,
}

/// The source's places at the times asked, or why it can't be read.
pub type Places<'a> = dyn Fn(&[i64]) -> Result<Vec<P>, Refused> + 'a;

/// Whole windows' samples by key, as a session keeps them.
pub type Held = BTreeMap<u64, Arc<Vec<(i64, P)>>>;

/// A compiled program's whole-window bakes for its 2D trails, kept with it: it compares equal
/// to any other and a copy shares it, so it never tells two programs apart.
#[derive(Clone, Debug, Default)]
pub struct Bakes(Arc<Mutex<Held>>);

impl PartialEq for Bakes {
    fn eq(&self, _: &Bakes) -> bool {
        true
    }
}

fn bad<T>(path: &str) -> Result<T, Refused> {
    Err(Refused {
        code: "out_of_range",
        path: path.to_string(),
        detail: None,
    })
}

/// The item's trail, or `None` when it has none; a field out of its range is refused, naming it.
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
    let unresolved = || Refused {
        code: "ref_unresolved",
        path: path.to_string(),
        detail: None,
    };
    match from {
        Value::Null => Ok(transport(program).0),
        Value::Object(m) => m
            .get("marker")
            .and_then(Value::as_str)
            .and_then(|id| markers.iter().find(|k| k.id == id))
            .map(|k| k.start)
            .ok_or_else(unresolved),
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
                .map_err(|_| unresolved())
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

/// The whole window's samples, kept in `held` by key once taken.
fn baked(
    key: u64,
    held: &mut Held,
    take: impl FnOnce() -> Result<Vec<(i64, P)>, Refused>,
) -> Result<Arc<Vec<(i64, P)>>, Refused> {
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

/// What `trail` on item `id` (at `path`) draws at `t`, the source read at earlier times through
/// `at`, a whole window's samples kept in `held`.
pub fn traced(
    trail: &Trail,
    (map, program, t): (&Map<String, Value>, &Program, i64),
    (id, path): (&str, &str),
    at: &Places<'_>,
    held: &mut Held,
) -> Result<Traced, Refused> {
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
            let starts = crate::occurrence::matches(program, map, on, &format!("{wpath}/on"))?;
            let ends = match until {
                Some(u) => crate::occurrence::matches(program, map, u, &format!("{wpath}/until"))?,
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
            let before: Vec<&(i64, P)> = all
                .iter()
                .filter(|(s, _)| *s < t && *s >= t - span)
                .collect();
            let mut times: Vec<i64> = before.iter().map(|(s, _)| *s).collect();
            let mut points: Vec<P> = before.iter().map(|(_, p)| *p).collect();
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
    Ok(Traced {
        source,
        traces,
        samples,
    })
}

/// Each point's share of the trail's width and its alpha: `(1 − u)^taper` and `(1 − u)^fade` at
/// the share `u` of the trace's time behind its newest point.
pub fn shares(trail: &Trail, trace: &Trace) -> Vec<(f64, f64)> {
    let (Some(&old), Some(&new)) = (trace.times.first(), trace.times.last()) else {
        return Vec::new();
    };
    let pow = deep_canvas::ops::pow;
    trace
        .times
        .iter()
        .map(|&at| {
            let left = match new - old {
                0 => 1.0,
                d => (1.0 - (new - at) as f64 / d as f64).max(0.0),
            };
            (pow(left, trail.taper), pow(left, trail.fade))
        })
        .collect()
}

/// A trail's CPU per frame, ms, for the budget estimate (The cost model): one evaluation of its
/// source's chain per point a frame reads, `segments` + 1 a trace and the source at t; a whole
/// window reads its bake, taken at check, and the source at t.
pub fn cost(item: &Value) -> f64 {
    let Ok(Some(trail)) = read(&item["params"], "") else {
        return 0.0;
    };
    let points = (trail.segments + 1) as f64;
    let evaluations = match trail.window {
        Window::Span => points + 1.0,
        Window::Since { keep, .. } => keep as f64 * points + 1.0,
        Window::Whole { .. } => 2.0,
    };
    evaluations * CHAIN_MS
}

/// The item of a trail's source chain (the source and its parents) that a driver reading a
/// `logic` item's array moves: a live simulation keeps no earlier steps for a trail to read.
fn logic_moved(doc: &Map<String, Value>, of: &str) -> Option<String> {
    let items = doc.get("items").and_then(Value::as_object)?;
    let mut chain = Vec::new();
    let mut at = of.split('#').next();
    while let Some(id) = at.filter(|id| !chain.contains(id)) {
        chain.push(id);
        at = items.get(id)?.get("parent").and_then(Value::as_str);
    }
    let logic = |v: &Value| {
        let owner = v.as_str().and_then(|p| p.split_once('.')).map(|(o, _)| o);
        owner
            .and_then(|o| items.get(o)?.get("kind")?.as_str())
            .is_some_and(|k| k.starts_with("logic"))
    };
    let drivers = doc.get("drivers").and_then(Value::as_object)?;
    drivers.values().find_map(|d| {
        let target = d.get("target").and_then(Value::as_str).unwrap_or("");
        let reads = d
            .get("vars")
            .and_then(Value::as_object)?
            .values()
            .any(logic);
        let moved = chain
            .iter()
            .find(|c| target.starts_with(&format!("items/{c}/")));
        moved.filter(|_| reads).map(|c| c.to_string())
    })
}

/// The check over an item's trail: a field out of its range, a source a logic array moves, a list
/// or a marker it names that doesn't resolve, or a whole window past its `max_points`, each refused
/// naming the trail or the moved item.
pub fn rule(doc: &Value, id: &str, item: &Value) -> Vec<deep_canvas::registry::Raised> {
    let path = format!("items/{id}/params");
    let raised = |r: Refused| deep_canvas::registry::Raised {
        code: r.code,
        severity: "error",
        what: format!("{id}'s trail: {}", r.path),
        path: r.path,
        fix_ops: None,
    };
    let trail = match read(&item["params"], &path) {
        Ok(Some(t)) => t,
        Ok(None) => return Vec::new(),
        Err(r) => return vec![raised(r)],
    };
    let Some(map) = doc.as_object() else {
        return Vec::new();
    };
    if let Some(moved) = logic_moved(map, &trail.of) {
        return vec![raised(Refused {
            code: "out_of_range",
            path: format!("items/{moved}"),
            detail: None,
        })];
    }
    let Ok(program) = Program::compile(map) else {
        return Vec::new();
    };
    let checked = match &trail.window {
        Window::Whole { from } => sample_times(&trail, &program, from, &path).map(|_| ()),
        Window::Since { on, until, .. } => {
            let wpath = format!("{path}/trail/window/since");
            crate::occurrence::matches(&program, map, on, &format!("{wpath}/on")).and_then(|_| {
                until.as_ref().map_or(Ok(()), |u| {
                    crate::occurrence::matches(&program, map, u, &format!("{wpath}/until"))
                        .map(|_| ())
                })
            })
        }
        Window::Span => Ok(()),
    };
    checked.err().map(raised).into_iter().collect()
}

/// A 2D item's place at its parents' places: each parent's `at` (pos, then a rotation in degrees
/// and a scale) taken outward in turn.
fn placed(items: &Map<String, Value>, id: &str) -> P {
    let pair = |v: Option<&Value>, d: f64| match v {
        Some(Value::Array(a)) => [
            a.first().and_then(Value::as_f64).unwrap_or(d),
            a.get(1).and_then(Value::as_f64).unwrap_or(d),
        ],
        Some(v) => [v.as_f64().unwrap_or(d); 2],
        None => [d; 2],
    };
    let mut at = items
        .get(id)
        .map_or([0.0; 2], |i| pair(i.pointer("/at/pos"), 0.0));
    let mut seen = vec![id];
    let mut parent = items.get(id).and_then(|i| i.get("parent")?.as_str());
    while let Some(p) = parent.filter(|p| !seen.contains(p)) {
        seen.push(p);
        let Some(item) = items.get(p) else { break };
        let [x, y] = pair(item.pointer("/at/pos"), 0.0);
        let [sx, sy] = pair(item.pointer("/at/scale"), 1.0);
        // A 2D turn, in degrees: a number, or the first of an evaluated item's three slots.
        let rot = item.pointer("/at/rot");
        let deg = rot.and_then(|r| r.as_f64().or_else(|| r.get(0)?.as_f64()));
        let r = deep_canvas::ops::rad(deg.unwrap_or(0.0));
        let (s, c) = (deep_canvas::ops::sin(r), deep_canvas::ops::cos(r));
        let (u, v) = (at[0] * sx, at[1] * sy);
        at = [x + c * u - s * v, y + s * u + c * v];
        parent = item.get("parent").and_then(Value::as_str);
    }
    [at[0], at[1], 0.0]
}

/// #450: each 2D `path@1` in `items` with a `trail` (Marks in 3D: trail, on `path@1` in a 2D
/// writer layer) drawn as its trail: its path data the traces in its own space, one subpath a
/// trace, with a per-point `width` (its trail width times its taper share, u) and `opacity`
/// column (its fade share). The source's place at each earlier time comes from the document
/// evaluated afresh at that time, its parents included; a trail that can't be read draws
/// nothing, as the check refuses it.
pub(crate) fn flat(
    doc: &Map<String, Value>,
    program: &Program,
    state: &State,
    items: &mut Map<String, Value>,
) {
    let trailed: Vec<String> = items
        .iter()
        .filter(|(_, i)| i["kind"] == "path@1" && !i["params"]["trail"].is_null())
        .map(|(id, _)| id.clone())
        .collect();
    for id in trailed {
        let path = format!("items/{id}/params");
        let Ok(Some(trail)) = read(&items[&id]["params"], &path) else {
            items[&id]["params"]["d"] = Value::from("");
            continue;
        };
        let source = trail.of.split('#').next().unwrap_or("").to_string();
        // The source and its parents, the items its place reads.
        let all = doc.get("items").and_then(Value::as_object);
        let mut chain = Map::new();
        let mut at_id = Some(source.as_str());
        while let Some(i) = at_id.filter(|i| !chain.contains_key(*i)) {
            let Some(item) = all.and_then(|a| a.get(i)) else {
                break;
            };
            chain.insert(i.to_string(), item.clone());
            at_id = item.get("parent").and_then(Value::as_str);
        }
        let at = |times: &[i64]| -> Result<Vec<P>, Refused> {
            let mut out = Vec::with_capacity(times.len());
            for &t in times {
                let mut s = program.state();
                program.evaluate_local(t, crate::eval::Validity::Full, &mut s);
                let then = crate::eval::evaluated(chain.clone(), program, &s);
                out.push(placed(&then, &source));
            }
            Ok(out)
        };
        let traced = {
            let mut held = program.trails.0.lock().unwrap_or_else(|e| e.into_inner());
            traced(
                &trail,
                (doc, program, state.t),
                (&id, &path),
                &at,
                &mut held,
            )
        };
        let Ok(traced) = traced else {
            items[&id]["params"]["d"] = Value::from("");
            continue;
        };
        let own = placed(items, &id);
        let (mut d, mut width, mut opacity) = (String::new(), Vec::new(), Vec::new());
        for tr in &traced.traces {
            for (k, (p, (w, a))) in tr.points.iter().zip(shares(&trail, tr)).enumerate() {
                let verb = if k == 0 { 'M' } else { 'L' };
                d.push_str(&format!("{verb}{} {} ", p[0] - own[0], p[1] - own[1]));
                width.push(trail.width * w);
                opacity.push(a);
            }
        }
        let params = &mut items[&id]["params"];
        params["d"] = Value::from(d.trim_end());
        params["width"] = json!(width);
        params["opacity"] = json!(opacity);
    }
}
