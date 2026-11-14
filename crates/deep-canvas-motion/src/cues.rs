//! Cue lists `cues@1` (#222; canvas primitives: Cue list `cues@1`): plays and waits written in
//! order, expanded at check, never per frame, into the channels, markers and derived items the
//! list owns, with exact flicks. `after` starts a cue at the previous cue's end plus `gap`, `with`
//! at the previous cue's start, `at` at a time or a marker; a cue over n targets staggers them by
//! `lag`, for a span of d × ((n − 1) × lag + 1); each cue writes the marker `cues.<id>`. A cue's
//! from-values are what its targets hold at its start: the list's own keys so far, else the
//! document evaluated there, else the authored value. A cue's verb is a `cue.kind@1` entry, data
//! that [`verb`] reads; only this expander is code.

use std::collections::BTreeMap;

use deep_canvas::document::expands::{Lowered, Refusal, Request};
use deep_canvas::grammar::FLICKS_PER_SECOND;
use serde_json::{json, Map, Value};

use crate::doc::{self, Ctx, Lag, Order};

mod kit;
pub(crate) mod verb;

pub use kit::registry;

/// The kind `cues@1`, by its bare name.
pub const KIND: &str = "cues";
/// The registry of cue verbs.
pub const REGISTRY: &str = "cue.kind@1";
/// The most cues one list holds.
pub const MAX_CUES: usize = 512;
/// #222's planted expander: a `with` cue starts at the previous cue's end, not its start.
pub const WITH_AT_END: &str = "cue_with_at_previous_end";
/// A planted twin, `cue_twin:<verb>`: the verb expands as the wrong twin its entry names.
pub const TWIN: &str = "cue_twin:";

/// Whether `name` is a planted program of cue lists.
pub fn planted(name: &str) -> bool {
    name == WITH_AT_END || name.strip_prefix(TWIN).is_some_and(|v| !v.is_empty())
}

/// The default span of a cue, one second.
const SPAN: i64 = FLICKS_PER_SECOND;

/// The check's expansion of one `cues@1` item: its verbs through the document's registries.
pub fn expand(req: &Request<'_>) -> Result<Lowered, Vec<Refusal>> {
    let verbs = |name: &str| req.entries.get(REGISTRY, name).map(|(v, _)| v.clone());
    lower(req.doc, req.items, req.id, req.item, &verbs, req.planted)
}

/// One cue as timed: its window on the timeline and each target's own window inside it.
pub(crate) struct Cue {
    pub id: String,
    pub index: usize,
    pub start: i64,
    pub end: i64,
    /// One target's span, d.
    pub d: i64,
    /// Each target with its own start, in list order.
    pub targets: Vec<(String, i64)>,
    pub ease: Value,
    pub set: Map<String, Value>,
    pub kind: Option<String>,
    pub params: Map<String, Value>,
}

impl Cue {
    pub(crate) fn path(&self, list: &str) -> String {
        format!("items/{list}/params/cues/{}", self.index)
    }
}

/// A refusal at `path`.
pub(crate) fn refused(code: &'static str, path: String, actual: Value, what: String) -> Refusal {
    Refusal {
        code,
        path,
        actual: Box::new(actual),
        what,
    }
}

