//! The warm-up at check (canvas primitives: Compile, validate and cache; issue #432): every state
//! a live document can reach over its span and its controls, so the first frame a feature turns
//! on compiles nothing. A state is the writer's payload with each control's value written where
//! it binds and each variant set's picked option's patch applied (Control; Variant); its scenes
//! are its evaluations at t = 0, at each channel key and at the span's end, where a keyed value
//! leaves 0 or reaches its last. The look's cap of 32 counts the reachable feature sets.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::grammar::{Time, TimeContext};
use deep_canvas_effects::fusion;
use deep_canvas_effects::module::operator_of;
use deep_canvas_scene3d::scene::Scene;
use deep_scene3d_render::created;
use serde_json::{json, Value};

/// Each control's value a session holds, by control ID: a toggle's bool, a choice's option name.
pub type Choices = BTreeMap<String, Value>;

/// The most states the warm-up enumerates; past it the cap refuses the document anyway.
const MAX_STATES: usize = 4096;

/// The look's cap on reachable feature sets, and a session's on operator pipelines.
pub const CAP: usize = 32;

/// The value a toggle writes where it binds: its range's or options' entry for off and on, or the
/// bool itself.
fn toggle_value(control: &Value, on: bool) -> Value {
    let pick = |k: &str| control[k].as_array().and_then(|a| a.get(usize::from(on))).cloned();
    pick("range").or_else(|| pick("options")).unwrap_or(json!(on))
}

/// The document a session draws: `payload` with each control's value (its entry in `choices`,
/// else its default) written where it binds, then each variant set's picked option's patch, in
/// set order; a set with no pick applies its default.
pub fn applied(payload: &Value, choices: &Choices) -> Value {
    let mut doc = payload.clone();
    let mut picked: BTreeMap<String, String> = BTreeMap::new();
    for (id, c) in payload["controls"].as_object().into_iter().flatten() {
        let value = choices.get(id).or_else(|| c.get("default"));
        match c["kind"].as_str() {
            Some("toggle") => {
                let on = value.and_then(Value::as_bool).unwrap_or(false);
                let v = toggle_value(c, on);
                for b in c["binds"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                    deep_canvas::document::variants::set_path(&mut doc, b, v.clone());
                }
            }
            Some("choice") => {
                if let (Some(set), Some(Value::String(o))) = (c["variant"].as_str(), value) {
                    picked.insert(set.to_string(), o.clone());
                }
            }
            _ => {}
        }
    }
    deep_canvas::document::variants::applied(&doc, &picked)
}

/// Every combination of the controls' values a viewer can reach: each toggle off and on, each
/// variant choice's options; the default first.
pub fn reachable(payload: &Value) -> Vec<Choices> {
    let mut states = vec![Choices::new()];
    let sets = &payload["variants"];
    for (id, c) in payload["controls"].as_object().into_iter().flatten() {
        let values: Vec<Value> = match c["kind"].as_str() {
            Some("toggle") => {
                let first = c["default"].as_bool().unwrap_or(false);
                vec![json!(first), json!(!first)]
            }
            Some("choice") => match c["variant"].as_str().map(|s| &sets[s]) {
                Some(set) => {
                    let mut names: Vec<Value> = set["options"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|o| o["name"].as_str().map(|n| json!(n)))
                        .collect();
                    // The default first, so state 0 is what the document shows unasked.
                    if let Some(d) = set["default"].as_str() {
                        names.sort_by_key(|n| n != d);
                    }
                    names
                }
                None => continue,
            },
            _ => continue,
        };
        if values.is_empty() {
            continue;
        }
        let mut next = Vec::with_capacity(states.len() * values.len());
        for s in &states {
            for v in &values {
                let mut s = s.clone();
                s.insert(id.clone(), v.clone());
                next.push(s);
                if next.len() >= MAX_STATES {
                    break;
                }
            }
        }
        states = next;
    }
    states
}

/// The times, in flicks, a state is evaluated at: 0, each channel key's and the span's end.
pub fn times(doc: &Value) -> Vec<i64> {
    let ctx = TimeContext::default();
    let flicks = |v: &Value| -> Option<i64> {
        match Time::parse(v.as_str()?) {
            Ok(Time::Span(span)) => span.resolve(&ctx).ok(),
            _ => None,
        }
    };
    let mut out = BTreeSet::from([0i64]);
    for ch in doc["channels"].as_object().into_iter().flatten().map(|(_, c)| c) {
        for k in ch["keys"].as_object().into_iter().flatten().map(|(_, k)| k) {
            if let Some(t) = flicks(&k["t"]) {
                out.insert(t.max(0));
            }
        }
    }
    if let Some(end) = flicks(&doc["transport"]["span"]) {
        out.insert(end);
    }
    out.into_iter().collect()
}

