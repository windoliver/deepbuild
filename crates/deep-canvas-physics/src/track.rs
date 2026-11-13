//! Issue #522: a world's input track (canvas primitives: Input track entries, Input track).
//! Entries `{step, kind, target, data}` apply at the start of their step, ordered by (kind,
//! target ID), then by the declared input and its data, so the order two writers wrote them in
//! never matters. A new entry where later ones exist forks the track there; a late entry joins
//! at its step and drops nothing.

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use deep_canvas::schedule::canonical;
use serde_json::{json, Map, Value};

use crate::doc::{resolved, Input, Refusal, World};

/// One entry, resolved against the input it names: its fields over that input's defaults.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub step: u64,
    pub kind: String,
    pub target: String,
    /// The declared input it belongs to.
    pub input: String,
    pub data: Map<String, Value>,
}

impl Entry {
    fn rank(&self) -> (u64, &str, &str, &str, Vec<u8>) {
        let data = canonical(&Value::Object(self.data.clone()));
        (self.step, &self.kind, &self.target, &self.input, data)
    }

    pub fn json(&self) -> Value {
        json!({"step": self.step, "kind": self.kind, "target": self.target, "input": self.input, "data": self.data})
    }
}

/// Sorts `entries` into the order they apply in.
pub fn order(entries: &mut [Entry]) {
    entries.sort_by(|a, b| a.rank().cmp(&b.rank()));
}

/// The track's hash: sha256 of its entries in order, as 64 hex.
pub fn hash(entries: &[Entry]) -> String {
    let all: Vec<Value> = entries.iter().map(Entry::json).collect();
    sha256_hex(&canonical(&Value::Array(all)))
}

/// Each step's entries, in the order they apply.
pub fn by_step(entries: &[Entry]) -> BTreeMap<u64, Vec<Entry>> {
    let mut out: BTreeMap<u64, Vec<Entry>> = BTreeMap::new();
    let mut sorted = entries.to_vec();
    order(&mut sorted);
    for e in sorted {
        out.entry(e.step).or_default().push(e);
    }
    out
}

/// `v`, a written entry at `path`, resolved against the world's declared inputs: `input` names
/// one, or else its `kind` and `target` pick the one input of that kind that targets it.
pub fn entry(w: &World, v: &Value, path: &str) -> Result<Entry, Box<Refusal>> {
    let refused = |code, what: String| {
        Box::new(Refusal {
            code,
            path: path.into(),
            actual: v.clone(),
            what,
        })
    };
    let step = v
        .get("step")
        .and_then(Value::as_u64)
        .ok_or_else(|| refused("out_of_range", format!("{path}/step must be a step")))?;
    let target = v.get("target").and_then(Value::as_str).unwrap_or("");
    let named = v.get("input").and_then(Value::as_str);
    let kind = v.get("kind").and_then(Value::as_str);
    let fits = |(id, i): &(&String, &Input)| {
        named.is_none_or(|n| n == id.as_str())
            && kind.is_none_or(|k| k == i.kind)
            && i.targets.iter().any(|t| t == target)
    };
    let found: Vec<(&String, &Input)> = w.inputs.iter().filter(fits).collect();
    let [(id, input)] = found[..] else {
        let what = format!(
            "{path} must name one input the world declares, of its kind, that targets {target}"
        );
        return Err(refused("ref_unresolved", what));
    };
    Ok(Entry {
        step,
        kind: input.kind.clone(),
        target: target.into(),
        input: id.clone(),
        data: resolved(input, v.get("data").unwrap_or(&Value::Null), path)?,
    })
}

/// The entries of `track`, a JSON array, resolved and in order.
pub fn read(w: &World, track: &Value) -> Result<Vec<Entry>, Box<Refusal>> {
    let mut out = Vec::new();
    for (i, v) in track.as_array().into_iter().flatten().enumerate() {
        out.push(entry(w, v, &format!("track/{i}"))?);
    }
    order(&mut out);
    Ok(out)
}

/// Forks the track at `e`'s step: every entry after it is dropped, and `e` joins.
pub fn fork(entries: &mut Vec<Entry>, e: Entry) {
    entries.retain(|x| x.step <= e.step);
    entries.push(e);
    order(entries);
}

/// A late entry joins at its own step and drops nothing.
pub fn join(entries: &mut Vec<Entry>, e: Entry) {
    entries.push(e);
    order(entries);
}

/// The entries a core input track `core` (the input module's control entries, `{t, seq, control,
/// value, …}`) derives for `w`'s inputs `on` a control: each entry of that control, or with
/// `each: change` each whose value differs from the one before, adds the input to each of its
/// targets, stamped at the first step at or after the entry's flick (`h` flicks a step), with the
/// input's defaults. Each comes with the index in `core` of the entry it derives from (#522, #525).
pub fn from_controls(w: &World, h: i64, core: &[Value]) -> Vec<(usize, Entry)> {
    let mut controls: Vec<(usize, &Value)> = core
        .iter()
        .enumerate()
        .filter(|(_, e)| e["control"].is_string())
        .collect();
    controls.sort_by_key(|(_, e)| (e["t"].as_i64(), e["seq"].as_i64()));
    let mut last: BTreeMap<&str, &Value> = BTreeMap::new();
    let mut out = Vec::new();
    for (i, e) in controls {
        let control = e["control"].as_str().unwrap_or_default();
        let changed = last.get(control).is_none_or(|v| **v != e["value"]);
        last.insert(control, &e["value"]);
        let step = ((e["t"].as_i64().unwrap_or(0).max(0) + h - 1) / h) as u64;
        for (id, input) in &w.inputs {
            let Some(crate::doc::On::Control { id: c, change }) = &input.on else {
                continue;
            };
            if c != control || (*change && !changed) {
                continue;
            }
            for target in &input.targets {
                let entry = Entry {
                    step,
                    kind: input.kind.clone(),
                    target: target.clone(),
                    input: id.clone(),
                    data: input.defaults.clone(),
                };
                out.push((i, entry));
            }
        }
    }
    out
}
