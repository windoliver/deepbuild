//! The parts of a document motion reads: the transport, channels, clips and placements, read
//! from the document's JSON (canvas primitives: Transport, Channel and key, Clip, Placement).

use deep_canvas::grammar::{Seeded, Time, TimeContext};
use serde_json::{Map, Value};

use crate::curve::{Curve, Interp, Key};

/// Why a document can't be evaluated, as a refusal code and the path it names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refused {
    pub code: &'static str,
    pub path: String,
}

fn refuse<T>(code: &'static str, path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
    })
}

/// What a channel writes: a field path inside an item, after the item's ID.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    /// The item, or a clip's slot name.
    pub owner: String,
    /// The field path inside the item, such as `["at", "pos", "0"]`.
    pub field: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueType {
    F32,
    Color,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Channel {
    pub id: String,
    pub target: Target,
    pub ty: ValueType,
    pub curve: Curve,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Clip {
    pub id: String,
    /// The clip's span: its own, or its last key's time (`span: auto`).
    pub span: i64,
    pub channels: Vec<Channel>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Extend {
    None,
    Hold,
}

/// One item a placement binds to a slot, with how long after the placement's start its own copy
/// of the clip starts (its stagger delay).
#[derive(Clone, Debug, PartialEq)]
pub struct Binding {
    pub slot: String,
    pub item: String,
    pub delay: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub id: String,
    pub clip: String,
    /// Every slot's items, each with its stagger delay, in slot order then target order.
    pub bindings: Vec<Binding>,
    /// Resolved: its own `start`, or the end of the placement it comes `after` plus `offset`.
    pub start: i64,
    pub count: u32,
    pub before: Extend,
    pub after: Extend,
}

/// A cut between two adjacent placements, at the flick the second starts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cut {
    pub id: String,
    pub from: String,
    pub to: String,
    pub at: i64,
}

/// A marker's resolved start and end (canvas primitives: Marker).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Marker {
    pub id: String,
    pub kind: String,
    pub start: i64,
    pub end: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Transport {
    pub start: i64,
    pub span: Option<i64>,
    pub wrap: bool,
}

/// Everything motion reads, with each map in ID order.
#[derive(Clone, Debug, PartialEq)]
pub struct Motion {
    pub transport: Transport,
    pub channels: Vec<Channel>,
    pub clips: Vec<Clip>,
    pub placements: Vec<Placement>,
    pub markers: Vec<Marker>,
    /// Each parented item with its parent, parents before their children (child-of parenting).
    pub parents: Vec<(String, String)>,
    pub cuts: Vec<Cut>,
    pub frame_rate: (u32, u32),
}

impl Motion {
    pub fn clip(&self, id: &str) -> Option<&Clip> {
        self.clips.iter().find(|c| c.id == id)
    }
}

/// A map section's entries: each ID with its object.
type Entries<'a> = Vec<(&'a String, &'a Map<String, Value>)>;

/// A map section, in ID order: a missing one is empty.
fn section<'a>(doc: &'a Map<String, Value>, name: &str) -> Result<Entries<'a>, Refused> {
    let mut entries = Vec::new();
    match doc.get(name) {
        None | Some(Value::Null) => {}
        Some(Value::Object(map)) => {
            for (id, value) in map {
                match value {
                    Value::Object(entry) => entries.push((id, entry)),
                    _ => return refuse("bad_doc", format!("{name}/{id}")),
                }
            }
        }
        Some(_) => return refuse("bad_doc", name),
    }
    entries.sort_by(|a, b| a.0.cmp(b.0));
    Ok(entries)
}

/// A time field's flicks.
pub fn time_of(value: Option<&Value>, ctx: &TimeContext, path: &str) -> Result<i64, Refused> {
    let Some(Value::String(text)) = value else {
        return refuse("bad_time", path);
    };
    Time::parse(text)
        .and_then(|t| t.resolve(ctx))
        .or_else(|_| refuse("bad_time", path))
}

fn number(value: Option<&Value>, path: &str) -> Result<f64, Refused> {
    match value.and_then(Value::as_f64) {
        Some(n) if n.is_finite() => Ok(n),
        _ => refuse("out_of_range", path),
    }
}

