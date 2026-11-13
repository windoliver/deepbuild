//! The sandbox canvas module's manifest and register call (Canvas module; #238): `sandbox@1`, bit
//! and canonical, on core alone, its implementation pinning the wasmtime the app runs.

use std::collections::BTreeMap;

use deep_canvas::registry::{
    Equivalence, Implementation, Manifest, Module, Pin, Range, Registrar, Semver, StateClass,
};

/// The interface this module implements.
pub const INTERFACE: &str = "sandbox@1";
/// The wasmtime the shipped implementation pins, and the features it builds with.
pub const WASMTIME: &str = "=49.0.5";
pub const WASMTIME_FEATURES: [&str; 4] = ["addr2line", "cranelift", "runtime", "std"];

/// The shipped module.
pub fn module() -> Module {
    implementation("sandbox", WASMTIME)
}

/// The sandbox module as the implementation `name`, pinning wasmtime at `wasmtime`.
pub fn implementation(name: &str, wasmtime: &str) -> Module {
    let mut pins = BTreeMap::new();
    pins.insert(
        "wasmtime".to_string(),
        Pin {
            version: wasmtime.into(),
            features: WASMTIME_FEATURES.iter().map(|f| f.to_string()).collect(),
        },
    );
    Module {
        manifest: Manifest {
            name: "sandbox".into(),
            version: Semver::parse("1.0.0").expect("a version"),
            core: Range::parse("*").expect("a range"),
            depends_on: BTreeMap::new(),
            feature: "sandbox".into(),
            license: "Apache-2.0".into(),
            implements: INTERFACE.into(),
            implementation: Implementation {
                name: name.into(),
                version: Semver::parse("1.0.0").expect("a version"),
                pins,
                equivalence: Equivalence::Bit,
                state: StateClass::Canonical,
            },
        },
        register,
    }
}

/// The module registers no kind, array or operator: it runs programs only at check, for the items,
/// packs and registries that name one, so a document that names none costs it nothing. It fills
/// the core's `data.layout@1` with the first-party layouts, whose validators it runs (#415).
fn register(r: &mut Registrar) {
    for l in crate::layouts::first_party() {
        r.entry("data.layout@1", l.name, l.entry(), "R6");
    }
}
