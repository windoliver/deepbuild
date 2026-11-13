//! Issue #464: a 2D frame through its look's print finish on this machine's GPU, the print pass
//! the canvas's live frame runs (Look `look@1`: print finishes): a `display_only` snapshot beside
//! the Vello CPU one, and (#157) each frame an export draws, so a delivery holds the grain the
//! canvas shows and a look with grain raises the encoder's floor over frames that carry it.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use crate::evidence;
use crate::hub::{Hub, Show};
use crate::snapshot::{self, Drawn, Unfit};

impl Hub<'_> {
    /// `drawn` at `size` and time `t` through `def`'s print finish: the items no separation inks
    /// drawn over the ground, each separation's items drawn as its coverage, and the GPU's pass
    /// over them, its grain from hash(the frame at the finish's rate, the document's seed).
    /// `Ok(None)` when the finish is identity; `Err` when this machine's GPU can't run the pass.
    pub(crate) fn printed(
        &mut self,
        def: &Value,
        doc: &Value,
        drawn: &Drawn,
        size: [u16; 2],
        t: i64,
        instanced: &BTreeMap<String, (String, String)>,
    ) -> Result<Option<Vec<u8>>, ()> {
        let Ok(print) = deep_canvas_marks::print::read(def, &self.look.light, f64::from(size[0]))
        else {
            return Ok(None);
        };
        if print.is_identity() {
            return Ok(None);
        }
        let items = doc
            .get("items")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let role = |i: &Value| {
            i.pointer("/params/paint/fill/role")
                .or_else(|| i.pointer("/params/paint/stroke/role"))
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        let inks: Vec<BTreeSet<String>> = print
            .separations
            .iter()
            .map(|s| {
                items
                    .iter()
                    .filter(|(_, i)| role(i).as_deref() == Some(s.role.as_str()))
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .collect();
        let inked: BTreeSet<&String> = inks.iter().flatten().collect();
        let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
        let base = drawn.only(|i| !inked.iter().any(|k| k.as_str() == i));
        let (base, _) = self
            .renderer
            .raster_batched(&base, size, Some(ground), instanced);
        let covs: Vec<Vec<u8>> = inks
            .iter()
            .map(|set| {
                let only = drawn.only(|i| set.contains(i));
                self.renderer.raster_batched(&only, size, None, instanced).0
            })
            .collect();
        let seed = doc.get("seed").and_then(Value::as_u64).unwrap_or(0) as u32;
        let frame = deep_canvas_marks::print::frame(&print, seed, t, false);
        let px = [u32::from(size[0]), u32::from(size[1])];
        let placed = deep_scene3d_render::print::Placed {
            scale: 1.0 / drawn.scale(size),
            offset: [0.0, 0.0],
        };
        let params = deep_scene3d_render::print::params(
            &print,
            &frame,
            px,
            placed,
            ground,
            false,
            Default::default(),
        );
        let gpu = self.gpu3().ok_or(())?;
        gpu.print(&params, &base, &covs, px).ok_or(()).map(Some)
    }

    /// #157: the look an exported frame prints through: `look` (a look asset the document names)
    /// or else the document's own, when its finish isn't identity.
    pub(crate) fn print_look(&self, doc: &Value, look: Option<&str>) -> Option<Value> {
        let def = match look {
            Some(name) => self.look_named(doc, name),
            None => self.look_def_of(doc),
        }?;
        let print = deep_canvas_marks::print::read(&def, &self.look.light, 1.0).ok()?;
        (!print.is_identity()).then_some(def)
    }

    /// #157: an exported 2D frame's items through `def`'s print finish at `t`. A look that
    /// prints on a machine whose GPU can't run the pass stops the frame, never delivering it
    /// without its finish.
    pub(crate) fn print_part(
        &mut self,
        def: &Value,
        doc: &Value,
        drawn: &Drawn,
        size: [u16; 2],
        t: i64,
    ) -> Result<Option<Vec<u8>>, Unfit> {
        self.printed(def, doc, drawn, size, t, &BTreeMap::new())
            .map_err(|()| Unfit {
                code: "print_unavailable",
                path: "look/finish".into(),
            })
    }

    /// A look@1 the document names by asset, read from the evidence store (#1162's way).
    pub(crate) fn look_named(&self, doc: &Value, name: &str) -> Option<Value> {
        let sha = doc.pointer(&format!("/assets/{name}/sha256"))?.as_str()?;
        let bytes = (sha.len() == 64)
            .then(|| std::fs::read(self.scenario.evidence.join(&sha[..2]).join(&sha[2..])).ok())
            .flatten()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// #464: a 2D frame under a print look through the look's finish on this machine's GPU (the
    /// print pass, as the canvas's live frame runs it), kept as evidence and labelled
    /// `display_only`: an agent sees the grain and the halftone, and no check reads it.
    pub(crate) fn print_snapshot(
        &mut self,
        show: &Show,
        drawn: &Drawn,
        size: [u16; 2],
        instanced: &BTreeMap<String, (String, String)>,
    ) -> Option<Value> {
        let def = self.look_def.clone()?;
        let rgba = self
            .printed(&def, &show.document, drawn, size, show.t, instanced)
            .ok()??;
        let sha = evidence::put(&self.scenario.evidence, &snapshot::png(rgba, size)).ok()?;
        self.display_only.insert(sha.clone());
        Some(json!({"sha256": sha, "w": size[0], "h": size[1], "display_only": true}))
    }
}
