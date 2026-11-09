//! The motion canvas module (technical design: Canvas modules, the module table's `motion` row;
//! issue #387 lays R1's canvas out as canvas modules). A revision's motion compiles once, at
//! check, into a program; each item a channel or a placement writes then has one node per frame
//! that evaluates the program at t and contributes its own transform to the core's
//! `core.transform` and every other field it writes to `core.fields`. The core composes a
//! child's transform with its parent's, so motion's values stay the item's own.

use std::sync::Arc;

use deep_canvas::canon::{canonical_value, NoShape};
use deep_canvas::registry::{Module, Registrar};
use deep_canvas::schedule::core_ops::{Datum, Edit, Edits};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

use crate::eval::Validity;
use crate::program::Program;

/// The motion module: its manifest and its one register call.
pub fn module() -> Module {
    Module {
        manifest: deep_canvas::registry::Manifest {
            name: "motion".into(),
            version: deep_canvas::registry::Semver {
                major: 1,
                minor: 0,
                patch: 0,
            },
            core: deep_canvas::registry::Range::parse("*").expect("a range"),
            depends_on: Default::default(),
            feature: "motion".into(),
            license: "Apache-2.0".into(),
            implements: "motion@1".into(),
            implementation: deep_canvas::registry::Implementation::reference(
                "motion",
                deep_canvas::registry::Semver::parse("1.0.0").expect("a version"),
            ),
        },
        register,
    }
}

/// The planted layout of #490: the motion module declaring `ease@1` and filling it with the
/// named eases, as if the eases were motion's rather than the core's.
pub fn declaring_eases() -> Module {
    Module {
        register: |r| {
            r.registry(deep_canvas::registry::core_lists::ease_registry());
            for e in deep_canvas::registry::core_lists::ease_entries(false) {
                r.entry("ease@1", &e.name, e.value, &e.since);
            }
            register(r);
        },
        ..module()
    }
}

/// The planted opening of #490 (`test-ease-renumbered`): motion built against an `ease@1` whose
/// entries are renumbered, so its programs encode other entry numbers. A module that computes
/// differently is another version, which every key its operators make holds.
pub fn renumbered() -> Module {
    let mut m = Module {
        register: |r| register_compiling(r, crate::kit::Planted::None, compile_renumbered),
        ..module()
    };
    m.manifest.version.patch = 1;
    m
}

fn compile_renumbered(v: &mut View<'_>) -> Result<(), OpError> {
    let canonical = canonical_value(v.document()?, &NoShape)
        .map_err(|e| OpError::new("out_of_range", e.path))?;
    let Value::Object(doc) = &canonical else {
        return Err(OpError::new("bad_doc", ""));
    };
    let options = crate::program::Options {
        planted: crate::program::Planted::EaseRenumbered,
        ..Default::default()
    };
    let program = Program::compile_with(doc, options).map_err(|r| OpError::new(r.code, r.path))?;
    v.write("motion.program", Val::typed(Arc::new(program)))
}

/// The motion module with a planted constraint solve, whose `constraint@1` entry the
/// constraint kit must refuse at the seal, naming the kind.
pub fn planted(planted: crate::kit::Planted) -> Module {
    Module {
        register: match planted {
            crate::kit::Planted::None => register,
            crate::kit::Planted::Iterates => |r| register_with(r, crate::kit::Planted::Iterates),
            crate::kit::Planted::PreviousFrame => {
                |r| register_with(r, crate::kit::Planted::PreviousFrame)
            }
        },
        ..module()
    }
}