/// Expands the cue list `id`: the expansion [`expand`] makes, with its verbs from `verbs`.
pub fn lower(
    doc: &Value,
    items: &Map<String, Value>,
    id: &str,
    item: &Value,
    verbs: &dyn Fn(&str) -> Option<Value>,
    planted: Option<&str>,
) -> Result<Lowered, Vec<Refusal>> {
    let empty = Map::new();
    let doc_map = doc.as_object().unwrap_or(&empty);
    let cues = time(doc_map, items, id, item, planted).map_err(|r| vec![r])?;
    let mut out = Lowered::default();
    let mut markers = Map::new();
    for c in &cues {
        markers.insert(
            format!("cues.{}", c.id),
            json!({"kind": "cue", "t": c.start, "span": c.end - c.start}),
        );
    }
    let seed = seed_of(doc_map);
    let mut writer = Writer::new(doc_map, items, id);
    writer.seed = seed;
    writer.twin = planted
        .and_then(|p| p.strip_prefix(TWIN))
        .map(str::to_string);
    let mut order: Vec<&Cue> = cues.iter().collect();
    order.sort_by_key(|c| (c.start, c.index));
    let mut refusals = Vec::new();
    for c in order {
        if let Err(r) = writer.cue(c, verbs, &mut out.items) {
            refusals.push(r);
        }
    }
    if !refusals.is_empty() {
        return Err(refusals);
    }
    let channels = writer.channels()?;
    if !channels.is_empty() {
        out.sections
            .insert("channels".into(), Value::Object(channels));
    }
    out.sections
        .insert("markers".into(), Value::Object(markers));
    Ok(out)
}

/// `doc` with each cue list's markers `cues.<id>` in its `markers`, for a reader of the document
/// as written (narration, sound, a time literal) that anchors to a cue: timing alone, no verb.
pub fn with_markers(doc: &Value) -> Value {
    let mut out = doc.clone();
    let Some(map) = doc.as_object() else {
        return out;
    };
    let empty = Map::new();
    let items = map
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let mut markers = Map::new();
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("cues@1") {
            continue;
        }
        for c in time(map, items, id, item, None).unwrap_or_default() {
            markers.insert(
                format!("cues.{}", c.id),
                json!({"kind": "cue", "t": c.start, "span": c.end - c.start}),
            );
        }
    }
    if let (false, Some(o)) = (markers.is_empty(), out.as_object_mut()) {
        let section = o.entry("markers").or_insert_with(|| json!({}));
        if let Some(section) = section.as_object_mut() {
            for (k, v) in markers {
                section.entry(k).or_insert(v);
            }
        }
    }
    out
}

