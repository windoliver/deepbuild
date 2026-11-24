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
pub(crate) fn only(doc: &Value, keep: impl Fn(&str) -> bool) -> Value {
    let mut out = doc.clone();
    if let Some(items) = out.get_mut("items").and_then(Value::as_object_mut) {
        items.retain(|id, item| {
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            keep(id) && deep_canvas_marks::scene::KINDS.contains(&kind)
        });
    }
    out
}

/// #298: `doc` with the view values its drivers read at t bound on it for a frame of `size`
/// (Overlay: clamped to the edge), as `view3d` binds them, so the 3D frame and the 2D raster of
/// an overlay's own items read one `edge` and `edge_angle`; none where no driver reads one.
fn edged(doc: &Value, t: i64, size: [u16; 2]) -> Result<Option<Value>, Unfit> {
    use deep_canvas_scene3d::scene::{bound, view_values, Refused};
    let unfit = |r: Refused| Unfit {
        code: r.code,
        path: r.path,
    };
    let reads = |d: &Value| {
        let vars = d.get("vars").and_then(Value::as_object);
        let mut names = vars.into_iter().flatten().filter_map(|(_, v)| v.as_str());
        names.any(|v| v.ends_with(".edge") || v.ends_with(".edge_angle"))
    };
    let drivers = doc.get("drivers").and_then(Value::as_object);
    if !drivers.into_iter().flatten().any(|(_, d)| reads(d)) {
        return Ok(None);
    }
    // The values are the frame's: its size is the one the camera projects onto.
    let mut sized = doc.clone();
    sized["size"] = json!(size);
    let values = view_values(&sized, t, None).map_err(unfit)?;
    if values.is_empty() {
        return Ok(None);
    }
    let mut out = bound(&sized, t, &values).map_err(unfit)?;
    if let Some(o) = out.as_object_mut() {
        match doc.get("size") {
            Some(own) => o.insert("size".into(), own.clone()),
            None => o.remove("size"),
        };
    }
    Ok(Some(out))
}

