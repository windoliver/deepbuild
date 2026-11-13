//! #522: the entries a world reads off the core's input track (canvas primitives: Input track
//! entries; tests/acceptance/522/README.md: deep-show). A world input with `on: {control: ID}`
//! derives an entry from each entry of that control at the world's first step at or after its
//! flick; one with `on: {<canvas module>: item ID}` takes each entry that item fires, which its
//! module writes on the track. The physics module reads `on`'s module by name only; whether the
//! build holds it is this host's question, refused `module_missing`. Derived entries aren't
//! stored: they follow from the track and the document, so a replay applies the same ones, and
//! the bake keeps each with where it came from and the place it took as the modules wrote it.

use std::collections::BTreeMap;

use deep_canvas::document::Issue;
use deep_canvas::schedule::canonical;
use deep_canvas_physics::doc::{resolved, On, Refusal, World};
use deep_canvas_physics::occurrence::step_flicks;
use serde_json::{json, Map, Value};

/// An entry a canvas module other than the input module writes on the core's input track: the
/// item that fires it, the step it's for, its kind and its fields.
struct Fired {
    module: String,
    item: String,
    step: u64,
    kind: String,
    data: Value,
}

/// The entries the build's canvas modules fire in `form`, each module's in the order it writes
/// them (#1834 adds logic's).
fn fired(form: &Value) -> Vec<Fired> {
    #[allow(unused_mut)]
    let mut out = Vec::new();
    #[cfg(any(feature = "test-launch-module", feature = "test-launch-module-first"))]
    for e in deep_canvas_test_modules::launch::fired(form) {
        out.push(Fired {
            module: "test.launch".into(),
            item: e["item"].as_str().unwrap_or_default().into(),
            step: e["step"].as_u64().unwrap_or(0),
            kind: e["kind"].as_str().unwrap_or_default().into(),
            data: e["data"].clone(),
        });
    }
    let _ = form;
    out
}

/// `test-launch-module-first`: the other modules write a step's entries before the input
/// module's, not after.
const MODULES_FIRST: bool = cfg!(feature = "test-launch-module-first");

/// One entry on the core's input track as the modules wrote it.
enum Written<'a> {
    Control(&'a Value),
    Module(&'a Fired),
}

/// World `w`'s entries from the core's input track `track` (the input module's control entries,
/// `{t, seq, control, value, …}`) and from what `form`'s canvas modules fire, each as the bake
/// keeps it, in the order they apply: `{step, kind, target, data, input, from, written}`.
pub(crate) fn kept(form: &Value, w: &World, track: &[Value]) -> Result<Vec<Value>, Box<Refusal>> {
    let h = step_flicks(w);
    let at = |t: i64| ((t.max(0) + h - 1) / h) as u64;
    let fired = fired(form);
    let mut controls: Vec<&Value> = track.iter().filter(|e| e["control"].is_string()).collect();
    controls.sort_by_key(|e| (e["t"].as_i64(), e["seq"].as_i64()));
    let (control_rank, module_rank) = if MODULES_FIRST { (1, 0) } else { (0, 1) };
    let mut written: Vec<(u64, u8, usize, Written)> = Vec::new();
    for (i, e) in controls.iter().enumerate() {
        written.push((
            at(e["t"].as_i64().unwrap_or(0)),
            control_rank,
            i,
            Written::Control(e),
        ));
    }
    for (i, f) in fired.iter().enumerate() {
        written.push((f.step, module_rank, i, Written::Module(f)));
    }
    written.sort_by_key(|(step, rank, i, _)| (*step, *rank, *i));
    let mut last: BTreeMap<&str, &Value> = BTreeMap::new();
    let mut out: Vec<Value> = Vec::new();
    for (n, (step, _, _, e)) in written.iter().enumerate() {
        for (id, input) in &w.inputs {
            let (data, from) = match (e, &input.on) {
                (
                    Written::Control(c),
                    Some(On::Control {
                        id: control,
                        change,
                    }),
                ) if c["control"] == json!(control) => {
                    if *change
                        && last
                            .get(control.as_str())
                            .is_some_and(|v| *v == &c["value"])
                    {
                        continue;
                    }
                    (Value::Null, format!("control:{control}"))
                }
                (Written::Module(f), Some(On::Module { module, item }))
                    if *module == f.module && *item == f.item && input.kind == f.kind =>
                {
                    (f.data.clone(), format!("{module}:{item}"))
                }
                _ => continue,
            };
            let data = resolved(input, &data, &format!("inputs/{id}/data"))?;
            for target in &input.targets {
                out.push(
                    json!({"step": step, "kind": input.kind, "target": target, "data": data,
                                "input": id, "from": from, "written": n}),
                );
            }
        }
        if let Written::Control(c) = e {
            if let Some(control) = c["control"].as_str() {
                last.insert(control, &c["value"]);
            }
        }
    }
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

/// The kept entries as the runner's track: each by its input, with its fields.
pub(crate) fn track_of(kept: &[Value]) -> Value {
    let entry = |k: &Value| json!({"step": k["step"], "kind": k["kind"], "target": k["target"], "input": k["input"], "data": k["data"]});
    Value::Array(kept.iter().map(entry).collect())
}

/// World `id`'s first input whose `on` names a canvas module the build doesn't hold, refused
/// `module_missing`, naming the module.
pub(crate) fn missing(id: &str, w: &World, held: impl Fn(&str) -> bool) -> Option<Issue> {
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

/// `physics_bake`: the world a presented document lists, in its scene.
pub struct Bake {
    pub doc: String,
    pub world: String,
    pub track: Vec<Value>,
}

pub fn parse(c: &Map<String, Value>) -> Option<Bake> {
    Some(Bake {
        doc: c.get("doc")?.as_str()?.into(),
        world: c.get("world")?.as_str()?.into(),
        track: c
            .get("track")
            .map_or(Some(Vec::new()), |t| t.as_array().cloned())?,
    })
}