/// Reads and times every cue in list order.
fn time(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    id: &str,
    item: &Value,
    planted: Option<&str>,
) -> Result<Vec<Cue>, Refusal> {
    let at = format!("items/{id}/params/cues");
    // #1974: `cues` left out is its listed default, no cues.
    let none = Vec::new();
    let list = match item.pointer("/params/cues") {
        None => &none,
        Some(v) => v.as_array().ok_or_else(|| {
            refused(
                "bad_doc",
                at.clone(),
                Value::Null,
                "a cue list holds `cues`, a list".into(),
            )
        })?,
    };
    if list.len() > MAX_CUES {
        return Err(refused(
            "out_of_range",
            at,
            json!(list.len()),
            format!("a cue list holds at most {MAX_CUES} cues"),
        ));
    }
    let transport = doc.get("transport").and_then(Value::as_object);
    let frame_rate = doc::frame_rate_of(transport).unwrap_or((60, 1));
    let mut ctx = Ctx::timeline(doc, frame_rate).unwrap_or_else(|_| Ctx::of(frame_rate));
    let seed = seed_of(doc);
    let mut out: Vec<Cue> = Vec::with_capacity(list.len());
    let mut seen = std::collections::BTreeSet::new();
    for (index, c) in list.iter().enumerate() {
        let path = format!("{at}/{index}");
        let bad = |field: &str, what: &str| {
            refused(
                "bad_doc",
                format!("{path}/{field}"),
                c.get(field).cloned().unwrap_or(Value::Null),
                what.to_string(),
            )
        };
        let Some(c) = c.as_object() else {
            return Err(bad("", "a cue is an object"));
        };
        let cue_id = c.get("id").and_then(Value::as_str).unwrap_or_default();
        let marker = format!("cues.{cue_id}");
        if cue_id.is_empty() || cue_id == "end" || deep_canvas::grammar::Id::parse(&marker).is_err()
        {
            return Err(bad(
                "id",
                "a cue's ID is an ID, other than `end`, that `cues.<id>` names",
            ));
        }
        if !seen.insert(cue_id.to_string()) {
            return Err(bad("id", "two cues of one list share this ID"));
        }
        let time_at = |field: &str, default: i64| -> Result<i64, Refusal> {
            match c.get(field) {
                None => Ok(default),
                v => doc::time_of(v, &ctx, &format!("{path}/{field}")).map_err(|r| {
                    refused(
                        r.code,
                        r.path,
                        v.cloned().unwrap_or(Value::Null),
                        "not a time".into(),
                    )
                }),
            }
        };
        let gap = time_at("gap", 0)?;
        let d = time_at("span", SPAN)?;
        if d < 0 {
            return Err(bad("span", "a span is not negative"));
        }
        let targets = targets_of(c.get("targets"), items).map_err(|what| bad("targets", &what))?;
        let (lag, order) = match (c.get("lag"), c.get("order")) {
            (None, None) => (Lag::Ratio(0.0), Order::Index),
            _ => {
                let mut st = Map::new();
                st.insert("lag".into(), c.get("lag").cloned().unwrap_or(json!(0)));
                if let Some(o) = c.get("order") {
                    st.insert("order".into(), o.clone());
                }
                let (lag, order, _) = doc::stagger_of(&st, &ctx, &path).map_err(|r| {
                    refused(
                        r.code,
                        r.path,
                        Value::Object(st.clone()),
                        "not a lag or an order".into(),
                    )
                })?;
                (lag, order)
            }
        };
        let step = match lag {
            Lag::Ratio(x) => (x * d as f64).floor() as i64,
            Lag::Flicks(f) => f,
        };
        let n = targets.len().max(1);
        let total = (n as i64 - 1) * step + d;
        let prev = out.last().map(|p| (p.start, p.end));
        let start = match c.get("when") {
            None => prev.map_or(0, |p| p.1) + gap,
            Some(Value::String(w)) if w == "after" => prev.map_or(0, |p| p.1) + gap,
            Some(Value::String(w)) if w == "with" => match (prev, planted) {
                (Some(p), Some(WITH_AT_END)) => p.1 + gap,
                (Some(p), _) => p.0 + gap,
                (None, _) => gap,
            },
            Some(Value::Object(o)) if o.len() == 1 && o.contains_key("at") => {
                doc::time_of(o.get("at"), &ctx, &format!("{path}/when/at")).map_err(|r| {
                    refused(r.code, r.path, json!(o), "not a time or a marker".into())
                })? + gap
            }
            Some(_) => return Err(bad("when", "`after`, `with` or `{at: time}`")),
        };
        let ranks = doc::ranks(targets.len(), order, seed ^ doc::fnv1a(&marker));
        let targets = targets
            .into_iter()
            .zip(ranks)
            .map(|(t, r)| (t, start + r as i64 * step))
            .collect();
        ctx.markers.insert(marker, (start, start + total));
        let ease = ease_of(c.get("ease")).map_err(|what| bad("ease", &what))?;
        let object = |field: &str| -> Result<Map<String, Value>, Refusal> {
            match c.get(field) {
                None => Ok(Map::new()),
                Some(Value::Object(m)) => Ok(m.clone()),
                Some(_) => Err(bad(field, "an object")),
            }
        };
        out.push(Cue {
            id: cue_id.to_string(),
            index,
            start,
            end: start + total,
            d,
            targets,
            ease,
            set: object("set")?,
            kind: c.get("kind").and_then(Value::as_str).map(str::to_string),
            params: object("params")?,
        });
    }
    Ok(out)
}

/// The document's seed: its own, or one drawn from its ID, as placements' staggers take it.
fn seed_of(doc: &Map<String, Value>) -> u64 {
    match doc.get("seed").and_then(Value::as_u64) {
        Some(s) => s,
        None => doc::fnv1a(doc.get("id").and_then(Value::as_str).unwrap_or("")),
    }
}

