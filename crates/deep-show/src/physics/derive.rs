//! #522: the entries a world reads off the core's input track (canvas primitives: Input track
//! entries; tests/acceptance/522/README.md: deep-show). A world input with `on: {control: ID}`
//! derives an entry from each entry of that control at the world's first step at or after its
//! flick; one with `on: {<canvas module>: item ID}` takes each entry that item fires, which its
//! module writes on the track. The physics module reads `on`'s module by name only; whether the
//! build holds it is this host's question, refused `module_missing`. Derived entries aren't
//! stored: they follow from the track and the document, so a replay applies the same ones, and
//! the bake keeps each with where it came from and the place it took as the modules wrote it.

use deep_canvas_physics::doc::{Refusal, World};
use deep_play::derive::Fired;
use serde_json::{Map, Value};

/// The entries the build's canvas modules fire in `form`, each module's in the order it writes
/// them (#1834 adds logic's).
pub(crate) fn fired(form: &Value) -> Vec<Fired> {
    #[allow(unused_mut)]
    let mut out = Vec::new();
    #[cfg(any(feature = "test-launch-module", feature = "test-launch-module-first"))]
    for e in deep_canvas_test_modules::launch::fired(form) {
        out.push(Fired {
            module: "test.launch".into(),
            item: e["item"].as_str().unwrap_or_default().into(),
            step: e["step"].as_u64().unwrap_or(0),
            kind: e["kind"].as_str().unwrap_or_default().into(),
            data: e["data"].clone(),
        });
    }
    let _ = form;
    out
}

/// `test-launch-module-first`: the other modules write a step's entries before the input
/// module's, not after.
pub(crate) const MODULES_FIRST: bool = cfg!(feature = "test-launch-module-first");

/// World `w`'s entries from the core's input track `track` and from what `form`'s canvas modules
/// fire, each as the bake keeps it, in the order they apply (the shared rule, #172).
pub(crate) fn kept(form: &Value, w: &World, track: &[Value]) -> Result<Vec<Value>, Box<Refusal>> {
    deep_play::derive::kept(w, track, &fired(form), MODULES_FIRST)
}

pub(crate) use deep_play::derive::{missing, track_of};

/// `physics_bake`: the world a presented document lists, in its scene.
pub struct Bake {
    pub doc: String,
    pub world: String,
    pub track: Vec<Value>,
}

pub fn parse(c: &Map<String, Value>) -> Option<Bake> {
    Some(Bake {
        doc: c.get("doc")?.as_str()?.into(),
        world: c.get("world")?.as_str()?.into(),
        track: c
            .get("track")
            .map_or(Some(Vec::new()), |t| t.as_array().cloned())?,
    })
}