/// A two-item cycle through constraint kind `kind`, compiled for real: items `a` and `b`, each
/// reading the other's position, one of them through the kind; a kind that reads no other item
/// closes the loop through two drivers. The check's answer, as the kit reads it.
pub fn cycle_through(kind: &str) -> Value {
    let item = |id: &str, x: f64| json!({"id": id, "kind": "rect@1", "params": {"box": [0, 0, 4, 4]}, "at": {"pos": [x, 0, 0]}});
    let mut constraints = serde_json::Map::new();
    let mut drivers = serde_json::Map::new();
    let reads_other = !matches!(kind, "limit" | "follow_path" | "spring_chain" | "rest_on");
    let constraint = |owner: &str, other: &str| match kind {
        "child_of" => json!({"owner": owner, "kind": kind, "parent": other}),
        "copy" => json!({"owner": owner, "kind": kind, "what": "location", "target": other}),
        "reach2" => json!({"owner": owner, "kind": kind, "chain": [owner, other, other], "target": other}),
        "follow_tip" => json!({"owner": owner, "kind": kind, "item": other}),
        "limit" => json!({"owner": owner, "kind": kind, "what": "location", "bounds": [[0, 10], null, null]}),
        "follow_path" => json!({"owner": owner, "kind": kind, "path": [[0, 0], [10, 0]], "fraction": 0.5}),
        "spring_chain" => json!({"owner": owner, "kind": kind, "bones": [owner]}),
        "rest_on" => json!({"owner": owner, "kind": kind}),
        _ => json!({"owner": owner, "kind": kind, "target": other}),
    };
    // b's position follows what a's constraint writes, so the constraint's read of b (or, for
    // a kind that reads no other item, a's position a third driver sets from b) closes a loop.
    let written = if matches!(kind, "look_at" | "reach2") { "rot/2" } else { "pos/0" };
    constraints.insert("a".into(), constraint("a", "b"));
    drivers.insert("b".into(), json!({"target": "items/b/at/pos/0", "expr": "v + 1", "vars": {"v": format!("items/a/at/{written}")}}));
    if !reads_other {
        drivers.insert("c".into(), json!({"target": "items/a/at/pos/1", "expr": "v", "vars": {"v": "items/b/at/pos/0"}}));
    }
    let doc = json!({"items": {"a": item("a", 1.0), "b": item("b", 2.0)},
                     "constraints": constraints, "drivers": drivers});
    let Value::Object(doc) = doc else { return json!({}) };
    match Program::compile(&doc) {
        Err(r) if r.code == "cycle" => {
            // Each step reads `<entry> (<item>)`: the chain is its items.
            let chain: Vec<&str> = r
                .path
                .split(" → ")
                .filter_map(|e| e.rsplit_once(" (")?.1.strip_suffix(')'))
                .collect();
            json!({"code": r.code, "chain": chain})
        }
        Err(r) => json!({"code": r.code, "chain": []}),
        Ok(_) => json!({"code": null, "chain": []}),
    }
}

fn register(r: &mut Registrar) {
    register_with(r, crate::kit::Planted::None);
}

fn register_with(r: &mut Registrar, planted: crate::kit::Planted) {
    register_compiling(r, planted, compile);
}

