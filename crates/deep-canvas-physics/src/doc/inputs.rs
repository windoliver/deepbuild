//! #525: a world's declared inputs (Input track entries), the slice a live lab's press runs: a
//! `launch` derived from a control's entries, `on: {control, each}`, with the kind's defaults
//! `linear` (m/s) and `angular` (deg/s). Every other kind, an input a logic item fires, `data`
//! expressions and `from` are refused, naming #522, which brings the rest.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::{join, Body, Reader};
use crate::backend::Input;

/// The issue that brings the inputs this slice refuses.
const LATER: &str = "#522";

/// One declared input that a control's entries derive.
#[derive(Clone, Debug, PartialEq)]
pub struct Declared {
    pub kind: String,
    pub targets: Vec<String>,
    pub control: String,
    /// `each: change`: only an entry whose value differs from the one before adds it.
    pub on_change: bool,
    pub linear: [f64; 3],
    pub angular: [f64; 3],
}

impl Reader {
    pub(super) fn inputs(
        &mut self,
        m: &Map<String, Value>,
        bodies: &BTreeMap<String, Body>,
    ) -> BTreeMap<String, Declared> {
        let mut out = BTreeMap::new();
        for (id, v) in self.map(m, "inputs") {
            let path = format!("inputs/{id}");
            let d = self.obj(
                v,
                &path,
                &["kind", "targets", "on", "data", "from", "linear", "angular"],
            );
            let later = |what: &str| {
                format!("{what} isn't run by this backend interface yet; {LATER} brings it")
            };
            let kind = d.get("kind").and_then(Value::as_str).unwrap_or_default();
            if kind != "launch" {
                self.refuse(
                    "physics.unsupported",
                    join(&path, "kind"),
                    &json!(kind),
                    later(&format!("the input kind {kind}")),
                );
                continue;
            }
            if let Some((k, x)) = ["data", "from"].iter().find_map(|k| Some((*k, d.get(*k)?))) {
                self.refuse(
                    "physics.unsupported",
                    join(&path, k),
                    x,
                    later(&format!("an input's {k}")),
                );
                continue;
            }
            let on = d.get("on").cloned().unwrap_or(Value::Null);
            let control = on.get("control").and_then(Value::as_str);
            let each = on.get("each").and_then(Value::as_str).unwrap_or("entry");
            let Some(control) = control.filter(|_| ["entry", "change"].contains(&each)) else {
                self.refuse(
                    "physics.unsupported",
                    join(&path, "on"),
                    &on,
                    later("an input not derived from a control's entries"),
                );
                continue;
            };
            let targets: Vec<String> = d
                .get("targets")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|t| t.as_str().map(str::to_string))
                .collect();
            let unknown = targets.iter().find(|t| !bodies.contains_key(*t)).cloned();
            if targets.is_empty() || unknown.is_some() {
                let t = unknown.unwrap_or_default();
                self.refuse(
                    "out_of_range",
                    join(&path, "targets"),
                    d.get("targets").unwrap_or(&Value::Null),
                    format!("targets must name bodies of the world; `{t}` is none"),
                );
                continue;
            }
            let linear = self.vec3(&d, "linear", &path, [0.0; 3]);
            let angular = self.vec3(&d, "angular", &path, [0.0; 3]);
            out.insert(
                id.clone(),
                Declared {
                    kind: kind.into(),
                    targets,
                    control: control.into(),
                    on_change: each == "change",
                    linear,
                    angular,
                },
            );
        }
        out
    }
}

/// The inputs a track derives, by step: each entry of a declared input's control adds it, to
/// each of its targets, at the first step at or after the entry's flick (step k runs over
/// [(k − 1)·h, k·h), so that step is ⌈t ÷ h⌉ + 1), ordered by (kind, target ID).
pub fn derived(
    inputs: &BTreeMap<String, Declared>,
    h: i64,
    track: &[Value],
) -> BTreeMap<u64, Vec<Input>> {
    let mut out: BTreeMap<u64, Vec<Input>> = BTreeMap::new();
    for d in inputs.values() {
        let mut entries: Vec<&Value> = track
            .iter()
            .filter(|e| e["control"] == json!(d.control))
            .collect();
        entries.sort_by_key(|e| (e["t"].as_i64().unwrap_or(0), e["seq"].as_i64().unwrap_or(0)));
        let mut last: Option<&Value> = None;
        for e in entries {
            let changed = last.is_none_or(|l| l["value"] != e["value"]);
            last = Some(e);
            let Some(t) = e["t"].as_i64().filter(|_| changed || !d.on_change) else {
                continue;
            };
            let k = (t.max(0) + h - 1).div_euclid(h) as u64 + 1;
            for target in &d.targets {
                let data = json!({"linear": d.linear, "angular": d.angular});
                out.entry(k).or_default().push(Input {
                    kind: d.kind.clone(),
                    target: target.clone(),
                    data,
                });
            }
        }
    }
    for v in out.values_mut() {
        v.sort_by(|a, b| (&a.kind, &a.target).cmp(&(&b.kind, &b.target)));
    }
    out
}
