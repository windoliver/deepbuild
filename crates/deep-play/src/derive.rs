//! #522: the entries a world reads off the core's input track (canvas primitives: Input track
//! entries). A world input with `on: {control: ID}` derives an entry from each entry of that
//! control at the world's first step at or after its flick; one with `on: {<canvas module>: item
//! ID}` takes each entry that item fires, which its module writes on the track. Whether the build
//! holds that module is the host's question, refused `module_missing`. Derived entries aren't
//! stored: they follow from the track and the document, so a replay applies the same ones.

use std::collections::BTreeMap;

use deep_canvas::document::Issue;
use deep_canvas::schedule::canonical;
use deep_canvas_physics::doc::{resolved, On, Refusal, World};
use deep_canvas_physics::occurrence::step_flicks;
use deep_canvas_physics::track;
use serde_json::{json, Value};

/// An entry a canvas module other than the input module writes on the core's input track: the
/// item that fires it, the step it's for, its kind and its fields.
pub struct Fired {
    pub module: String,
    pub item: String,
    pub step: u64,
    pub kind: String,
    pub data: Value,
}

/// World `w`'s entries from the core's input track `track` (the input module's control entries,
/// `{t, seq, control, value, …}`) and from `fired`, what the build's canvas modules fire, each as
/// the bake keeps it, in the order they apply: `{step, kind, target, data, input, from,
/// written}`. `modules_first`: the other modules write a step's entries before the input
/// module's (a planted build's order). A choice of `form` reads as its option's index (#1040).
pub fn kept(
    form: &Value,
    w: &World,
    track: &[Value],
    fired: &[Fired],
    modules_first: bool,
) -> Result<Vec<Value>, Box<Refusal>> {
    let track = &indexed(form, track)[..];
    let h = step_flicks(w);
    // The core input track as the modules wrote it: each step's input-module entries and the
    // other modules' in the order the build writes them; each entry's place in it, by its source.
    let (control_rank, module_rank) = if modules_first { (1, 0) } else { (0, 1) };
    let mut written: Vec<(u64, u8, (u8, usize))> = Vec::new();
    for (i, e) in track
        .iter()
        .enumerate()
        .filter(|(_, e)| e["control"].is_string())
    {
        let at = ((e["t"].as_i64().unwrap_or(0).max(0) + h - 1) / h) as u64;
        written.push((at, control_rank, (0, i)));
    }
    for (i, f) in fired.iter().enumerate() {
        written.push((f.step, module_rank, (1, i)));
    }
    let when = |(kind, i): (u8, usize)| match kind {
        0 => (track[i]["t"].as_i64(), track[i]["seq"].as_i64()),
        _ => (None, None),
    };
    written.sort_by_key(|(step, rank, src)| (*step, *rank, when(*src), src.1));
    let place: BTreeMap<(u8, usize), usize> =
        written.iter().enumerate().map(|(n, w)| (w.2, n)).collect();
    let row = |e: &track::Entry, from: String, n: usize| {
        json!({"step": e.step, "kind": e.kind, "target": e.target, "data": e.data, "input": e.input,
               "from": from, "written": n})
    };
    let mut out: Vec<Value> = Vec::new();
    for (i, e) in track::from_controls(w, h, track) {
        let control = track[i]["control"].as_str().unwrap_or_default();
        out.push(row(&e, format!("control:{control}"), place[&(0, i)]));
    }
    for (i, f) in fired.iter().enumerate() {
        for (id, input) in &w.inputs {
            let Some(On::Module { module, item }) = &input.on else {
                continue;
            };
            if *module != f.module || *item != f.item || input.kind != f.kind {
                continue;
            }
            let data = resolved(input, &f.data, &format!("inputs/{id}/data"))?;
            for target in &input.targets {
                let e = track::Entry {
                    step: f.step,
                    kind: input.kind.clone(),
                    target: target.clone(),
                    input: id.clone(),
                    data: data.clone(),
                };
                out.push(row(&e, format!("{module}:{item}"), place[&(1, i)]));
            }
        }
    }
    // #2371: of two sets of one target and path on one step, only the one written later holds
    // (Input track entries), as when an item fires its input twice in a step.
    let set = |v: &Value| {
        let path = v["data"]["path"].to_string();
        (v["kind"] == "set").then(|| (v["step"].as_u64(), v["target"].to_string(), path))
    };
    let mut last = BTreeMap::new();
    for v in &out {
        if let Some(k) = set(v) {
            let n = last.entry(k).or_insert(0);
            *n = v["written"].as_u64().unwrap_or(0).max(*n);
        }
    }
    out.retain(|v| set(v).is_none_or(|k| last[&k] == v["written"].as_u64().unwrap_or(0)));
    // The order they apply in: by step, then (kind, target ID), then input and data.
    let key = |v: &Value| {
        let s = |k: &str| v[k].as_str().unwrap_or_default().to_string();
        (
            v["step"].as_u64(),
            s("kind"),
            s("target"),
            s("input"),
            canonical(&v["data"]),
        )
    };
    out.sort_by_key(key);
    Ok(out)
}

