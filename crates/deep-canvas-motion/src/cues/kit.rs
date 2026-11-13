//! The registry `cue.kind@1` and its cue kit (Cue list `cues@1`; Registry and seal: registries):
//! every entry, a first-party pack's or a pack's, is expanded by [`super::lower`] as the one cue
//! of a list on a fixed document. It must expand to identical bytes twice (`same_bytes`; the
//! second time under another document seed, which no verb may read), write only paths under its
//! targets, the items its `joins` inputs name and its own derived items (`targets_only`), key only
//! inside its cue's span (`inside_span`), end as its class says, an enter verb fully drawn and an
//! exit at opacity 0 or unbuilt (`end_state`), and, an emphasis, leave every path it wrote at its
//! base value, bit for bit (`back_to_base`). The end states are read after the last key it
//! writes, so a key past the span breaks only `inside_span`. Each rule has a planted wrong entry
//! that breaks it alone.

use deep_canvas::document::expands::Lowered;
use deep_canvas::registry::lists::RegistryDef;
use serde_json::{json, Value};

use super::{lower, verb, REGISTRY};
use crate::eval::Validity;
use crate::program::Program;

/// The document a verb is expanded on, with `seed`: two boxes, two paths and two texts, each
/// drawn and opaque, in a 2D film.
pub fn document(seed: u64) -> Value {
    json!({
        "format": 1, "profile": "film", "id": "cue-kit", "seed": seed,
        "requires": {"modules": {"motion": "^1", "marks2d": "^1"}},
        "items": {
            "a": {"id": "a", "kind": "rect@1", "name": "A", "order": "a0", "at": {"pos": [100, 80, 0]},
                  "params": {"box": [-60, -40, 120, 80], "paint": {"fill": {"role": "accent"}, "stroke": {"role": "ink", "width": 2}},
                             "ops": [{"trim": {"start": 0, "end": 1}}]}},
            "b": {"id": "b", "kind": "rect@1", "name": "B", "order": "a1", "at": {"pos": [400, 240, 0]},
                  "params": {"box": [-30, -30, 60, 60], "paint": {"fill": {"role": "muted"}}}},
            "p": {"id": "p", "kind": "path@1", "name": "P", "order": "a2",
                  "params": {"d": "M 0 0 L 200 0 L 200 100", "paint": {"stroke": {"role": "ink", "width": 2}}}},
            "q": {"id": "q", "kind": "path@1", "name": "Q", "order": "a5", "at": {"pos": [300, 100, 0]},
                  "params": {"d": "M 0 -40 L 40 30 L -40 30 Z", "paint": {"stroke": {"role": "ink", "width": 2}}}},
            "t": {"id": "t", "kind": "text@1", "name": "T", "order": "a3", "at": {"pos": [100, 300, 0]},
                  "params": {"text": "Speed", "size": 32, "reveal": {"mode": "fade", "order": "reading", "progress": 1}}},
            "n": {"id": "n", "kind": "text@1", "name": "N", "order": "a4", "at": {"pos": [300, 300, 0]},
                  "params": {"text": "", "size": 32}},
        }
    })
}

fn name(entry: &Value) -> &str {
    entry.get("name").and_then(Value::as_str).unwrap_or("")
}

/// The cue an entry is expanded in: its `kit` targets and params, else the box `a`.
fn cue_of(entry: &Value) -> Value {
    let kit = entry.get("kit");
    let targets = kit
        .and_then(|f| f.get("targets"))
        .cloned()
        .unwrap_or(json!(["a"]));
    let params = kit
        .and_then(|f| f.get("params"))
        .cloned()
        .unwrap_or(json!({}));
    json!({"id": "k", "kind": name(entry), "targets": targets, "params": params, "span": "1s"})
}