/// The module's registration, with `compile` the operator that compiles a revision's motion.
fn register_compiling(
    r: &mut Registrar,
    planted: crate::kit::Planted,
    compile: fn(&mut View<'_>) -> Result<(), OpError>,
) {
    // #489: motion's kinds in the core's `constraint@1`, each with its kit fixture.
    for (name, value) in crate::kit::entries(planted, cycle_through) {
        r.entry("constraint@1", name, value, "R6");
    }
    r.array("motion.program", "program", "document", "geometry", "plan");
    r.contribution(
        "motion.at",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.contribution(
        "motion.fields",
        "fields",
        "item",
        "geometry",
        "items",
        "core.fields",
    );
    r.operator("compile", "plan", &["refs"], &["motion.program"])
        .document()
        .applies(has_motion)
        .run(compile);
    // Issue #488: the frame's `valid_until` (Transport: "Each frame returns `valid_until`, and
    // the app sleeps until then"), the earliest flick anything motion moves changes next, or
    // null once nothing does; the frame clock arms the next frame from it.
    r.array("motion.next", "i64", "document", "time", "items");
    r.operator("clock", "items", &["motion.program", "t"], &["motion.next"])
        .document()
        .applies(has_motion)
        .run(clock);
    r.operator(
        "channels",
        "items",
        &["motion.program", "t", "view(reduced_motion)", "self"],
        &["motion.at", "motion.fields"],
    )
    .applies(is_target)
    .run(channels);
    r.code(
        "bad_doc",
        "A motion section, or a field of one, that isn't the shape motion reads.",
        "Write the transport, channels, clips, placements and markers as the motion sections define them.",
        false,
    );
    r.code(
        "bad_interp",
        "A key's interpolation motion doesn't land, or one its channel's type can't take; or a transition's or a shot's ease it doesn't land.",
        "Use linear, hold, a bezier or a spring on a number, and hold on a bool; for an ease, a bezier or the ease linear, in_cubic, out_cubic or in_out_cubic.",
        false,
    );
    r.code(
        "bad_space",
        "A color channel in a space motion doesn't mix colors in.",
        "Leave the space out, or write oklab.",
        false,
    );
    r.code(
        "bad_type",
        "A channel of a type motion doesn't write.",
        "Use the type f32, color or bool.",
        false,
    );
    r.code(
        "bad_marker_kind",
        "A marker of a kind motion doesn't land.",
        "Use the marker kind cue, shot, section or record.",
        false,
    );
    r.code(
        "time_unresolved",
        "A marker whose time never resolves, through a loop of markers or one that doesn't exist.",
        "Time the marker from a marker that resolves, or give it its own time.",
        false,
    );
    r.code(
        "placement_cycle",
        "Placements that each start after another in a loop.",
        "Give one placement of the loop its own start.",
        false,
    );
    r.code(
        "transition_kind",
        "A transition of a kind motion doesn't land.",
        "Use a cut.",
        false,
    );
    r.code(
        "transition_gap",
        "A cut between placements that don't meet: the second doesn't start where the first ends.",
        "Start the second placement where the first ends, or after it.",
        false,
    );
    r.fixture("slide", slide(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/rider/at/pos", "value": [16, -14, 0]},
    }));
}

const SECTIONS: [&str; 8] = [
    "channels",
    "clips",
    "placements",
    "markers",
    "drivers",
    "constraints",
    // #493: shots write their camera's pose, which a parallax group reads.
    "shots",
    "transitions",
];

/// A document with any channel, clip, placement, marker, driver or constraint.
fn has_motion(doc: &Value, _: &str, _: &Value) -> bool {
    SECTIONS.iter().any(|s| {
        doc.get(*s)
            .and_then(Value::as_object)
            .is_some_and(|m| !m.is_empty())
    })
}

/// An item a document channel or driver targets, a limit constraint holds or a placement binds.
fn is_target(doc: &Value, id: &str, item: &Value) -> bool {
    // #493: a parallax group moves with the camera's pose and its drift.
    if item.get("kind").and_then(Value::as_str) == Some("group@1")
        && item.pointer("/params/parallax").is_some_and(Value::is_object)
        && doc.get("camera").is_some()
    {
        return true;
    }
    let prefix = format!("items/{id}/");
    let targets = |section: &str| {
        doc.get(section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .any(|(_, c)| {
                c.get("target")
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.starts_with(&prefix))
            })
    };
    let channel = targets("channels")
        || targets("drivers")
        || !keyed_data(doc, item).is_empty()
        || counter_data(doc, item).is_some();
    let held = doc
        .get("constraints")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .any(|(_, c)| {
            c.get("kind").and_then(Value::as_str) == Some("limit")
                && c.get("owner").and_then(Value::as_str) == Some(id)
        });
    let bound = doc
        .get("placements")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .flat_map(|(_, p)| {
            p.get("slots")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
        })
        .any(|(_, items)| match items {
            Value::String(s) => s == id,
            Value::Array(list) => list.iter().any(|v| v.as_str() == Some(id)),
            _ => false,
        });
    channel || held || bound
}

/// The data value a counter's driver writes (`data/<name>`), which its text shows at t.
fn counter_data<'a>(doc: &'a Value, item: &Value) -> Option<&'a str> {
    let source = item.pointer("/params/text/counter/source")?.as_str()?;
    let target = doc.get("drivers")?.get(source)?.get("target")?.as_str()?;
    target.strip_prefix("data/")
}

