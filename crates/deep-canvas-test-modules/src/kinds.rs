//! The #412 acceptance README's test canvas modules (Test canvas modules and features of
//! `deep-show`): `test.preview`, a preview kind tracked by #412; `test.cue`, a registry of cue
//! kinds whose `pop_in` scales its targets in on a spring, and the cue list that plays it;
//! `test.ring` at fixture digests A and B, where ring@2 renames `thick` to `stroke_width`,
//! retires `dash` and moves `segments`' default from 32 to 64; and `test.wordy`, whose kind's
//! one-liner is too long for the sheet. None is in a shipped build.

use deep_canvas::kinds::{Entry, Migration, Param, ParamType, Rename, Version};
use deep_canvas::ops;
use deep_canvas::registry::lists::RegistryDef;
use deep_canvas::registry::{Module, Registrar};
use deep_canvas::schedule::core_ops::{Datum, Edit, Edits};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

use super::{box_param, json_param, kind, manifest, number, of_kind};

fn register_preview(r: &mut Registrar) {
    r.kind(
        kind("test", "preview.blob", vec![box_param()]),
        &[],
        "rect@1",
    )
    .preview("#412", "R2", "R5")
    .described("A blob drawn as its box, a preview until #412 lands.");
}

/// What an item of the removed `test.preview.blob@1` opens as: `rect@1` at its box, in the
/// look's ink, as the blob drew.
fn blob_as_rect(params: &Value) -> Value {
    json!({"box": params.get("box").cloned().unwrap_or(Value::Null),
           "paint": {"fill": {"role": "ink"}}})
}

fn register_preview_removed(r: &mut Registrar) {
    r.removed(
        "test.preview.blob@1",
        Some(("rect@1", blob_as_rect as fn(&Value) -> Value)),
    );
}

fn register_preview_removed_bare(r: &mut Registrar) {
    r.removed("test.preview.blob@1", None);
}

fn preview_1_1(register: fn(&mut Registrar)) -> Module {
    let mut manifest = manifest("test.preview", &[]);
    manifest.version.minor = 1;
    Module { manifest, register }
}

/// `test.preview` 1.1.0 (#1802): it removed `test.preview.blob@1`, whose items open as `rect@1`.
pub fn preview_removed() -> Module {
    preview_1_1(register_preview_removed)
}

/// `test.preview` 1.1.0 planted (#1802): it removed `test.preview.blob@1` with no migration.
pub fn preview_removed_bare() -> Module {
    preview_1_1(register_preview_removed_bare)
}

/// `test.preview` 1.0.0: `test.preview.blob@1 {box}`, drawn as a rect, a preview tracked by #412.
pub fn preview() -> Module {
    Module {
        manifest: manifest("test.preview", &[]),
        register: register_preview,
    }
}

/// The registry of cue kinds `test.cue` declares.
pub const CUE_KINDS: &str = "test.cue.kind@1";
const FLICKS: f64 = 705_600_000.0;

/// A cue kind's one move: a field of its targets from one value to another over its span, on a
/// spring released from rest.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Move {
    pub from: f64,
    pub to: f64,
    pub start: f64,
    pub span: f64,
    pub frequency: f64,
    pub damping_ratio: f64,
}

impl Move {
    /// A spring's displacement released from rest at 1 after `u` seconds.
    fn released(&self, u: f64) -> f64 {
        let w = ops::TAU * self.frequency;
        let z = self.damping_ratio;
        let wd = w * ops::sqrt(1.0 - z * z);
        ops::exp(-z * w * u) * (ops::cos(wd * u) + (z * w / wd) * ops::sin(wd * u))
    }

    /// The field's value at `t` seconds: `from` until the start, the spring between, and `to`
    /// from the start plus the span on.
    pub fn at(&self, t: f64) -> f64 {
        let u = t - self.start;
        if u <= 0.0 {
            self.from
        } else if u >= self.span {
            self.to
        } else {
            self.to + (self.from - self.to) * self.released(u)
        }
    }

    /// The move as `deep_kinds` lists it, its spring's decay and peak worked from the numbers
    /// the expansion runs on.
    pub fn to_json(&self) -> Value {
        let w = ops::TAU * self.frequency;
        let wd = w * ops::sqrt(1.0 - self.damping_ratio * self.damping_ratio);
        let peak = (ops::PI / wd).min(self.span);
        json!({
            "path": "at/scale", "from": self.from, "to": self.to, "start": self.start, "span": self.span,
            "ease": {"spring": {
                "frequency": self.frequency, "damping_ratio": self.damping_ratio,
                "decay": w * self.damping_ratio,
                "peak": {"at": peak, "value": self.at(self.start + peak)},
            }},
        })
    }
}