/// The entry expanded under `seed` as the only cue of a list: the document with the expansion
/// merged in, the expansion, and the window its marker covers.
fn expand(entry: &Value, seed: u64) -> Result<(Value, Lowered, i64, i64), String> {
    let mut doc = document(seed);
    let list = json!({"id": "kit", "kind": "cues@1", "name": "Kit", "order": "z0",
                      "params": {"cues": [cue_of(entry)]}});
    let items = doc["items"].as_object().cloned().unwrap_or_default();
    let verbs = |n: &str| (n == name(entry)).then(|| entry.clone());
    let lowered = lower(&doc, &items, "kit", &list, &verbs, None).map_err(|r| {
        r.iter()
            .map(|r| r.what.clone())
            .collect::<Vec<_>>()
            .join("; ")
    })?;
    let marker = lowered
        .sections
        .get("markers")
        .and_then(|m| m.get("cues.k"))
        .cloned()
        .unwrap_or(Value::Null);
    let start = marker["t"].as_i64().unwrap_or(0);
    let end = start + marker["span"].as_i64().unwrap_or(0);
    if let Some(o) = doc.as_object_mut() {
        for (s, v) in &lowered.sections {
            o.insert(s.clone(), v.clone());
        }
        if let Some(items) = o.get_mut("items").and_then(Value::as_object_mut) {
            items.extend(lowered.items.clone());
        }
    }
    Ok((doc, lowered, start, end))
}

fn once(entry: &Value) -> Result<(Value, Lowered, i64, i64), String> {
    expand(entry, 1).map_err(|why| format!("`{}` doesn't expand: {why}", name(entry)))
}

/// Each channel's target, with its keys' times and its pulses' ends.
fn writes(lowered: &Lowered) -> Vec<(String, Vec<i64>)> {
    let channels = lowered.sections.get("channels").and_then(Value::as_object);
    channels
        .into_iter()
        .flatten()
        .map(|(_, c)| {
            let mut times: Vec<i64> = c["keys"]
                .as_object()
                .into_iter()
                .flatten()
                .filter_map(|(_, k)| k["t"].as_i64())
                .collect();
            for p in c["modifiers"].as_array().into_iter().flatten() {
                if let (Some(at), Some(span)) = (p["at"].as_i64(), p["span"].as_i64()) {
                    times.extend([at, at + span]);
                }
            }
            (c["target"].as_str().unwrap_or("").to_string(), times)
        })
        .collect()
}

/// The cue's targets.
fn targets(entry: &Value) -> Vec<String> {
    let cue = cue_of(entry);
    cue["targets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

/// What each path holds at `t` in `doc`, evaluated.
fn held(doc: &Value, t: i64, paths: &[String]) -> Result<Vec<Option<Value>>, String> {
    let map = doc.as_object().cloned().unwrap_or_default();
    let program = Program::compile(&map).map_err(|r| format!("{}: {}", r.code, r.path))?;
    let mut state = program.state();
    program.evaluate_local(t, Validity::Full, &mut state);
    let items = crate::eval::items(&map, &program, &state);
    Ok(paths
        .iter()
        .map(|p| {
            let rest = p.strip_prefix("items/")?;
            let (owner, field) = rest.split_once('/')?;
            let field: Vec<String> = field.split('/').map(str::to_string).collect();
            super::authored(items.get(owner)?, &field)
        })
        .collect())
}

/// The time an end state is read: after the last key or pulse the entry writes.
fn last(lowered: &Lowered, end: i64) -> i64 {
    writes(lowered)
        .iter()
        .flat_map(|(_, t)| t.iter().copied())
        .fold(end, i64::max)
}

fn class(entry: &Value) -> Result<&str, String> {
    let class = entry.get("class").and_then(Value::as_str).unwrap_or("");
    if verb::CLASSES.contains(&class) {
        Ok(class)
    } else {
        Err(format!(
            "`{}`'s class `{class}` is none of {:?}",
            name(entry),
            verb::CLASSES
        ))
    }
}

fn rule_same_bytes(entry: &Value) -> Result<(), String> {
    let (_, a, ..) = once(entry)?;
    let (_, b, ..) =
        expand(entry, 2).map_err(|why| format!("`{}` doesn't expand: {why}", name(entry)))?;
    let bytes = |l: &Lowered| {
        serde_json::to_vec(&json!({"sections": l.sections, "items": l.items})).unwrap_or_default()
    };
    if bytes(&a) != bytes(&b) {
        return Err(format!(
            "`{}` expands to different bytes twice",
            name(entry)
        ));
    }
    Ok(())
}

fn rule_targets_only(entry: &Value) -> Result<(), String> {
    let (_, lowered, ..) = once(entry)?;
    let mut ok = targets(entry);
    let cue = cue_of(entry);
    let inputs = entry.pointer("/recipe_body/inputs");
    for joined in entry
        .get("joins")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        let id = cue["params"]
            .get(joined)
            .or_else(|| inputs?.get(joined)?.get("default"))
            .and_then(Value::as_str);
        ok.extend(id.map(str::to_string));
    }
    ok.extend(lowered.items.keys().cloned());
    for (target, _) in writes(&lowered) {
        let owner = target
            .strip_prefix("items/")
            .and_then(|r| r.split('/').next())
            .unwrap_or("");
        if !ok.iter().any(|o| o == owner) {
            return Err(format!(
                "`{}` writes `{target}`, which is neither a target's nor an item it derives",
                name(entry)
            ));
        }
    }
    Ok(())
}

fn rule_inside_span(entry: &Value) -> Result<(), String> {
    let (_, lowered, start, end) = once(entry)?;
    for (target, times) in writes(&lowered) {
        if let Some(t) = times.iter().find(|t| **t < start || **t > end) {
            return Err(format!(
                "`{}` keys `{target}` at flick {t}, outside its cue's span [{start}, {end}]",
                name(entry)
            ));
        }
    }
    Ok(())
}

/// The paths it wrote on its targets, each with what it holds after the last key and what the
/// document without the cue holds there.
/// A path an entry wrote, what it holds after the last key and what it holds without the cue.
type End = (String, Option<Value>, Option<Value>);

fn ends(entry: &Value) -> Result<Vec<End>, String> {
    let (doc, lowered, _, end) = once(entry)?;
    let t = last(&lowered, end);
    let targets = targets(entry);
    let paths: Vec<String> = writes(&lowered)
        .into_iter()
        .map(|(p, _)| p)
        .filter(|p| {
            targets
                .iter()
                .any(|t| p.starts_with(&format!("items/{t}/")))
        })
        .collect();
    let after = held(&doc, t, &paths)?;
    let base = held(&document(1), t, &paths)?;
    Ok(paths
        .into_iter()
        .zip(after)
        .zip(base)
        .map(|((p, a), b)| (p, a, b))
        .collect())
}

/// Two evaluated values equal, numbers by value (an authored 1 is the 1.0 a channel wrote).
fn same(a: &Option<Value>, b: &Option<Value>) -> bool {
    fn eq(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
            (Value::Array(x), Value::Array(y)) => {
                x.len() == y.len() && x.iter().zip(y).all(|(x, y)| eq(x, y))
            }
            _ => a == b,
        }
    }
    match (a, b) {
        (Some(a), Some(b)) => eq(a, b),
        (a, b) => a == b,
    }
}

