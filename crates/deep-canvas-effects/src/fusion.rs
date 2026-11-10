//! Pass fusion (canvas primitives: Compile, validate and cache: pass fusion; issue #432):
//! adjacent pass operators in one chain that are all pixel-wise compile into one pass, in order,
//! each operator's read of the frame's color at its own pixel replaced by the operator before
//! it's output, so k finishes cost one full-screen pass instead of k. What fuses follows from the
//! operators alone, never from how the document was edited.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::graph::LITERAL_FIELDS;

/// Whether a texture input is the frame's color, the chain's current target.
fn frame_color(input: &Value) -> bool {
    let t = &input["from"]["texture"]["target"];
    input["type"] == "texture" && t["op"] == "core" && t["output"] == "color"
}

/// The step IDs that read the frame's color at their own pixel: a `load@1` at a `pixel@1` step,
/// or a `sample@1` at a `screen_uv@1` step at lod 0.
fn own_pixel_reads(g: &Value) -> Option<BTreeSet<String>> {
    let steps = g["steps"].as_object()?;
    let inputs = g["inputs"].as_object()?;
    let op_of = |id: &Value| id.as_str().and_then(|i| steps.get(i)).and_then(|s| s["op"].as_str());
    let mut out = BTreeSet::new();
    for (id, s) in steps {
        let op = s["op"].as_str()?;
        let a = &s["args"];
        let reads = match op {
            "load@1" => op_of(&a["ixy"]) == Some("pixel@1"),
            "sample@1" => op_of(&a["uv"]) == Some("screen_uv@1") && a["lod"].as_f64() == Some(0.0),
            _ => continue,
        };
        let color = a["tex"].as_str().and_then(|t| inputs.get(t)).is_some_and(frame_color);
        if !(reads && color) {
            return None;
        }
        out.insert(id.clone());
    }
    Some(out)
}

/// Whether a pass operator's graph may fuse: `fuse` not `none`; every texture it reads is the
/// frame's color at its own pixel; its inputs are values (a param, a channel, a role or the
/// time), never the item's seed or another target; no step that reads a neighbourhood, carries a
/// body, calls a function or draws seeded noise; and it writes only its color.
pub fn pixel_wise(g: &Value) -> bool {
    if g["kind"] != "pass" || g["fuse"] == "none" || g.get("source").is_some() {
        return false;
    }
    if g["uses"].as_array().is_some_and(|u| !u.is_empty()) {
        return false;
    }
    let outputs_ok = g["outputs"]
        .as_object()
        .is_some_and(|o| o.keys().all(|k| k == "color" || k == "blend") && o.contains_key("color"));
    let inputs_ok = g["inputs"].as_object().is_some_and(|ins| {
        ins.values().all(|i| {
            frame_color(i)
                || ["param", "channel", "role"].iter().any(|k| i["from"].get(*k).is_some())
                || i["from"] == "time"
        })
    });
    let steps_ok = g["steps"].as_object().is_some_and(|steps| {
        steps.values().all(|s| {
            let op = s["op"].as_str().unwrap_or("");
            let seeded = ["noise", "fbm", "cells"].iter().any(|p| op.starts_with(p));
            let neighbour = matches!(op, "ddx@1" | "ddy@1" | "fwidth@1" | "iterate@1" | "use@1");
            !seeded && !neighbour && s["args"].get("body").is_none()
        })
    });
    outputs_ok && inputs_ok && steps_ok && own_pixel_reads(g).is_some()
}

/// The blend a pass writes with.
fn blend(g: &Value) -> &str {
    g["outputs"]["blend"].as_str().unwrap_or("replace")
}

/// Whether `b` may follow `a` in one fused pass: both pixel-wise, in one chain at one resolution,
/// and `a` replaces what it reads, so `b` reads exactly what `a` wrote.
pub fn joins(a: &Value, b: &Value) -> bool {
    pixel_wise(a)
        && pixel_wise(b)
        && blend(a) == "replace"
        && a["chain"].as_str().unwrap_or("effects") == b["chain"].as_str().unwrap_or("effects")
        && a["resolution"] == b["resolution"]
}