/// A cue kind's expansion at check: its entry's defaults, with the cue's own span when it gives
/// one, starting at `start` seconds.
pub fn expand(entry: &Value, start: f64, span: Option<f64>) -> Option<Move> {
    let spring = entry.get("spring")?;
    Some(Move {
        from: entry.get("from")?.as_f64()?,
        to: entry.get("to")?.as_f64()?,
        start,
        span: span.or_else(|| entry.get("span")?.as_f64())?,
        frequency: spring.get("frequency")?.as_f64()?,
        damping_ratio: spring.get("damping_ratio")?.as_f64()?,
    })
}

/// An entry's moves at its defaults, from its expansion: what `deep_kinds` lists.
fn moves_at_defaults(entry: &Value) -> Vec<Value> {
    expand(entry, 0.0, None)
        .map(|m| m.to_json())
        .into_iter()
        .collect()
}

/// `pop_in` at a default span of `span` seconds: its targets' scale from 0 to 1 on a spring of
/// 4 Hz and damping ratio 0.3.
fn pop_in(span: f64) -> Value {
    json!({"path": "at/scale", "from": 0.0, "to": 1.0, "span": span,
           "spring": {"frequency": 4.0, "damping_ratio": 0.3}})
}

fn cue_kinds() -> RegistryDef {
    let mut def = RegistryDef::new(
        CUE_KINDS,
        json!({"type": "object", "properties": {
            "path": {"type": "string"}, "from": {"type": "number"}, "to": {"type": "number"},
            "span": {"type": "number", "minimum": 0}, "spring": {"type": "object"}},
            "required": ["path", "from", "to", "span", "spring"], "additionalProperties": false}),
        &["module"],
        "R6",
    )
    .rule(
        "span_positive",
        "a cue kind's span is more than 0 s",
        |v| match v.get("span").and_then(Value::as_f64) {
            Some(s) if s > 0.0 => Ok(()),
            _ => Err("its span is not more than 0 s".into()),
        },
    )
    .planted(
        "no_span",
        json!({"path": "at/scale", "from": 0.0, "to": 1.0, "span": 0.0, "spring": {}}),
    );
    def.moves = Some(moves_at_defaults);
    def
}

/// Each cue of every cue list in the document that targets `id`, as its move: the list plays its
/// cues in order from 0 s, each starting where the one before ends.
fn moves_on(doc: &Value, id: &str, entry: &Value) -> Vec<Move> {
    let mut out = Vec::new();
    let lists = doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    for (_, list) in lists.filter(|(_, i)| of_kind(i, "test.cue.list@1")) {
        let mut start = 0.0;
        let cues = list
            .pointer("/params/cues")
            .and_then(Value::as_array)
            .into_iter()
            .flatten();
        for cue in cues {
            let span = cue.get("span").and_then(Value::as_f64);
            let Some(m) = expand(entry, start, span) else {
                continue;
            };
            start += m.span;
            let targets = cue
                .get("targets")
                .and_then(Value::as_array)
                .into_iter()
                .flatten();
            if targets.filter_map(Value::as_str).any(|t| t == id) {
                out.push(m);
            }
        }
    }
    out
}

fn targeted(doc: &Value, id: &str) -> bool {
    !moves_on(doc, id, &pop_in(0.5)).is_empty()
}

/// The pop-in's scale on the item at the session's time, at the default span `SPAN_MS`.
fn scale<const SPAN_MS: u32>(v: &mut View<'_>) -> Result<(), OpError> {
    let t = v.t()? as f64 / FLICKS;
    let id = v.id().unwrap_or_default().to_string();
    let doc = v.document()?;
    let entry = pop_in(f64::from(SPAN_MS) / 1000.0);
    let Some(m) = moves_on(doc, &id, &entry).into_iter().last() else {
        return Ok(());
    };
    let s = m.at(t);
    v.write(
        "test.cue.scale",
        Val::typed(Edits(vec![Edit {
            add: false,
            path: vec!["scale".into()],
            value: Datum::Nums(vec![s, s, s]),
        }])),
    )
}

