//! The registries the core declares (issue #200; canvas primitives: Registries and closed lists),
//! opened from the lists the canvas core ships, each the core's because more than one canvas
//! module fills it: the GPU layer's `gpu.step@1` (the op table), `gpu.output@1` (operator
//! outputs) and `gpu.function@1` (step functions); `mark@1`, `builder@1`, `modifier@1` and
//! `check.kind.doc@1`; and the kits of `device.class@1` and `logic.service@1`, whose entries land
//! with the input seam and the logic module. Each kit's rules are each isolated by a planted wrong
//! entry that breaks that rule alone.

use serde_json::{json, Value};

use super::lists::{EntryDef, KitResult, RegistryDef, RuleResult};
use crate::steps;

/// The release these registries open in.
pub const SINCE: &str = "R2";

/// Today's operator outputs, the effects module's operator check types against them: each
/// operator kind's output, its WGSL type and the type its consumer reads it as.
pub const OUTPUTS: &[(&str, &str, &str)] = &[
    ("pass", "color", "vec4<f32>"),
    ("pass", "coverage", "f32"),
    ("material", "base_color", "vec3<f32>"),
    ("material", "emission", "vec3<f32>"),
    ("material", "alpha", "f32"),
    ("material", "metallic", "f32"),
    ("material", "roughness", "f32"),
];

/// The WGSL type an operator of `kind` writes its output `name` as, if it has that output.
pub fn output_type(kind: &str, name: &str) -> Option<&'static str> {
    OUTPUTS
        .iter()
        .find(|(k, n, _)| *k == kind && *n == name)
        .map(|(_, _, t)| *t)
}