/// `track` with each entry of a choice of `form` valued as its option's index (Control: in an
/// expression a choice reads as the index of its option), so a world input's data reads it as a
/// number.
fn indexed(form: &Value, track: &[Value]) -> Vec<Value> {
    let index = |e: &Value| {
        let c = &form["controls"][e["control"].as_str()?];
        let name = e["value"].as_str().filter(|_| c["kind"] == "choice")?;
        let names = deep_canvas::document::variants::option_names(form, c);
        let mut e = e.clone();
        e["value"] = json!(names.iter().position(|n| n == name)?);
        Some(e)
    };
    track
        .iter()
        .map(|e| index(e).unwrap_or_else(|| e.clone()))
        .collect()
}

/// The kept entries as the runner's track: each by its input, with its fields.
pub fn track_of(kept: &[Value]) -> Value {
    let entry = |k: &Value| json!({"step": k["step"], "kind": k["kind"], "target": k["target"], "input": k["input"], "data": k["data"]});
    Value::Array(kept.iter().map(entry).collect())
}

/// World `id`'s first input whose `on` names a canvas module the build doesn't hold, refused
/// `module_missing`, naming the module.
pub fn missing(id: &str, w: &World, held: impl Fn(&str) -> bool) -> Option<Issue> {
    w.inputs.iter().find_map(|(input, i)| match &i.on {
        Some(On::Module { module, item }) if !held(module) => Some(Issue::error(
            "module_missing",
            id,
            format!("worlds/{id}/inputs/{input}/on"),
            json!({"module": module, "item": item}),
            &format!("this world input takes the entries the {module} module's item {item} fires, and this build lacks the {module} module"),
        )),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #2371: a logic item that fires its set input twice in one step leaves the set it fired
    /// second, and its set of another step stays.
    #[test]
    fn a_set_fired_twice_in_a_step_keeps_the_second() {
        let doc = json!({
            "kind": "physics.world@1",
            "capacity": {"bodies": 1, "shapes": 1, "joints": 0, "contacts": 0, "particles": 0},
            "contact_materials": {"m": {"density": 1000}},
            "shapes": {"ball": {"kind": "sphere", "radius": 0.25}},
            "bodies": {"puck": {"kind": "dynamic", "shapes": [{"shape": "ball", "contact_material": "m"}]}},
            "forces": {"push": {"kind": {"uniform": {"accel": [2, 0, 0]}}, "applies_to": ["puck"], "strength": "throttle"}},
            "inputs": {"throttle": {"kind": "set", "targets": ["push"], "on": {"logic": "coach"}}}
        });
        let w = deep_canvas_physics::doc::read(&doc).unwrap_or_else(|e| panic!("{e:?}"));
        let fire = |step, value: f64| Fired {
            module: "logic".into(),
            item: "coach".into(),
            step,
            kind: "set".into(),
            data: json!({"value": value}),
        };
        let fired = [fire(40, 9.0), fire(40, 2.0), fire(41, 5.0)];
        let kept = kept(&json!({}), &w, &[], &fired, false).unwrap();
        let values: Vec<_> = kept
            .iter()
            .map(|k| (k["step"].clone(), k["data"]["value"].clone()))
            .collect();
        assert_eq!(values, [(json!(40), json!(2.0)), (json!(41), json!(5.0))]);
    }
}