/// A cue's targets: each ID names an item; a group names its children, in document order.
fn targets_of(v: Option<&Value>, items: &Map<String, Value>) -> Result<Vec<String>, String> {
    let list = match v {
        None => return Ok(Vec::new()),
        Some(Value::Array(list)) => list,
        Some(Value::String(one)) => return targets_of(Some(&json!([one])), items),
        Some(_) => return Err("a list of IDs".into()),
    };
    let mut out = Vec::new();
    for t in list {
        let Some(t) = t.as_str() else {
            return Err("a list of IDs".into());
        };
        let Some(item) = items.get(t) else {
            return Err(format!("`{t}` names no item"));
        };
        if item.get("kind").and_then(Value::as_str) == Some("group@1") {
            let children: Vec<String> = items
                .iter()
                .filter(|(_, c)| c.get("parent").and_then(Value::as_str) == Some(t))
                .map(|(k, _)| k.clone())
                .collect();
            if !children.is_empty() {
                out.extend(children);
                continue;
            }
        }
        out.push(t.to_string());
    }
    Ok(out)
}

/// A cue's `ease` as the interp its keys write: a key interp (`linear`, `hold`, `{bezier}`), an
/// ease's name, `name(k)` with one param, or `{name, params}`; `sigmoid(10)` when none.
fn ease_of(v: Option<&Value>) -> Result<Value, String> {
    let named = |name: &str, params: Option<Value>| match params {
        Some(p) => json!({"ease": {"name": name, "params": p}}),
        None => json!({"ease": {"name": name}}),
    };
    match v {
        None => Ok(named("sigmoid", Some(json!(10)))),
        Some(Value::String(s)) if matches!(s.as_str(), "linear" | "hold") => Ok(json!(s)),
        Some(Value::String(s)) => match s.split_once('(') {
            Some((name, rest)) => {
                let k: f64 = rest
                    .strip_suffix(')')
                    .and_then(|k| k.trim().parse().ok())
                    .ok_or_else(|| format!("`{s}` is not `name(k)`"))?;
                Ok(named(name, Some(json!(k))))
            }
            None => Ok(named(s, None)),
        },
        Some(Value::Object(o)) if o.contains_key("name") => Ok(json!({"ease": o})),
        Some(Value::Object(o)) => Ok(Value::Object(o.clone())),
        Some(_) => Err("an ease".into()),
    }
}

// ---- writing ---------------------------------------------------------------------------------

/// One key a cue writes on a path.
#[derive(Clone, Debug)]
pub(crate) struct Key {
    pub t: i64,
    pub value: Value,
    pub interp: Value,
    /// A key `travel` (an arc or a spiral) for the segment it owns.
    pub travel: Option<Value>,
}

/// What the list writes on one path: its keys and pulses, and each cue's span on it.
#[derive(Default)]
struct Track {
    ty: Option<String>,
    /// The first cue that writes it, which names its channel.
    cue: Option<String>,
    keys: Vec<Key>,
    pulses: Vec<Value>,
    /// Each cue that keys it, with the span its keys cover.
    spans: Vec<(usize, String, i64, i64)>,
}

/// The channels the list writes, built cue by cue in start order.
pub(crate) struct Writer<'a> {
    doc: &'a Map<String, Value>,
    items: &'a Map<String, Value>,
    list: &'a str,
    tracks: BTreeMap<String, Track>,
    /// The document compiled without the list, once, when a from-value needs it.
    base: Option<Option<(crate::program::Program, Map<String, Value>)>>,
    pub(crate) seed: u64,
    /// The verb whose planted twin runs in its place.
    pub(crate) twin: Option<String>,
}