/// The feature sets a scene draws, each with the items that bring it: each solid's view feature
/// set, and each casting solid's caster kind while a light casts.
pub fn feature_sets(scene: &Scene, into: &mut BTreeMap<String, BTreeSet<String>>) {
    let casts = scene.sun.as_ref().is_some_and(|s| s.shadow) || !scene.lights.is_empty();
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        let item = created::item_of(&s.id).to_string();
        into.entry(created::feature_set(s)).or_default().insert(item.clone());
        if casts && s.cast_shadow {
            into.entry(created::caster_set(s).to_string()).or_default().insert(item);
        }
    }
}

/// The over_budget issue of a document whose reachable feature sets pass the look's 32, naming
/// the items whose sets the default state at t = 0 doesn't hold: those the other states add.
pub fn cap_issue(all: &BTreeMap<String, BTreeSet<String>>, first: &BTreeMap<String, BTreeSet<String>>) -> Option<Value> {
    if all.len() <= CAP {
        return None;
    }
    let ids: BTreeSet<&String> = all
        .iter()
        .filter(|(set, _)| !first.contains_key(*set))
        .flat_map(|(_, items)| items)
        .collect();
    Some(json!({
        "code": "over_budget", "severity": "error", "ids": ids, "path": "items",
        "actual": {"feature_sets": all.len(), "cap": CAP},
        "what": format!(
            "the document can reach {} feature sets over its span and its controls, past the look's {CAP}",
            all.len()
        ),
    }))
}

/// The chain of pass operators a document runs, in order: (item, graph).
fn chain(doc: &Value) -> Vec<(String, Value)> {
    let mut out: Vec<(String, String, Value)> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(id, item)| {
            let g = operator_of(id, item)?;
            (g["kind"] == "pass").then(|| (g["order"].as_str().unwrap_or("a0").to_string(), id.clone(), g))
        })
        .collect();
    out.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
    out.into_iter().map(|(_, id, g)| (id, g)).collect()
}

/// The operators that run apart (Compile, validate and cache: pass fusion): none while the
/// fused chains every state gives fit the session's 32 operator pipelines; else every operator
/// whose presence or graph differs between the states.
pub fn apart(states: &[Value]) -> BTreeSet<String> {
    let chains: Vec<Vec<(String, Value)>> = states.iter().map(chain).collect();
    let count = |apart: &BTreeSet<String>| -> usize {
        let mut keys = BTreeSet::new();
        for c in &chains {
            for run in fusion::runs(c, apart) {
                let members: Vec<&(String, Value)> = run.iter().map(|&k| &c[k]).collect();
                keys.insert(serde_json::to_string(&members.iter().map(|m| &m.1).collect::<Vec<_>>()).unwrap_or_default());
            }
        }
        keys.len()
    };
    if count(&BTreeSet::new()) <= CAP {
        return BTreeSet::new();
    }
    let mut seen: BTreeMap<&String, BTreeSet<String>> = BTreeMap::new();
    for c in &chains {
        for (id, g) in c {
            seen.entry(id).or_default().insert(g.to_string());
        }
    }
    seen.into_iter()
        .filter(|(id, graphs)| graphs.len() > 1 || chains.iter().any(|c| !c.iter().any(|(i, _)| i == *id)))
        .map(|(id, _)| id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn controls_and_variants_apply_and_reach_every_state() {
        let payload = json!({
            "items": {"m": {"params": {"transmission": 0}}, "t": {"params": {"steps": "day"}}},
            "controls": {
                "glass": {"kind": "toggle", "binds": ["items/m/params/transmission"], "range": [0, 0.9], "default": false},
                "time": {"kind": "choice", "variant": "time"},
            },
            "variants": {"time": {"default": "day", "options": [
                {"name": "day", "patch": [{"op": "set", "path": "items/t/params/steps", "value": "day"}]},
                {"name": "night", "patch": [{"op": "set", "path": "items/t/params/steps", "value": "night"},
                                            {"op": "create", "item": {"id": "h", "kind": "x"}}]},
            ]}},
        });
        let states = reachable(&payload);
        assert_eq!(states.len(), 4);
        let docs: Vec<Value> = states.iter().map(|s| applied(&payload, s)).collect();
        assert_eq!(docs[0]["items"]["m"]["params"]["transmission"], json!(0));
        assert!(docs.iter().any(|d| d["items"]["m"]["params"]["transmission"] == json!(0.9)));
        let night: Vec<&Value> = docs.iter().filter(|d| d["items"]["t"]["params"]["steps"] == "night").collect();
        assert_eq!(night.len(), 2);
        assert!(night.iter().all(|d| d["items"]["h"]["kind"] == "x"));
        assert_eq!(times(&json!({"channels": {"c": {"keys": {"a": {"t": "2.9s"}}}}, "transport": {"span": "6s"}})).len(), 3);
    }
}
