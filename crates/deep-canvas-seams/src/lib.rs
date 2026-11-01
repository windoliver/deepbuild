//! The canvas's platform seams (issue #140; canvas primitives: Seam and backend). Each
//! platform-dependent part of the canvas sits behind one seam, and a backend is the canvas module
//! that implements it for one platform, chosen at build time. A backend's name and version enter
//! every content key and result it feeds, so results from two backends never mix.

pub mod network;

use deep_canvas::registry::{Behavior, Implementation, Interface, Manifest, Module, Range, Semver};

/// The seams, in the order the issue's Fields list them.
pub const SEAMS: [&str; 13] = [
    "gpu",
    "surface",
    "display",
    "fonts",
    "accessibility",
    "input",
    "color",
    "codecs",
    "audio",
    "capture",
    "cpu",
    "headless",
    "network",
];

/// One backend of one seam, as every result names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Backend {
    pub name: &'static str,
    pub version: &'static str,
}

impl Backend {
    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({"name": self.name, "version": self.version})
    }
}

/// The headless seam's backend: each 2D writer layer drawn by Vello CPU.
pub const HEADLESS: Backend = Backend {
    name: "headless.vello-cpu",
    version: "0.3.0",
};

/// The CPU seam's backend: the architecture as Rust names it, which the binary reporting it
/// passes in, since a canvas crate never observes its target.
pub fn cpu(arch: &'static str) -> Backend {
    Backend {
        name: arch,
        version: "1.0.0",
    }
}

/// A backend as the seal holds it (issue #185; canvas primitives: Canvas module: interface and
/// implementation): one implementation of its seam's interface `seam.<seam>@1`, chosen at build
/// time, so a build with two backends of one seam is refused at the seal. It registers no shape a
/// document sees; its seam's conformance suite is its interface's kit. `name` is
/// `seam.<seam>` for the backend a build ships.
pub fn module(seam: &str, name: &str, backend: Backend) -> Module {
    let version = Semver::parse(backend.version).unwrap_or(Semver {
        major: 0,
        minor: 0,
        patch: 0,
    });
    Module {
        manifest: Manifest {
            name: name.into(),
            version,
            core: Range::parse("*").expect("a range"),
            depends_on: Default::default(),
            feature: name.replace('.', "-"),
            license: "Apache-2.0".into(),
            implements: format!("seam.{seam}@1"),
            implementation: Implementation::reference(backend.name, version),
        },
        register: |_| {},
    }
}

/// The interface `seam.<seam>@1`, whose reference is `reference`, the backend the macOS build
/// ships, and whose kit and behavior part are the seam's conformance suite, which runs apart
/// from the canvas kit (#140).
pub fn interface(seam: &str, reference: Module) -> Interface {
    let suite = format!("seam.{seam}.conformance");
    Interface {
        name: format!("seam.{seam}@1"),
        reference,
        kit: vec![suite.clone()],
        behavior: Some(Behavior {
            name: suite,
            fixtures: Vec::new(),
        }),
    }
}

/// A result's `backends`: each seam that fed it and its backend.
pub fn json(backends: &[(&str, Backend)]) -> serde_json::Value {
    serde_json::Value::Object(
        backends
            .iter()
            .map(|(seam, b)| (seam.to_string(), b.json()))
            .collect(),
    )
}
