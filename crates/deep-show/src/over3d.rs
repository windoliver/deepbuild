//! #506: a 3D panel's view as render-back draws it, with its overlays. The 3D frame on the GPU;
//! the document's 2D items over it; then each `overlay.frame@1` shown at t, its 2D frame and every
//! item in it drawn on top of the scene with the frame's top left corner at its anchor's
//! projection plus its offset. An overlay hidden at t (its `visible` off, as a view-class control
//! binds it, or its point behind the camera) draws nothing; its frame never draws in place.

use std::collections::BTreeSet;

use serde_json::{Map, Value};
use vello_cpu::kurbo::Affine;

use crate::hub::Hub;
use crate::snapshot;

/// `doc` with only the 2D items `keep` says: what the 2D raster draws over the 3D frame.
fn only(doc: &Value, keep: impl Fn(&str) -> bool) -> Value {
    let mut out = doc.clone();
    if let Some(items) = out.get_mut("items").and_then(Value::as_object_mut) {
        items.retain(|id, item| {
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            keep(id) && deep_canvas_marks::scene::KINDS.contains(&kind)
        });
    }
    out
}

impl Hub<'_> {
    /// The view of `doc` at `t`, a 3D document: its frame, the 2D items of `drawn` (the items
    /// this build draws) over it, and its overlays on top (see the module's note); `None` without
    /// a GPU.
    pub(crate) fn view3d(
        &mut self,
        doc: &Value,
        drawn: &Value,
        t: i64,
    ) -> Result<Option<(Vec<u8>, [u16; 2])>, Value> {
        let size = snapshot::px([0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(1.0)));
        let palette = self.look.light.clone();
        let posed = crate::film::posed(doc, t);
        let doc = posed.as_ref().unwrap_or(doc);
        let Some(gpu) = self.gpu3() else {
            return Ok(None);
        };
        let (mut rgba, scene) = gpu
            .draw(doc, t, &palette, size)
            .map_err(|u| serde_json::json!({"code": u.code, "path": u.path}))?;
        let overlays = deep_canvas_scene3d::views::framed(doc);
        let inside: BTreeSet<&str> = overlays.iter().flat_map(|f| f.items.iter().map(String::as_str)).collect();
        let mut layer = |this: &mut Hub<'_>, part: &Value, view: Option<Affine>| -> Result<(), Value> {
            let map: &Map<String, Value> = part.as_object().expect("a document is an object");
            let mut drawn = this
                .renderer
                .prepare(map, t, &this.look.light, this.look.status.as_ref(), &this.record(), &this.scenario.evidence)
                .map_err(|u| serde_json::json!({"code": u.code, "path": u.path}))?;
            drawn.view = view;
            let over = this.renderer.raster(&drawn, size, None);
            snapshot::over(&mut rgba, &over);
            Ok(())
        };
        layer(self, &only(drawn, |id| !inside.contains(id)), None)?;
        for f in &overlays {
            let Some(origin) = scene.overlays.iter().find(|o| o.id == f.overlay).and_then(|o| o.origin) else {
                continue;
            };
            let shift = Affine::translate((origin[0] - f.corner[0], origin[1] - f.corner[1]));
            layer(self, &only(drawn, |i| f.items.contains(i)), Some(shift))?;
        }
        Ok(Some((rgba, size)))
    }
}
