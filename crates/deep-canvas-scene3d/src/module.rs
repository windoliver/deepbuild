//! The scene3d canvas module (technical design: Canvas modules, the module table's scene3d row),
//! registered through the registry and seal (#305): its manifest, its R2 subset's kinds (Marks in
//! 3D) and the two passes its render module adds to the frame, the geometry of its 3D writer
//! layers and the output pass that tone-maps and encodes them. A build without it refuses a
//! document holding one of these kinds with `module_missing`, and so does a camera that sets
//! `near` or `far`, which the core's camera entry already names as scene3d's.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver};
use deep_canvas::schedule::{Canonical, OpError, Val, View};
use serde_json::{json, Value};

use crate::light::{self, Tie};

/// The pass that draws every 3D writer layer's batches into the linear, object-ID and depth
/// targets.
pub const GEOMETRY_PASS: &str = "scene3d.geometry";
/// The one pass that writes the final frame: exposure, tone map and the sRGB encode.
pub const OUTPUT_PASS: &str = "scene3d.output";
/// #465: the mirror's pass, its view and its picture over the mirror's parts, after the geometry.
pub const MIRROR_PASS: &str = "scene3d.mirror";
/// #465: the flare, added into the linear image before tone mapping.
pub const FLARE_PASS: &str = "scene3d.flare";
/// #166: the water's parts, drawn after the geometry and the mirror's view.
pub const WATER_PASS: &str = "scene3d.water";
/// The key light's shadow map: the solids' vertex stage under the light's clip matrix, depth
/// only (the core's shadow pass, in the frame's shadows place).
pub const SHADOW_PASS: &str = "scene3d.shadow";
/// The key sun's cascades (#422; Light policy: cascades): one depth layer each, by the shadow
/// pass's steps.
pub const CASCADE_PASS: &str = "scene3d.cascade";
/// One face of a local light's shadow map (#446; Light policy: local shadows), by the shadow
/// pass's steps.
pub const LOCAL_SHADOW_PASS: &str = "scene3d.local_shadow";
/// Instancers above 256 elements culled per view and per shadow map on the GPU (#484; Instance
/// `instance@1`), the core's own compute pass before the frame's draws.
pub const CULL_PASS: &str = "scene3d.cull";
/// The camera's occluders drawn depth-only, the depth pyramid built from them and the occlusion
/// test of the camera's lists against it (#1637; Instance `instance@1`), each frame, from that
/// frame's depth alone, after the cull and before anything draws.
pub const PYRAMID_PASS: &str = "scene3d.depth_pyramid";
/// Ambient occlusion (#418; Look `look@1`: ao): the opaque solids' depth and normal prepass, the
/// occlusion and its blur, before the geometry pass reads it; drawn only while the look has ao on.
pub const AO_PASS: &str = "scene3d.ao";
/// The object-ID target's writes: each draw's pick ID where it covers at least half the pixel.
/// They run inside the geometry pass's draws, which carry their time and the target's bytes; the
/// registry lists them apart so the steps they compile from resolve at the seal (#200).
pub const OBJECT_ID_PASS: &str = "scene3d.object_id";
/// The `gpu.step@1` steps the shadow pass compiles from (scene3d.wgsl's `mesh_vs`): each row of
/// the instance's world matrix dotted with the vertex plus its offset, the camera's clip matrix
/// times the world point (#200).
pub const SHADOW_STEPS: &[&str] = &["camera@1", "compose@1", "dot@1", "add@1", "mul@1"];
/// The steps the object-ID writes compile from: the pick ID selected where coverage is at least
/// one half (scene3d.wgsl's `line_fs`, `point_fs` and `text_fs`).
pub const OBJECT_ID_STEPS: &[&str] = &["ge@1", "select@1"];