/// The data names a text template's slots read (`{data/<name>}`), each once.
fn data_slots(template: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in deep_canvas::template::parts(template).unwrap_or_default() {
        if let deep_canvas::template::Part::Slot(slot) = part {
            if let Some(name) = slot.strip_prefix("data/").filter(|n| !out.iter().any(|o| o == n)) {
                out.push(name.to_string());
            }
        }
    }
    out
}

/// The keyed data values an item's text template reads (Text `text@1`, `template`), each with
/// the channel that keys it: `(name, channel)`. Its text shows the value at the frame's time.
fn keyed_data(doc: &Value, item: &Value) -> Vec<(String, String)> {
    let Some(template) = item.pointer("/params/template").and_then(Value::as_str) else {
        return Vec::new();
    };
    let Ok(parts) = deep_canvas::template::parts(template) else {
        return Vec::new();
    };
    let channels = doc.get("channels").and_then(Value::as_object);
    let mut out = Vec::new();
    for part in parts {
        let deep_canvas::template::Part::Slot(slot) = part else { continue };
        let Some(name) = slot.strip_prefix("data/") else { continue };
        let keyed = channels.into_iter().flatten().find(|(_, c)| {
            c.get("target").and_then(Value::as_str) == Some(slot)
        });
        if let Some((channel, _)) = keyed {
            if !out.iter().any(|(n, _)| n == name) {
                out.push((name.to_string(), channel.clone()));
            }
        }
    }
    out
}

/// The revision's motion, compiled once at check.
fn compile(v: &mut View<'_>) -> Result<(), OpError> {
    // Compiled from the canonical form, members in name order, so a program's layout (its items'
    // slots among them) is the same however the document lists them.
    let canonical = canonical_value(v.document()?, &NoShape)
        .map_err(|e| OpError::new("out_of_range", e.path))?;
    let Value::Object(doc) = &canonical else {
        return Err(OpError::new("bad_doc", ""));
    };
    let program = Program::compile(doc).map_err(|r| OpError::new(r.code, r.path))?;
    v.write("motion.program", Val::typed(Arc::new(program)))
}

/// The frame's `valid_until` at t: when anything motion moves changes next.
fn clock(v: &mut View<'_>) -> Result<(), OpError> {
    let t = v.t()?;
    let Some(program) = v.typed::<Arc<Program>>("motion.program")? else {
        return Err(OpError::new("input_missing", ""));
    };
    let mut state = program.state();
    program.evaluate_local(t, Validity::Full, &mut state);
    v.write("motion.next", Val::typed(state.valid_until))
}

