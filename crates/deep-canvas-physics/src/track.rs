//! Issue #522: a world's input track (canvas primitives: Input track entries, Input track).
//! Entries `{step, kind, target, data}` apply at the start of their step, ordered by (kind,
//! target ID), then by the declared input and its data, so the order two writers wrote them in
//! never matters. A new entry where later ones exist forks the track there; a late entry joins
//! at its step and drops nothing.

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use deep_canvas::schedule::canonical;
use serde_json::{json, Map, Value};

use crate::doc::{addressed, resolved, Input, Refusal, World};

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
    let data = resolved(input, v.get("data").unwrap_or(&Value::Null), path)?;
    addressed(&w.bodies, &data, path)?;
    Ok(Entry {
        step,
        kind: input.kind.clone(),
        target: target.into(),
        input: id.clone(),
        data,
    })
}

/// #2371: drops from `entries` the one `e`, written after it, replaces: a `set` of `e`'s step,
/// target and path (Input track entries: "a second `set` on the same step replaces the first").
fn replace<T>(entries: &mut Vec<T>, e: &Entry, entry: impl Fn(&T) -> &Entry) {
    if e.kind != "set" {
        return;
    }
    let of = |x: &Entry| x.kind == "set" && x.step == e.step && x.target == e.target;
    entries.retain(|x| !of(entry(x)) || entry(x).data.get("path") != e.data.get("path"));
}

/// The entries of `track`, a JSON array, resolved and in order, each `set` replacing the one
/// written before it on its step; `both` (#2371's planted track) keeps the two, which then
/// apply in the track's own order, never the order written.
pub fn read(w: &World, track: &Value, both: bool) -> Result<Vec<Entry>, Box<Refusal>> {
    let mut out = Vec::new();
    for (i, v) in track.as_array().into_iter().flatten().enumerate() {
        let e = entry(w, v, &format!("track/{i}"))?;
        if !both {
            replace(&mut out, &e, |x| x);
        }
        out.push(e);
    }
    order(&mut out);
    Ok(out)
}

/// Forks the track at `e`'s step: every entry after it is dropped, and `e` joins.
pub fn fork(entries: &mut Vec<Entry>, e: Entry) {
    entries.retain(|x| x.step <= e.step);
    join(entries, e);
}

/// A late entry joins at its own step and drops nothing but a `set` it replaces.
pub fn join(entries: &mut Vec<Entry>, e: Entry) {
    replace(entries, &e, |x| x);
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
            // #540: its data expressions read at the entry's flick over its defaults; a field that
            // reads nothing there derives no input from the entry.
            let mut data = input.defaults.clone();
            if !input.exprs.is_empty() {
                let Some(fields) = crate::doc::data::fields(&input.exprs, e, core) else {
                    continue;
                };
                data.extend(fields);
            }
            if data.get("from").is_some_and(|f| f == "pose") {
                data.remove("from");
            }
            for target in &input.targets {
                let entry = Entry {
                    step,
                    kind: input.kind.clone(),
                    target: target.clone(),
                    input: id.clone(),
                    data: data.clone(),
                };
                replace(&mut out, &entry, |d: &(usize, Entry)| &d.1);
                out.push((i, entry));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A world whose force `push` takes its strength from the set input `throttle`, which each
    /// entry of the control `gas` derives with its value.
    fn world() -> World {
        let doc = json!({
            "kind": "physics.world@1",
            "capacity": {"bodies": 1, "shapes": 1, "joints": 0, "contacts": 0, "particles": 0},
            "contact_materials": {"m": {"density": 1000}},
            "shapes": {"ball": {"kind": "sphere", "radius": 0.25}},
            "bodies": {"puck": {"kind": "dynamic", "shapes": [{"shape": "ball", "contact_material": "m"}]}},
            "forces": {"push": {"kind": {"uniform": {"accel": [2, 0, 0]}}, "applies_to": ["puck"], "strength": "throttle"}},
            "inputs": {"throttle": {"kind": "set", "targets": ["push"], "path": "strength", "value": 0,
                                    "on": {"control": "gas"}, "data": {"value": "gas"}},
                       "poke": {"kind": "poke", "targets": ["puck"]}}
        });
        crate::doc::read(&doc).unwrap_or_else(|e| panic!("{e:?}"))
    }

    fn set(step: u64, value: f64) -> Value {
        json!({"step": step, "kind": "set", "target": "push", "data": {"value": value}})
    }

    /// Each entry's step and the value it sets, in the order they apply.
    fn values(entries: &[Entry]) -> Vec<(u64, f64)> {
        let value = |e: &Entry| e.data["value"].as_f64().unwrap();
        entries.iter().map(|e| (e.step, value(e))).collect()
    }

    /// Of two sets of one force's strength on one step, the one written second holds, however a
    /// track takes them: read from a call, joined late, forked in, or derived from a control.
    #[test]
    fn a_second_set_on_one_step_replaces_the_first() {
        let w = world();
        let read = |track: Value, both| values(&read(&w, &track, both).unwrap());
        assert_eq!(
            read(json!([set(40, 9.0), set(40, 2.0)]), false),
            [(40, 2.0)]
        );
        assert_eq!(
            read(json!([set(40, 2.0), set(40, 9.0)]), false),
            [(40, 9.0)]
        );
        // Another step's set stays, and the planted track keeps both, the 9 applied last.
        let apart = json!([set(40, 9.0), set(41, 2.0)]);
        assert_eq!(read(apart, false), [(40, 9.0), (41, 2.0)]);
        let both = [(40, 2.0), (40, 9.0)];
        assert_eq!(read(json!([set(40, 9.0), set(40, 2.0)]), true), both);

        let entry = |step, value| entry(&w, &set(step, value), "track/0").unwrap();
        let mut late = vec![entry(40, 9.0), entry(50, 5.0)];
        join(&mut late, entry(40, 2.0));
        assert_eq!(values(&late), [(40, 2.0), (50, 5.0)]);
        fork(&mut late, entry(40, 7.0));
        assert_eq!(values(&late), [(40, 7.0)]);

        // Two entries of the control inside step 1 and one inside step 2.
        let h = crate::occurrence::step_flicks(&w);
        let gas =
            |t: i64, seq: i64, v: f64| json!({"t": t, "seq": seq, "control": "gas", "value": v});
        let core = [gas(1, 0, 9.0), gas(2, 1, 2.0), gas(h + 1, 2, 4.0)];
        let derived: Vec<Entry> = from_controls(&w, h, &core)
            .into_iter()
            .map(|d| d.1)
            .collect();
        assert_eq!(values(&derived), [(1, 2.0), (2, 4.0)]);
    }

    /// An entry's poke by the address of an anchor no body has is refused at the entry's field.
    #[test]
    fn a_poke_by_an_address_no_body_has_is_refused() {
        let poke =
            json!({"step": 3, "kind": "poke", "target": "puck", "data": {"address": "puck#rim"}});
        let refused = entry(&world(), &poke, "track/0").unwrap_err();
        assert_eq!(
            (refused.code, refused.path.as_str()),
            ("ref_unresolved", "track/0/address")
        );
    }
}