impl<'a> Writer<'a> {
    pub(crate) fn new(
        doc: &'a Map<String, Value>,
        items: &'a Map<String, Value>,
        list: &'a str,
    ) -> Self {
        Writer {
            doc,
            items,
            list,
            tracks: BTreeMap::new(),
            base: None,
            seed: 0,
            twin: None,
        }
    }

    /// Writes one cue: its `set` paths and its verb's steps, on each target in its own window.
    fn cue(
        &mut self,
        c: &Cue,
        verbs: &dyn Fn(&str) -> Option<Value>,
        derived: &mut Map<String, Value>,
    ) -> Result<(), Refusal> {
        let path = c.path(self.list);
        let items = self.items;
        let entry = match &c.kind {
            None => None,
            Some(name) => Some(verbs(name).ok_or_else(|| {
                refused(
                    "ref_unresolved",
                    format!("{path}/kind"),
                    json!(name),
                    format!("no `cue.kind@1` entry `{name}` in this build or the document's packs"),
                )
            })?),
        };
        let n = c.targets.len();
        let mut targets = c.targets.clone();
        targets.sort_by_key(|(_, s)| *s);
        for (rank, (target, w0)) in c.targets.iter().enumerate() {
            let rank = targets
                .iter()
                .position(|(t, _)| t == target)
                .unwrap_or(rank);
            for (p, v) in &c.set {
                let full = format!("items/{target}/{}", p.trim_start_matches('/'));
                // A pulse adds over the window and ends at exactly 0 (Channel and key: pulse).
                if let Some(pulse) = v
                    .get("pulse")
                    .filter(|_| v.as_object().is_some_and(|o| o.len() == 1))
                {
                    let pulse = verb::pulse(pulse, *w0, c.d, &c.ease);
                    self.pulse(c, &full, pulse);
                    continue;
                }
                let from = self.from(&full, *w0);
                let to = widen(v.clone(), from.as_ref());
                let keys = vec![
                    Key {
                        t: *w0,
                        value: from.unwrap_or_else(|| to.clone()),
                        interp: c.ease.clone(),
                        travel: None,
                    },
                    Key {
                        t: *w0 + c.d,
                        value: to,
                        interp: json!("hold"),
                        travel: None,
                    },
                ];
                self.key(c, &path, &full, None, keys)?;
            }
            if let Some(entry) = &entry {
                let window = verb::Window {
                    list: self.list,
                    cue: c,
                    target,
                    rank,
                    n,
                    w0: *w0,
                    item: items.get(target.as_str()),
                    items,
                    seed: self.seed,
                };
                let twin = self.twin.as_deref() == c.kind.as_deref();
                let wrote = verb::apply(entry, &window, twin, &mut |p, t| self.from(p, t))
                    .map_err(|what| {
                        refused("out_of_range", format!("{path}/kind"), json!(c.kind), what)
                    })?;
                for (id, value) in wrote.items {
                    derived.insert(id, value);
                }
                for w in wrote.writes {
                    match w {
                        verb::Write::Keys {
                            path: full,
                            ty,
                            keys,
                        } => self.key(c, &path, &full, ty, keys)?,
                        verb::Write::Pulse { path: full, pulse } => self.pulse(c, &full, pulse),
                    }
                }
            }
        }
        Ok(())
    }

    /// Adds a cue's keys on `full`, refusing two cues that key one path over overlapping spans.
    fn key(
        &mut self,
        c: &Cue,
        at: &str,
        full: &str,
        ty: Option<String>,
        keys: Vec<Key>,
    ) -> Result<(), Refusal> {
        let (Some(a), Some(b)) = (
            keys.iter().map(|k| k.t).min(),
            keys.iter().map(|k| k.t).max(),
        ) else {
            return Ok(());
        };
        let track = self.tracks.entry(full.to_string()).or_default();
        if let Some((_, other, ..)) = track
            .spans
            .iter()
            .find(|(i, _, s, e)| *i != c.index && a < *e && *s < b)
        {
            return Err(refused(
                "cue_overlap",
                at.to_string(),
                json!({"cues": [other, c.id], "path": full}),
                format!(
                    "cues `{other}` and `{}` both write `{full}` over overlapping spans",
                    c.id
                ),
            ));
        }
        track.spans.push((c.index, c.id.clone(), a, b));
        track.cue.get_or_insert_with(|| c.id.clone());
        if track.ty.is_none() {
            track.ty = ty;
        }
        track.keys.extend(keys);
        Ok(())
    }

