//! What scene3d fills into the GPU layer's registries (#486; Operator output, Pack graphs and
//! step functions): a material operator's lobe outputs, `occlusion` and `normal` in
//! `gpu.output@1`, and `core.bump@1` in `gpu.function@1`; and which lobe each output needs on the
//! material it shades. #485 adds the light loop's responses `light` and `ambient` and the
//! `vertex_offset` to `gpu.output@1`, and their defaults `core.light@1` and `core.ambient@1`.

use deep_canvas::registry::Registrar;
use serde_json::{json, Map, Value};

/// Each material output scene3d fills: its name, its WGSL type and the material field whose lobe
/// it needs (`None`: none). A lobe output replaces its field per pixel only where the material
/// has that lobe, so the feature set stays the material's.
pub const OUTPUTS: &[(&str, &str, Option<&str>)] = &[
    ("anisotropy", "vec2<f32>", Some("anisotropy/strength")),
    ("coat", "f32", Some("coat")),
    ("coat_normal", "vec3<f32>", Some("coat")),
    ("coat_roughness", "f32", Some("coat")),
    ("diffuse_roughness", "f32", Some("diffuse_roughness")),
    ("iridescence_thickness", "f32", Some("iridescence/weight")),
    ("normal", "vec3<f32>", None),
    ("occlusion", "f32", None),
    ("sheen", "f32", Some("sheen/weight")),
    ("sheen_color", "vec3<f32>", Some("sheen/weight")),
    ("sheen_roughness", "f32", Some("sheen/weight")),
    ("specular_color", "vec3<f32>", Some("specular_color")),
    ("specular_level", "f32", None),
    ("subsurface", "f32", Some("subsurface/weight")),
    ("translucency", "f32", Some("translucency/amount")),
    ("transmission", "f32", Some("transmission")),
];

/// The outputs whose values live in a part's lobe entry, which the part then needs even while its
/// material's lobe sits at 0 for a channel, driver or control to move it.
pub const TABLE_LOBES: &[&str] = &[
    "anisotropy",
    "diffuse_roughness",
    "iridescence_thickness",
    "sheen",
    "sheen_color",
    "sheen_roughness",
    "subsurface",
    "translucency",
    "transmission",
];

/// The sheen's outputs: a part whose operator writes one keeps its sheen's color and weight apart.
pub const SHEEN: &[&str] = &["sheen", "sheen_color", "sheen_roughness"];

/// Whether the material operator `item` writes any of `outputs`.
pub fn writes(item: &Value, outputs: &[&str]) -> bool {
    item["params"]["outputs"]
        .as_object()
        .is_some_and(|o| outputs.iter().any(|n| o.contains_key(*n)))
}

/// The WGSL type a material operator writes scene3d's output `name` as, if it is one.
pub fn output_type(name: &str) -> Option<&'static str> {
    OUTPUTS.iter().find(|o| o.0 == name).map(|o| o.1)
}

/// The part's own values a light response reads beside the light's (#485: "the operator's own
/// outputs"): each as the part's operator left it, or its material's where it wrote none.
const OWN: &[(&str, &str)] = &[
    ("base_color", "vec3<f32>"),
    ("alpha", "f32"),
    ("metallic", "f32"),
    ("roughness", "f32"),
    ("specular_level", "f32"),
];

/// What the core's light loop hands a material's `light` once per shaded light (#485; Operator
/// output: light response): the shading normal, the direction to the eye and to the light in
/// view space, the light's radiance after its falloff, IES distribution and receivers, its shadow
/// (0..1), a hash of its ID, then the part's own values.
pub const LIGHT_IN: &[(&str, &str)] = &[
    ("n", "vec3<f32>"),
    ("v", "vec3<f32>"),
    ("l", "vec3<f32>"),
    ("radiance", "vec3<f32>"),
    ("shadow", "f32"),
    ("light_hash", "u32"),
];

/// What it hands `ambient` once per pixel: the irradiance from the environment or the sky after
/// ambient occlusion, one environment sample along the reflection at the roughness, the normal
/// and the direction to the eye in view space, then the part's own values.
pub const AMBIENT_IN: &[(&str, &str)] = &[
    ("irradiance", "vec3<f32>"),
    ("env", "vec3<f32>"),
    ("n", "vec3<f32>"),
    ("v", "vec3<f32>"),
];

/// A response's inputs: `ports` then the part's own values.
pub fn response_in(ports: &[(&'static str, &'static str)]) -> Vec<(&'static str, &'static str)> {
    ports.iter().chain(OWN).copied().collect()
}

/// The light loop's two responses: the output each is, its inputs and its default, the core's own
/// shading, which naming leaves as it is.
pub const RESPONSES: &[(&str, &[(&str, &str)], &str)] = &[
    ("light", LIGHT_IN, "core.light@1"),
    ("ambient", AMBIENT_IN, "core.ambient@1"),
];

