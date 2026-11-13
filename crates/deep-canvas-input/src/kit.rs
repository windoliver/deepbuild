//! `control@1` (canvas primitives: Control: kinds as a registry): the registry the input module
//! declares, filled only by canvas modules at the seal, and its kit. Each entry carries the
//! fixture its kit reads, made by running the kind through the input module's own session:
//!
//! - `replay`: one recorded session of the kind played at 30, 60 and 120 fps gives one track
//!   hash, and the control reads at a replay after the camera moved what its entry recorded;
//! - `read_region`: the kind's value fields and their layout digest;
//! - `keyboard`: a role and a keyboard path, and keys alone move the value;
//! - `input`: your gesture's entry carries your serial, the parameter tool's is the agent's with
//!   none, and an agent's own pointer input writes nothing.

use deep_canvas::canon::sha256_hex;
use deep_canvas::registry::lists::RegistryDef;
use serde_json::{json, Map, Value};

use crate::session::{Behavior, Planted, Session, KINDS};

pub const REGISTRY: &str = "control@1";
/// The kit's parts, each a rule of the registry's kit.
pub const PARTS: [&str; 4] = ["replay", "read_region", "keyboard", "input"];

const F: f64 = deep_canvas::grammar::FLICKS_PER_SECOND as f64;

fn fl(s: f64) -> i64 {
    let x = s * F;
    let r = x as i64;
    if x - r as f64 >= 0.5 {
        r + 1
    } else {
        r
    }
}

fn rect(id: &str, x: f64, y: f64, w: f64, h: f64) -> Value {
    json!({"id": id, "kind": "test.rect@1", "layer": "main", "name": id, "order": "a1",
           "params": {"w": w, "h": h, "fill": [255, 255, 255]}, "at": {"pos": [x, y, 0]}})
}

/// The kit's board: 640 × 360 u, its camera the frame, with one control `c` of kind `name`.
fn board(name: &str, b: Behavior) -> Value {
    let mut c = json!({"kind": name, "class": "document", "label": "Kit", "role": role(b)});
    let mut items = vec![rect("box", 300.0, 100.0, 60.0, 40.0)];
    match b {
        Behavior::Number | Behavior::Turn => {
            let top = if b == Behavior::Turn { 360.0 } else { 1.0 };
            c["range"] = json!([0, top]);
            c["default"] = json!(top / 2.0);
            c["handle"] = json!({"item": "knob", "along": "x", "travel": 200, "drag": "along"});
            items.push(rect("knob", 90.0, 170.0, 20.0, 20.0));
        }
        Behavior::Path => {
            c["range"] = json!([0, 1]);
            c["default"] = json!(0);
            c["handle"] = json!({"item": "bead", "along": {"polyline": [[100, 100], [300, 100], [300, 250]]}, "drag": "along"});
            items.push(rect("bead", 95.0, 95.0, 10.0, 10.0));
        }
        Behavior::Toggle => c["targets"] = json!({"flip": "box"}),
        Behavior::Choice => {
            c["options"] = json!(["a", "b", "c"]);
            c["verb"] = json!("pick");
            c["targets"] = json!({"b": "box"});
        }
        Behavior::Stages => {
            c["default"] = json!("a");
            c["stages"] =
                json!({"a": {"label": "A", "keys": ["1"]}, "b": {"label": "B", "keys": ["2"]}});
            c["targets"] = json!({"b": "box"});
        }
        Behavior::Press => {
            c["keys"] = json!({"Enter": 1});
            c["targets"] = json!({"go": "box"});
        }
        Behavior::Hover => {
            c["class"] = json!("view");
            c["range"] = json!([0, 10]);
            c["default"] = json!(0);
            c["targets"] = json!({"over": "box"});
            c["smoothing"] = json!({"follow": {"transition": {"span": 0.3, "interp": {"ease": {"name": "out_cubic"}}}}});
        }
    }
    let mut map = Map::new();
    map.insert(
        "cam".into(),
        json!({"id": "cam", "kind": "camera@1", "layer": "main", "name": "Camera", "order": "a0",
        "params": {"projection": "orthographic", "target": [320, 180, 0], "view_width": 640}}),
    );
    for i in items {
        map.insert(i["id"].as_str().unwrap_or("").to_string(), i);
    }
    json!({"format": 1, "id": "doc-control-kit", "profile": "board", "size": [640, 360], "camera": "cam",
           "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
           "controls": {"c": c}, "items": Value::Object(map)})
}

fn role(b: Behavior) -> &'static str {
    match b {
        Behavior::Number | Behavior::Turn | Behavior::Path => "slider",
        Behavior::Toggle => "switch",
        Behavior::Choice => "radiogroup",
        Behavior::Stages => "tablist",
        Behavior::Press => "button",
        Behavior::Hover => "group",
    }
}