/// Renames a step's argument values: a string that names one of the operator's own steps or
/// inputs takes its new name; literal fields keep theirs.
fn rename_args(args: &Value, rename: &dyn Fn(&str) -> Option<String>) -> Value {
    let Some(o) = args.as_object() else {
        return args.clone();
    };
    let mut out = Map::new();
    for (k, v) in o {
        let nv = match v {
            Value::String(s) if !LITERAL_FIELDS.contains(&k.as_str()) => {
                rename(s).map_or_else(|| v.clone(), Value::String)
            }
            Value::Array(a) if !LITERAL_FIELDS.contains(&k.as_str()) => Value::Array(
                a.iter()
                    .map(|x| match x.as_str().and_then(rename) {
                        Some(n) => Value::String(n),
                        None => x.clone(),
                    })
                    .collect(),
            ),
            _ => v.clone(),
        };
        out.insert(k.clone(), nv);
    }
    Value::Object(out)
}

/// The prefix member `k`'s steps and inputs take in a fused graph.
pub fn prefix(k: usize) -> String {
    format!("m{k}_")
}

/// One pass of `members` (item ID, graph), in order: member k's reads of the frame's color at its
/// own pixel become member k − 1's output; every other step and input keeps its member's prefix,
/// and a param input reads `<prefix><param>`. Its cost is the members' summed; its blend the
/// last's. `None` unless every adjacent pair [`joins`].
pub fn fuse(members: &[(String, Value)]) -> Option<Value> {
    if members.len() < 2 || members.windows(2).any(|w| !joins(&w[0].1, &w[1].1)) {
        return None;
    }
    let first = &members[0].1;
    let mut inputs = Map::new();
    let mut steps = Map::new();
    let mut prev_out: Option<String> = None;
    let mut cost = 0.0;
    for (k, (_, g)) in members.iter().enumerate() {
        let p = prefix(k);
        let reads = own_pixel_reads(g)?;
        let own_steps = g["steps"].as_object()?;
        let own_inputs = g["inputs"].as_object()?;
        let colors: BTreeSet<&String> = own_inputs.iter().filter(|(_, i)| frame_color(i)).map(|(n, _)| n).collect();
        let replaced: BTreeMap<String, String> = match &prev_out {
            Some(out) => reads.iter().map(|r| (r.clone(), out.clone())).collect(),
            None => BTreeMap::new(),
        };
        let rename = |s: &str| -> Option<String> {
            if let Some(to) = replaced.get(s) {
                Some(to.clone())
            } else if own_steps.contains_key(s) {
                Some(format!("{p}{s}"))
            } else if colors.contains(&s.to_string()) {
                Some("src".into())
            } else if own_inputs.contains_key(s) {
                Some(format!("{p}{s}"))
            } else {
                None
            }
        };
        for (name, i) in own_inputs {
            if colors.contains(name) {
                inputs.insert("src".into(), i.clone());
                continue;
            }
            let mut i = i.clone();
            if let Some(param) = i["from"]["param"].as_str().map(str::to_string) {
                i["from"]["param"] = json!(format!("{p}{param}"));
            }
            inputs.insert(format!("{p}{name}"), i);
        }
        for (id, s) in own_steps {
            if replaced.contains_key(id) {
                continue;
            }
            let mut s = s.clone();
            if let Some(a) = s.get("args") {
                s["args"] = rename_args(a, &rename);
            }
            steps.insert(format!("{p}{id}"), s);
        }
        prev_out = Some(rename(g["outputs"]["color"].as_str()?)?);
        cost += g["cost"]["ns_per_px"].as_f64().unwrap_or(0.0);
    }
    let last = &members.last()?.1;
    let names: Vec<&str> = members.iter().map(|(i, _)| i.as_str()).collect();
    let origin = if members.iter().all(|(_, g)| g["origin"] == first["origin"]) {
        first["origin"].clone()
    } else {
        json!("composed")
    };
    let mut fused = json!({
        "id": format!("fused.{}", names.join("+")),
        "kind": "pass",
        "origin": origin,
        "about": format!("The pixel-wise passes {} fused into one, in order.", names.join(", ")),
        "inputs": inputs,
        "steps": steps,
        "outputs": {"color": prev_out?, "blend": blend(last)},
        "cost": {"ns_per_px": cost},
        "chain": first["chain"].as_str().unwrap_or("effects"),
        "order": first["order"].as_str().unwrap_or("a0"),
        "fallback": "look",
    });
    if let Some(r) = first.get("resolution") {
        fused["resolution"] = r.clone();
    }
    Some(fused)
}

