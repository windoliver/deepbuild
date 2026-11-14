//! #522's fields of the world document: the inputs it declares (canvas primitives: Input track
//! entries), and the checkpoint ring's `every` and `budget` (Checkpoint ring).

use std::collections::BTreeMap;

use deep_canvas::expr::Expr;
use serde_json::{json, Map, Value};

use super::{data, join, Body, Reader, Refusal};

/// The issue that brings the input kinds and fields this backend interface doesn't run yet.
pub const INPUTS_LATER: &str = "#2371";

/// The input kinds this backend interface runs, each with its fields and their defaults.
const KINDS: [(&str, &[(&str, Field)]); 5] = [
    (
        "grab",
        &[
            ("point", Field::Vec3([0.0; 3])),
            ("plane", Field::Plane),
            ("pick_radius", Field::Num(0.0, 0.0)),
            ("hz", Field::Num(2.0, f64::MIN_POSITIVE)),
            ("damping_ratio", Field::Num(0.6, 0.0)),
            ("max_accel", Field::Num(140.0, f64::MIN_POSITIVE)),
        ],
    ),
    (
        "launch",
        &[
            ("linear", Field::Vec3([0.0; 3])),
            ("angular", Field::Vec3([0.0; 3])),
            ("from", Field::From),
        ],
    ),
    ("move", &[("to", Field::Vec3([0.0; 3]))]),
    (
        "poke",
        &[
            ("point", Field::Vec3([0.0; 3])),
            ("impulse", Field::Vec3([0.0; 3])),
            ("push", Field::Vec3([0.0; 3])),
        ],
    ),
    ("release", &[("keeps_velocity", Field::Bool(true))]),
];

/// The kinds and fields the design gives that wait on `INPUTS_LATER` or the issue named.
const LATER: [(&str, &str); 11] = [
    ("set", INPUTS_LATER),
    ("activate", INPUTS_LATER),
    ("deactivate", INPUTS_LATER),
    ("blast", INPUTS_LATER),
    ("jump", "#182"),
    ("drive", "#251"),
    ("steer", "#251"),
    ("brake", "#251"),
    ("poke.address", INPUTS_LATER),
    ("poke.radius", INPUTS_LATER),
    ("poke.falloff", INPUTS_LATER),
];

#[derive(Clone, Copy)]
enum Field {
    /// Its default and its least value.
    Num(f64, f64),
    Vec3([f64; 3]),
    Bool(bool),
    /// The plane a drag moves on: `view`, `ground` or `{normal: vec3}`, `view` by default.
    Plane,
    /// Where a launch places its body first (#540): a position `[x, y, z]`, a pose `{pos, rot}`,
    /// or `pose`, the pose its `from.pos` and `from.rot` data fields give; none by default.
    From,
}

/// The issue that brings a launch from a body's anchor.
const ANCHOR: &str = "#164";

/// Where a derived input comes from (Input track entries: `on`).
#[derive(Clone, Debug, PartialEq)]
pub enum On {
    /// Each entry of the control, or with `change` each entry whose value differs from the last.
    Control { id: String, change: bool },
    /// Each entry the item `item` of the canvas module `module` fires, which that module puts on
    /// the core's input track as derived entries: `{logic: ID}` a logic item's. The physics module
    /// reads the module by name only and never depends on it.
    Module { module: String, item: String },
}

/// An input the world declares: its kind, the bodies it may target, its fields' defaults with
/// the kind's own under them, and where it's derived from.
#[derive(Clone, Debug, PartialEq)]
pub struct Input {
    pub kind: String,
    pub targets: Vec<String>,
    pub defaults: Map<String, Value>,
    pub on: Option<On>,
    /// #540: each `data` field written as an expression over controls, read at each entry's
    /// flick over the defaults (`super::data`).
    pub exprs: BTreeMap<String, Expr>,
}

/// An entry's fields over `input`'s defaults, or the refusal of a field its kind doesn't take.
pub fn resolved(
    input: &Input,
    data: &Value,
    path: &str,
) -> Result<Map<String, Value>, Box<Refusal>> {
    let mut out = input.defaults.clone();
    let Some(d) = data.as_object() else {
        return if data.is_null() {
            Ok(out)
        } else {
            Err(bad(
                join(path, "data"),
                data,
                "data must be an object".into(),
            ))
        };
    };
    for (k, v) in d {
        out.insert(k.clone(), field(&input.kind, k, v, &join(path, k))?);
    }
    Ok(out)
}

fn bad(path: String, actual: &Value, what: String) -> Box<Refusal> {
    Box::new(Refusal {
        code: "out_of_range",
        path,
        actual: actual.clone(),
        what,
    })
}