fn interp_of(value: Option<&Value>, path: &str) -> Result<Interp, Refused> {
    match value {
        None => Ok(Interp::Linear),
        Some(Value::String(s)) if s == "linear" => Ok(Interp::Linear),
        Some(Value::String(s)) if s == "hold" => Ok(Interp::Hold),
        Some(Value::Object(o)) if o.len() == 1 => {
            if let Some(Value::Object(h)) = o.get("bezier") {
                let at = |k: &str| number(h.get(k), &format!("{path}/bezier/{k}"));
                let (x1, x2) = (at("x1")?, at("x2")?);
                if !(0.0..=1.0).contains(&x1) || !(0.0..=1.0).contains(&x2) {
                    return refuse("out_of_range", format!("{path}/bezier"));
                }
                return Ok(Interp::Bezier {
                    x1,
                    y1: at("y1")?,
                    x2,
                    y2: at("y2")?,
                });
            }
            if let Some(Value::Object(s)) = o.get("spring") {
                let freq_hz = number(s.get("freq_hz"), &format!("{path}/spring/freq_hz"))?;
                let damping_ratio = number(
                    s.get("damping_ratio"),
                    &format!("{path}/spring/damping_ratio"),
                )?;
                if freq_hz <= 0.0 || damping_ratio <= 0.0 {
                    return refuse("out_of_range", format!("{path}/spring"));
                }
                return Ok(Interp::Spring {
                    freq_hz,
                    damping_ratio,
                });
            }
            refuse("bad_interp", path)
        }
        // A bare `ease` or `smooth`, and every interpolation R1 doesn't land, is refused.
        Some(_) => refuse("bad_interp", path),
    }
}

fn target_of(text: &str, in_clip: bool, path: &str) -> Result<Target, Refused> {
    let parts: Vec<&str> = text.split('/').collect();
    let (owner, field) = if in_clip {
        let Some(slot) = parts.first().and_then(|p| p.strip_prefix("slot:")) else {
            return refuse("bad_path", path);
        };
        (slot, &parts[1..])
    } else {
        match parts.as_slice() {
            ["items", id, rest @ ..] => (*id, rest),
            _ => return refuse("bad_path", path),
        }
    };
    if owner.is_empty() || field.is_empty() || field.iter().any(|f| f.is_empty()) {
        return refuse("bad_path", path);
    }
    Ok(Target {
        owner: owner.to_string(),
        field: field.iter().map(|f| f.to_string()).collect(),
    })
}

fn channel_of(
    id: &str,
    c: &Map<String, Value>,
    in_clip: bool,
    ctx: &TimeContext,
    path: &str,
) -> Result<Channel, Refused> {
    let Some(Value::String(target)) = c.get("target") else {
        return refuse("bad_path", format!("{path}/target"));
    };
    let target = target_of(target, in_clip, &format!("{path}/target"))?;
    let ty = match c.get("type").and_then(Value::as_str) {
        Some("f32") | None => ValueType::F32,
        Some("color") => match c.get("space").and_then(Value::as_str) {
            Some("oklab") | None => ValueType::Color,
            _ => return refuse("bad_space", format!("{path}/space")),
        },
        _ => return refuse("bad_type", format!("{path}/type")),
    };
    let mut keys = Vec::new();
    let Some(Value::Object(map)) = c.get("keys") else {
        return refuse("bad_doc", format!("{path}/keys"));
    };
    for (kid, key) in map {
        let kpath = format!("{path}/keys/{kid}");
        let Value::Object(key) = key else {
            return refuse("bad_doc", kpath);
        };
        let t = time_of(key.get("t"), ctx, &format!("{kpath}/t"))?;
        let value = match (ty, key.get("value")) {
            (ValueType::F32, v) => vec![number(v, &format!("{kpath}/value"))?],
            (ValueType::Color, Some(Value::Array(parts))) if parts.len() == 3 => parts
                .iter()
                .enumerate()
                .map(|(i, p)| number(Some(p), &format!("{kpath}/value/{i}")))
                .collect::<Result<_, _>>()?,
            _ => return refuse("out_of_range", format!("{kpath}/value")),
        };
        let interp = interp_of(key.get("interp"), &format!("{kpath}/interp"))?;
        if matches!(interp, Interp::Spring { .. }) && ty != ValueType::F32 {
            return refuse("bad_interp", format!("{kpath}/interp"));
        }
        keys.push(Key {
            id: kid.clone(),
            t,
            value,
            interp,
        });
    }
    Ok(Channel {
        id: id.to_string(),
        target,
        ty,
        curve: Curve::new(keys),
    })
}

fn extend_of(value: Option<&Value>, path: &str) -> Result<Extend, Refused> {
    match value.and_then(Value::as_str) {
        None => Ok(Extend::None),
        Some("none") => Ok(Extend::None),
        Some("hold") => Ok(Extend::Hold),
        Some(_) => refuse("bad_doc", path),
    }
}