fn register_cue<const SPAN_MS: u32>(r: &mut Registrar) {
    r.registry(cue_kinds());
    r.entry(
        CUE_KINDS,
        "pop_in",
        pop_in(f64::from(SPAN_MS) / 1000.0),
        "R6",
    );
    r.kind(kind("test", "cue.list", vec![json_param("cues")]), &[], "")
        .described("A cue list: plays its cues in order from 0 s, each a cue kind on its targets.");
    r.contribution(
        "test.cue.scale",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.operator(
        "scale",
        "items",
        &["self", "refs", "t"],
        &["test.cue.scale"],
    )
    .applies(|doc, id, _| targeted(doc, id))
    .run(scale::<SPAN_MS>);
}

/// `test.cue` 1.0.0: the registry `test.cue.kind@1` with `pop_in` at a default span of 0.5 s, and
/// the cue list `test.cue.list@1` that plays it.
pub fn cue() -> Module {
    Module {
        manifest: manifest("test.cue", &[]),
        register: register_cue::<500>,
    }
}

/// `test.cue` with `pop_in`'s default span at 0.8 s and nothing else changed.
pub fn cue_span() -> Module {
    Module {
        manifest: manifest("test.cue", &[]),
        register: register_cue::<800>,
    }
}

fn with_default(mut p: Param, default: Value) -> Param {
    p.default = default;
    p
}

/// `thick`, `stroke_width`: a width in u, at least 0, defaulting to 1.
fn width(name: &'static str) -> Param {
    Param {
        min: Some(0.0),
        ..with_default(number(name), json!(1))
    }
}

/// `segments`: how many segments the ring is drawn with.
fn segments(default: u32) -> Param {
    Param {
        name: "segments",
        ty: ParamType::F32,
        unit: "",
        default: json!(default),
        min: Some(3.0),
        max: Some(4096.0),
        minor: 0,
        module: "",
        operator: "",
    }
}

fn ring_1() -> Version {
    Version {
        major: 1,
        minor: 0,
        params: vec![
            json_param("center"),
            with_default(number("r"), json!(10)),
            width("thick"),
            with_default(json_param("dash"), json!([])),
            segments(32),
        ],
    }
}

fn register_ring_a(r: &mut Registrar) {
    r.kind(
        Entry {
            family: "",
            name: "ring",
            versions: vec![ring_1()],
            migrations: vec![],
        },
        &[],
        "",
    )
    .described("A ring about its center, drawn in segments.");
}

fn register_ring_b(r: &mut Registrar) {
    let ring_2 = Version {
        major: 2,
        minor: 0,
        params: vec![
            json_param("center"),
            with_default(number("r"), json!(10)),
            width("stroke_width"),
            segments(64),
        ],
    };
    r.kind(
        Entry {
            family: "",
            name: "ring",
            versions: vec![ring_1(), ring_2],
            migrations: vec![Migration {
                from: 1,
                to: 2,
                renames: vec![Rename {
                    from: "thick",
                    to: "stroke_width",
                }],
                retires: vec!["dash"],
                map: None,
            }],
        },
        &[],
        "",
    )
    .described("A ring about its center, drawn in segments.");
}

/// `test.ring` 1.0.0 at fixture digest A: `ring@1 {center, r, thick = 1, dash = [], segments = 32}`.
pub fn ring_a() -> Module {
    Module {
        manifest: manifest("test.ring", &[]),
        register: register_ring_a,
    }
}

/// `test.ring` 1.0.0 at fixture digest B: `ring@2 {center, r, stroke_width = 1, segments = 64}`,
/// migrating from ring@1 by renaming `thick` to `stroke_width` and retiring `dash`.
pub fn ring_b() -> Module {
    Module {
        manifest: manifest("test.ring", &[]),
        register: register_ring_b,
    }
}

fn register_wordy(r: &mut Registrar) {
    // A one-liner of 33,000 bytes: past the sheet's 32,768 on its own.
    let words = "a very long one-line description ".repeat(1000);
    r.kind(kind("test", "wordy.long", vec![box_param()]), &[], "rect@1")
        .described(&words);
}

/// `test.wordy`: `test.wordy.long@1`, whose one-line description is 33,000 bytes.
pub fn wordy() -> Module {
    Module {
        manifest: manifest("test.wordy", &[]),
        register: register_wordy,
    }
}