/// `v` as field `key` of `kind`, or its refusal.
fn field(kind: &str, key: &str, v: &Value, path: &str) -> Result<Value, Box<Refusal>> {
    let later = format!("{kind}.{key}");
    if let Some((_, issue)) = LATER.iter().find(|(n, _)| *n == later) {
        return Err(Box::new(Refusal {
            code: "physics.unsupported",
            path: path.into(),
            actual: v.clone(),
            what: format!("{later} isn't run by this backend interface yet; {issue} brings it"),
        }));
    }
    let fields = KINDS
        .iter()
        .find(|(n, _)| *n == kind)
        .map_or(&[][..], |k| k.1);
    let Some((_, f)) = fields.iter().find(|(n, _)| *n == key) else {
        let names: Vec<&str> = fields.iter().map(|(n, _)| *n).collect();
        return Err(Box::new(Refusal {
            code: "unknown_field",
            path: path.into(),
            actual: v.clone(),
            what: format!(
                "{path} is not a field of {kind}; its fields are {}",
                names.join(", ")
            ),
        }));
    };
    let ok = match f {
        Field::Num(_, min) => v.as_f64().is_some_and(|x| x >= *min && x.is_finite()),
        Field::Vec3(_) => three(v),
        Field::Bool(_) => v.is_boolean(),
        Field::Plane => {
            v == "view"
                || v == "ground"
                || v.get("normal")
                    .and_then(Value::as_array)
                    .is_some_and(|a| a.len() == 3)
        }
        Field::From => match v {
            Value::String(s) if s == "pose" => true,
            Value::String(s) => {
                return Err(Box::new(Refusal {
                    code: "physics.unsupported",
                    path: path.into(),
                    actual: v.clone(),
                    what: format!("a launch from a body's anchor ({s}) isn't run by this backend interface yet; {ANCHOR} brings it"),
                }))
            }
            Value::Array(_) => three(v),
            Value::Object(o) => {
                o.keys().all(|k| k == "pos" || k == "rot")
                    && o.get("pos").is_none_or(three)
                    && o.get("rot").is_none_or(|r| {
                        r.as_array().is_some_and(|a| {
                            (3..=4).contains(&a.len()) && a.iter().all(|x| x.as_f64().is_some())
                        })
                    })
            }
            _ => false,
        },
    };
    if ok {
        Ok(v.clone())
    } else {
        let want = match f {
            Field::Num(_, min) => format!("a number of at least {min}"),
            Field::Vec3(_) => "three numbers".into(),
            Field::Bool(_) => "true or false".into(),
            Field::Plane => "view, ground or {normal: vec3}".into(),
            Field::From => "a position [x, y, z], a pose {pos, rot} or pose".into(),
        };
        Err(bad(path.into(), v, format!("{path} must be {want}")))
    }
}

/// Whether `v` is three finite numbers.
fn three(v: &Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() == 3 && a.iter().all(|x| x.as_f64().is_some_and(f64::is_finite)))
}

/// Whether `kind` takes a data expression for `key`: one of its fields, or a launch's
/// `from.pos` and `from.rot`.
fn takes_expr(kind: &str, key: &str) -> bool {
    let fields = KINDS
        .iter()
        .find(|(n, _)| *n == kind)
        .map_or(&[][..], |k| k.1);
    fields.iter().any(|(n, _)| *n == key)
        || (kind == "launch" && matches!(key, "from.pos" | "from.rot"))
}

/// The kind's own defaults.
fn own(kind: &str) -> Map<String, Value> {
    let fields = KINDS
        .iter()
        .find(|(n, _)| *n == kind)
        .map_or(&[][..], |k| k.1);
    fields
        .iter()
        .filter(|(n, _)| !matches!(*n, "point" | "impulse" | "push") || kind == "grab")
        .filter(|(n, _)| *n != "from")
        .map(|(n, f)| {
            let v = match f {
                Field::Num(d, _) => json!(d),
                Field::Vec3(d) => json!(d),
                Field::Bool(b) => json!(b),
                Field::Plane => json!("view"),
                Field::From => Value::Null,
            };
            ((*n).to_string(), v)
        })
        .collect()
}

impl Reader {
    /// `checkpoint: {every, budget}`: steps between deep checkpoints, 60 by default, and the
    /// ring's bytes, 16 MiB by default.
    pub(super) fn checkpoint(&mut self, m: &Map<String, Value>) -> (u64, u64) {
        let cp = &self.obj(
            m.get("checkpoint").unwrap_or(&Value::Null),
            "checkpoint",
            &["every", "budget"],
        );
        let every = self.num(cp, "every", "checkpoint", 60.0, 1.0, f64::from(u32::MAX)) as u64;
        let budget = self.num(
            cp,
            "budget",
            "checkpoint",
            16.0 * 1024.0 * 1024.0,
            1.0,
            9e15,
        );
        (every, budget as u64)
    }

