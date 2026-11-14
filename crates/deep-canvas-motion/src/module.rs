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
        "reach2" => {
            json!({"owner": owner, "kind": kind, "chain": [owner, other, other], "target": other})
        }
        "follow_tip" => json!({"owner": owner, "kind": kind, "item": other}),
        "limit" => {
            json!({"owner": owner, "kind": kind, "what": "location", "bounds": [[0, 10], null, null]})
        }
        "follow_path" => {
            json!({"owner": owner, "kind": kind, "path": [[0, 0], [10, 0]], "fraction": 0.5})
        }
        "spring_chain" => json!({"owner": owner, "kind": kind, "bones": [owner]}),
        "rest_on" => json!({"owner": owner, "kind": kind}),
        _ => json!({"owner": owner, "kind": kind, "target": other}),
    };
    // b's position follows what a's constraint writes, so the constraint's read of b (or, for
    // a kind that reads no other item, a's position a third driver sets from b) closes a loop.
    let written = if matches!(kind, "look_at" | "reach2") {
        "rot/2"
    } else {
        "pos/0"
    };
    constraints.insert("a".into(), constraint("a", "b"));
    drivers.insert("b".into(), json!({"target": "items/b/at/pos/0", "expr": "v + 1", "vars": {"v": format!("items/a/at/{written}")}}));
    if !reads_other {
        drivers.insert(
            "c".into(),
            json!({"target": "items/a/at/pos/1", "expr": "v", "vars": {"v": "items/b/at/pos/0"}}),
        );
    }
    let doc = json!({"items": {"a": item("a", 1.0), "b": item("b", 2.0)},
                     "constraints": constraints, "drivers": drivers});
    let Value::Object(doc) = doc else {
        return json!({});
    };
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
    // #450: a trail on a 3D line or a 2D path reads its source's chain at earlier times: each
    // frame's evaluations count in the budget estimate, and its fields are checked here.
    for kind in ["mark.line", "path"] {
        r.cost(kind, crate::trail::cost)
            .rule(kind, crate::trail::rule);
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
        .applies(has_clock)
        .run(clock);
    r.operator(
        "channels",
        "items",
        &["motion.program", "t", "view(reduced_motion)", "self"],
        &["motion.at", "motion.fields"],
    )
    .applies(is_target)
    .run(channels);
    register_arrange(r);
    register_score(r);
    // #538: a flip by array in the frame the hub draws.
    crate::held::register(r);
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
        "marker_order",
        "A then or goto that names a marker at or before its own, or a loop that replays from one at or after its stage: paths only go forward (#507).",
        "Name a later marker; to go back, press back in present mode.",
        false,
    );
    r.code(
        "waits_for_class",
        "A marker that waits for a control of class view or viewer, whose entries never reach the input track (#507).",
        "Wait for a control of class document.",
        false,
    );
    r.code(
        "too_many_paths",
        "A film whose waits and branches make more than 64 paths, more than the film audit runs on (#507).",
        "Join branches, or let some options play on, so the film makes 64 paths or fewer.",
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
        "occurrence.undeclared",
        "A start_on, a mark set's rows or a driver reads a logic item's occurrences by a kind or field the item doesn't declare in emits.",
        "Name a kind the item's emits declares and a field that kind declares, or declare it in emits.",
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

/// A `rest_on` that names `on` (#2013): it rests its owner on true shapes at check.
pub fn rests_at_check(constraint: &Value) -> bool {
    constraint.get("kind").and_then(Value::as_str) == Some("rest_on")
        && constraint.get("on").is_some()
}

/// A document with motion a frame's time can change: any section's entry but a rest solved at
/// check, which alone gives a frame nothing to evaluate (Constraint: rest_on).
fn has_clock(doc: &Value, _: &str, _: &Value) -> bool {
    SECTIONS.iter().any(|s| {
        doc.get(*s).and_then(Value::as_object).is_some_and(|m| {
            m.values()
                .any(|entry| *s != "constraints" || !rests_at_check(entry))
        })
    })
}

/// An item a document channel or driver targets, a constraint moves (but a rest solved at check)
/// or a placement binds.
fn is_target(doc: &Value, id: &str, item: &Value) -> bool {
    // #493: a parallax group moves with the camera's pose and its drift.
    if item.get("kind").and_then(Value::as_str) == Some("group@1")
        && item
            .pointer("/params/parallax")
            .is_some_and(Value::is_object)
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
        || counter_data(doc, item).is_some()
        || reads_moving(doc, item);
    // #162: every constraint's owner, not only a limit's, so an item a follow_path or a child_of
    // alone moves draws where the program puts it.
    let held = doc
        .get("constraints")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .any(|(_, c)| c.get("owner").and_then(Value::as_str) == Some(id) && !rests_at_check(c));
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

/// #504: whether a text's template reads a value that moves at t: a control's, an assembly's, or
/// a data value a driver or a stage's `set` writes (Overlay: a readout and the parts it describes
/// come from one model).
fn reads_moving(doc: &Value, item: &Value) -> bool {
    let Some(template) = item.pointer("/params/template").and_then(Value::as_str) else {
        return false;
    };
    let written = |slot: &str| {
        let drivers = doc
            .get("drivers")
            .and_then(Value::as_object)
            .into_iter()
            .flatten();
        let set = doc
            .get("controls")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .flat_map(|(_, c)| {
                c.get("stages")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flatten()
                    .filter_map(|(_, s)| s.get("set")?.as_object())
            });
        drivers
            .into_iter()
            .any(|(_, d)| d.get("target").and_then(Value::as_str) == Some(slot))
            || set.into_iter().any(|s| s.contains_key(slot))
    };
    deep_canvas::template::parts(template)
        .unwrap_or_default()
        .into_iter()
        .any(|p| match p {
            deep_canvas::template::Part::Slot(s) => {
                s.starts_with("controls/")
                    || s.starts_with("assemblies/")
                    || (s.starts_with("data/") && written(s))
            }
            deep_canvas::template::Part::Words(_) => false,
        })
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
            if let Some(name) = slot
                .strip_prefix("data/")
                .filter(|n| !out.iter().any(|o| o == n))
            {
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
        let deep_canvas::template::Part::Slot(slot) = part else {
            continue;
        };
        let Some(name) = slot.strip_prefix("data/") else {
            continue;
        };
        let keyed = channels
            .into_iter()
            .flatten()
            .find(|(_, c)| c.get("target").and_then(Value::as_str) == Some(slot));
        if let Some((channel, _)) = keyed {
            if !out.iter().any(|(n, _)| n == name) {
                out.push((name.to_string(), channel.clone()));
            }
        }
    }
    out
}

/// #544's wrong program (scenario `planted`): a check that passes a reader of a logic item's
/// occurrences naming a kind or field the item doesn't declare.
pub const UNDECLARED_KIND_ACCEPTED: &str = "undeclared_kind_accepted";

/// #504's wrong programs a scenario names, each compiled into the program.
pub const PLANTED: [&str; 3] = [
    "slider_entries_ignored",
    "stage_sets_nothing",
    "stage_shot_cuts",
];

/// The revision's motion, compiled once at check.
fn compile(v: &mut View<'_>) -> Result<(), OpError> {
    // Compiled from the canonical form, members in name order, so a program's layout (its items'
    // slots among them) is the same however the document lists them.
    let canonical = canonical_value(v.document()?, &NoShape)
        .map_err(|e| OpError::new("out_of_range", e.path))?;
    let Value::Object(doc) = &canonical else {
        return Err(OpError::new("bad_doc", ""));
    };
    // #544's planted check passes a reader naming what a logic item doesn't emit.
    let planted = match v.planted() {
        Some(UNDECLARED_KIND_ACCEPTED) => crate::program::Planted::AcceptsUndeclaredOccurrence,
        Some("slider_entries_ignored") => crate::program::Planted::SliderEntriesIgnored,
        Some("stage_sets_nothing") => crate::program::Planted::StageSetIgnored,
        Some("stage_shot_cuts") => crate::program::Planted::StageShotCuts,
        _ => Default::default(),
    };
    let options = crate::program::Options {
        planted,
        ..Default::default()
    };
    // What a refusal names past its path (#544: the reader, the undeclared name, close names).
    let program = Program::compile_with(doc, options).map_err(|r| OpError {
        actual: r.detail,
        ..OpError::new(r.code, r.path)
    })?;
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
    // #504: a part whose parent names an assembly rides it; the core composes item parents only.
    if let Some(a) = program.assembly_of(&id) {
        crate::assembly::placed(&program.assembly_world(&state.slots, a), &mut transform);
    }
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
        let keyed = program
            .motion
            .channels
            .iter()
            .find(|c| c.target.owner == owner);
        if let Some(x) = keyed.and_then(|c| program.channel_value(&state, &c.id)) {
            fields.push((vec!["params".into(), "data".into(), name], Datum::Num(x)));
        }
    }
    // #504: a slot on a data value a driver or a stage writes, on a control's value or on an
    // assembly's shows it at t too: data rides as `params/data/<name>`, a control's or an
    // assembly's as `params/shown/<section>/<id>/value`, which the template reads first.
    for slot in template
        .iter()
        .flat_map(|t| deep_canvas::template::parts(t).unwrap_or_default())
    {
        let deep_canvas::template::Part::Slot(slot) = slot else {
            continue;
        };
        if let Some(name) = slot.strip_prefix("data/") {
            let field = program
                .fields
                .iter()
                .find(|f| f.written && f.data.as_deref() == Some(name));
            if let Some(f) = field.filter(|_| {
                !fields
                    .iter()
                    .any(|(p, _)| p.last().map(String::as_str) == Some(name))
            }) {
                fields.push((
                    vec!["params".into(), "data".into(), name.to_string()],
                    Datum::Num(state.slots[f.slot]),
                ));
            }
        } else if let Some(id) = slot
            .strip_prefix("assemblies/")
            .and_then(|r| r.strip_suffix("/value"))
        {
            if let Some(a) = program.assemblies.iter().find(|a| a.id == id) {
                let path = ["params", "shown", "assemblies", id, "value"]
                    .map(String::from)
                    .to_vec();
                fields.push((path, Datum::Num(a.held(state.slots[a.slot]))));
            }
        } else if let Some(id) = slot
            .strip_prefix("controls/")
            .and_then(|r| r.strip_suffix("/value"))
        {
            let last = program
                .options
                .input
                .iter()
                .filter(|e| e.control == id && e.t <= t)
                .max_by_key(|e| e.key());
            if let Some(x) = last.and_then(|e| e.value.as_f64()) {
                let path = ["params", "shown", "controls", id, "value"]
                    .map(String::from)
                    .to_vec();
                fields.push((path, Datum::Num(x)));
            }
        }
    }
    // A counter on a driver of a data value shows it at t the same way.
    let source = v
        .item()?
        .pointer("/params/text/counter/source")
        .and_then(Value::as_str);
    let driver = source.and_then(|d| program.motion.drivers.iter().find(|x| x.id == d));
    let name = driver.and_then(|d| d.target.owner.strip_prefix("data/"));
    if let Some(field) =
        name.and_then(|n| program.fields.iter().find(|f| f.data.as_deref() == Some(n)))
    {
        let name = field.data.clone().unwrap_or_default();
        fields.push((
            vec!["params".into(), "data".into(), name],
            Datum::Num(state.slots[field.slot]),
        ));
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

/// #1732: `arrange@1`, solved at check once per revision of the document, each arranged item's
/// transform then written into the core's from that one solve; the planted per-frame solve runs
/// in a frame phase instead.
fn register_arrange(r: &mut Registrar) {
    use crate::arrange;
    use deep_canvas::kinds::{Entry, Param, ParamType, Version};
    let json_param = |name: &'static str, form: &'static str| Param {
        name,
        ty: ParamType::Json(form),
        unit: "",
        default: json!([]),
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    r.kind(
        Entry {
            family: "",
            name: "arrange",
            versions: vec![Version {
                major: 1,
                minor: 0,
                params: vec![
                    json_param("items", "[item ID]"),
                    json_param(
                        "relations",
                        "[{a: ID, rel: on | inside | next_to | against | facing | near | apart, b: ID, d?: m}]",
                    ),
                    json_param("broken_out", "[item ID]"),
                ],
            }],
            migrations: Vec::new(),
        },
        &[],
        "",
    );
    // One solve per revision of every arrangement in the document, at check: the frames read
    // its places and never solve. #504: only a document that holds an arrangement has the node,
    // so a revision of any other one leaves every solid's place, and what reads it, kept (a
    // saved file reloads in place); a revision that adds one gains the node, and the readers it
    // binds run again.
    r.array(
        "motion.arranged",
        "arranged",
        "document",
        "transform",
        "plan",
    );
    r.operator("arrange", "plan", &["refs"], &["motion.arranged"])
        .document()
        .applies(has_arrangement)
        .run(arrange_op);
    r.contribution(
        "motion.placed",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.operator("placed", "items", &["motion.arranged"], &["motion.placed"])
        .applies(is_arranged)
        .run(placed_op);
    r.array(
        "motion.arrangelive",
        "arrangement",
        "item",
        "transform",
        "items",
    );
    r.operator(
        "arrangelive",
        "items",
        &["self", "refs", "t"],
        &["motion.arrangelive"],
    )
    .applies(|_, _, item| arrange::is_arrangement(item))
    .run(arrange_live_op);
    r.code(
        arrange::UNSATISFIED,
        "An arrangement whose relations can't all hold with nothing passing into anything.",
        "Drop or loosen the relations it names, or give the items more room.",
        false,
    );
}

/// A solid: what an arrangement can place. It reads only the item, since the core keeps an
/// unchanged item's nodes from one revision to the next; the node writes only for the items an
/// arrangement places.
/// Whether the document holds an arrangement (asked once per document).
fn has_arrangement(doc: &Value, _: &str, _: &Value) -> bool {
    doc.get("items")
        .and_then(Value::as_object)
        .is_some_and(|items| items.values().any(crate::arrange::is_arrangement))
}

fn is_arranged(_: &Value, _: &str, item: &Value) -> bool {
    crate::arrange::is_solid(item)
}

/// Every arrangement of the document solved from where it stands its items, in document order.
fn arrange_op(v: &mut View<'_>) -> Result<(), OpError> {
    let doc = v.document()?;
    let planted = v.planted();
    v.write("motion.arranged", Val::typed(solve_all(doc, planted)?))
}

fn solve_all(doc: &Value, planted: Option<&str>) -> Result<crate::arrange::Arranged, OpError> {
    let mut all = crate::arrange::Arranged::default();
    let items = doc.get("items").and_then(Value::as_object);
    for (id, _) in items
        .into_iter()
        .flatten()
        .filter(|(_, i)| crate::arrange::is_arrangement(i))
    {
        match crate::arrange::solve_doc(doc, id, planted) {
            Ok(a) => all.0.extend(a.0),
            Err((code, path, actual)) => return Err(OpError::new(code, path).with(actual)),
        }
    }
    Ok(all)
}

/// The planted per-frame solve: the arrangement solved again in every frame. As shipped it
/// solves nothing and writes nothing.
fn arrange_live_op(v: &mut View<'_>) -> Result<(), OpError> {
    let _ = v.t()?;
    let _ = v.item()?;
    if v.planted() != Some(crate::arrange::SOLVES_PER_FRAME) {
        return Ok(());
    }
    let id = v.id().unwrap_or_default().to_string();
    let doc = v.document()?;
    match crate::arrange::solve_doc(doc, &id, v.planted()) {
        Ok(a) => v.write("motion.arrangelive", Val::typed(a)),
        Err((code, path, actual)) => Err(OpError::new(code, path).with(actual)),
    }
}

/// An arranged item's solved place, written over its own transform.
fn placed_op(v: &mut View<'_>) -> Result<(), OpError> {
    let id = v.id().unwrap_or_default().to_string();
    let Some(arranged) = v.typed::<crate::arrange::Arranged>("motion.arranged")? else {
        return Ok(());
    };
    let Some((pos, rot)) = arranged.0.get(&id).copied() else {
        return Ok(());
    };
    let set = |name: &str, x: [f64; 3]| Edit {
        add: false,
        path: vec![name.to_string()],
        value: Datum::Nums(x.to_vec()),
    };
    v.write(
        "motion.placed",
        Val::typed(Edits(vec![set("pos", pos), set("rot", rot)])),
    )
}

/// #154: the check of `score.music@1`, music as data, here because its onsets resolve through the
/// tempo map and markers; and the `samples` a library pack lists its presets in.
fn register_score(r: &mut Registrar) {
    // The kind is the core's (`score.music@1`), its fields this module's: the rule here checks it.
    r.rule("score.music", crate::score::rule);
    r.pack_field("samples", samples_field);
    r.check(
        "sound_lock",
        "any",
        &["sound_lock.off_palette", "score.check_unread"],
        |l, i| {
            let out = crate::score::sound_lock(l, i);
            out.raised.into_iter().map(|(id, r, _)| (id, r)).collect()
        },
    )
    .check_report(crate::score::sound_lock);
    r.check("mix.balance", "any", &["score.check_unread"], |_, _| {
        Vec::new()
    })
    .check_report(crate::score::mix_balance);
    for (code, meaning, fix) in [
        ("score.pad_too_low", "A note on a sustained pad below MIDI 48, on an instrument not marked bass.", "Raise the note to MIDI 48 or above, or mark the instrument bass."),
        ("score.note_too_long", "A note held over 60 s.", "Shorten the note to 60 s or less, or write it as notes that follow one another."),
        ("score.far_from_sample", "A sampled note more than 4 semitones from its zone's root.", "Use a preset with a zone nearer the note, or move the note."),
        ("score.unknown_source", "An instrument whose source isn't sampled, pluck or synth.", "Write the source as sampled {library, preset}, pluck {preset} or synth {preset}."),
        ("score.unknown_preset", "An instrument naming a preset its source doesn't have.", "Name a pluck preset (nylon, steel, harp), a synth preset (sine, triangle, saw, square, pad) or a preset of the library's samples."),
        ("score.unknown_instrument", "An event naming an instrument the score doesn't hold.", "Name one of the score's instruments."),
        ("score.bad_pitch", "An event whose pitch is neither a MIDI number nor a name.", "Write the pitch as a MIDI number or a name such as C4."),
        ("score.time_unresolved", "An event whose onset doesn't resolve through the tempo map or markers.", "Write the onset as bar:beat on the tempo map, a time, or @marker."),
        ("score.bad_duration", "An event whose length isn't a positive number of beats or seconds.", "Write the length in beats, or in seconds as \"1.5s\"."),
        ("sound_lock.off_palette", "A score instrument the brief's sound palette doesn't list.", "Use an instrument the palette names, or change the brief's palette."),
        ("score.check_unread", "A score check that couldn't read what it measures.", "Give the check its input: the brief's palette, or the export's power bake."),
        ("score.bad_loop", "A loop region that isn't two bar:beat positions on the tempo map, in order.", "Write the loop as {from, to}, each a bar:beat, with to after from."),
    ] {
        r.code(code, meaning, fix, false);
    }
}

/// A library pack's `samples`: `{preset → {sustained, zones: [{lo, hi, root, takes: [asset path]}]}}`,
/// each take one of the pack's `assets`.
fn samples_field(manifest: &Value) -> Vec<(String, String)> {
    let mut bad = Vec::new();
    let assets: Vec<&str> = manifest["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["path"].as_str())
        .collect();
    let Some(presets) = manifest["samples"].as_object() else {
        return vec![(
            String::new(),
            "samples is {preset: {sustained, zones}}".into(),
        )];
    };
    for (name, p) in presets {
        if !matches!(p.get("sustained"), None | Some(Value::Bool(_))) {
            bad.push((format!("{name}/sustained"), "true or false".into()));
        }
        let Some(zones) = p["zones"].as_array().filter(|z| !z.is_empty()) else {
            bad.push((format!("{name}/zones"), "a preset lists its zones".into()));
            continue;
        };
        for (i, z) in zones.iter().enumerate() {
            let at = format!("{name}/zones/{i}");
            let midi = |k: &str| z[k].as_f64().filter(|v| (0.0..=127.0).contains(v));
            if midi("lo").zip(midi("hi")).is_none_or(|(lo, hi)| lo > hi) || midi("root").is_none() {
                bad.push((at.clone(), "a zone is {lo, hi, root}, MIDI numbers with lo at most hi and its measured root".into()));
            }
            let takes = z["takes"].as_array().filter(|t| !t.is_empty());
            match takes {
                None => bad.push((
                    format!("{at}/takes"),
                    "a zone lists its takes, each one of the pack's assets".into(),
                )),
                Some(t) => {
                    for (k, take) in t.iter().enumerate() {
                        if !take.as_str().is_some_and(|p| assets.contains(&p)) {
                            bad.push((
                                format!("{at}/takes/{k}"),
                                "not a path of the pack's assets".into(),
                            ));
                        }
                    }
                }
            }
        }
    }
    bad
}