/// The frame rate the time literals resolve against: `transport.frame_rate` as `p/q` text or a
/// `[p, q]` pair, 60/1 when absent.
fn frame_rate_of(transport: Option<&Map<String, Value>>) -> Result<(u32, u32), Refused> {
    let Some(rate) = transport.and_then(|t| t.get("frame_rate")) else {
        return Ok((60, 1));
    };
    let pair = match rate {
        Value::Array(pq) if pq.len() == 2 => (pq[0].as_u64(), pq[1].as_u64()),
        Value::String(s) => {
            let mut parts = s.splitn(2, '/');
            let p = parts.next().and_then(|p| p.trim().parse().ok());
            let q = parts.next().map_or(Some(1), |q| q.trim().parse().ok());
            (p, q)
        }
        _ => (None, None),
    };
    match pair {
        (Some(p), Some(q)) if p > 0 && q > 0 => Ok((
            u32::try_from(p).or_else(|_| refuse("bad_rate", "transport/frame_rate"))?,
            u32::try_from(q).or_else(|_| refuse("bad_rate", "transport/frame_rate"))?,
        )),
        _ => refuse("bad_rate", "transport/frame_rate"),
    }
}

/// Reads a document's motion.
pub fn read(doc: &Value) -> Result<Motion, Refused> {
    let Value::Object(doc) = doc else {
        return refuse("bad_doc", "");
    };
    let transport_map = match doc.get("transport") {
        None | Some(Value::Null) => None,
        Some(Value::Object(t)) => Some(t),
        Some(_) => return refuse("bad_doc", "transport"),
    };
    let frame_rate = frame_rate_of(transport_map)?;
    let markers = markers_of(doc, frame_rate)?;
    let ctx = TimeContext {
        frame_rate,
        markers: markers
            .iter()
            .map(|m| (m.id.clone(), (m.start, m.end)))
            .collect(),
    };
    let transport = match transport_map {
        None => Transport {
            start: 0,
            span: None,
            wrap: false,
        },
        Some(t) => {
            let start = match t.get("start") {
                None => 0,
                v => time_of(v, &ctx, "transport/start")?,
            };
            let span = match t.get("span") {
                None => None,
                Some(Value::String(s)) if s == "auto" || s == "open" => None,
                v => Some(time_of(v, &ctx, "transport/span")?),
            };
            let wrap = match t.get("loop").and_then(Value::as_str) {
                None | Some("none") => false,
                Some("wrap") => true,
                Some(_) => return refuse("bad_doc", "transport/loop"),
            };
            if wrap && span.is_none_or(|s| s <= 0) {
                return refuse("bad_time", "transport/span");
            }
            Transport { start, span, wrap }
        }
    };
    let mut channels = Vec::new();
    for (id, c) in section(doc, "channels")? {
        channels.push(channel_of(id, c, false, &ctx, &format!("channels/{id}"))?);
    }
    let mut clips = Vec::new();
    for (id, c) in section(doc, "clips")? {
        let path = format!("clips/{id}");
        let mut list = Vec::new();
        for (cid, ch) in section(c, "channels")? {
            list.push(channel_of(
                cid,
                ch,
                true,
                &ctx,
                &format!("{path}/channels/{cid}"),
            )?);
        }
        let last = list
            .iter()
            .filter_map(|c| c.curve.keys.last().map(|k| k.t))
            .max()
            .unwrap_or(0);
        let span = match c.get("span") {
            None => last,
            Some(Value::String(s)) if s == "auto" => last,
            v => time_of(v, &ctx, &format!("{path}/span"))?,
        };
        if span <= 0 {
            return refuse("bad_time", format!("{path}/span"));
        }
        clips.push(Clip {
            id: id.clone(),
            span,
            channels: list,
        });
    }
    let mut raw = Vec::new();
    for (id, p) in section(doc, "placements")? {
        raw.push(placement_of(id, p, &clips, &ctx)?);
    }
    let seed = match doc.get("seed") {
        None => fnv1a(doc.get("id").and_then(Value::as_str).unwrap_or("")),
        Some(v) => match v.as_u64() {
            Some(seed) => seed,
            None => return refuse("out_of_range", "seed"),
        },
    };
    let mut placements = resolve_series(raw, &clips, seed)?;
    let cuts = cuts_of(doc, &mut placements, &clips)?;
    let parents = parents_of(doc)?;
    Ok(Motion {
        transport,
        channels,
        clips,
        placements,
        markers,
        parents,
        cuts,
        frame_rate,
    })
}