fn manifest() -> Manifest {
    Manifest {
        name: "scene3d".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [(
            "motion".to_string(),
            Dependency {
                range: Range::parse("^1").expect("a range"),
                optional: false,
            },
        )]
        .into_iter()
        .collect(),
        feature: "scene3d".into(),
        license: "Apache-2.0".into(),
        implements: "scene3d@1".into(),
        implementation: deep_canvas::registry::Implementation::reference(
            "scene3d",
            deep_canvas::registry::Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

/// The scene3d module.
pub fn module() -> Module {
    Module {
        manifest: manifest(),
        register,
    }
}

fn param(name: &'static str, ty: ParamType, default: Value) -> Param {
    Param {
        name,
        ty,
        unit: "",
        default,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn json_param(name: &'static str) -> Param {
    param(name, ParamType::Json, Value::Null)
}

fn str_param(name: &'static str, default: &str) -> Param {
    param(name, ParamType::Str, json!(default))
}

fn kind(name: &'static str, params: Vec<Param>) -> Entry {
    Entry {
        family: "mark",
        name,
        versions: vec![Version {
            major: 1,
            minor: 0,
            params,
        }],
        migrations: Vec::new(),
    }
}

/// What every mark in 3D carries (Marks in 3D: common fields), with `open`, the deeper document
/// it loads by reference once it is large enough on screen (Level of detail; #383).
fn common(mut params: Vec<Param>) -> Vec<Param> {
    params.push(str_param("size_space", "screen"));
    params.push(json_param("paint"));
    params.push(json_param("status"));
    params.push(json_param("open"));
    params
}

fn register(r: &mut Registrar) {
    register_with(r, Tie::Id);
}

/// The view's light policy as the module evaluates it (Light and the light policy; #421): the
/// lights it shades, each with its weight, and the ones its budget left out, by ID. The kit's
/// `bit` part compares it with the reference's, so an implementation of scene3d@1 that ranks
/// lights another way fails, naming the fixture and this array.
#[derive(Clone, Debug, PartialEq)]
pub struct Lit {
    pub shaded: Vec<(String, f64)>,
    pub left_out: Vec<String>,
}

impl Canonical for Lit {
    fn encode(&self, out: &mut Vec<u8>) {
        self.shaded.encode(out);
        self.left_out.encode(out);
    }
}

/// A document with a light.
fn has_light(doc: &Value, _: &str, _: &Value) -> bool {
    doc.get("items")
        .and_then(Value::as_object)
        .is_some_and(|items| {
            items.values().any(|i| {
                i.get("kind")
                    .and_then(Value::as_str)
                    .is_some_and(|k| k.starts_with("light.") && !k.starts_with("light.probe@"))
            })
        })
}

/// The document's scene at t under the session's look, and its light policy at its camera,
/// ties broken by `tie`.
fn lit(v: &mut View<'_>, tie: Tie) -> Result<(), OpError> {
    let t = v.t()?;
    let roles = v
        .look()?
        .iter()
        .filter_map(|(role, c)| {
            let c: Vec<u8> = c
                .as_array()?
                .iter()
                .filter_map(|x| x.as_u64().and_then(|x| u8::try_from(x).ok()))
                .collect();
            Some((role.clone(), <[u8; 3]>::try_from(c.as_slice()).ok()?))
        })
        .collect();
    let doc = v.document()?;
    let look = crate::look::Look3::from_roles(roles);
    let scene = crate::scene::evaluate(doc, t, &look, &mut crate::scene::Labels::new())
        .map_err(|r| OpError::new(r.code, r.path))?;
    let policy = light::policy_by(&scene.lights, &scene.camera, tie);
    v.write(
        "scene3d.lights",
        Val::typed(Lit {
            shaded: policy
                .shaded
                .iter()
                .map(|&(i, w)| (scene.lights[i].id.clone(), w))
                .collect(),
            left_out: policy.left_out,
        }),
    )
}

fn lit_by_id(v: &mut View<'_>) -> Result<(), OpError> {
    lit(v, Tie::Id)
}

fn lit_by_order(v: &mut View<'_>) -> Result<(), OpError> {
    lit(v, Tie::Order)
}

/// scene3d's registration with its light policy breaking ties by `tie`: by ID in the shipped
/// module, by registration order in #421's planted implementation of scene3d@1.
pub fn register_with(r: &mut Registrar, tie: Tie) {
    for solid in ["box", "cylinder", "sphere"] {
        r.kind(kind(solid, common(vec![json_param("size")])), &[], "");
    }
    r.kind(
        kind(
            "line",
            common(vec![
                json_param("points"),
                str_param("mode", "strip"),
                json_param("width"),
                json_param("dash"),
                json_param("ends"),
                json_param("cap"),
                json_param("join"),
                // A line of a mesh's edges in place of points (Marks in 3D: mesh edges; #420).
                json_param("edges"),
            ]),
        ),
        &[],
        "",
    );
    r.kind(
        kind(
            "point",
            common(vec![json_param("size"), str_param("shape", "dot")]),
        ),
        &[],
        "",
    );
    r.kind(
        kind(
            "text",
            common(vec![
                str_param("text", ""),
                str_param("font", "body"),
                json_param("size"),
                str_param("facing", "camera"),
            ]),
        ),
        &[],
        "",
    );
    // The key light (Light and the light policy): it shines along its local −Z, shades the solids
    // and, with `shadow`, casts the shadow map.
    r.kind(
        Entry {
            family: "light",
            name: "sun",
            // Minor 1 (#421): a color temperature and a flicker channel. Minor 2 (#422): its
            // shadow's cascades (Light policy: cascades).
            versions: vec![Version {
                major: 1,
                minor: 2,
                params: vec![
                    param("illuminance", ParamType::Json, json!(10_000)),
                    param("shadow", ParamType::Json, json!(false)),
                    param("angle", ParamType::Json, json!(0.53)),
                    json_param("color"),
                    param("priority", ParamType::Json, json!(0)),
                    Param {
                        minor: 1,
                        ..json_param("temperature")
                    },
                    Param {
                        minor: 1,
                        ..json_param("flicker")
                    },
                    Param {
                        minor: 2,
                        ..param("cascades", ParamType::Json, json!(3))
                    },
                    Param {
                        minor: 2,
                        ..param("split", ParamType::Json, json!(0.5))
                    },
                    Param {
                        minor: 2,
                        ..param("shadow_far", ParamType::Json, json!("auto"))
                    },
                    Param {
                        minor: 2,
                        ..param("fade", ParamType::Json, json!(true))
                    },
                ],
            }],
            migrations: Vec::new(),
        },
        &[],
        "",
    );
    // The trusted builders and the curve, named bare as the design names them, with their
    // build, mark and shade operators (Builder; Curve `curve@1`; #420).
    for spec in crate::spec::scene3d() {
        if crate::builders::KINDS.contains(&spec.kind) || spec.kind == "curve@1" {
            let name = &spec.kind[..spec.kind.len() - "@1".len()];
            r.kind(crate::spec::entry(&spec, "", name), &[], "");
        }
        if spec.kind == "mesh.asset@1" {
            r.kind(crate::spec::entry(&spec, "mesh", "asset"), &[], "");
        }
        // The local and area lights and the material (#421).
        for (kind, family, name) in [
            ("light.point@1", "light", "point"),
            ("light.spot@1", "light", "spot"),
            ("light.area@1", "light", "area"),
            ("light.probe@1", "light", "probe"),
            ("material@1", "", "material"),
            ("sky@1", "", "sky"),
            ("puff@1", "", "puff"),
        ] {
            if spec.kind == kind {
                r.kind(crate::spec::entry(&spec, family, name), &[], "");
            }
        }
    }
    // #424: the cutaway and the instancer, read by the scene as data.
    for (kind, name) in [
        ("cutaway@1", "cutaway"),
        ("instance@1", "instance"),
        ("effect@1", "effect"),
    ] {
        if let Some(spec) = crate::spec::of(kind) {
            r.kind(crate::spec::entry(&spec, "", name), &[], "");
        }
    }
    // #419's stand-in for the physics module's baked world, which the scene draws body by body
    // (#405: a document's checks reach it as a kind this module knows).
    r.kind(
        Entry {
            family: "fixture",
            name: "world",
            versions: vec![Version {
                major: 1,
                minor: 0,
                params: ["step_hz", "span", "gravity", "floor", "restitution", "bodies", "buoyancy", "inputs", "paint"]
                    .into_iter()
                    .map(json_param)
                    .collect(),
            }],
            migrations: Vec::new(),
        },
        &[],
        "",
    );
    crate::build::register_scene3d(r);
    // A solid's modifier stack, every prefix kept by its content key (Modifier; #411).
    r.array("scene3d.stack", "stack", "item", "geometry", "items");
    r.operator("stack", "items", &["self"], &["scene3d.stack"])
        .applies(crate::modifiers::has_modifiers)
        .run(crate::modifiers::stack);
    r.array("scene3d.lights", "lights", "document", "shading", "items");
    r.operator(
        "lights",
        "items",
        &["refs", "t", "look"],
        &["scene3d.lights"],
    )
    .document()
    .applies(has_light)
    .run(match tie {
        Tie::Id => lit_by_id,
        Tie::Order => lit_by_order,
    });
    r.pass(CULL_PASS, "compute");
    r.pass(PYRAMID_PASS, "compute");
    r.pass(AO_PASS, "geometry");
    r.pass(GEOMETRY_PASS, "geometry");
    // #200: the shadow and object-ID passes compile from the core's base steps, which the seal
    // resolves in gpu.step@1, so a build without effects still has every step they need.
    r.pass(SHADOW_PASS, "shadows").pass_steps(SHADOW_STEPS);
    // #422: the key sun's cascades, drawn by the shadow pass's own steps, one layer each.
    r.pass(CASCADE_PASS, "shadows").pass_steps(SHADOW_STEPS);
    r.pass(LOCAL_SHADOW_PASS, "shadows")
        .pass_steps(SHADOW_STEPS);
    r.pass(OBJECT_ID_PASS, "geometry")
        .pass_steps(OBJECT_ID_STEPS);
    r.pass(MIRROR_PASS, "geometry");
    r.pass(WATER_PASS, "geometry");
    r.pass(FLARE_PASS, "bloom");
    r.pass(OUTPUT_PASS, "tone_mapping");
    // Headless, the kit proves what reaches the check: the figure's kinds and fields pass it
    // with no issue. Its pixels need the GPU, and the acceptance suite draws them there.
    r.fixture("figure", figure(), None).sidecar(json!({
        "codes": [],
        "covers": {
            "kinds": ["mark.box@1", "mark.cylinder@1", "mark.line@1", "mark.text@1"],
            "fields": [
                "mark.box@1/params/size", "mark.box@1/params/paint",
                "mark.line@1/params/points", "mark.line@1/params/width",
                "mark.text@1/params/text", "mark.text@1/params/size", "mark.text@1/params/size_space",
            ],
        },
    }));
    // Two more suns than the light policy shades, all of one score, registered against their
    // IDs' order: the policy keeps the first 32 by ID, so one that breaks the tie by registration
    // order keeps others (#421).
    r.fixture("lights", lights(), None).sidecar(json!({
        "codes": [],
        "covers": {"kinds": ["light.sun@1"], "fields": ["light.sun@1/params/illuminance"]},
    }));
    // A solid under a modifier stack, so the stack's operator has a node the kit evaluates (#411).
    r.fixture("stack", stack(), None).sidecar(json!({
        "codes": [],
        "covers": {"kinds": ["mark.box@1"], "fields": ["mark.box@1/params/size"]},
    }));
    // #486: the lobe outputs, occlusion and normal in gpu.output@1, core.bump@1 in gpu.function@1.
    crate::gpu::register(r);
}

/// 34 suns of 10,000 lx each, `s00` to `s33`, ordered last ID first.
fn lights() -> Value {
    let mut items = serde_json::Map::new();
    items.insert(
        "cam".into(),
        json!({"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
               "params": {"projection": "isometric", "target": [0, 0, 0], "view_width": 6}}),
    );
    for n in 0..light::SHADED + 2 {
        let id = format!("s{n:02}");
        items.insert(
            id.clone(),
            json!({"id": id, "kind": "light.sun@1", "name": format!("Sun {n}"),
                   "order": format!("b{:02}", light::SHADED + 1 - n),
                   "params": {"illuminance": 10_000}}),
        );
    }
    json!({
        "format": 1, "profile": "figure", "title": "Tied suns",
        "description": "Thirty-four suns of one illuminance under an isometric camera, ordered against their IDs.",
        "size": [480, 360], "camera": "cam", "requires": {"modules": {"scene3d": "^1"}},
        "items": items
    })
}

/// A box under a subdivide, an array of three and a mirror: 26 × 3 × 2 vertices after the stack.
fn stack() -> Value {
    json!({
        "format": 1, "profile": "figure", "title": "A stacked hull",
        "description": "A box subdivided once, arrayed three times along x and mirrored across x.",
        "size": [480, 360], "camera": "cam", "requires": {"modules": {"scene3d": "^1"}},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                    "params": {"projection": "isometric", "target": [0, 0, 0], "view_width": 12}},
            "hull": {"id": "hull", "kind": "mark.box@1", "name": "Hull", "order": "a1",
                     "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "accent"}}},
                     "modifiers": [
                         {"kind": "mod.subdivide@1", "params": {"levels": 1}},
                         {"kind": "mod.array@1", "params": {"count": 3, "offset": [1.5, 0, 0]}},
                         {"kind": "mod.mirror@1", "params": {"axes": ["x"]}}
                     ]}
        }
    })
}

/// The module's fixture: a small isometric figure, a box and a cylinder joined by a wire, with a
/// label that faces the camera.
fn figure() -> Value {
    json!({
        "format": 1, "profile": "figure", "title": "Two parts and a wire",
        "description": "A box and a cylinder under an isometric camera, a wire between them and a label over the box.",
        "size": [480, 360], "camera": "cam", "requires": {"modules": {"scene3d": "^1"}},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                    "params": {"projection": "isometric", "target": [0, 0.5, 0], "view_width": 6}},
            "block": {"id": "block", "kind": "mark.box@1", "name": "Block", "order": "a1",
                      "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "accent"}}},
                      "at": {"pos": [-1, 0.5, 0]}},
            "drum": {"id": "drum", "kind": "mark.cylinder@1", "name": "Drum", "order": "a2",
                     "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "muted"}}},
                     "at": {"pos": [1, 0.5, 0]}},
            "wire": {"id": "wire", "kind": "mark.line@1", "name": "Wire", "order": "a3",
                     "params": {"points": ["block", "drum"], "width": [2, 4], "paint": {"fill": {"role": "ink"}}}},
            "tag": {"id": "tag", "kind": "mark.text@1", "name": "Tag", "order": "a4",
                    "params": {"text": "Block", "size": 0.3, "size_space": "world", "paint": {"fill": {"role": "ink"}}},
                    "at": {"pos": [-1, 1.4, 0]}}
        }
    })
}