/// The runs a chain of pass graphs, in their order, fuses into: indices into `chain`, each run one
/// pass. Members of `apart` and graphs that aren't pixel-wise run alone.
pub fn runs(chain: &[(String, Value)], apart: &BTreeSet<String>) -> Vec<Vec<usize>> {
    let mut out: Vec<Vec<usize>> = Vec::new();
    for (k, (item, g)) in chain.iter().enumerate() {
        let alone = apart.contains(item);
        match out.last_mut() {
            Some(run)
                if !alone
                    && !apart.contains(&chain[*run.last().expect("never empty")].0)
                    && joins(&chain[*run.last().expect("never empty")].1, g) =>
            {
                run.push(k)
            }
            _ => out.push(vec![k]),
        }
    }
    out
}

/// One pass a composed pass compiles into: `of` is `steps` for its own steps, or the shipped
/// stage it runs; its graph; and the operator's step IDs it computes.
#[derive(Clone, Debug)]
pub struct Part {
    pub of: String,
    pub graph: Value,
    pub steps: Vec<String>,
}

/// The step IDs an argument object names among `steps`.
fn named<'a>(args: &'a Value, steps: &Map<String, Value>) -> Vec<&'a str> {
    let mut out = Vec::new();
    for (k, v) in args.as_object().into_iter().flatten() {
        if LITERAL_FIELDS.contains(&k.as_str()) {
            continue;
        }
        let mut push = |x: &'a Value| {
            if let Some(s) = x.as_str().filter(|s| steps.contains_key(*s)) {
                out.push(s);
            }
        };
        match v {
            Value::Array(a) => a.iter().for_each(&mut push),
            v => push(v),
        }
    }
    out
}

