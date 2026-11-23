//! #290: what a `view3d` frame reports of its hidden views (Object: hidden view), and its
//! `shadow` target, which shows that they write into no shadow map.

use deep_gpu::device::Backend;
use serde_json::{json, Map, Value};

use crate::view3d::write_named;
use crate::{session3, App};

/// `frame` as the reply holds it. Under `counts`, its `draws` gain a row for each hidden-view
/// pass after the color pass's rows: `{pass: "hidden_depth", of}` and `{pass: "hidden_view",
/// of}`, one depth pass and one blended draw for each item whose hidden view is above 0. With the
/// `shadow` target, `shadow` names by SHA-256 a file of every shadow map the frame's lights
/// read, f32 depths: the key sun's cascades in order, then the local maps' layers.
pub(crate) fn reported(
    app: &App,
    out: &str,
    targets: &std::collections::BTreeSet<String>,
    counts: &deep_scene3d_render::Counts,
    mut frame: Map<String, Value>,
) -> Result<Value, Value> {
    if let Some(Value::Array(draws)) = frame.get_mut("draws") {
        for item in &counts.hidden_views {
            draws.push(json!({"pass": "hidden_depth", "of": item}));
            draws.push(json!({"pass": "hidden_view", "of": item}));
        }
    }
    if targets.contains("shadow") && app.backend != Backend::Noop {
        let texels = session3::shadows(app)?;
        frame.insert("shadow".into(), json!(write_named(out, &texels, "f32")?));
    }
    Ok(Value::Object(frame))
}