/// The defaults' entries in `gpu.function@1`: their ports, and as their body the core's own WGSL
/// in the renderer, which no graph can name a step of (the DFG table, the extra lobes).
fn defaults() -> Vec<(&'static str, Value)> {
    RESPONSES
        .iter()
        .map(|(output, ports, name)| {
            let ins: Map<String, Value> = response_in(ports)
                .into_iter()
                .map(|(k, t)| (k.to_string(), json!(t)))
                .collect();
            let value = json!({
                "signature": {"in": ins, "out": {"radiance": "vec3<f32>"}},
                "exact": false,
                "body": {"source": {"wgsl": format!("deep-scene3d-render/scene3d.wgsl#{output}")}},
            });
            (*name, value)
        })
        .collect()
}

/// scene3d's step functions, each in a pack function's form `{about, ports, steps}`.
pub fn functions() -> Map<String, Value> {
    let mut out = Map::new();
    out.insert("core.bump@1".into(), bump());
    out
}

/// `core.bump@1 {in: {height: f32 (m), strength: f32}, out: {normal: vec3}}`: the surface
/// gradient of height over position (Mikkelsen 2010), σx and σy the position's screen
/// derivatives, r1 = σy × n, r2 = n × σx, det = σx · r1 and n' = normalize(|det| n − sign(det)
/// (∂h/∂x r1 + ∂h/∂y r2) × strength), given in the tangent frame the renderer rebuilds the normal
/// in, its bitangent cross(n, t) times the frame's handedness; (0, 0, 1) where there is no tangent.
fn bump() -> Value {
    let steps: Vec<(&str, &str, Value)> = vec![
        ("p", "position@1", json!({"space": "world"})),
        ("n0", "normal@1", json!({"space": "world"})),
        ("n", "normalize@1", json!({"x": "n0"})),
        ("sx", "ddx@1", json!({"x": "p"})),
        ("sy", "ddy@1", json!({"x": "p"})),
        ("hx", "ddx@1", json!({"x": "height"})),
        ("hy", "ddy@1", json!({"x": "height"})),
        ("r1", "cross@1", json!({"a": "sy", "b": "n"})),
        ("r2", "cross@1", json!({"a": "n", "b": "sx"})),
        ("det", "dot@1", json!({"a": "sx", "b": "r1"})),
        ("g1", "mul@1", json!({"a": "r1", "b": "hx"})),
        ("g2", "mul@1", json!({"a": "r2", "b": "hy"})),
        ("g", "add@1", json!({"a": "g1", "b": "g2"})),
        ("sd", "sign@1", json!({"x": "det"})),
        ("gs", "mul@1", json!({"a": "g", "b": "sd"})),
        ("grad", "mul@1", json!({"a": "gs", "b": "strength"})),
        ("ad", "abs@1", json!({"x": "det"})),
        ("nd", "mul@1", json!({"a": "n", "b": "ad"})),
        ("nb0", "sub@1", json!({"a": "nd", "b": "grad"})),
        ("nb", "normalize@1", json!({"x": "nb0"})),
        ("tg", "tangent@1", json!({})),
        ("tv", "split@1", json!({"x": "tg", "pick": "xyz"})),
        ("tw", "split@1", json!({"x": "tg", "pick": "w"})),
        ("tn", "dot@1", json!({"a": "n", "b": "tv"})),
        ("tnn", "mul@1", json!({"a": "n", "b": "tn"})),
        ("tp", "sub@1", json!({"a": "tv", "b": "tnn"})),
        ("tl", "dot@1", json!({"a": "tp", "b": "tp"})),
        ("has_t", "gt@1", json!({"a": "tl", "b": 1e-12})),
        ("tl1", "max@1", json!({"a": "tl", "b": 1e-12})),
        ("ti", "inverse_sqrt@1", json!({"x": "tl1"})),
        ("t", "mul@1", json!({"a": "tp", "b": "ti"})),
        ("left", "lt@1", json!({"a": "tw", "b": 0.0})),
        (
            "hand",
            "select@1",
            json!({"f": 1.0, "t": -1.0, "cond": "left"}),
        ),
        ("b0", "cross@1", json!({"a": "n", "b": "t"})),
        ("b", "mul@1", json!({"a": "b0", "b": "hand"})),
        ("x", "dot@1", json!({"a": "nb", "b": "t"})),
        ("y", "dot@1", json!({"a": "nb", "b": "b"})),
        ("z", "dot@1", json!({"a": "nb", "b": "n"})),
        ("bent", "compose@1", json!({"x": "x", "y": "y", "z": "z"})),
        ("up", "const@1", json!({"value": [0.0, 0.0, 1.0]})),
        (
            "normal",
            "select@1",
            json!({"f": "up", "t": "bent", "cond": "has_t"}),
        ),
    ];
    let steps: Map<String, Value> = steps
        .into_iter()
        .map(|(id, op, args)| (id.to_string(), json!({"op": op, "args": args})))
        .collect();
    json!({
        "about": "Relief from any height graph (m): a tangent-space normal for the normal output, by the surface gradient of height and position and the tangent frame's handedness.",
        "ports": {"in": {"height": "f32", "strength": "f32"}, "out": {"normal": "vec3<f32>"}},
        "steps": steps,
    })
}