impl Hub<'_> {
    /// Each picture `scene` draws (an inset's, or a module's mark's, #2450), rastered into its
    /// texels under its key and kept by key between frames.
    pub(crate) fn paint_pictures(&mut self, scene: &mut Scene) -> Result<(), Unfit> {
        let record = self.record();
        let keys: Vec<String> = scene.pictures.iter().map(|p| p.key.clone()).collect();
        self.inset_pictures.retain(|k, _| keys.contains(k));
        for p in &scene.pictures {
            if !self.inset_pictures.contains_key(&p.key) {
                // #2450: a pictured module's item draws as the core kind its module registered, a
                // vector's outline imported again at its picture's size.
                let mut form = (*p.document).clone();
                self.inline_vectors(&mut form);
                let sealed = &self.startup.sealed;
                let items = form.get_mut("items").and_then(Value::as_object_mut);
                for item in items.into_iter().flat_map(|m| m.values_mut()) {
                    let kind = item["kind"].as_str().unwrap_or("").to_string();
                    if let (Some(core), Some(draw)) =
                        (sealed.draws_as(&kind), sealed.draw_of(&kind))
                    {
                        item["params"] = draw(&item["params"]);
                        item["kind"] = json!(core);
                    }
                }
                let map = form.as_object().cloned().unwrap_or_default();
                let drawn = self.renderer.prepare(
                    &map,
                    0,
                    &self.look.light,
                    None,
                    &record,
                    &self.scenario.evidence,
                )?;
                let px = p.size.map(|v| v.min(u32::from(u16::MAX)) as u16);
                let mut rgba = self.renderer.raster(&drawn, px, None);
                deep_canvas_scene3d::inset::bleed(&mut rgba, p.size);
                let texels = Texels {
                    format: "rgba8unorm-srgb".into(),
                    size: p.size,
                    mips: 1,
                    data: Arc::new(rgba),
                };
                self.inset_pictures.insert(p.key.clone(), Arc::new(texels));
            }
            scene
                .texels
                .insert(p.key.clone(), self.inset_pictures[&p.key].clone());
        }
        Ok(())
    }

    /// `doc`'s 3D frame at `t` and `size`, its pictures in the scene's texels
    /// ([`Hub::paint_pictures`]); straight RGBA and the scene it drew.
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
        let frame = self.evaluate3d(doc, t, size)?;
        let rgba = self
            .gpu3()
            .and_then(|g| g.draw(&frame))
            .ok_or_else(|| Unfit {
                code: "unsupported_platform",
                path: String::new(),
            })?;
        Ok((rgba, frame.staged.scene))
    }

    /// #3017: `doc`'s 3D frame at `t` and `size` ([`Hub::painted3d`]) with its visible table,
    /// read from the object-ID pass that frame drew. Under the planted `visible_table_as_boxes`
    /// nothing is read; under `visible_picks_before_cutaway` the frame is drawn again without its
    /// cutaway for its picks.
    pub(crate) fn shown3d(
        &mut self,
        doc: &Value,
        t: i64,
        size: [u16; 2],
    ) -> Result<(Vec<u8>, crate::scene3d::Shown, Scene), Unfit> {
        use crate::scene3d::{Shown, AS_BOXES, BEFORE_CUTAWAY};
        let edged = edged(doc, t, size)?;
        let doc = edged.as_ref().unwrap_or(doc);
        let (rgba, scene) = self.painted3d(doc, t, size)?;
        let plant = self.scenario.module_planted.clone();
        let plant = plant.as_deref();
        if plant == Some(AS_BOXES) {
            let shown = Shown::of_boxes(scene.boxes(), size);
            return Ok((rgba, shown, scene));
        }
        let unfit = || Unfit {
            code: "unsupported_platform",
            path: String::new(),
        };
        let targets = if plant == Some(BEFORE_CUTAWAY) {
            let posed = crate::film::posed(doc, t);
            let mut uncut = self.evaluate3d(posed.as_ref().unwrap_or(doc), t, size)?;
            uncut.staged.scene.set_cutaway(None);
            let gpu = self.gpu3().ok_or_else(unfit)?;
            gpu.draw_scene(&uncut, false).ok_or_else(unfit)?.1
        } else {
            let gpu = self.gpu3().ok_or_else(unfit)?;
            gpu.targets(size.map(u32::from), false).ok_or_else(unfit)?
        };
        let shown = targets.shown(scene.boxes(), size, plant);
        Ok((rgba, shown, scene))
    }

    /// #1722: `doc`'s 2D items as render-back, and a shared document's presenting, draw them over
    /// its 3D frame, prepared from the revision itself in the look it names (a sole writer's
    /// presenting draws its session's drawing of the same items); `None` when it has none.
    pub(crate) fn items2d(&mut self, doc: &Value, t: i64) -> Result<Option<Drawn>, Unfit> {
        let flat = only(&crate::shared::drawable(doc), |_| true);
        let items = flat.get("items").and_then(Value::as_object);
        if items.is_none_or(Map::is_empty) {
            return Ok(None);
        }
        let record = self.record();
        let named = self.look_of(doc);
        let look = named.as_ref().unwrap_or(&self.look);
        self.renderer
            .prepare(
                flat.as_object().expect("a document is an object"),
                t,
                &look.light,
                look.status.as_ref(),
                &record,
                &self.scenario.evidence,
            )
            .map(Some)
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
        let edged = edged(doc, t, size)?;
        let doc = edged.as_ref().unwrap_or(doc);
        let (mut rgba, scene) = self.painted3d(doc, t, size)?;
        let shown = crate::shared::drawable(doc);
        let overlays = deep_canvas_scene3d::views::framed(doc);
        let inside: BTreeSet<String> = overlays
            .iter()
            .flat_map(|f| f.items.iter().cloned())
            .collect();
        let record = self.record();
        let mut layer = |this: &mut Hub<'_>, mut drawn: Drawn, view: Option<Affine>| {
            drawn.view = view;
            let over = this.renderer.raster(&drawn, size, None);
            snapshot::over(&mut rgba, &over);
        };
        let prepare = |this: &mut Hub<'_>, part: &Value| -> Result<Drawn, Unfit> {
            let map: &Map<String, Value> = part.as_object().expect("a document is an object");
            let look = &this.look;
            this.renderer.prepare(
                map,
                t,
                &look.light,
                look.status.as_ref(),
                &record,
                &this.scenario.evidence,
            )
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
            let Some(origin) = scene
                .overlays
                .iter()
                .find(|o| o.id == f.overlay)
                .and_then(|o| o.origin)
            else {
                continue;
            };
            let shift = Affine::translate((origin[0] - f.corner[0], origin[1] - f.corner[1]));
            let part = prepare(self, &only(&shown, |i| f.items.contains(i)))?;
            layer(self, part, Some(shift));
        }
        // Each view overlay: the document again from its camera, one level deep.
        let look = self.look3(doc)?.look;
        let [w, h] = size.map(u32::from);
        let placed =
            deep_canvas_scene3d::views::placed(doc, [w, h], Some(&look)).map_err(|r| Unfit {
                code: r.code,
                path: r.path,
            })?;
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
    #[allow(clippy::type_complexity)]
    pub(crate) fn view3d(
        &mut self,
        doc: &Value,
        t: i64,
    ) -> Result<Option<(Vec<u8>, [u16; 2])>, Value> {
        let size = snapshot::px([0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(1.0)));
        match self.frame3d(doc, t, size, None) {
            Ok(rgba) => Ok(Some((rgba, size))),
            Err(u) if u.code == "unsupported_platform" => Ok(None),
            Err(u) => Err(json!({"code": u.code, "path": u.path})),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #298: a tag on a post near the frame's right side, and an arrow in it a driver turns by
    /// the tag's `edge_angle`. The post's top projects 0.9 of the half width right of the center.
    fn tagged(vars: Value) -> Value {
        let item = |kind: &str, order: &str, params: Value| json!({"kind": kind, "order": order, "params": params});
        let cam = json!({"projection": "perspective", "position": [0, 0, 9.6], "target": [0, 0, 0], "fov": 90, "near": 0.05, "far": 500});
        let mut post = item("mark.box@1", "a1", json!({"size": [0.6, 2.4, 0.6]}));
        post["at"] = json!({"pos": [8.64, 1.2, 0]});
        let mut arrow = item("path@1", "a4", json!({"d": "M -16 -14 L 16 0 L -16 14 Z"}));
        arrow["parent"] = json!("tag-frame");
        arrow["at"] = json!({"pos": [24, 24, 0], "rot": [0, 0, 0]});
        let tag = json!({"frame": "tag-frame", "anchor": {"item": "post", "point": [0, 1.2, 0]}, "offset": [-24, -24], "hide": "clamp"});
        json!({"size": [320, 180], "camera": "cam", "safe": 48, "transport": {"span": "1s"},
            "items": {"cam": item("camera@1", "a0", cam), "post": post, "tag-frame": item("frame@1", "a2", json!({"box": [0, 0, 48, 48]})),
                "tag": item("overlay.frame@1", "a3", tag), "arrow": arrow},
            "drivers": {"turn": {"target": "items/arrow/at/rot/2", "expr": "a", "vars": vars}}})
    }

    #[test]
    fn a_frame_binds_the_edge_values_its_drivers_read_at_the_frames_own_size() {
        let doc = tagged(json!({"a": "tag.edge_angle"}));
        let bound = |size| {
            edged(&doc, 0, size)
                .expect("it evaluates")
                .expect("a driver reads it")
        };
        // On 1920 x 1080 the top projects to (1824, 300), inside the safe frame: the tag rests on
        // it, and its arrow turns toward it, atan2(-240, 864) = 344.476 deg.
        let wide = bound([1920, 1080]);
        assert_eq!(
            wide["size"],
            json!([320, 180]),
            "the document keeps its own size"
        );
        assert_eq!(wide["items"]["tag"]["edge"], json!(0));
        let turn = wide["items"]["arrow"]["at"]["rot"][2]
            .as_f64()
            .expect("the arrow's turn");
        assert!((turn - 344.4759).abs() < 1e-3, "{turn}");
        // On 320 x 180 it projects to (304, 50), past the 48 px margin: clamped.
        assert_eq!(bound([320, 180])["items"]["tag"]["edge"], json!(1));
        let other = tagged(json!({"a": "time"}));
        assert_eq!(edged(&other, 0, [1920, 1080]).expect("it evaluates"), None);
    }
}
