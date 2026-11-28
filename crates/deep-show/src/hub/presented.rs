//! Issues #806 and #2494: a presented revision as the hub hands it to the app.

use super::*;

/// `doc` with `layer`'s items alone, where other writers hold layers of it too (#1721).
pub(crate) fn only_layer<'d>(doc: &'d Value, layer: &str) -> Cow<'d, Value> {
    if doc["layers"].as_object().is_none_or(|l| l.len() < 2) {
        return Cow::Borrowed(doc);
    }
    let mut own = shared::drawable(doc);
    if let Some(Value::Object(items)) = own.get_mut("items") {
        items.retain(|_, i| i["layer"].as_str() == Some(layer));
    }
    Cow::Owned(own)
}

impl Hub<'_> {
    /// #806: a document's current revision as the hub records it once presented: its writer, the
    /// layer the connection stamped and its canonical document, kept in the evidence store by the
    /// hash it names; and every layer on screen on its panel, back to front, as the app draws them.
    pub fn presented_revision(&self, doc: &str) -> Option<Value> {
        let row = self.current(doc)?;
        let kinds = self.startup.sealed.kinds();
        let canonical = canonical_in(&row.doc, &kinds).ok()?;
        let hash = evidence::put(&self.scenario.evidence, canonical.bytes.as_bytes()).ok()?;
        let items: Vec<&String> = row.doc["items"].as_object()?.keys().collect();
        let panel = self.scenario.docs.get(doc)?;
        let rect = self.slot(panel)?;
        let size = snapshot::px([rect[2], rect[3]]);
        let record = self.record();
        let mut framed = BTreeSet::new();
        let layers: Vec<Value> = self
            .bands()
            .iter()
            .filter(|b| {
                b.doc
                    .as_deref()
                    .is_some_and(|d| self.scenario.docs.get(d) == Some(panel))
            })
            .map(|b| {
                let mut out = b.to_json();
                let current = b.doc.as_deref().and_then(|d| self.current(d));
                // What this writer's layer holds of its document (#1721).
                let own = current.map(|r| only_layer(&r.doc, &b.layer));
                // The presented document's items this layer draws; another document's layer on the
                // panel draws none of them.
                let drawn: Vec<String> = own
                    .as_ref()
                    .filter(|_| b.doc.as_deref() == Some(doc))
                    .and_then(|d| d["items"].as_object())
                    .map(|m| m.keys().cloned().collect())
                    .unwrap_or_default();
                // A 3D document is one frame, its writers' layers together: the first one names it.
                let three = current.filter(|r| deep_canvas_scene3d::scene::has_3d(&r.doc));
                let first = three.is_some() && framed.insert(b.doc.clone());
                let scene = three.filter(|_| first).and_then(|r| {
                    let form = self.expanded3d(&r.doc);
                    let form = form.as_ref().unwrap_or(&r.doc);
                    let bytes = match canonical_in(form, &kinds) {
                        Ok(c) => c.bytes.into_bytes(),
                        Err(_) => serde_json::to_vec(form).ok()?,
                    };
                    evidence::put(&self.scenario.evidence, &bytes).ok()
                });
                let over = three.filter(|_| first).map(|r| {
                    let flat = crate::over3d::only(&shared::drawable(&r.doc), |_| true);
                    (flat, self.look_of(&r.doc))
                });
                let flat = match (&over, three) {
                    (Some((flat, _)), _) => Some(flat),
                    (None, Some(_)) => None,
                    (None, None) => own.as_deref(),
                };
                let pictured = flat.filter(|d| {
                    three.is_none() || d["items"].as_object().is_some_and(|i| !i.is_empty())
                });
                let look =
                    (over.as_ref().and_then(|(_, named)| named.as_ref())).unwrap_or(&self.look);
                // The layer's picture in its panel, with no ground, as the compositor rasterizes it:
                // kept in the evidence store for the app to draw, by its hash.
                let picture = pictured.and_then(|d| {
                    let doc = d.as_object()?;
                    let mut renderer = Renderer::new();
                    let d = renderer
                        .prepare(
                            doc,
                            0,
                            &look.light,
                            look.status.as_ref(),
                            &record,
                            &self.scenario.evidence,
                        )
                        .ok()?;
                    let size = match three {
                        Some(_) => size.map(|side| side.saturating_mul(2)),
                        None => size,
                    };
                    let png = snapshot::png(renderer.raster(&d, size, None), size);
                    evidence::put(&self.scenario.evidence, &png).ok()
                });
                out["doc"] = json!(b.doc);
                out["items"] = json!(drawn);
                out["picture"] = json!(picture);
                if let Some(scene) = scene {
                    out["scene"] = json!(scene);
                }
                out
            })
            .collect();
        Some(json!({
            "doc": doc,
            "rev": row.rev,
            "hash": hash,
            "writer": row.writer.to_json(),
            "patch": row.patch,
            "layer": row.writer.layer_id(),
            "items": items,
            "panel": panel,
            "rect": rect,
            "layers": layers,
        }))
    }
}