/// A step function's body as `gpu.function@1` reads it: its out port's step unfolded into nested
/// `[step, arg..]` arrays, each step's `@1` dropped, an in port or a literal as itself.
fn unfold(steps: &Map<String, Value>, id: &str) -> Value {
    let Some(s) = steps.get(id) else {
        return json!(id);
    };
    let op = s["op"].as_str().unwrap_or("").trim_end_matches("@1");
    let mut node = vec![json!(op)];
    for v in s["args"].as_object().into_iter().flatten().map(|(_, v)| v) {
        node.push(match v.as_str() {
            Some(r) if steps.contains_key(r) => unfold(steps, r),
            _ => v.clone(),
        });
    }
    Value::Array(node)
}

/// The release scene3d's entries join the GPU registries in (Lands: R6 for composed graphs).
const SINCE: &str = "R6";

/// scene3d's entries in the core's GPU registries, at the seal.
pub fn register(r: &mut Registrar) {
    for (name, ty, _) in OUTPUTS {
        r.entry(
            "gpu.output@1",
            &format!("material.{name}"),
            json!({"kind": "material", "type": ty, "read_as": ty}),
            SINCE,
        );
    }
    // #485: the light loop's responses, each the radiance it reads, and the vertex offset.
    for name in ["light", "ambient", "vertex_offset"] {
        r.entry(
            "gpu.output@1",
            &format!("material.{name}"),
            json!({"kind": "material", "type": "vec3<f32>", "read_as": "vec3<f32>"}),
            SINCE,
        );
    }
    for (name, value) in defaults() {
        r.entry("gpu.function@1", name, value, SINCE);
    }
    for (name, f) in functions() {
        let steps = f["steps"].as_object().cloned().unwrap_or_default();
        let outs: Vec<&String> = f["ports"]["out"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(k, _)| k)
            .collect();
        let body = match outs.as_slice() {
            [one] => unfold(&steps, one),
            _ => Value::Array(outs.iter().map(|o| unfold(&steps, o)).collect()),
        };
        r.entry(
            "gpu.function@1",
            &name,
            json!({"signature": f["ports"], "exact": false, "body": body}),
            SINCE,
        );
    }
}

/// Whether `a` names `b` or a path under it, or the reverse, by whole segments.
fn overlaps(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim_start_matches('/'), b.trim_start_matches('/'));
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

/// Whether a channel, a driver, a control or a variant of `doc` can move the value at `path`.
fn moved(doc: &Value, path: &str) -> bool {
    let strs = |v: &Value| -> Vec<String> {
        v.as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect()
    };
    let mut paths: Vec<String> = Vec::new();
    for section in ["channels", "drivers"] {
        for (_, c) in doc[section].as_object().into_iter().flatten() {
            paths.extend(c["target"].as_str().map(String::from));
        }
    }
    for (_, c) in doc["controls"].as_object().into_iter().flatten() {
        paths.extend(strs(&c["binds"]));
        paths.extend(c["binds"].as_str().map(String::from));
    }
    for (_, set) in doc["variants"].as_object().into_iter().flatten() {
        for o in set["options"].as_array().into_iter().flatten() {
            for op in o["patch"].as_array().into_iter().flatten() {
                paths.extend(op["path"].as_str().map(String::from));
            }
        }
    }
    paths.iter().any(|p| overlaps(p, path))
}

/// The field whose lobe material `mid` of `doc` lacks for the output `output`, if it lacks it:
/// its weight, strength, amount or coat is 0 (its specular color white) and no channel, driver,
/// control or variant can move it. `None` for an output that needs no lobe or a lobe it has.
pub fn lacks(doc: &Value, mid: &str, output: &str) -> Option<&'static str> {
    let field = OUTPUTS.iter().find(|o| o.0 == output)?.2?;
    let params = &doc["items"][mid]["params"];
    let v = field.split('/').fold(params, |v, k| &v[k]);
    let on = match field {
        "specular_color" => v
            .as_array()
            .is_some_and(|c| c.iter().any(|x| x.as_f64().is_some_and(|x| x != 1.0))),
        _ => v.as_f64().is_some_and(|x| x != 0.0),
    };
    (!on && !moved(doc, &format!("items/{mid}/params/{field}"))).then_some(field)
}
