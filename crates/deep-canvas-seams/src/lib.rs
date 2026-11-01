//! The canvas's platform seams (issue #140; canvas primitives: Seam and backend). Each
//! platform-dependent part of the canvas sits behind one seam, and a backend is the canvas module
//! that implements it for one platform, chosen at build time. A backend's name and version enter
//! every content key and result it feeds, so results from two backends never mix.

pub mod network;

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

/// A result's `backends`: each seam that fed it and its backend.
pub fn json(backends: &[(&str, Backend)]) -> serde_json::Value {
    serde_json::Value::Object(
        backends
            .iter()
            .map(|(seam, b)| (seam.to_string(), b.json()))
            .collect(),
    )
}
