//! #506: a 3D document's frame as render-back draws it, with what #506 sets in and over it. The 3D
//! frame on the GPU, each inset's content rastered here by the 2D renderer into the texels its
//! window or cast reads (straight alpha, converted once as the raster leaves its premultiplied
//! pixmap); the document's 2D items over it; each `overlay.frame@1` shown at t, its 2D frame and
//! every item in it drawn on top of the scene with the frame's top left corner at its anchor's
//! projection plus its offset (an overlay hidden at t, its `visible` off or its point behind the
//! camera, draws nothing, and its frame never draws in place); then each `overlay.view@1`, the
//! document drawn again from its camera at its rect's size, with every view overlay taken out.

use std::collections::BTreeSet;
use std::sync::Arc;

use deep_canvas_scene3d::light::Texels;
use deep_canvas_scene3d::scene::Scene;
use serde_json::{json, Map, Value};
use vello_cpu::kurbo::Affine;

use crate::hub::Hub;
use crate::snapshot::{self, Drawn, Unfit};

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
    /// `doc`'s 3D frame at `t` and `size`, each inset's picture rastered into the scene's texels
    /// first (kept by key between frames); straight RGBA and the scene it drew.
    pub(crate) fn painted3d(
        &mut self,
        doc: &Value,
        t: i64,
        size: [u16; 2],
    ) -> Result<(Vec<u8>, Scene), Unfit> {
        // Insets and view overlays the check refuses draw nothing (#506), as in view3d.
        if let Some(issue) = deep_canvas_scene3d::inset::refusals(doc).into_iter().next() {
            return Err(Unfit {
                code: "refused",
                path: issue["path"].as_str().unwrap_or("items").to_string(),
            });
        }
        let posed = crate::film::posed(doc, t);
        let doc = posed.as_ref().unwrap_or(doc);
        let palette = self.look.light.clone();
        let record = self.record();
        if self.gpu3().is_none() {
            return Err(Unfit {
                code: "gpu_unavailable",
                path: "snapshots".into(),
            });
        }
        let Some(Some(gpu)) = self.gpu3.as_mut() else {
            unreachable!("opened above");
        };
        let (renderer, kept) = (&mut self.renderer, &mut self.inset_pictures);
        let (look, evidence) = (&self.look, &self.scenario.evidence);
        let mut failed = None;
        let mut paint = |scene: &mut Scene| {
            let keys: Vec<&str> = scene.pictures.iter().map(|p| p.key.as_str()).collect();
            kept.retain(|k, _| keys.contains(&k.as_str()));
            for p in &scene.pictures {
                if !kept.contains_key(&p.key) {
                    let map = p.document.as_object().cloned().unwrap_or_default();
                    let drawn = match renderer.prepare(&map, 0, &look.light, None, &record, evidence) {
                        Ok(d) => d,
                        Err(u) => {
                            failed = Some(u);
                            return;
                        }
                    };
                    let px = p.size.map(|v| v.min(u32::from(u16::MAX)) as u16);
                    let mut rgba = renderer.raster(&drawn, px, None);
                    deep_canvas_scene3d::inset::bleed(&mut rgba, p.size);
                    let texels = Texels {
                        format: "rgba8unorm-srgb".into(),
                        size: p.size,
                        mips: 1,
                        data: Arc::new(rgba),
                    };
                    kept.insert(p.key.clone(), Arc::new(texels));
                }
                scene.texels.insert(p.key.clone(), kept[&p.key].clone());
            }
        };
        let drawn = gpu.draw_painted(doc, t, &palette, size, &mut paint)?;
        match failed {
            Some(u) => Err(u),
            None => Ok(drawn),
        }
    }

    /// `doc`'s frame at `t` and `size` with what #506 sets in and over it (see the module's note).
    /// `drawing`, where given, is the 2D items as the session's operators drew them; else the
    /// document's own 2D items are drawn.
    pub(crate) fn frame3d(
        &mut self,
        doc: &Value,
        t: i64,
        size: [u16; 2],
        drawing: Option<&crate::frames::Painted>,
    ) -> Result<Vec<u8>, Unfit> {
        let (mut rgba, scene) = self.painted3d(doc, t, size)?;
        let shown = crate::shared::drawable(doc);
        let overlays = deep_canvas_scene3d::views::framed(doc);
        let inside: BTreeSet<String> = overlays.iter().flat_map(|f| f.items.iter().cloned()).collect();
        let record = self.record();
        let mut layer = |this: &mut Hub<'_>, mut drawn: Drawn, view: Option<Affine>| {
            drawn.view = view;
            let over = this.renderer.raster(&drawn, size, None);
            snapshot::over(&mut rgba, &over);
        };
        let prepare = |this: &mut Hub<'_>, part: &Value| -> Result<Drawn, Unfit> {
            let map: &Map<String, Value> = part.as_object().expect("a document is an object");
            let look = &this.look;
            this.renderer
                .prepare(map, t, &look.light, look.status.as_ref(), &record, &this.scenario.evidence)
        };
        let base = match drawing {
            Some(d) => {
                let mut drawn = self.renderer.prepare_drawing(d, &self.scenario.evidence)?;
                for l in &mut drawn.frame.layers {
                    l.marks = l
                        .marks
                        .iter()
                        .filter(|m| {
                            let item = m.mark.item();
                            !inside.contains(item.split('#').next().unwrap_or(item))
                        })
                        .cloned()
                        .collect();
                }
                drawn
            }
            None => prepare(self, &only(&shown, |id| !inside.contains(id)))?,
        };
        layer(self, base, None);
        for f in &overlays {
            let Some(origin) = scene.overlays.iter().find(|o| o.id == f.overlay).and_then(|o| o.origin) else {
                continue;
            };
            let shift = Affine::translate((origin[0] - f.corner[0], origin[1] - f.corner[1]));
            let part = prepare(self, &only(&shown, |i| f.items.contains(i)))?;
            layer(self, part, Some(shift));
        }
        // Each view overlay: the document again from its camera, one level deep.
        let look = deep_canvas_scene3d::look::Look3::from_roles(self.look.light.clone());
        let [w, h] = size.map(u32::from);
        let placed = deep_canvas_scene3d::views::placed(doc, [w, h], Some(&look))
            .map_err(|r| Unfit { code: r.code, path: r.path })?;
        for p in placed {
            let mut sub = deep_canvas_scene3d::views::document(doc, &p);
            sub["size"] = json!([p.rect[2], p.rect[3]]);
            let rect = [p.rect[2], p.rect[3]].map(|v| v.min(u32::from(u16::MAX)) as u16);
            let picture = self.frame3d(&sub, t, rect, None)?;
            let [r, g, b] = p.border;
            deep_canvas_scene3d::views::lay(&p, &picture, &mut rgba, [w, h], [r, g, b, 255]);
        }
        Ok(rgba)
    }

    /// The view of `doc` at `t`, a 3D document, as [`Hub::frame3d`] draws it; `None` without a
    /// GPU.
    pub(crate) fn view3d(&mut self, doc: &Value, t: i64) -> Result<Option<(Vec<u8>, [u16; 2])>, Value> {
        let size = snapshot::px([0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(1.0)));
        match self.frame3d(doc, t, size, None) {
            Ok(rgba) => Ok(Some((rgba, size))),
            Err(u) if u.code == "gpu_unavailable" => Ok(None),
            Err(u) => Err(json!({"code": u.code, "path": u.path})),
        }
    }
}