fn rule_end_state(entry: &Value) -> Result<(), String> {
    match class(entry)? {
        "enter" => {
            for (p, after, base) in ends(entry)? {
                if !same(&after, &base) {
                    let (a, b) = (after.unwrap_or(Value::Null), base.unwrap_or(Value::Null));
                    return Err(format!(
                        "`{}` (enter) ends with `{p}` at {a}, not fully drawn at {b}",
                        name(entry)
                    ));
                }
            }
            Ok(())
        }
        "exit" => {
            let (doc, lowered, _, end) = once(entry)?;
            let t = last(&lowered, end);
            for target in targets(entry) {
                let looks = [
                    format!("items/{target}/adjust/opacity"),
                    format!("items/{target}/params/ops/0/trim/end"),
                    format!("items/{target}/params/reveal/progress"),
                    format!("items/{target}/at/scale/0"),
                ];
                let gone = held(&doc, t, &looks)?
                    .iter()
                    .any(|v| v.as_ref().and_then(Value::as_f64) == Some(0.0));
                if !gone {
                    return Err(format!(
                        "`{}` (exit) ends with `{target}` neither at opacity 0 nor unbuilt",
                        name(entry)
                    ));
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn rule_back_to_base(entry: &Value) -> Result<(), String> {
    if class(entry)? != "emphasis" {
        return Ok(());
    }
    for (p, after, base) in ends(entry)? {
        if !same(&after, &base) {
            let (a, b) = (after.unwrap_or(Value::Null), base.unwrap_or(Value::Null));
            return Err(format!(
                "`{}` (emphasis) leaves `{p}` at {a}, not its base {b}, bit for bit",
                name(entry)
            ));
        }
    }
    Ok(())
}

/// A rule's message naming the entry it read.
macro_rules! naming {
    ($f:ident, $text:expr) => {
        fn $f(entry: &Value) -> Value {
            json!({"message": format!("{} (`{}`)", $text, name(entry))})
        }
    };
}
const SAME_BYTES: &str = "it expands to identical bytes twice";
const TARGETS_ONLY: &str = "it writes only paths under its targets and its own derived items";
const INSIDE_SPAN: &str =
    "every key it writes lies inside [start, start + d × ((n − 1) × lag + 1)]";
const END_STATE: &str =
    "an enter verb ends with its targets fully drawn and an exit verb at opacity 0 or unbuilt";
const BACK_TO_BASE: &str =
    "an emphasis verb leaves every path it wrote at its base value, bit for bit";
naming!(say_same_bytes, SAME_BYTES);
naming!(say_targets_only, TARGETS_ONLY);
naming!(say_inside_span, INSIDE_SPAN);
naming!(say_end_state, END_STATE);
naming!(say_back_to_base, BACK_TO_BASE);

/// A planted entry: a verb named `name` of `class` whose recipe is the one cue step `params`,
/// with `inputs`.
fn planted(name: &str, class: &str, inputs: Value, params: Value) -> Value {
    json!({"name": name, "class": class, "recipe": format!("planted.{name}@1"),
           "recipe_body": {"id": format!("planted.{name}"), "version": "1.0", "inputs": inputs,
                           "steps": {"s": {"op": "cue", "params": params}}}})
}

/// The registry motion declares: `{owner: motion, fill: [first_party_pack, pack], resolve:
/// check}`, its kit's five rules and a planted wrong entry breaking each alone.
pub fn registry() -> RegistryDef {
    let schema = json!({"type": "object", "required": ["name", "class", "recipe"]});
    let none = json!({});
    let mut def = RegistryDef::new(REGISTRY, schema, &["first_party_pack", "pack"], "R6")
        .rule("same_bytes", SAME_BYTES, rule_same_bytes)
        .reported(say_same_bytes)
        .rule("targets_only", TARGETS_ONLY, rule_targets_only)
        .reported(say_targets_only)
        .rule("inside_span", INSIDE_SPAN, rule_inside_span)
        .reported(say_inside_span)
        .rule("end_state", END_STATE, rule_end_state)
        .reported(say_end_state)
        .rule("back_to_base", BACK_TO_BASE, rule_back_to_base)
        .reported(say_back_to_base)
        // An `indicate` whose scale ends at 1.0000001.
        .planted("indicate", planted("indicate", "emphasis", none.clone(),
            json!({"set": {"at/scale": ["now[0] * 1.0000001", "now[1] * 1.0000001", "now[2]"]}})))
        // A `fade_in` whose last key lands one flick past its span.
        .planted("fade_in", planted("fade_in", "enter", none.clone(),
            json!({"from": {"adjust/opacity": 0}, "until": "1 + 1 / (d * 705600000)"})))
        // A verb that writes the position of `other`, which it neither targets nor joins.
        .planted("nudge", planted("nudge", "move", json!({"other": {"type": "ID", "default": "b"}}),
            json!({"on": "other", "set": {"at/pos": ["now[0] + 10", "now[1]", "now[2]"]}})))
        // A verb whose move reads the document's seed, so its bytes change with it.
        .planted("shuffle", planted("shuffle", "move", none.clone(),
            json!({"set": {"at/pos/0": "now + seed % 7 + 1"}})))
        // A `fade_out` that stops at opacity 0.5.
        .planted("fade_out", planted("fade_out", "exit", none, json!({"set": {"adjust/opacity": 0.5}})));
    def.resolve = "check";
    def
}

/// The moves an entry makes in the kit's cue, for a listing (#412).
pub fn moves(entry: &Value) -> Vec<Value> {
    match expand(entry, 1) {
        Ok((_, l, ..)) => writes(&l)
            .into_iter()
            .map(|(target, times)| json!({"target": target, "times": times}))
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_rule_has_a_planted_entry_that_breaks_it_alone() {
        let def = registry();
        assert!(deep_canvas::registry::lists::unisolated(&def).is_empty());
        for p in &def.planted {
            let kit = def.run_kit(&p.name, &p.value);
            assert_eq!(
                kit.failed().len(),
                1,
                "{}: {:?}",
                p.name,
                kit.rules
                    .iter()
                    .map(|r| (&r.rule, &r.why))
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn a_good_entry_passes() {
        let good = planted(
            "fade_in",
            "enter",
            json!({}),
            json!({"from": {"adjust/opacity": 0}}),
        );
        let kit = registry().run_kit("fade_in", &good);
        assert!(
            kit.pass(),
            "{:?}",
            kit.rules.iter().map(|r| &r.why).collect::<Vec<_>>()
        );
    }
}