/// The item's own transform and fields at t, as the core's contributions.
fn channels(v: &mut View<'_>) -> Result<(), OpError> {
    let mut t = v.t()?;
    let id = v.id().unwrap_or_default().to_string();
    let Some(program) = v.typed::<Arc<Program>>("motion.program")? else {
        return Err(OpError::new("input_missing", format!("items/{id}")));
    };
    let transport = program.motion.transport;
    if transport.holds && v.reduced_motion()? {
        t = transport.start;
    }
    let mut state = program.state();
    program.evaluate_local(t, Validity::Full, &mut state);
    let Some((mut transform, mut fields)) = program.item_values(&state, &id) else {
        return Ok(());
    };
    // #493: a parallax group's offset (Frame and group: parallax).
    if let Some(plan) = program.shots.as_deref() {
        if let Some(o) = plan.parallax(&program, &id, t, v.reduced_motion()?) {
            transform[0] += o[0];
            transform[1] += o[1];
        }
    }
    // A text whose template reads a keyed data value shows it at t: the value rides on the
    // evaluated item as `params/data/<name>`, which the template reads before the document's.
    let template = v
        .item()?
        .pointer("/params/template")
        .and_then(Value::as_str)
        .map(str::to_string);
    for name in template.iter().flat_map(|t| data_slots(t)) {
        let owner = format!("data/{name}");
        let keyed = program.motion.channels.iter().find(|c| c.target.owner == owner);
        if let Some(x) = keyed.and_then(|c| program.channel_value(&state, &c.id)) {
            fields.push((vec!["params".into(), "data".into(), name], Datum::Num(x)));
        }
    }
    // A counter on a driver of a data value shows it at t the same way.
    let source = v.item()?.pointer("/params/text/counter/source").and_then(Value::as_str);
    let driver = source.and_then(|d| program.motion.drivers.iter().find(|x| x.id == d));
    let name = driver.and_then(|d| d.target.owner.strip_prefix("data/"));
    if let Some(field) = name.and_then(|n| program.fields.iter().find(|f| f.data.as_deref() == Some(n))) {
        let name = field.data.clone().unwrap_or_default();
        fields.push((vec!["params".into(), "data".into(), name], Datum::Num(state.slots[field.slot])));
    }
    let set = |name: &str, from: usize| Edit {
        add: false,
        path: vec![name.to_string()],
        value: Datum::Nums(transform[from..from + 3].to_vec()),
    };
    let at = Edits(vec![set("pos", 0), set("rot", 3), set("scale", 6)]);
    let edits = fields
        .into_iter()
        .map(|(path, value)| Edit {
            add: false,
            path,
            value,
        })
        .collect();
    v.write("motion.at", Val::typed(at))?;
    v.write("motion.fields", Val::typed(Edits(edits)))
}

/// The motion module's fixture: a box a clip slides, a child riding it, and a caption.
fn slide() -> Value {
    json!({
        "format": 1, "profile": "board", "seed": 387, "title": "Motion slide",
        "description": "A box a clip slides across, its child riding along, and a caption: the motion module's fixture.",
        "size": [320, 200],
        "items": {
            "ground": {"id": "ground", "kind": "rect@1", "name": "Ground", "order": "a0",
                       "params": {"box": [0, 0, 320, 200], "paint": {"fill": {"role": "ground"}}}},
            "mover": {"id": "mover", "kind": "rect@1", "name": "Sliding box", "order": "a1",
                      "params": {"box": [0, 0, 40, 30], "paint": {"fill": {"role": "ink"}}},
                      "at": {"pos": [16, 80, 0]}},
            "rider": {"id": "rider", "kind": "rect@1", "name": "Rider", "order": "a2", "parent": "mover",
                      "params": {"box": [0, 0, 12, 10], "paint": {"fill": {"role": "muted"}}},
                      "at": {"pos": [10, -14, 0]}},
            "cap": {"id": "cap", "kind": "text@1", "name": "Caption", "order": "a3",
                    "params": {"text": "Sliding", "font": "body", "size": 13, "box": {"w": 120, "h": 20}},
                    "at": {"pos": [16, 20, 0]}}
        },
        "clips": {"slide": {"slots": {"target": {"type": "rect@1", "required": true}}, "span": "auto",
            "channels": {"x": {"target": "slot:target/at/pos/0", "type": "f32",
                "keys": {"k0": {"t": "0s", "value": 16, "interp": "linear"}, "k1": {"t": "2s", "value": 260, "interp": "linear"}}}}}},
        "placements": {"p": {"clip": "slide", "slots": {"target": "mover"}, "start": "0s"}}
    })
}