/// Today's marks: the mark primitives scene3d draws, each with its unit fixture's bounds and the
/// box its pixels cover, in the item's space.
const MARKS: &[(&str, [f64; 6])] = &[
    ("mark.box@1", [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    ("mark.cylinder@1", [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    ("mark.line@1", [0.0, 0.0, 0.0, 1.0, 0.0, 0.0]),
    ("mark.point@1", [-0.5, -0.5, 0.0, 0.5, 0.5, 0.0]),
    ("mark.sphere@1", [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    ("mark.text@1", [0.0, -0.5, 0.0, 1.0, 0.5, 0.0]),
];

/// Today's modifiers, each with what it does to its unit box's 8 vertices.
const MODIFIERS: &[(&str, &str, u64)] = &[
    ("mod.array@1", "generate", 16),
    ("mod.mirror@1", "generate", 16),
    ("mod.subdivide@1", "generate", 26),
];

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required})
}

// ---- gpu.step@1

fn step_signature(v: &Value) -> Result<(), String> {
    match (v.pointer("/signature/ports"), v.pointer("/signature/kinds")) {
        (Some(Value::Array(_)), Some(Value::Array(k))) if !k.is_empty() => Ok(()),
        _ => Err("its signature names no ports or no operator kinds".into()),
    }
}

fn step_fixture(v: &Value) -> Result<(), String> {
    match v.get("fixture") {
        Some(Value::Array(c)) if !c.is_empty() => Ok(()),
        _ => Err("it has no exactness fixture".into()),
    }
}

fn step_twin(v: &Value) -> Result<(), String> {
    match v.pointer("/twin/perturb") {
        Some(Value::String(_)) => Ok(()),
        _ => Err("it has no planted twin".into()),
    }
}

fn step_exact(v: &Value) -> Result<(), String> {
    if step_fixture(v).is_err() {
        return Ok(());
    }
    steps::exactness(v, "")
}

fn step_twin_refused(v: &Value) -> Result<(), String> {
    let (Ok(()), Some(twin)) = (
        step_fixture(v),
        v.pointer("/twin/perturb").and_then(Value::as_str),
    ) else {
        return Ok(());
    };
    match steps::exactness(v, twin) {
        Ok(()) => Err(format!(
            "its exactness fixture admits its planted twin `{twin}`"
        )),
        Err(_) => Ok(()),
    }
}

/// A step's exactness fixture run on its planted twin: listed as the entry's `twin_result`,
/// failing and naming the step.
fn step_twin_result(name: &str, v: &Value) -> KitResult {
    let twin = v
        .pointer("/twin/perturb")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let outcome = if step_fixture(v).is_err() {
        Err("no exactness fixture".into())
    } else {
        steps::exactness(v, twin)
    };
    KitResult {
        entry: name.into(),
        rules: vec![RuleResult {
            rule: "exactness",
            pass: outcome.is_ok(),
            message: STEP_EXACT,
            why: outcome
                .err()
                .map(|w| format!("{name}'s planted twin `{twin}`: {w}"))
                .unwrap_or_default(),
        }],
    }
}

const STEP_EXACT: &str =
    "a step whose evaluation gives another value than its exactness fixture says";

fn gpu_step() -> RegistryDef {
    let add = steps::base_entries()
        .into_iter()
        .find(|(n, _)| *n == "add@1")
        .map(|(_, v)| v)
        .unwrap_or(Value::Null);
    let mut saturating = add.clone();
    saturating["impl"] = json!({"base": "add@1", "perturb": "saturate"});
    let mut admitted = add.clone();
    admitted["twin"] = json!({"perturb": ""});
    let without = |field: &str| {
        let mut v = add.clone();
        if let Some(o) = v.as_object_mut() {
            o.remove(field);
        }
        v
    };
    let mut def = RegistryDef::new(
        "gpu.step@1",
        obj(
            json!({"signature": {"type": "object"}, "weight": {"type": "number", "minimum": 0},
                   "fetches": {"type": "integer", "minimum": 0}, "exact": {"type": "boolean"},
                   "impl": {"type": "object"}, "fixture": {"type": "array"}, "twin": {"type": "object"}}),
            &["weight", "exact", "impl"],
        ),
        &["module"],
        SINCE,
    )
    .rule("signature", "a step that names no ports or no operator kinds", step_signature)
    .rule("fixture", "a step without an exactness fixture", step_fixture)
    .rule("twin", "a step without a planted twin", step_twin)
    .rule("exactness", STEP_EXACT, step_exact)
    .rule("twin_refused", "a step whose exactness fixture admits its planted twin", step_twin_refused)
    .planted("add_saturating", saturating)
    .planted("no_signature", without("signature"))
    .planted("no_fixture", without("fixture"))
    .planted("no_twin", without("twin"))
    .planted("twin_admitted", admitted);
    def.twin = Some(step_twin_result);
    def
}

// ---- gpu.output@1

fn output_typed(v: &Value) -> Result<(), String> {
    match (
        v.get("type").and_then(Value::as_str),
        v.get("read_as").and_then(Value::as_str),
    ) {
        (Some(_), Some(_)) => Ok(()),
        _ => Err("it doesn't say its type and the type its consumer reads".into()),
    }
}

fn output_matches(v: &Value) -> Result<(), String> {
    match (
        v.get("type").and_then(Value::as_str),
        v.get("read_as").and_then(Value::as_str),
    ) {
        (Some(t), Some(r)) if t != r => Err(format!("typed {t}, its consumer reads it as {r}")),
        _ => Ok(()),
    }
}

fn gpu_output() -> RegistryDef {
    RegistryDef::new(
        "gpu.output@1",
        obj(
            json!({"kind": {"type": "string"}, "type": {"type": "string"}, "read_as": {"type": "string"}}),
            &["kind"],
        ),
        &["module"],
        SINCE,
    )
    .rule("typed", "an output without its type or its consumer's", output_typed)
    .rule("type_matches", "an output typed other than its consumer reads it", output_matches)
    .planted("vec3_read_as_vec4", json!({"kind": "pass", "type": "vec3<f32>", "read_as": "vec4<f32>"}))
    .planted("untyped", json!({"kind": "pass"}))
}

// ---- gpu.function@1

/// Every step a body names, `[step, expr..]` nodes read as `step@1`.
fn body_steps(e: &Value, out: &mut Vec<String>) {
    if let Value::Array(list) = e {
        if let Some(op) = list.first().and_then(Value::as_str) {
            out.push(format!("{op}@1"));
        }
        for x in list.iter().skip(1) {
            body_steps(x, out);
        }
    }
}

fn function_resolves(v: &Value) -> Result<(), String> {
    let mut used = Vec::new();
    body_steps(v.get("body").unwrap_or(&Value::Null), &mut used);
    if used.is_empty() {
        return Err("its body calls no step".into());
    }
    match used.iter().find(|s| steps::def(s).is_none()) {
        Some(s) => Err(format!("its body calls `{s}`, which is no step")),
        None => Ok(()),
    }
}

fn function_exact(v: &Value) -> Result<(), String> {
    if v.get("exact") != Some(&Value::Bool(true)) {
        return Ok(());
    }
    let mut used = Vec::new();
    body_steps(v.get("body").unwrap_or(&Value::Null), &mut used);
    match used
        .iter()
        .find(|s| steps::def(s).is_some_and(|d| !d.exact))
    {
        Some(s) => Err(format!(
            "declared exact, its body takes the float step `{s}`"
        )),
        None => Ok(()),
    }
}

fn gpu_function() -> RegistryDef {
    RegistryDef::new(
        "gpu.function@1",
        obj(
            json!({"signature": {"type": "object"}, "exact": {"type": "boolean"}, "body": {}}),
            &["exact", "body"],
        ),
        &["module", "pack"],
        SINCE,
    )
    .rule(
        "body_resolves",
        "a step function whose body calls something that is no step",
        function_resolves,
    )
    .rule(
        "exact_body",
        "a step function declared exact whose body takes a float step",
        function_exact,
    )
    .planted(
        "exact_takes_float_step",
        json!({"exact": true, "body": ["mix", "a", "b", "t"]}),
    )
    .planted(
        "calls_no_step",
        json!({"exact": false, "body": ["blend", "a", "b"]}),
    )
}

// ---- mark@1

fn mark_fixture(v: &Value) -> Result<(), String> {
    let six = |k: &str| {
        v.pointer(k)
            .and_then(Value::as_array)
            .is_some_and(|a| a.len() == 6)
    };
    if six("/fixture/bounds") && six("/fixture/drawn") {
        Ok(())
    } else {
        Err("it has no fixture with its bounds and the box its pixels cover".into())
    }
}

fn mark_covers(v: &Value) -> Result<(), String> {
    let nums = |k: &str| -> Option<Vec<f64>> {
        Some(
            v.pointer(k)?
                .as_array()?
                .iter()
                .filter_map(Value::as_f64)
                .collect(),
        )
    };
    let (Some(b), Some(d)) = (nums("/fixture/bounds"), nums("/fixture/drawn")) else {
        return Ok(());
    };
    if b.len() < 6 || d.len() < 6 {
        return Ok(());
    }
    for axis in 0..3 {
        if d[axis] < b[axis] || d[axis + 3] > b[axis + 3] {
            return Err(format!(
                "it draws {:?}, outside its bounds {:?} on axis {axis}",
                &d[..],
                &b[..]
            ));
        }
    }
    Ok(())
}

fn mark() -> RegistryDef {
    RegistryDef::new(
        "mark@1",
        obj(json!({"draws": {"type": "string"}, "fixture": {"type": "object"}}), &["draws"]),
        &["module"],
        SINCE,
    )
    .rule("fixture", "a mark without a fixture of its bounds and drawn pixels", mark_fixture)
    .rule("bounds_cover", "a mark whose bounds leave out a pixel it draws", mark_covers)
    .planted(
        "bounds_miss_pixel",
        json!({"draws": "path", "fixture": {"bounds": [0, 0, 0, 10, 10, 0], "drawn": [0, 0, 0, 11, 10, 0]}}),
    )
    .planted("no_fixture", json!({"draws": "path"}))
}

// ---- builder@1

/// Every name an expression reads, `[op, expr..]` nodes skipped.
fn names_in(e: &Value, out: &mut Vec<String>) {
    match e {
        Value::String(s) => out.push(s.clone()),
        Value::Array(list) => list.iter().skip(1).for_each(|x| names_in(x, out)),
        _ => {}
    }
}

fn builder_params(v: &Value) -> Result<(), String> {
    match v.get("params") {
        Some(Value::Array(_)) => Ok(()),
        _ => Err("it declares no params".into()),
    }
}

fn builder_count(v: &Value) -> Result<(), String> {
    let params: Vec<&str> = v
        .get("params")
        .and_then(Value::as_array)
        .map(|p| p.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut read = Vec::new();
    names_in(v.get("count").unwrap_or(&Value::Null), &mut read);
    match read.iter().find(|n| !params.contains(&n.as_str())) {
        Some(n) if v.get("params").is_some() => Err(format!(
            "its element count reads `{n}`, which is not one of its params"
        )),
        _ => Ok(()),
    }
}

fn builder() -> RegistryDef {
    RegistryDef::new(
        "builder@1",
        obj(
            json!({"params": {"type": "array"}, "count": {}}),
            &["count"],
        ),
        &["module"],
        SINCE,
    )
    .rule(
        "params",
        "a builder that declares no params",
        builder_params,
    )
    .rule(
        "count_from_params",
        "a builder whose element count isn't computable from its params",
        builder_count,
    )
    .planted(
        "count_not_from_params",
        json!({"params": ["segments"], "count": ["mul", "segments", "rows"]}),
    )
    .planted("no_params", json!({"count": 4}))
}

// ---- modifier@1

fn modifier_class(v: &Value) -> Result<(), String> {
    match v.get("class").and_then(Value::as_str) {
        Some("deform" | "generate") => Ok(()),
        other => Err(format!("its class is {other:?}, not deform or generate")),
    }
}

fn modifier_keeps(v: &Value) -> Result<(), String> {
    let n = |k: &str| v.pointer(k).and_then(Value::as_u64);
    match (
        v.get("class").and_then(Value::as_str),
        n("/fixture/vertices_in"),
        n("/fixture/vertices_out"),
    ) {
        (Some("deform"), Some(i), Some(o)) if i != o => {
            Err(format!("declared deform, it turns {i} vertices into {o}"))
        }
        (Some("deform"), None, _) | (Some("deform"), _, None) => {
            Err("declared deform, its fixture doesn't count vertices".into())
        }
        _ => Ok(()),
    }
}

fn modifier() -> RegistryDef {
    RegistryDef::new(
        "modifier@1",
        obj(
            json!({"class": {"type": "string"}, "fixture": {"type": "object"}}),
            &["class"],
        ),
        &["module"],
        SINCE,
    )
    .rule(
        "class",
        "a modifier that is neither deform nor generate",
        modifier_class,
    )
    .rule(
        "deform_keeps_vertices",
        "a modifier declared deform that adds vertices",
        modifier_keeps,
    )
    .planted(
        "deform_adds_vertices",
        json!({"class": "deform", "fixture": {"vertices_in": 8, "vertices_out": 9}}),
    )
    .planted(
        "unknown_class",
        json!({"class": "warp", "fixture": {"vertices_in": 8, "vertices_out": 8}}),
    )
}

// ---- check.kind.doc@1

fn check_catalogued(v: &Value) -> Result<(), String> {
    let codes = v
        .get("codes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    match codes
        .iter()
        .filter_map(Value::as_str)
        .find(|c| !crate::document::CORE_CODES.iter().any(|(k, _)| k == c))
    {
        Some(c) => Err(format!("it emits `{c}`, which the catalogue doesn't list")),
        None => Ok(()),
    }
}

fn check_reads_core(v: &Value) -> Result<(), String> {
    match v.get("reads").and_then(Value::as_array) {
        Some(reads) => match reads
            .iter()
            .filter_map(Value::as_str)
            .find(|r| !r.starts_with("core.") && *r != "document")
        {
            Some(r) => Err(format!("a core check kind reading `{r}`, a module's array")),
            None => Ok(()),
        },
        None => Err("it doesn't say what it reads".into()),
    }
}

fn check_kind_doc() -> RegistryDef {
    RegistryDef::new(
        "check.kind.doc@1",
        obj(
            json!({"codes": {"type": "array"}, "reads": {"type": "array"}}),
            &["codes"],
        ),
        &["module"],
        SINCE,
    )
    .rule(
        "catalogued",
        "a check kind that emits a code the catalogue doesn't list",
        check_catalogued,
    )
    .rule(
        "reads_core",
        "a core check kind that reads a canvas module's arrays",
        check_reads_core,
    )
    .planted(
        "uncatalogued_code",
        json!({"codes": ["no_such_code"], "reads": ["document"]}),
    )
    .planted(
        "reads_a_module",
        json!({"codes": [], "reads": ["marks2d.bounds"]}),
    )
}

// ---- device.class@1

fn class_fixture(v: &Value) -> Result<(), String> {
    let t = v.pointer("/fixture/tracks").and_then(Value::as_object);
    match t {
        Some(t) if ["30", "60", "120"].iter().all(|k| t.contains_key(*k)) => Ok(()),
        _ => Err("it has no recorded fixture played at 30, 60 and 120 fps".into()),
    }
}

fn class_one_track(v: &Value) -> Result<(), String> {
    let Some(t) = v.pointer("/fixture/tracks").and_then(Value::as_object) else {
        return Ok(());
    };
    let mut hashes: Vec<&Value> = t.values().collect();
    hashes.dedup();
    if hashes.len() > 1 {
        Err(format!(
            "its recorded fixture gives {} track hashes across frame rates",
            hashes.len()
        ))
    } else {
        Ok(())
    }
}

fn class_bytes(v: &Value) -> Result<(), String> {
    let bytes = v.get("bytes").and_then(Value::as_u64).unwrap_or(0);
    let plugin = v.get("plugin") == Some(&Value::Bool(true));
    let cap = if plugin { 256 } else { 128 };
    if bytes > cap {
        Err(format!(
            "{bytes} B, past the {cap} B a {} class holds",
            if plugin {
                "plug-in's"
            } else {
                "canvas module's"
            }
        ))
    } else {
        Ok(())
    }
}

fn device_class() -> RegistryDef {
    let track = json!({"30": "a1", "60": "a1", "120": "a1"});
    RegistryDef::new(
        "device.class@1",
        obj(
            json!({"fields": {"type": "object"}, "bytes": {"type": "integer", "minimum": 0},
                   "plugin": {"type": "boolean"}, "fixture": {"type": "object"}}),
            &["fields", "bytes"],
        ),
        &["module", "plugin"],
        SINCE,
    )
    .rule("fixture", "a device class without a recorded fixture at 30, 60 and 120 fps", class_fixture)
    .rule("one_track", "a device class whose recorded fixture gives different track hashes across frame rates", class_one_track)
    .rule("bytes", "a device class past its byte cap", class_bytes)
    .planted(
        "frame_rate_dependent",
        json!({"fields": {"x": "u16"}, "bytes": 2, "fixture": {"tracks": {"30": "a1", "60": "a1", "120": "b2"}}}),
    )
    .planted("plugin_257_bytes", json!({"fields": {"blob": "u8"}, "bytes": 257, "plugin": true, "fixture": {"tracks": track}}))
    .planted("no_fixture", json!({"fields": {"x": "u16"}, "bytes": 2}))
}

// ---- logic.service@1

fn service_fixture(v: &Value) -> Result<(), String> {
    match v.get("fixture") {
        Some(Value::Array(c)) if !c.is_empty() => Ok(()),
        _ => Err("it has no fixture against its check kind's answers".into()),
    }
}

fn service_same_step(v: &Value) -> Result<(), String> {
    match v.get("answers_from").and_then(Value::as_str) {
        Some("step") => Ok(()),
        other => Err(format!(
            "it answers from the world at {other:?}, not the step it serves"
        )),
    }
}

fn logic_service() -> RegistryDef {
    RegistryDef::new(
        "logic.service@1",
        obj(
            json!({"answers_from": {"type": "string"}, "fixture": {"type": "array"}}),
            &["answers_from"],
        ),
        &["module"],
        SINCE,
    )
    .rule("fixture", "a service without fixtures", service_fixture)
    .rule(
        "answers_at_its_step",
        "a service that answers from the world after its next step",
        service_same_step,
    )
    .planted(
        "answers_after_next_step",
        json!({"answers_from": "next_step", "fixture": [{"ask": "nearest", "at": 3}]}),
    )
    .planted("no_fixture", json!({"answers_from": "step"}))
}

// ---- column.source@1 (#397: Array and table: column view)

/// A fixture's frames: each a clean evaluation's rows.
fn frames(v: &Value) -> Vec<&Value> {
    v.pointer("/fixture/frames")
        .and_then(Value::as_array)
        .map(|f| f.iter().collect())
        .unwrap_or_default()
}

fn seek_equals_clean(v: &Value) -> Result<(), String> {
    let frames = frames(v);
    for seek in v
        .pointer("/fixture/seeks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let to = seek["to"].as_u64().unwrap_or(0);
        if frames.get(to as usize).copied() != Some(&seek["rows"]) {
            return Err(format!(
                "frame {to}: after a seek from frame {} the source hands rows that differ from a clean evaluation",
                seek["from"]
            ));
        }
    }
    Ok(())
}

fn clean_rebuild_equality(v: &Value) -> Result<(), String> {
    let frames = frames(v);
    let Some(mut rows) = frames.first().and_then(|f| f.as_array()).cloned() else {
        return Ok(());
    };
    for (k, frame) in frames.iter().enumerate().skip(1) {
        let changed = v
            .pointer(&format!("/fixture/changed/{k}"))
            .and_then(Value::as_array);
        for range in changed.into_iter().flatten() {
            let (a, b) = (
                range[0].as_u64().unwrap_or(0) as usize,
                range[1].as_u64().unwrap_or(0) as usize,
            );
            for i in a..b.min(rows.len()) {
                rows[i] = frame[i].clone();
            }
        }
        if Some(&rows) != frame.as_array() {
            return Err(format!(
                "frame {k}: remapping only the changed ranges it reports gives rows that differ from a clean rebuild"
            ));
        }
    }
    Ok(())
}

fn column_source() -> RegistryDef {
    let frames = json!([[1, 1], [2, 2], [3, 3]]);
    let mut def = RegistryDef::new(
        crate::columns::REGISTRY,
        obj(
            json!({"form": {"type": "string"}, "types": {"type": "array"},
                   "fixture": {"type": "object"}, "sources": {"type": "object"}}),
            &["form", "types", "fixture"],
        ),
        &["module"],
        SINCE,
    )
    .rule("seek_equals_clean", "a source whose rows at t after a seek differ from a clean evaluation", seek_equals_clean)
    .rule("clean_rebuild_equality", "a source whose changed ranges miss rows that changed", clean_rebuild_equality)
    .planted(
        "keeps_previous_rows",
        json!({"form": "planted.<name>", "types": ["i32"], "fixture": {"frames": frames,
               "changed": [[], [[0, 2]], [[0, 2]]], "seeks": [{"from": 2, "to": 0, "rows": [3, 3]}]}}),
    )
    .planted(
        "reports_no_changes",
        json!({"form": "planted.<name>", "types": ["i32"], "fixture": {"frames": frames,
               "changed": [[], [], []], "seeks": [{"from": 2, "to": 0, "rows": [1, 1]}]}}),
    );
    def.resolve = "check";
    def
}

/// Every registry the core declares, by name.
pub fn registries() -> Vec<RegistryDef> {
    vec![
        builder(),
        check_kind_doc(),
        column_source(),
        device_class(),
        gpu_function(),
        gpu_output(),
        gpu_step(),
        logic_service(),
        mark(),
        modifier(),
    ]
}

/// The core's own entries: the op table's base steps (unless `steps_elsewhere`, the planted
/// layout in which a canvas module fills them), today's outputs, marks and modifiers, and the
/// core's document check kinds.
pub fn entries(steps_elsewhere: bool) -> Vec<EntryDef> {
    let mut out = Vec::new();
    let entry = |registry: &str, name: &str, value: Value| EntryDef {
        registry: registry.into(),
        name: name.into(),
        value,
        since: SINCE.into(),
    };
    if !steps_elsewhere {
        out.extend(base_steps());
    }
    for (kind, name, ty) in OUTPUTS {
        out.push(entry(
            "gpu.output@1",
            &format!("{kind}.{name}"),
            json!({"kind": kind, "type": ty, "read_as": ty}),
        ));
    }
    for (name, b) in MARKS {
        out.push(entry(
            "mark@1",
            name,
            json!({"draws": "mesh", "fixture": {"bounds": b, "drawn": b}}),
        ));
    }
    for (name, class, after) in MODIFIERS {
        out.push(entry(
            "modifier@1",
            name,
            json!({"class": class, "fixture": {"vertices_in": 8, "vertices_out": after}}),
        ));
    }
    for kind in super::CORE_CHECK_KINDS {
        let codes: Vec<&str> = if kind == crate::document::CHECK {
            crate::document::CORE_CODES
                .iter()
                .map(|(c, _)| *c)
                .collect()
        } else {
            Vec::new()
        };
        out.push(entry(
            "check.kind.doc@1",
            kind,
            json!({"codes": codes, "reads": ["document"]}),
        ));
    }
    out
}

/// The op table's base steps as `gpu.step@1` entries.
pub fn base_steps() -> Vec<EntryDef> {
    steps::base_entries()
        .into_iter()
        .map(|(name, value)| EntryDef {
            registry: "gpu.step@1".into(),
            name: name.into(),
            value,
            since: SINCE.into(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::lists::unisolated;
    use super::*;

    #[test]
    fn every_core_kit_is_isolated_and_refuses_its_planted_entries() {
        for def in registries() {
            assert!(
                unisolated(&def).is_empty(),
                "{}: {:?}",
                def.name,
                unisolated(&def)
            );
            for p in &def.planted {
                assert!(
                    !def.run_kit(&p.name, &p.value).pass(),
                    "{} admits {}",
                    def.name,
                    p.name
                );
            }
        }
    }

    #[test]
    fn every_core_entry_passes_its_registry_kit() {
        let defs = registries();
        for e in entries(false) {
            let def = defs
                .iter()
                .find(|d| d.name == e.registry)
                .expect("declared");
            let r = def.run_kit(&e.name, &e.value);
            assert!(r.pass(), "{} {}: {:?}", e.registry, e.name, r.failed());
            assert_eq!(
                super::super::lists::schema_fault(&def.entry, &e.value, ""),
                None,
                "{}",
                e.name
            );
        }
    }
}
