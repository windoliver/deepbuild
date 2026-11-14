//! The implementation a canvas module is of its interface (canvas primitives: Canvas module:
//! interface and implementation), and the runtime digest the seal computes over the
//! implementations whose state or results differ from one to another (Registry and seal: runtime
//! digest; issue #1920).

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{d1, Fault, SealedInterface, Semver};
use crate::canon::CanonError;

/// How an implementation's results compare with its interface's reference.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Equivalence {
    /// Every kit fixture gives the reference implementation's hashes.
    Bit,
    /// Every behavior fixture lands within the interface's tolerances.
    Measured,
}

/// What an implementation's carried state is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateClass {
    /// A documented layout any implementation of the interface reads.
    Canonical,
    /// Its crate's own bytes, which no other implementation or version loads.
    BackendBytes,
}

/// One library an implementation pins.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pin {
    pub version: String,
    pub features: Vec<String>,
}

/// The implementation a canvas module is of its interface.
#[derive(Clone, Debug)]
pub struct Implementation {
    pub name: String,
    pub version: Semver,
    /// crate → its version and features.
    pub pins: BTreeMap<String, Pin>,
    pub equivalence: Equivalence,
    pub state: StateClass,
}

impl Implementation {
    /// A bit, canonical implementation pinning nothing, as every shipped module but physics is.
    pub fn reference(name: &str, version: Semver) -> Implementation {
        Implementation {
            name: name.into(),
            version,
            pins: BTreeMap::new(),
            equivalence: Equivalence::Bit,
            state: StateClass::Canonical,
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "version": self.version.to_string(),
            "pins": self.pins.iter().map(|(k, p)| (k.clone(), json!({"version": p.version, "features": p.features}))).collect::<serde_json::Map<_, _>>(),
            "equivalence": match self.equivalence { Equivalence::Bit => "bit", Equivalence::Measured => "measured" },
            "state": match self.state { StateClass::Canonical => "canonical", StateClass::BackendBytes => "backend_bytes" },
        })
    }
}

/// The interface the planted digest that leaves the physics implementation out names.
const PHYSICS: &str = "physics@1";

/// The runtime digest (Registry and seal: runtime digest): a d1 digest over
/// `[{interface, implementation, version, pins}]`, in `interfaces`' order, which the seal sorts
/// by interface, for every implementation whose state is backend_bytes or whose equivalence is
/// measured. A seam's backend is none of `interfaces`: its name already enters every content key
/// and result it feeds. A planted `fault` leaves the physics implementation out, or hashes each
/// interface's registered shapes in place of its implementation's version and pins.
pub(super) fn runtime_digest(
    interfaces: &[SealedInterface],
    fault: Option<Fault>,
) -> Result<String, CanonError> {
    let entries = interfaces
        .iter()
        .filter(|i| {
            let m = &i.implementation;
            (m.state == StateClass::BackendBytes || m.equivalence == Equivalence::Measured)
                && !(fault == Some(Fault::RuntimeOmitsPhysics) && i.name == PHYSICS)
        })
        .map(|i| {
            if fault == Some(Fault::RuntimeOnlyShapes) {
                return json!({"interface": i.name, "digest": i.digest});
            }
            let m = i.implementation.to_json();
            json!({"interface": i.name, "implementation": m["name"], "version": m["version"], "pins": m["pins"]})
        })
        .collect();
    d1(&Value::Array(entries))
}

#[cfg(test)]
mod tests {
    use super::super::{BuildSet, Manifest, Module, Range, Registry};
    use super::*;

    /// The canvas module `module`, implementing `interface` as `<module>.engine` 1.2.3, measured
    /// with backend_bytes state and one pin.
    fn measured(module: &str, interface: &str) -> Module {
        let pin = Pin {
            version: "2.0.0".into(),
            features: vec!["f32".into()],
        };
        Module {
            manifest: Manifest {
                name: module.into(),
                version: Semver::parse("1.0.0").expect("a version"),
                core: Range::parse("*").expect("a range"),
                depends_on: BTreeMap::new(),
                feature: module.into(),
                license: "Apache-2.0".into(),
                implements: interface.into(),
                implementation: Implementation {
                    name: format!("{module}.engine"),
                    version: Semver::parse("1.2.3").expect("a version"),
                    pins: BTreeMap::from([("engine".to_string(), pin)]),
                    equivalence: Equivalence::Measured,
                    state: StateClass::BackendBytes,
                },
            },
            register: |_| {},
        }
    }

    fn entry(interface: &str, implementation: &str) -> Value {
        json!({"interface": interface, "implementation": implementation, "version": "1.2.3",
               "pins": {"engine": {"version": "2.0.0", "features": ["f32"]}}})
    }

    /// The entries sort by interface, not by the canvas module that implements each, and a
    /// seam's backend is never one of them, measured or not.
    #[test]
    fn entries_sort_by_interface_and_leave_a_seams_backend_out() {
        let sealed = Registry::new(BuildSet::Core)
            .with(measured("a", "z@1"))
            .with(measured("b", "y@1"))
            .backend(measured("seam.gpu", "seam.gpu@1"))
            .seal()
            .expect("the set seals");
        let entries = json!([entry("y@1", "b.engine"), entry("z@1", "a.engine")]);
        assert_eq!(sealed.runtime_digest, d1(&entries).expect("a digest"));
    }
}