/// FNV-1a over a string's bytes: the seed a document without one takes from its ID, and what a
/// placement's ID adds to it, until the design's `hash@1` is defined.
fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// The cut transitions (canvas primitives: Transition, R1 `cut`): each joins two adjacent
/// placements, the second starting exactly where the first ends, and switches between them with
/// no blend. At a cut the outgoing placement stops writing and the incoming one starts, whatever
/// their `extend` says, so neither hides the cut. Every other kind lands in R6.
fn cuts_of(
    doc: &Map<String, Value>,
    placements: &mut [Placement],
    clips: &[Clip],
) -> Result<Vec<Cut>, Refused> {
    let mut cuts = Vec::new();
    for (id, tr) in section(doc, "transitions")? {
        let path = format!("transitions/{id}");
        match tr.get("kind").and_then(Value::as_str) {
            None | Some("cut") => {}
            Some(_) => return refuse("transition_kind", format!("{path}/kind")),
        }
        let find = |field: &str| -> Result<usize, Refused> {
            let name = tr.get(field).and_then(Value::as_str);
            name.and_then(|n| placements.iter().position(|p| p.id == n))
                .ok_or(Refused {
                    code: "ref_unresolved",
                    path: format!("{path}/{field}"),
                })
        };
        let (from, to) = (find("from")?, find("to")?);
        let span = |p: &Placement| clips.iter().find(|c| c.id == p.clip).map_or(1, |c| c.span);
        let out = &placements[from];
        let reach = out.bindings.iter().map(|b| b.delay).max().unwrap_or(0);
        let end = out.start + reach + span(out) * i64::from(out.count);
        if placements[to].start != end {
            return refuse("transition_gap", path);
        }
        placements[from].after = Extend::None;
        placements[to].before = Extend::None;
        cuts.push(Cut {
            id: id.clone(),
            from: placements[from].id.clone(),
            to: placements[to].id.clone(),
            at: end,
        });
    }
    Ok(cuts)
}

/// The marker kinds R1 lands: cue, shot, section and record.
const MARKER_KINDS: [&str; 4] = ["cue", "shot", "section", "record"];

/// Resolves every marker at check, in dependency order: a marker whose time names another marker
/// waits for it, so a relative time keeps its offset when its marker moves. One that never
/// resolves, through a cycle or a missing marker, is refused, naming it.
fn markers_of(doc: &Map<String, Value>, frame_rate: (u32, u32)) -> Result<Vec<Marker>, Refused> {
    let mut pending = Vec::new();
    for (id, m) in section(doc, "markers")? {
        let path = format!("markers/{id}");
        let kind = m.get("kind").and_then(Value::as_str).unwrap_or("cue");
        if !MARKER_KINDS.contains(&kind) {
            return refuse("bad_marker_kind", format!("{path}/kind"));
        }
        pending.push((id.clone(), kind.to_string(), m, path));
    }
    let mut ctx = TimeContext {
        frame_rate,
        ..TimeContext::default()
    };
    let mut done: Vec<Marker> = Vec::new();
    while !pending.is_empty() {
        let before = pending.len();
        let mut waiting = Vec::new();
        for (id, kind, m, path) in pending {
            match time_of(m.get("t"), &ctx, &format!("{path}/t")) {
                Ok(start) => {
                    let span = match m.get("span") {
                        None => 0,
                        v => time_of(v, &ctx, &format!("{path}/span"))?,
                    };
                    if span < 0 {
                        return refuse("bad_time", format!("{path}/span"));
                    }
                    ctx.markers.insert(id.clone(), (start, start + span));
                    done.push(Marker {
                        id,
                        kind,
                        start,
                        end: start + span,
                    });
                }
                Err(_) => waiting.push((id, kind, m, path)),
            }
        }
        if waiting.len() == before {
            let (_, _, _, path) = &waiting[0];
            return refuse("time_unresolved", format!("{path}/t"));
        }
        pending = waiting;
    }
    done.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(done)
}

/// A placement's start before series are resolved: its own time, or after another placement.
enum Start {
    At(i64),
    After { placement: String, offset: i64 },
}

/// The order a stagger starts its targets in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Order {
    Index,
    Reverse,
    /// A permutation drawn from the document's seed and the placement's ID, the same on every
    /// machine and at every evaluation.
    Seeded,
}

