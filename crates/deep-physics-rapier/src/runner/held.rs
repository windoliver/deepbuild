//! #524: `check`'s read-back of what the backend built (tests/acceptance/524/README.md: `check`'s
//! `soft` and `backend`), taken from the backend through the interface, never from the document:
//! each soft body's shape, particles and target volume ratio, and the rigid bodies, joints, soft
//! bodies and particles the engine holds, a soft body's own hidden frames not counted.

use deep_canvas_physics::backend::Held;
use deep_canvas_physics::doc::{SoftShape, World};
use serde_json::{json, Map, Value};

/// #524: each soft body as the backend built it, read back from it (`check`'s `soft`), and what
/// the backend holds (`check`'s `backend`).
pub(super) fn held(w: &World, h: &Held) -> (Value, Value) {
    let shape = |id: &str| {
        w.soft.get(id).map(|s| match s.shape {
            SoftShape::Rope => "rope",
            SoftShape::Cloth { .. } => "cloth",
            SoftShape::Balloon { .. } => "balloon",
            SoftShape::Volume { .. } => "volume",
        })
    };
    let soft: Map<String, Value> = h.soft.iter().map(|s| {
        let ratio = s.volume_ratio.filter(|_| s.volume_held);
        (s.id.clone(), json!({"shape": shape(&s.id), "particles": s.particles, "target_volume_ratio": ratio}))
    }).collect();
    let backend = json!({"rigid_bodies": h.rigid_bodies, "joints": h.joints,
        "soft_bodies": h.soft.iter().map(|s| s.bodies).sum::<usize>(),
        "particles": h.soft.iter().map(|s| s.particles).sum::<usize>()});
    (Value::Object(soft), backend)
}