    /// Adds a cue's pulse on `full`: it adds, so it never overlaps another cue's write.
    fn pulse(&mut self, c: &Cue, full: &str, pulse: Value) {
        let track = self.tracks.entry(full.to_string()).or_default();
        track.cue.get_or_insert_with(|| c.id.clone());
        track.pulses.push(pulse);
    }

    /// What `full` holds at `t`: the list's own keys so far, else the document evaluated there,
    /// else the authored value or the path's default.
    pub(crate) fn from(&mut self, full: &str, t: i64) -> Option<Value> {
        if let Some(track) = self.tracks.get(full) {
            if let Some(k) = track.keys.iter().filter(|k| k.t <= t).max_by_key(|k| k.t) {
                return Some(k.value.clone());
            }
            if let Some(k) = track.keys.iter().min_by_key(|k| k.t) {
                return Some(k.value.clone());
            }
        }
        let (owner, field) = split(full)?;
        if self.written_outside(full) {
            if let Some(v) = self.evaluated(owner, &field, t) {
                return Some(v);
            }
        }
        // What a path or a vector import draws is its own outline, `{of: <itself>}`, until a
        // cue morphs it (Channel and key: path keys `{of}`).
        if field == ["path"] {
            return Some(json!({"of": owner}));
        }
        let item = self.items.get(owner)?;
        authored(item, &field).or_else(|| default_of(&field))
    }

    /// Whether anything but this list writes `full` or a path inside it.
    fn written_outside(&self, full: &str) -> bool {
        let writes = |section: &str| {
            self.doc
                .get(section)
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .any(|(_, e)| {
                    e.get("target")
                        .and_then(Value::as_str)
                        .is_some_and(|t| t.starts_with(full) || full.starts_with(t))
                })
        };
        writes("channels")
            || writes("drivers")
            || writes("bound_values")
            || self
                .doc
                .get("placements")
                .is_some_and(|p| p.as_object().is_some_and(|m| !m.is_empty()))
            || self
                .doc
                .get("constraints")
                .is_some_and(|p| p.as_object().is_some_and(|m| !m.is_empty()))
    }

    /// `owner`'s `field` in the document without the list, evaluated at `t`.
    fn evaluated(&mut self, owner: &str, field: &[String], t: i64) -> Option<Value> {
        if self.base.is_none() {
            let mut doc = self.doc.clone();
            doc.insert("items".into(), Value::Object(self.items.clone()));
            self.base = Some(
                crate::program::Program::compile(&doc)
                    .ok()
                    .map(|p| (p, doc)),
            );
        }
        let (program, doc) = self.base.as_ref()?.as_ref()?;
        let mut state = program.state();
        program.evaluate_local(t, crate::eval::Validity::Full, &mut state);
        let items = crate::eval::items(doc, program, &state);
        authored(items.get(owner)?, field)
    }