struct Raw {
    placement: Placement,
    start: Start,
    /// The stagger's lag between consecutive targets, as a ratio of the placement's span or in
    /// flicks, and its order.
    lag: Option<(Lag, Order)>,
}

#[derive(Clone, Copy)]
enum Lag {
    Ratio(f64),
    Flicks(i64),
}

fn placement_of(
    id: &str,
    p: &Map<String, Value>,
    clips: &[Clip],
    ctx: &TimeContext,
) -> Result<Raw, Refused> {
    let path = format!("placements/{id}");
    let Some(Value::String(clip)) = p.get("clip") else {
        return refuse("bad_doc", format!("{path}/clip"));
    };
    if !clips.iter().any(|c| &c.id == clip) {
        return refuse("ref_unresolved", format!("{path}/clip"));
    }
    let mut bindings = Vec::new();
    if let Some(Value::Object(map)) = p.get("slots") {
        for (slot, items) in map {
            let list: Vec<&Value> = match items {
                Value::Array(list) => list.iter().collect(),
                one => vec![one],
            };
            for item in list {
                let Value::String(item) = item else {
                    return refuse("bad_doc", format!("{path}/slots/{slot}"));
                };
                bindings.push(Binding {
                    slot: slot.clone(),
                    item: item.clone(),
                    delay: 0,
                });
            }
        }
    }
    let start = match (p.get("start"), p.get("after")) {
        (Some(t), None) => Start::At(time_of(Some(t), ctx, &format!("{path}/start"))?),
        (None, Some(Value::String(after))) => Start::After {
            placement: after.clone(),
            offset: match p.get("offset") {
                None => 0,
                Some(Value::String(o)) => {
                    let (negative, body) = match o.strip_prefix('-') {
                        Some(body) => (true, body),
                        None => (false, o.as_str()),
                    };
                    let flicks = time_of(
                        Some(&Value::String(body.to_string())),
                        ctx,
                        &format!("{path}/offset"),
                    )?;
                    if negative {
                        -flicks
                    } else {
                        flicks
                    }
                }
                Some(_) => return refuse("bad_time", format!("{path}/offset")),
            },
        },
        _ => return refuse("bad_doc", format!("{path}/start")),
    };
    let count = match p.get("repeat") {
        None => 1,
        Some(Value::Object(r)) => {
            match r.get("mode").and_then(Value::as_str) {
                None | Some("wrap") => {}
                Some(_) => return refuse("bad_doc", format!("{path}/repeat/mode")),
            }
            match r.get("count").and_then(Value::as_u64) {
                Some(n) if n >= 1 => u32::try_from(n)
                    .or_else(|_| refuse("out_of_range", format!("{path}/repeat/count")))?,
                _ => return refuse("out_of_range", format!("{path}/repeat/count")),
            }
        }
        Some(_) => return refuse("bad_doc", format!("{path}/repeat")),
    };
    let (before, after) = match p.get("extend") {
        None => (Extend::None, Extend::None),
        Some(Value::Object(e)) => (
            extend_of(e.get("before"), &format!("{path}/extend/before"))?,
            extend_of(e.get("after"), &format!("{path}/extend/after"))?,
        ),
        Some(_) => return refuse("bad_doc", format!("{path}/extend")),
    };
    let lag = match p.get("stagger") {
        None => None,
        Some(Value::Object(st)) => {
            let lag = match st.get("lag") {
                Some(Value::String(text)) => Lag::Flicks(time_of(
                    Some(&Value::String(text.clone())),
                    ctx,
                    &format!("{path}/stagger/lag"),
                )?),
                Some(v) => match v.as_f64() {
                    Some(r) if r.is_finite() && r >= 0.0 => Lag::Ratio(r),
                    _ => return refuse("out_of_range", format!("{path}/stagger/lag")),
                },
                None => return refuse("bad_doc", format!("{path}/stagger/lag")),
            };
            // reverse_on_close lands with controls in R6.
            let order = match st.get("order").and_then(Value::as_str) {
                None | Some("index") => Order::Index,
                Some("reverse") => Order::Reverse,
                Some("seeded") => Order::Seeded,
                Some(_) => return refuse("bad_doc", format!("{path}/stagger/order")),
            };
            Some((lag, order))
        }
        Some(_) => return refuse("bad_doc", format!("{path}/stagger")),
    };
    Ok(Raw {
        placement: Placement {
            id: id.to_string(),
            clip: clip.clone(),
            bindings,
            start: 0,
            count,
            before,
            after,
        },
        start,
        lag,
    })
}

