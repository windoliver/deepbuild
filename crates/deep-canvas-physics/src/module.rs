//! The physics canvas module's manifest and register call (Canvas module; issue #1920):
//! `physics@1`, whose implementation is the backend's crate, declared measured with backend_bytes
//! state (World and backend), its pins the backend and the crates under it as the build resolved
//! them, so the seal's runtime digest names them.

use std::collections::BTreeMap;

use deep_canvas::registry::{
    Equivalence, Implementation, Manifest, Module, Pin, Range, Registrar, Semver, StateClass,
};

use crate::bake::Build;

/// The module on the backend `build` names.
pub fn module(build: &Build) -> Module {
    let pins = std::iter::once(&build.backend)
        .chain(&build.pins)
        .map(|p| {
            let pin = Pin {
                version: p.version.clone(),
                features: p.features.clone(),
            };
            (p.name.clone(), pin)
        })
        .collect();
    Module {
        manifest: Manifest {
            name: "physics".into(),
            version: Semver::parse("1.0.0").expect("a version"),
            core: Range::parse("*").expect("a range"),
            depends_on: BTreeMap::new(),
            feature: "physics".into(),
            license: "Apache-2.0".into(),
            implements: "physics@1".into(),
            implementation: Implementation {
                name: build.implementation.clone(),
                version: Semver::parse(&build.version).expect("a crate's version"),
                pins,
                equivalence: Equivalence::Measured,
                state: StateClass::BackendBytes,
            },
        },
        register,
    }
}

/// The module registers no kind, array or operator yet: a world runs through its backend's
/// runner until a scene lists it (#522), so a document costs it nothing.
fn register(_: &mut Registrar) {}
