//! #540: the net module's `net@1` kind (canvas primitives: Net `net@1`), as far as a lockstep
//! match's point entries need it: a document declares its match, so a point control's entries
//! are stamped `delay` match steps after their gesture, and `match` runs every copy over a test
//! relay in this process (`points`). Joining, the relay, rollback and the match's hashes are the
//! net module's own task (#549).

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Implementation, Manifest, Module, Range, Registrar, Semver};
use serde_json::{json, Value};

fn param(
    name: &'static str,
    ty: ParamType,
    unit: &'static str,
    default: Value,
    range: [f64; 2],
) -> Param {
    Param {
        name,
        ty,
        unit,
        default,
        min: (ty != ParamType::Str).then_some(range[0]),
        max: (ty != ParamType::Str).then_some(range[1]),
        minor: 0,
        module: "",
        operator: "",
    }
}

fn register(r: &mut Registrar) {
    let params = vec![
        param("relay", ParamType::Str, "", json!(""), [0.0, 0.0]),
        param("players", ParamType::F32, "", json!(2), [2.0, 8.0]),
        param("step_rate", ParamType::F32, "Hz", json!(60), [1.0, 240.0]),
        param("delay", ParamType::F32, "", json!(2), [0.0, 30.0]),
        param("window", ParamType::F32, "", json!(8), [0.0, 16.0]),
    ];
    let net = Entry {
        family: "",
        name: "net",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params,
        }],
        migrations: vec![],
    };
    r.kind(net, &[], "");
}

/// The net module, holding `net@1`.
pub fn module() -> Module {
    let one = Semver::parse("1.0.0").expect("a version");
    Module {
        manifest: Manifest {
            name: "net".into(),
            version: one.clone(),
            core: Range::parse("*").expect("a range"),
            depends_on: Default::default(),
            feature: "net".into(),
            license: "Apache-2.0".into(),
            implements: "net@1".into(),
            implementation: Implementation::reference("net", one),
        },
        register,
    }
}