    /// The list's channels: one per path, `<list>.ch<k>`, its keys in time order with IDs in the
    /// order written, so two keys on one flick keep the cues' order. A path a pulse adds to that
    /// holds a vector is written as one f32 channel per component, each taking its share.
    fn channels(&mut self) -> Result<Map<String, Value>, Vec<Refusal>> {
        let mut out = Map::new();
        let tracks = std::mem::take(&mut self.tracks);
        let mut k = 0;
        for (full, track) in tracks {
            // A path only pulses add to holds its value from the first pulse's start.
            let first = track
                .pulses
                .iter()
                .filter_map(|p| p["at"].as_i64())
                .min()
                .unwrap_or(0);
            let base = if track.keys.is_empty() {
                self.from(&full, first)
            } else {
                None
            };
            let width = track
                .keys
                .first()
                .map(|k| &k.value)
                .or(base.as_ref())
                .and_then(Value::as_array)
                .map(Vec::len);
            let split = !track.pulses.is_empty() && width.is_some();
            let parts: Vec<(String, Option<usize>)> = match (split, width) {
                (true, Some(w)) => (0..w).map(|i| (format!("{full}/{i}"), Some(i))).collect(),
                _ => vec![(full.clone(), None)],
            };
            for (target, comp) in parts {
                let pick = |v: &Value| match comp {
                    Some(i) => v.get(i).cloned().unwrap_or(json!(0)),
                    None => v.clone(),
                };
                let mut keys: Vec<Key> = track
                    .keys
                    .iter()
                    .map(|key| Key {
                        t: key.t,
                        value: pick(&key.value),
                        interp: key.interp.clone(),
                        travel: key.travel.clone(),
                    })
                    .collect();
                if keys.is_empty() {
                    let Some(b) = &base else { continue };
                    keys.push(Key {
                        t: first,
                        value: pick(b),
                        interp: json!("hold"),
                        travel: None,
                    });
                }
                // Stable by time, so keys on one flick stay in the order the cues wrote them; a key
                // the next one repeats on the same flick (a cue's end where the next starts) is
                // left out, since the later key owns the segment.
                let mut order: Vec<usize> = (0..keys.len()).collect();
                order.sort_by_key(|&i| keys[i].t);
                let repeated = |n: usize| {
                    order.get(n + 1).is_some_and(|&next| {
                        keys[next].t == keys[order[n]].t && keys[next].value == keys[order[n]].value
                    })
                };
                let order: Vec<usize> = (0..order.len())
                    .filter(|&n| !repeated(n))
                    .map(|n| order[n])
                    .collect();
                let keyed: Map<String, Value> = order
                    .iter()
                    .enumerate()
                    .map(|(n, &i)| {
                        let key = &keys[i];
                        let mut k = json!({"t": key.t, "value": key.value, "interp": key.interp});
                        if let Some(travel) = &key.travel {
                            k["travel"] = travel.clone();
                        }
                        (format!("k{n:04}"), k)
                    })
                    .collect();
                let ty = match comp {
                    Some(_) => "f32".to_string(),
                    None => track.ty.clone().unwrap_or_else(|| type_of(&keys[0].value)),
                };
                let mut channel = json!({"target": target, "type": ty, "keys": keyed});
                let pulses: Vec<Value> = track
                    .pulses
                    .iter()
                    .filter_map(|p| {
                        let mut p = p.clone();
                        if let Some(i) = comp {
                            let amount = p.get("amount")?.get(i)?.clone();
                            p["amount"] = amount;
                        }
                        Some(p)
                    })
                    .collect();
                if !pulses.is_empty() {
                    channel["modifiers"] = Value::Array(pulses);
                }
                let cue = track.cue.as_deref().unwrap_or("cue");
                out.insert(format!("{}.{cue}.{k}", self.list), channel);
                k += 1;
            }
        }
        Ok(out)
    }
}

/// `items/<owner>/<field…>` split into its owner and field.
fn split(full: &str) -> Option<(&str, Vec<String>)> {
    let rest = full.strip_prefix("items/")?;
    let (owner, field) = rest.split_once('/')?;
    Some((owner, field.split('/').map(str::to_string).collect()))
}