fn op(o: Value) -> Map<String, Value> {
    match o {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

fn pointer(phase: &str, x: f64, y: f64, t: f64, shift: bool) -> Map<String, Value> {
    let mods: Vec<&str> = if shift { vec!["shift"] } else { vec![] };
    op(json!({"op": "pointer", "phase": phase, "at": [x, y], "t": fl(t), "mods": mods}))
}

/// The kind's recorded gesture: a drag with Shift pressed and released mid-way for a handle, a
/// press and release on its target otherwise, a pass over its target for a hover.
fn gesture(b: Behavior) -> Vec<Map<String, Value>> {
    let steps: &[(&str, f64, f64, f64, bool)] = match b {
        Behavior::Number | Behavior::Turn => &[
            ("down", 200.0, 180.0, 1.0123, false),
            ("move", 216.0, 180.0, 1.0501, false),
            ("move", 216.0, 180.0, 1.1049, true),
            ("move", 236.0, 180.0, 1.2002, true),
            ("move", 236.0, 180.0, 1.3071, false),
            ("move", 256.0, 180.0, 1.4003, false),
            ("up", 256.0, 180.0, 1.5003, false),
        ],
        Behavior::Path => &[
            ("down", 100.0, 100.0, 1.0123, false),
            ("move", 160.0, 120.0, 1.0501, false),
            ("move", 240.0, 90.0, 1.1049, true),
            ("move", 320.0, 160.0, 1.2002, true),
            ("up", 320.0, 160.0, 1.5003, false),
        ],
        Behavior::Hover => &[
            ("move", 50.0, 50.0, 1.0123, false),
            ("move", 330.0, 120.0, 1.0501, false),
            ("move", 50.0, 50.0, 1.4003, false),
        ],
        _ => &[
            ("down", 330.0, 120.0, 1.0123, false),
            ("up", 330.0, 120.0, 1.1049, false),
        ],
    };
    steps
        .iter()
        .map(|(p, x, y, t, s)| pointer(p, *x, *y, *t, *s))
        .collect()
}

fn keyboard_path(b: Behavior) -> (&'static str, Vec<&'static str>) {
    match b {
        Behavior::Number | Behavior::Turn | Behavior::Path => (
            "arrows ± increment, Shift+arrows ± increment ÷ 10, Page Up and Down, Home and End",
            vec!["ArrowRight", "PageUp", "End"],
        ),
        Behavior::Toggle => ("Space or Enter flips it", vec![" "]),
        Behavior::Choice => ("arrows move between the options", vec!["ArrowRight"]),
        Behavior::Stages => (
            "each stage's keys, and arrows to the next or previous stage",
            vec!["2"],
        ),
        Behavior::Press => (
            "its keys press it once per press, never on repeat",
            vec!["Enter"],
        ),
        Behavior::Hover => ("focus over its target, Escape to leave", vec!["Tab"]),
    }
}

/// The kind's value fields, as its read region lays them out.
fn value_fields(b: Behavior) -> Value {
    match b {
        Behavior::Number | Behavior::Turn | Behavior::Hover => json!({"value": "f64"}),
        Behavior::Path => json!({"value": "f64", "at": "f64x2"}),
        Behavior::Toggle => json!({"value": "bool"}),
        Behavior::Choice => json!({"index": "i32"}),
        Behavior::Stages => json!({"stage": "u32"}),
        Behavior::Press => json!({"count": "u32"}),
    }
}

fn bytes_of(fields: &Value) -> Option<u64> {
    let mut n = 0;
    for ty in fields.as_object()?.values() {
        n += match ty.as_str()? {
            "f64" => 8,
            "f64x2" => 16,
            "bool" => 1,
            "i32" | "u32" => 4,
            _ => return None,
        };
    }
    Some(n)
}

fn layout_of(fields: &Value) -> String {
    sha256_hex(fields.to_string().as_bytes())
}

/// Runs `ops` on a fresh session of the kit's board; the session.
fn play(
    name: &str,
    b: Behavior,
    planted: Planted,
    fps: (u32, u32),
    ops: &[Map<String, Value>],
) -> Option<Session> {
    let doc = board(name, b);
    let mut s = Session::new(&doc, [640.0, 360.0], fps, false, planted, &[(name, b)]).ok()?;
    for o in ops {
        s.op(o).ok()?;
    }
    Some(s)
}

fn read(s: &mut Session, t: f64) -> Value {
    s.op(&op(json!({"op": "read", "control": "c", "t": fl(t)})))
        .map(|r| r["value"].clone())
        .unwrap_or(Value::Null)
}

/// Kind `name`'s fixture, from its behavior run for real with `planted`.
pub fn fixture(name: &str, b: Behavior, planted: Planted) -> Value {
    let g = gesture(b);
    let hashes: Vec<Value> = [(30, 1), (60, 1), (120, 1)]
        .iter()
        .map(|fps| play(name, b, planted, *fps, &g).map_or(Value::Null, |s| json!(s.track.hash())))
        .collect();
    let (recorded, replayed) = match play(name, b, planted, (60, 1), &g) {
        Some(mut s) => {
            let recorded = read(&mut s, 2.0);
            let _ = s.op(&op(
                json!({"op": "drag", "at": [10, 10], "delta": [-120, 40], "t": fl(3.0)}),
            ));
            let _ = s.op(&op(json!({"op": "seek", "t": fl(2.0)})));
            (recorded, read(&mut s, 2.0))
        }
        None => (Value::Null, Value::Null),
    };
    let (_, keys) = keyboard_path(b);
    let (before, after) = match play(name, b, planted, (60, 1), &[]) {
        Some(mut s) => {
            let before = read(&mut s, 0.5);
            for (i, k) in keys.iter().enumerate() {
                let _ = s.op(&op(json!({"op": "key", "control": "c", "key": k, "t": fl(1.0 + i as f64 * 0.1), "mods": []})));
            }
            let count = s.track.len();
            let after = read(&mut s, 2.0);
            (json!([before, 0]), json!([after, count]))
        }
        None => (Value::Null, Value::Null),
    };
    let input = match play(name, b, planted, (60, 1), &g) {
        Some(mut s) => {
            let mine = s
                .track
                .entries()
                .first()
                .map(|e| json!({"writer": e.writer.name(), "serial": e.serial}));
            let n = s.track.len();
            let tool_value = match b {
                Behavior::Number | Behavior::Turn | Behavior::Path => json!(0.25),
                Behavior::Toggle => json!(true),
                _ => json!("a"),
            };
            let _ = s.op(&op(
                json!({"op": "tool", "control": "c", "value": tool_value, "t": fl(3.0)}),
            ));
            let tool = s.track.entries()[n..]
                .first()
                .map(|e| json!({"writer": e.writer.name(), "serial": e.serial}));
            let agent = s.agent_pointer("c", [330.0, 120.0], fl(4.0)).unwrap_or(0);
            json!({"gesture": mine, "tool": tool, "agent": agent})
        }
        None => Value::Null,
    };
    json!({
        "replay": {"hashes": hashes, "recorded": recorded, "replayed": replayed},
        "keyboard": {"keys": keys, "before": before, "after": after},
        "input": input,
    })
}

/// Kind `name`'s entry of `control@1`: its classes, sources, value fields with their read
/// region, role and keyboard path, and its fixture.
pub fn entry(name: &str, b: Behavior, planted: Planted) -> Value {
    let fields = value_fields(b);
    let classes: &[&str] = match b {
        Behavior::Hover => &["view", "viewer"],
        Behavior::Number | Behavior::Turn | Behavior::Toggle | Behavior::Choice => {
            &["document", "view", "viewer"]
        }
        _ => &["document"],
    };
    let (keyboard, _) = keyboard_path(b);
    json!({
        "name": name,
        "classes": classes,
        "sources": ["pointer", "keys"],
        "value": fields.clone(),
        "read_region": {"bytes": bytes_of(&fields), "layout": layout_of(&fields)},
        "role": role(b),
        "keyboard": if planted.no_keyboard { "" } else { keyboard },
        "fixture": fixture(name, b, planted),
    })
}

/// The input module's entries, each kind run with the planted program `planted` gives it.
pub fn entries(planted: impl Fn(&str) -> Planted) -> Vec<(&'static str, Value)> {
    KINDS
        .iter()
        .map(|(n, b)| (*n, entry(n, *b, planted(n))))
        .collect()
}

fn field<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(v, |v, k| v.get(*k))
}

fn rule_replay(v: &Value) -> Result<(), String> {
    let r = field(v, &["fixture", "replay"]).ok_or("no replay fixture")?;
    let hashes = r["hashes"].as_array().ok_or("no hashes")?;
    if hashes.len() != 3 || hashes.iter().any(|h| !h.is_string() || *h != hashes[0]) {
        return Err(format!(
            "the recorded session replays at 30, 60 and 120 fps to more than one track hash: {}",
            r["hashes"]
        ));
    }
    if r["recorded"] != r["replayed"] {
        return Err(format!("its entry is computed again at replay: it recorded {} and reads {} once the camera moved", r["recorded"], r["replayed"]));
    }
    Ok(())
}

fn rule_read_region(v: &Value) -> Result<(), String> {
    let fields = v.get("value").ok_or("no value fields")?;
    let rr = v.get("read_region").ok_or("no read region")?;
    if rr["bytes"].as_u64() != bytes_of(fields) {
        return Err(format!(
            "its read region holds {} bytes, its value fields {:?}",
            rr["bytes"],
            bytes_of(fields)
        ));
    }
    if rr["layout"].as_str() != Some(layout_of(fields).as_str()) {
        return Err("its read region's layout digest is not its value fields'".into());
    }
    Ok(())
}

fn rule_keyboard(v: &Value) -> Result<(), String> {
    if v.get("role")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        return Err("it has no ARIA role".into());
    }
    if v.get("keyboard")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        return Err("it has no keyboard path".into());
    }
    let k = field(v, &["fixture", "keyboard"]).ok_or("no keyboard fixture")?;
    if k["before"] == k["after"] {
        return Err("its keys move nothing".into());
    }
    Ok(())
}