    /// `inputs: {ID → {kind, targets, on, ...defaults}}`, each target a body of the world.
    pub(super) fn inputs(
        &mut self,
        m: &Map<String, Value>,
        bodies: &BTreeMap<String, Body>,
    ) -> BTreeMap<String, Input> {
        let mut out = BTreeMap::new();
        for (id, v) in self.map(m, "inputs") {
            let p = format!("inputs/{id}");
            let Some(o) = v.as_object() else {
                self.refuse(
                    "out_of_range",
                    p,
                    v,
                    format!("inputs/{id} must be an object"),
                );
                continue;
            };
            let kind = o.get("kind").and_then(Value::as_str).unwrap_or("");
            if let Some((_, issue)) = LATER.iter().find(|(n, _)| *n == kind) {
                let what = format!("the input kind {kind} isn't run by this backend interface yet; {issue} brings it");
                self.refuse("physics.unsupported", join(&p, "kind"), &o["kind"], what);
                continue;
            }
            if !KINDS.iter().any(|(n, _)| *n == kind) {
                let names: Vec<&str> = KINDS.iter().map(|(n, _)| *n).collect();
                let what = format!("{p}/kind must be one of {}", names.join(", "));
                self.refuse(
                    "out_of_range",
                    join(&p, "kind"),
                    o.get("kind").unwrap_or(&Value::Null),
                    what,
                );
                continue;
            }
            let mut defaults = own(kind);
            let mut exprs = BTreeMap::new();
            // The kind's defaults as fields, then `data`'s values over them: a constant here, an
            // expression over controls read at each entry's flick (#540).
            if let Some(d) = o.get("data").filter(|d| !d.is_object()) {
                self.refuse(
                    "out_of_range",
                    join(&p, "data"),
                    d,
                    format!("{p}/data must be an object"),
                );
            }
            let fields = o
                .iter()
                .filter(|(k, _)| !matches!(k.as_str(), "kind" | "targets" | "on" | "data"));
            let given: Vec<(String, Value, String)> = fields
                .map(|(k, x)| (k.clone(), x.clone(), join(&p, k)))
                .chain(
                    o.get("data")
                        .and_then(Value::as_object)
                        .into_iter()
                        .flatten()
                        .map(|(k, x)| (k.clone(), x.clone(), format!("{p}/data/{k}"))),
                )
                .collect();
            for (k, x, path) in given {
                if let (Some(text), true) = (x.as_str(), path.contains("/data/")) {
                    if !takes_expr(kind, &k) {
                        let what = format!("{path} is not a field of {kind}");
                        self.refuse("unknown_field", path, &x, what);
                        continue;
                    }
                    match data::compile(text) {
                        Ok(e) => {
                            exprs.insert(k, e);
                        }
                        Err(why) => {
                            let what = format!(
                                "{path} must be an expression over controls and constants: {why}"
                            );
                            self.refuse("out_of_range", path, &x, what);
                        }
                    }
                    continue;
                }
                match field(kind, &k, &x, &path) {
                    Ok(x) => {
                        defaults.insert(k, x);
                    }
                    Err(r) => self.out.push(*r),
                }
            }
            if kind == "poke" && defaults.contains_key("impulse") && defaults.contains_key("push") {
                self.refuse(
                    "out_of_range",
                    p.clone(),
                    v,
                    format!("{p} takes impulse or push, not both"),
                );
            }
            let mut targets = Vec::new();
            for (i, t) in o
                .get("targets")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                match t.as_str().filter(|n| bodies.contains_key(*n)) {
                    Some(n) => targets.push(n.to_string()),
                    None => self.refuse(
                        "ref_unresolved",
                        format!("{p}/targets/{i}"),
                        t,
                        format!("{t} names no body of this world"),
                    ),
                }
            }
            if targets.is_empty() {
                let what = format!("{p} must target at least one body");
                self.refuse(
                    "physics.missing_field",
                    join(&p, "targets"),
                    o.get("targets").unwrap_or(&Value::Null),
                    what,
                );
            }
            targets.sort();
            let on = o.get("on").and_then(|x| self.on(x, &join(&p, "on")));
            out.insert(
                id.clone(),
                Input {
                    kind: kind.into(),
                    targets,
                    defaults,
                    on,
                    exprs,
                },
            );
        }
        out
    }

    fn on(&mut self, v: &Value, p: &str) -> Option<On> {
        let bad = |r: &mut Reader| {
            let what = format!("{p} must be {{control: ID, each}} or {{<canvas module>: item ID}}");
            r.refuse("out_of_range", p.into(), v, what);
            None
        };
        let Some(o) = v.as_object() else {
            return bad(self);
        };
        if o.contains_key("control") {
            let o = &self.obj(v, p, &["control", "each"]);
            let each = self.word(o, "each", p, "entry", &["entry", "change"]);
            return match o.get("control") {
                Some(Value::String(c)) => Some(On::Control {
                    id: c.clone(),
                    change: each == "change",
                }),
                _ => bad(self),
            };
        }
        match o.iter().collect::<Vec<_>>()[..] {
            [(module, Value::String(item))] => Some(On::Module {
                module: module.clone(),
                item: item.clone(),
            }),
            _ => bad(self),
        }
    }
}