/// The value at `field` inside an item, a transform's group as three numbers.
pub(crate) fn authored(item: &Value, field: &[String]) -> Option<Value> {
    let mut at = item;
    for (i, f) in field.iter().enumerate() {
        at = match at {
            Value::Array(a) => a.get(f.parse::<usize>().ok()?)?,
            Value::Object(o) => match o.get(f) {
                Some(v) => v,
                None if i == 0 && f == "at" => return default_of(field),
                None => return default_of(field),
            },
            _ => return None,
        };
    }
    let transform = field.len() == 2 && field[0] == "at";
    match (transform, at) {
        (true, Value::Array(a)) if a.len() < 3 => {
            let fill = if field[1] == "scale" { 1.0 } else { 0.0 };
            let mut v: Vec<Value> = a.clone();
            while v.len() < 3 {
                v.push(json!(fill));
            }
            Some(Value::Array(v))
        }
        _ => Some(at.clone()),
    }
}

/// The value a path holds when nothing authored or wrote it.
fn default_of(field: &[String]) -> Option<Value> {
    let f: Vec<&str> = field.iter().map(String::as_str).collect();
    Some(match f.as_slice() {
        ["at", "scale"] => json!([1.0, 1.0, 1.0]),
        ["at", _] => json!([0.0, 0.0, 0.0]),
        ["at", "scale", _] => json!(1.0),
        ["at", _, _] => json!(0.0),
        ["adjust", "opacity" | "saturation" | "brightness" | "contrast" | "gamma"] => json!(1.0),
        ["adjust", "hue" | "exposure"] => json!(0.0),
        ["params", "reveal", "progress"] => json!(1.0),
        [.., "trim", "end"] => json!(1.0),
        [.., "trim", "start"] => json!(0.0),
        _ => return None,
    })
}

/// `to` given the from-value's width: a transform's two numbers take the third from `from`.
fn widen(to: Value, from: Option<&Value>) -> Value {
    match (&to, from.and_then(Value::as_array)) {
        (Value::Array(t), Some(f)) if t.len() < f.len() => {
            let mut v = t.clone();
            v.extend(f[t.len()..].iter().cloned());
            Value::Array(v)
        }
        _ => to,
    }
}

/// A channel's type from a value it holds.
fn type_of(v: &Value) -> String {
    match v {
        Value::Array(a) if a.len() == 2 => "vec2",
        Value::Array(a) if a.len() == 4 => "color",
        Value::Array(_) => "vec3",
        Value::String(s) if s.starts_with('#') => "color",
        Value::String(_) => "path",
        Value::Bool(_) => "bool",
        _ => "f32",
    }
    .into()
}

/// Motion's registration of cue lists: the kind `cues@1`, the registry of cue verbs with its
/// kit, the expansion at check and the refusal it adds.
pub(crate) fn register(r: &mut deep_canvas::registry::Registrar) {
    use deep_canvas::kinds::{Entry, Param, ParamType, Version};
    r.kind(
        Entry {
            family: "",
            name: KIND,
            versions: vec![Version {
                major: 1,
                minor: 0,
                params: vec![Param {
                    name: "cues",
                    // The cue the expander reads (Cue list `cues@1`), declared as #1973's forms.
                    ty: ParamType::Json(
                        "[{id: ID, when?: after | with | {at: time | flick}, gap?: flick | time, span?: flick | time, ease?: ease, lag?: ratio | flick | time, order?: `index` | reverse | seeded, targets?: [ID | collection], set?, kind?: name, params?}] ≤ 512",
                    ),
                    unit: "",
                    default: json!([]),
                    min: None,
                    max: None,
                    minor: 0,
                    module: "",
                    operator: "",
                }],
            }],
            migrations: Vec::new(),
        },
        &[],
        "",
    );
    let mut def = registry();
    def.moves = Some(kit::moves);
    r.registry(def);
    r.expands(KIND, expand);
    r.code(
        "cue_overlap",
        "Two cues of a cue list write one path over overlapping spans; only a pulse or an add placement adds.",
        "Start the second cue after the first ends, or write it as a pulse.",
        false,
    );
}