fn rule_input(v: &Value) -> Result<(), String> {
    let i = field(v, &["fixture", "input"]).ok_or("no input fixture")?;
    if let Some(g) = i.get("gesture").filter(|g| !g.is_null()) {
        if g["writer"] != "you" || !g["serial"].is_u64() {
            return Err(format!("your gesture's entry is stamped {g}"));
        }
    }
    if let Some(t) = i.get("tool").filter(|t| !t.is_null()) {
        if t["writer"] != "agent" || !t["serial"].is_null() {
            return Err(format!(
                "the parameter tool's entry is stamped {t}, not the agent's with no serial"
            ));
        }
    }
    if i["agent"].as_u64() != Some(0) {
        return Err(format!("an agent's own input wrote {} entries", i["agent"]));
    }
    Ok(())
}

/// The registry the input module declares: `{owner: input, fill: [module], resolve: seal}`,
/// its kit of four rules and a planted wrong entry that breaks each alone.
pub fn registry() -> RegistryDef {
    let schema = json!({"type": "object", "required": ["classes", "sources", "value", "read_region", "role", "keyboard", "fixture"]});
    let good = entry("slider", Behavior::Number, Planted::default());
    let with = |path: &[&str], v: Value| {
        let mut e = good.clone();
        let mut at = &mut e;
        for k in &path[..path.len() - 1] {
            at = &mut at[*k];
        }
        at[path[path.len() - 1]] = v;
        e
    };
    RegistryDef::new(REGISTRY, schema, &["module"], "R6")
        .rule(
            "replay",
            "entries are computed once at the gesture and replay to one track hash",
            rule_replay,
        )
        .rule(
            "read_region",
            "the read region is the value fields, by layout digest",
            rule_read_region,
        )
        .rule(
            "keyboard",
            "a control has a role and a keyboard path",
            rule_keyboard,
        )
        .rule(
            "input",
            "no entry without your gesture serial but the parameter tool's, stamped as the agent",
            rule_input,
        )
        .planted(
            "planted.recomputed",
            with(&["fixture", "replay", "replayed"], json!(-1)),
        )
        .planted(
            "planted.unread",
            with(&["read_region", "layout"], json!("0000")),
        )
        .planted("planted.keyless", {
            let mut e = with(&["keyboard"], json!(""));
            e["fixture"]["keyboard"]["after"] = e["fixture"]["keyboard"]["before"].clone();
            e
        })
        .planted(
            "planted.agent_entry",
            with(&["fixture", "input", "agent"], json!(1)),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_nine_kinds_pass_the_kit_and_each_planted_entry_breaks_its_rule_alone() {
        let def = registry();
        for (name, value) in entries(|_| Planted::default()) {
            let r = def.run_kit(name, &value);
            assert!(r.pass(), "{name}: {:?} {}", r.failed(), value["fixture"]);
        }
        for (p, rule) in def.planted.iter().zip(PARTS) {
            assert_eq!(
                def.run_kit(&p.name, &p.value).failed(),
                vec![rule],
                "{}",
                p.name
            );
        }
        let recompute = Planted {
            recompute: true,
            ..Planted::default()
        };
        assert_eq!(
            def.run_kit(
                "drag_along",
                &entry("drag_along", Behavior::Path, recompute)
            )
            .failed(),
            vec!["replay"]
        );
        let modifiers = Planted {
            reads_modifiers: true,
            ..Planted::default()
        };
        assert_eq!(
            def.run_kit("slider", &entry("slider", Behavior::Number, modifiers))
                .failed(),
            vec!["replay"]
        );
        let tool = Planted {
            tool_stamps_you: true,
            ..Planted::default()
        };
        assert_eq!(
            def.run_kit("slider", &entry("slider", Behavior::Number, tool))
                .failed(),
            vec!["input"]
        );
        let agent = Planted {
            agent_input: true,
            ..Planted::default()
        };
        assert_eq!(
            def.run_kit("slider", &entry("slider", Behavior::Number, agent))
                .failed(),
            vec!["input"]
        );
        let keys = Planted {
            no_keyboard: true,
            ..Planted::default()
        };
        assert_eq!(
            def.run_kit("slider", &entry("slider", Behavior::Number, keys))
                .failed(),
            vec!["keyboard"]
        );
    }
}
