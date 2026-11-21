//! #204: live synthesis (canvas primitives: Synth `synth@1`): presets over the closed node list,
//! the `synth.preset@1` registry this module declares and its kit, the pack field `presets` that
//! fills it, and the voices the mix plays.

pub mod check;
pub mod play;
pub mod preset;
pub mod voice;

use deep_canvas::registry::lists::RegistryDef;
use serde_json::{json, Value};

use preset::{Preset, RULE_COST, RULE_CYCLE, RULE_EDGE, RULE_NODE, RULE_PARAM};
use voice::Twists;

/// The registry of synth presets.
pub const REGISTRY: &str = "synth.preset@1";

fn rule(v: &Value, rule: &str) -> Result<(), String> {
    match Preset::compile(v) {
        Err(f) if f.rule == rule => Err(f.why),
        _ => Ok(()),
    }
}

fn rule_node(v: &Value) -> Result<(), String> {
    rule(v, RULE_NODE)
}
fn rule_edge(v: &Value) -> Result<(), String> {
    rule(v, RULE_EDGE)
}
fn rule_cycle(v: &Value) -> Result<(), String> {
    rule(v, RULE_CYCLE)
}
fn rule_param(v: &Value) -> Result<(), String> {
    rule(v, RULE_PARAM)
}
fn rule_cost(v: &Value) -> Result<(), String> {
    rule(v, RULE_COST)
}

/// A preset every rule admits: a sine at `hz` through an envelope into a gain.
pub fn tone() -> Value {
    json!({
        "nodes": {
            "osc": {"kind": "osc", "wave": "sine", "hz": "hz"},
            "env": {"kind": "env", "attack": 0.005, "decay": 0.1, "sustain": 0.5, "release": 0.2},
            "amp": {"kind": "gain", "gain": 0}
        },
        "edges": [["osc", "amp", "in"], ["env", "amp", "gain"]],
        "out": "amp",
        "params": {"hz": {"unit": "Hz", "range": [20, 2000], "default": 440}},
        "cost": 8
    })
}

/// `synth.preset@1`: `{owner: media, fill: [module, first_party_pack, pack]}`, a kit of five
/// structural rules and a planted preset that breaks each alone. The sweep isn't a kit rule: the
/// seal runs every rule on the planted entries at each start, so it runs once per pack version in
/// the `presets` field's check.
pub fn registry() -> RegistryDef {
    let schema = json!({"type": "object", "required": ["nodes", "out", "cost"]});
    let with = |f: &dyn Fn(&mut Value)| {
        let mut v = tone();
        f(&mut v);
        v
    };
    RegistryDef::new(REGISTRY, schema, &["module", "first_party_pack", "pack"], "R6")
        .rule(RULE_NODE, "every node is in the closed list, with its fields", rule_node)
        .rule(RULE_EDGE, "every edge joins two nodes, into an input the node takes", rule_edge)
        .rule(RULE_CYCLE, "a cycle passes only through a wet delay of at least one block", rule_cycle)
        .rule(RULE_PARAM, "every param has a unit, a range holding its default, and every field names a param there is", rule_param)
        .rule(RULE_COST, "the cost at defaults is within the preset's estimate", rule_cost)
        .planted("planted.theremin", with(&|v| v["nodes"]["osc"]["kind"] = json!("theremin")))
        .planted("planted.osc_in", with(&|v| v["edges"][0] = json!(["env", "osc", "in"])))
        .planted("planted.loop", with(&|v| {
            v["nodes"]["fb"] = json!({"kind": "gain", "gain": 0.5});
            v["nodes"]["sum"] = json!({"kind": "mix"});
            v["edges"] = json!([["osc", "sum", "a"], ["sum", "amp", "in"], ["env", "amp", "gain"], ["amp", "fb", "in"], ["fb", "sum", "b"]]);
            v["cost"] = json!(20);
        }))
        .planted("planted.rangeless", with(&|v| v["params"]["hz"]["range"] = json!([500, 2000])))
        .planted("planted.cheap", with(&|v| v["cost"] = json!(4)))
}

/// The pack field `presets: {<name>@<major> → preset}`: each preset's rules, then its sweep, once
/// per pack version. A refusal is at the preset's key and names the preset as `<pack>.<key>`.
pub fn presets_field(manifest: &Value) -> Vec<(String, String)> {
    presets_field_with(manifest, Twists::default())
}

pub fn presets_field_with(manifest: &Value, twists: Twists) -> Vec<(String, String)> {
    let pack = manifest["name"].as_str().unwrap_or("pack");
    let Some(presets) = manifest["presets"].as_object() else {
        return vec![(String::new(), "presets is {<name>@<major> → preset}".into())];
    };
    // #1172: each preset's sweep on its own, across the cores, since a pack of 90 took seconds on one;
    // the refusals keep the presets' order.
    let compiled: Vec<(String, Option<Result<Preset, preset::Fault>>)> = presets
        .iter()
        .map(|(key, v)| {
            let named = format!("{pack}.{key}");
            (named, valid_key(key).then(|| Preset::compile(v)))
        })
        .collect();
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get().min(8));
    let swept: Vec<Option<check::Refusal>> = std::thread::scope(|s| {
        let handles: Vec<_> = compiled
            .chunks(compiled.len().div_ceil(threads).max(1))
            .map(|chunk| {
                s.spawn(move || {
                    chunk
                        .iter()
                        .map(|(named, p)| match p {
                            Some(Ok(p)) => check::sweep(p, named, twists),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
            .collect()
    });
    let mut bad = Vec::new();
    for ((key, _), ((named, p), refusal)) in presets.iter().zip(compiled.into_iter().zip(swept)) {
        let Some(p) = p else {
            bad.push((
                key.clone(),
                format!("preset {named}: a preset's key is <name>@<major>"),
            ));
            continue;
        };
        match p {
            Ok(_) => {}
            Err(f) => {
                let path =
                    f.at.as_ref()
                        .map_or_else(|| key.clone(), |at| format!("{key}/{at}"));
                bad.push((
                    path,
                    format!("preset {named} fails {REGISTRY}'s {}: {}", f.rule, f.why),
                ));
                continue;
            }
        };
        if let Some(r) = refusal {
            let at = if r.param == "all" {
                format!("every param at seeded point {}", r.value)
            } else {
                format!("param {} at {}", r.param, r.value)
            };
            bad.push((
                key.clone(),
                format!(
                    "preset {named} is refused: with {at}, sample {} is {} (first sample not finite or past {})",
                    r.sample,
                    r.level,
                    check::SWEEP_MAX
                ),
            ));
        }
    }
    bad
}

fn valid_key(key: &str) -> bool {
    match key.rsplit_once('@') {
        Some((name, major)) => {
            !name.is_empty() && !major.is_empty() && major.bytes().all(|b| b.is_ascii_digit())
        }
        None => false,
    }
}

#[cfg(test)]
mod tests;