/// Resolves each placement's start, in dependency order: one `after` another starts at that one's
/// end plus its offset. A cycle, or an `after` naming no placement, is refused, naming the
/// placement. Then each target's stagger delay: target i of n starts i × lag × d later, with d the
/// placement's active span, so the whole takes d × ((n − 1) × lag + 1).
fn resolve_series(raw: Vec<Raw>, clips: &[Clip], seed: u64) -> Result<Vec<Placement>, Refused> {
    let span_of = |p: &Placement| clips.iter().find(|c| c.id == p.clip).map_or(1, |c| c.span);
    let mut placed: Vec<Raw> = raw;
    for r in &mut placed {
        let d = span_of(&r.placement) * i64::from(r.placement.count);
        if let Some((lag, order)) = r.lag {
            let step = match lag {
                Lag::Ratio(x) => (x * d as f64).floor() as i64,
                Lag::Flicks(f) => f,
            };
            let n = r.placement.bindings.len();
            // Fisher–Yates over the targets' ranks, drawn from the seed and the placement's ID.
            let mut shuffled: Vec<usize> = (0..n).collect();
            if order == Order::Seeded {
                let mut rng = Seeded::new(seed ^ fnv1a(&r.placement.id));
                for i in (1..n).rev() {
                    let j = rng.below(i as u64 + 1) as usize;
                    shuffled.swap(i, j);
                }
            }
            for (i, b) in r.placement.bindings.iter_mut().enumerate() {
                let rank = match order {
                    Order::Index => i,
                    Order::Reverse => n - 1 - i,
                    Order::Seeded => shuffled[i],
                };
                b.delay = rank as i64 * step;
            }
        }
    }
    let mut resolved: Vec<Option<i64>> = placed
        .iter()
        .map(|r| match r.start {
            Start::At(t) => Some(t),
            Start::After { .. } => None,
        })
        .collect();
    loop {
        let mut progress = false;
        for i in 0..placed.len() {
            if resolved[i].is_some() {
                continue;
            }
            let Start::After { placement, offset } = &placed[i].start else {
                continue;
            };
            let Some(j) = placed.iter().position(|r| &r.placement.id == placement) else {
                return refuse(
                    "ref_unresolved",
                    format!("placements/{}/after", placed[i].placement.id),
                );
            };
            if let Some(start) = resolved[j] {
                let p = &placed[j].placement;
                let reach = p.bindings.iter().map(|b| b.delay).max().unwrap_or(0);
                let end = start + reach + span_of(p) * i64::from(p.count);
                resolved[i] = Some(end + offset);
                progress = true;
            }
        }
        if !progress {
            break;
        }
    }
    if let Some(i) = resolved.iter().position(Option::is_none) {
        return refuse(
            "placement_cycle",
            format!("placements/{}/after", placed[i].placement.id),
        );
    }
    Ok(placed
        .into_iter()
        .zip(resolved)
        .map(|(r, start)| Placement {
            start: start.unwrap_or(0),
            ..r.placement
        })
        .collect())
}

/// Every parented item with its parent, parents first. A parent that isn't an item, or a cycle,
/// is refused, naming the item.
fn parents_of(doc: &Map<String, Value>) -> Result<Vec<(String, String)>, Refused> {
    let mut edges: Vec<(String, String)> = Vec::new();
    if let Some(Value::Object(items)) = doc.get("items") {
        for (id, item) in items {
            match item.get("parent") {
                None | Some(Value::Null) => {}
                Some(Value::String(parent)) => {
                    if !items.contains_key(parent) {
                        return refuse("ref_unresolved", format!("items/{id}/parent"));
                    }
                    edges.push((id.clone(), parent.clone()));
                }
                Some(_) => return refuse("bad_doc", format!("items/{id}/parent")),
            }
        }
    }
    edges.sort();
    // A child is ready once its parent is no remaining edge's child.
    let mut ordered: Vec<(String, String)> = Vec::with_capacity(edges.len());
    while !edges.is_empty() {
        let (ready, waiting): (Vec<_>, Vec<_>) = edges
            .iter()
            .cloned()
            .partition(|(_, parent)| !edges.iter().any(|(child, _)| child == parent));
        if ready.is_empty() {
            return refuse("parent_cycle", format!("items/{}/parent", edges[0].0));
        }
        ordered.extend(ready);
        edges = waiting;
    }
    Ok(ordered)
}