/// A composed pass that calls the shipped blur (`uses: ["blur@1"]`, a step `use@1 {name:
/// "blur@1", src, radius}`) compiles into three parts (Compile, validate and cache): its steps
/// before the blur, a pass writing the value `src` gives; the blur's own passes, `blur.x@1` and
/// `blur.y@1`, at its radius; and its steps after, a pass that reads the blurred value at its own
/// pixel. `None` for any other graph, or when a step after the blur reads one before it.
pub fn split_blur(g: &Value) -> Option<Vec<Part>> {
    if g["kind"] != "pass" {
        return None;
    }
    let steps = g["steps"].as_object()?;
    let mut calls = steps
        .iter()
        .filter(|(_, s)| s["op"] == "use@1" && s["args"]["name"] == "blur@1");
    let (blur_id, call) = calls.next()?;
    if calls.next().is_some() {
        return None;
    }
    let src = call["args"]["src"].as_str().filter(|s| steps.contains_key(*s))?;
    // The steps before: what `src` reads, transitively.
    let mut before: BTreeSet<String> = BTreeSet::new();
    let mut stack = vec![src.to_string()];
    while let Some(id) = stack.pop() {
        if id == *blur_id || !before.insert(id.clone()) {
            continue;
        }
        stack.extend(named(&steps[&id]["args"], steps).into_iter().map(String::from));
    }
    if before.contains(blur_id) {
        return None;
    }
    let after: BTreeSet<String> = steps
        .keys()
        .filter(|k| *k != blur_id && !before.contains(*k))
        .cloned()
        .collect();
    if after
        .iter()
        .any(|a| named(&steps[a]["args"], steps).iter().any(|n| before.contains(*n)))
    {
        return None;
    }
    let base = |id: &str, steps_of: Map<String, Value>, inputs: Value, color: Value, blend: Value| {
        let mut part = json!({
            "id": id, "kind": "pass", "origin": g["origin"].clone(),
            "about": format!("A part of {}.", g["id"].as_str().unwrap_or("a pass")),
            "inputs": inputs, "steps": steps_of, "outputs": {"color": color, "blend": blend},
            "resolution": g.get("resolution").cloned().unwrap_or(json!("full")),
        });
        if let Some(c) = g.get("cost") {
            part["cost"] = c.clone();
        }
        part
    };
    let id = g["id"].as_str().unwrap_or("pass");
    let first: Map<String, Value> = before.iter().map(|k| (k.clone(), steps[k].clone())).collect();
    let mut last: Map<String, Value> = after.iter().map(|k| (k.clone(), steps[k].clone())).collect();
    let px = format!("{blur_id}__px");
    last.insert(px.clone(), json!({"op": "pixel@1", "args": {}}));
    last.insert(blur_id.clone(), json!({"op": "load@1", "args": {"tex": "src", "ixy": px}}));
    let mut values = g["inputs"].as_object().cloned().unwrap_or_default();
    values.retain(|_, i| i["type"] != "texture");
    let mut last_inputs = values.clone();
    last_inputs.insert(
        "src".into(),
        json!({"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}}),
    );
    let blur_stage = |axis: &str| {
        let mut stage = crate::shipped::blur(axis);
        if let Some(r) = call["args"].get("radius") {
            stage["inputs"]["radius"]["default"] = r.clone();
        }
        stage
    };
    Some(vec![
        Part {
            of: "steps".into(),
            graph: base(&format!("{id}.before"), first, g["inputs"].clone(), json!(src), json!("replace")),
            steps: before.iter().cloned().collect(),
        },
        Part { of: "blur.x@1".into(), graph: blur_stage("x"), steps: vec![blur_id.clone()] },
        Part { of: "blur.y@1".into(), graph: blur_stage("y"), steps: vec![blur_id.clone()] },
        Part {
            of: "steps".into(),
            graph: base(&format!("{id}.after"), last, Value::Object(last_inputs), g["outputs"]["color"].clone(), g["outputs"]["blend"].clone()),
            steps: after.iter().cloned().collect(),
        },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::check::read_and_check;
    use crate::interp::{self, Env, Image};

    fn pass(id: &str, body: Value, res: &str) -> Value {
        let mut steps = json!({
            "px": {"op": "pixel@1", "args": {}},
            "c": {"op": "load@1", "args": {"tex": "src", "ixy": "px"}},
            "rgb_r": {"op": "split@1", "args": {"x": "c", "pick": "x"}},
            "rgb_g": {"op": "split@1", "args": {"x": "c", "pick": "y"}},
            "rgb_b": {"op": "split@1", "args": {"x": "c", "pick": "z"}},
            "rgb": {"op": "compose@1", "args": {"x": "rgb_r", "y": "rgb_g", "z": "rgb_b"}},
            "ca": {"op": "split@1", "args": {"x": "c", "pick": "w"}},
            "o_r": {"op": "split@1", "args": {"x": "res", "pick": "x"}},
            "o_g": {"op": "split@1", "args": {"x": "res", "pick": "y"}},
            "o_b": {"op": "split@1", "args": {"x": "res", "pick": "z"}},
            "out": {"op": "compose@1", "args": {"x": "o_r", "y": "o_g", "z": "o_b", "w": "ca"}},
        });
        for (k, v) in body.as_object().unwrap() {
            steps[k] = v.clone();
        }
        json!({
            "id": id, "kind": "pass", "origin": "composed", "about": "a fusion test pass",
            "inputs": {"src": {"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}},
                       "gain": {"type": "f32", "from": {"param": "gain"}, "default": 1.5, "range": [0.0, 4.0], "unit": "ratio"}},
            "steps": steps, "outputs": {"color": "out", "blend": "replace"},
            "cost": {"ns_per_px": 0.1}, "resolution": res, "chain": "effects", "order": "a0",
        })
    }

    /// Two passes fused compute what the second computes over the first's output, on the f64
    /// interpreter: a fusion that dropped or reordered a step, or read the frame's color in the
    /// second, would differ.
    #[test]
    fn a_fused_pair_computes_the_second_over_the_first() {
        let a = pass("a", json!({"res": {"op": "mul@1", "args": {"a": "rgb", "b": "gain"}}}), "full");
        let b = pass("b", json!({"sq": {"op": "mul@1", "args": {"a": "rgb", "b": "rgb"}}, "res": {"op": "add@1", "args": {"a": "sq", "b": 0.1}}}), "full");
        let fused = fuse(&[("a".into(), a.clone()), ("b".into(), b)]).expect("they join");
        let c = read_and_check(&fused).expect("the fused graph passes the check");
        let mut img = Image::new(2, 1);
        img.px[0] = [0.2, 0.4, 0.6, 1.0];
        img.px[1] = [0.9, 0.05, 0.3, 0.5];
        let params = BTreeMap::from([("m0_gain".to_string(), json!(2.0))]);
        let env = Env {
            t: 0.0,
            seed: 7,
            clip: [0.0; 16],
            inverse_clip: [0.0; 16],
            eye: [0.0; 4],
            inputs: interp::inputs(&c, &params, &BTreeMap::new()),
            textures: BTreeMap::from([("src".to_string(), &img)]),
            normals: [[0.0; 3]; 3],
        };
        let out = interp::pass(&c, &env, [2, 1]).expect("runs");
        for (got, px) in out.px.iter().zip(&img.px) {
            for i in 0..3 {
                let want = (px[i] * 2.0) * (px[i] * 2.0) + 0.1;
                assert!((got[i] - want).abs() < 1e-6, "channel {i}: {} vs {want}", got[i]);
            }
            assert!((got[3] - px[3]).abs() < 1e-9, "alpha kept");
        }
        // Another resolution, `fuse: none` or a blend that isn't replace keeps them apart.
        let half = pass("h", json!({"res": {"op": "mul@1", "args": {"a": "rgb", "b": 2.0}}}), "half");
        assert!(!joins(&a, &half));
        let mut none = a.clone();
        none["fuse"] = json!("none");
        assert!(!pixel_wise(&none));
        let mut neighbour = a.clone();
        neighbour["steps"]["px2"] = json!({"op": "add@1", "args": {"a": "px", "b": 1}});
        neighbour["steps"]["c"]["args"]["ixy"] = json!("px2");
        assert!(!pixel_wise(&neighbour), "a read off its own pixel isn't pixel-wise");
    }

    /// A lift, the shipped blur and a dim split into the steps before, the blur's two passes and
    /// the steps after, each a pass the check accepts within its fetches.
    #[test]
    fn a_pass_around_the_blur_splits_in_three() {
        let g = json!({
            "id": "soft", "kind": "pass", "origin": "composed", "about": "lift, blur, dim",
            "inputs": {"src": {"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}}},
            "uses": ["blur@1"],
            "steps": {
                "px": {"op": "pixel@1", "args": {}},
                "c": {"op": "load@1", "args": {"tex": "src", "ixy": "px"}},
                "lift": {"op": "mul@1", "args": {"a": "c", "b": 1.2}},
                "b": {"op": "use@1", "args": {"name": "blur@1", "src": "lift", "radius": 6}},
                "dim": {"op": "mul@1", "args": {"a": "b", "b": 0.8}},
                "out": {"op": "add@1", "args": {"a": "dim", "b": 0.02}},
            },
            "outputs": {"color": "out", "blend": "replace"}, "resolution": "full", "cost": {"ns_per_px": 1.0},
        });
        let parts = split_blur(&g).expect("it splits");
        let of: Vec<&str> = parts.iter().map(|p| p.of.as_str()).collect();
        assert_eq!(of, ["steps", "blur.x@1", "blur.y@1", "steps"]);
        assert_eq!(parts[0].steps, ["c", "lift", "px"]);
        assert_eq!(parts[3].steps, ["dim", "out"]);
        for p in &parts {
            let c = read_and_check(&p.graph).unwrap_or_else(|e| panic!("{}: {e:?}", p.of));
            assert!(c.fetches <= 32, "{}: {} fetches", p.of, c.fetches);
        }
        assert_eq!(parts[1].graph["inputs"]["radius"]["default"], json!(6));
    }
}
