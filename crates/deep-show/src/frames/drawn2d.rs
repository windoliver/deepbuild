//! Issue #1561: a 2D document's frame under a drawn look, drawn on this machine's GPU through the
//! compositor and the passes the live window and `film2d` run (deep-groups-render), so a named
//! fill or line, paper, light and the 2D camera draw in `frames` as they do there. A look that
//! draws a document in its roles alone stays Vello CPU's, as every still does (Render-back).

use deep_canvas_marks::scene::Type;
use deep_canvas_motion::eval;
use deep_groups_render::frame2::{self, Frames2};

use crate::frames::Painted;
use crate::hub::Hub;
use crate::snapshot::{self, Unfit};

impl Hub<'_> {
    /// The frame of `doc`'s session at `t` as its look's drawn fields draw it, kept as a PNG:
    /// its SHA-256, or `None` inside when it can't be drawn (a machine with no GPU draws none,
    /// never a plain one). `None` for a document the look draws in its roles alone, and one with
    /// 3D writer layers or shots, which draw as before.
    pub(crate) fn drawn_png(
        &mut self,
        doc: &str,
        t: i64,
        drawing: &Painted,
    ) -> Option<Option<String>> {
        let def = self.look_def.as_ref().filter(|d| d["basis"] == "drawing")?;
        let session = self.sessions.get(doc)?;
        let document = session.document()?;
        let map = document.as_object()?;
        let frame = [document["size"][0].as_f64()?, document["size"][1].as_f64()?];
        let look = deep_canvas_marks::drawn::read_look(def, frame).ok()??;
        let roles = (self.look.light.iter())
            .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
            .collect();
        let Ok(page) = frame2::page_of(&look, map, &roles) else {
            return Some(None);
        };
        if !frame2::drawn_by(&look, &page, map) || deep_canvas_scene3d::scene::has_3d(document) {
            return None;
        }
        let program = crate::film::program_of(&self.sched, session)?;
        if crate::film::plan_of(&program, document).is_some() {
            return None;
        }
        let map = map.clone();
        let mut state = program.state();
        program.evaluate(t, eval::Validity::Full, &mut state);
        let items = eval::items(&map, &program, &state);
        let ty = Type {
            drawn: Some(look),
            ..self.look.light_type.clone()
        };
        let size = snapshot::px(frame);
        Some(
            self.drawn_rgba(&map, items, &ty, &page, t, size, drawing)
                .ok(),
        )
    }

    /// That frame's pixels: its items on the GPU, then the caption and the status marks over
    /// them as every frame draws them, in the evidence store as a `display_only` PNG.
    #[allow(clippy::too_many_arguments)]
    fn drawn_rgba(
        &mut self,
        doc: &serde_json::Map<String, serde_json::Value>,
        items: serde_json::Map<String, serde_json::Value>,
        ty: &Type,
        page: &deep_groups_render::drawn::Page,
        t: i64,
        size: [u16; 2],
        drawing: &Painted,
    ) -> Result<String, Unfit> {
        let unfit = |(code, path): (&'static str, String)| Unfit { code, path };
        // Opened on first use; then the GPU and the look are read side by side.
        let _ = self.gpu3();
        let gpu = (self.gpu3.as_mut().and_then(Option::as_mut))
            .ok_or_else(|| unfit(("gpu_unavailable", "frames".into())))?;
        let device = gpu.device().clone();
        let look = (&self.look.light, ty);
        let mut rgba = gpu
            .frames2
            .get_or_insert_with(|| Frames2::new(&device))
            .rgba(
                &device,
                doc,
                items,
                look,
                Some(page),
                t,
                size.map(u32::from),
            )
            .map_err(unfit)?;
        let drawn = self
            .renderer
            .prepare_drawing(drawing, &self.scenario.evidence)?;
        self.caption_over(&mut rgba, size);
        let status = self
            .renderer
            .raster(&drawn.part(drawn.view, false, true), size, None);
        snapshot::over(&mut rgba, &status);
        // A picture from this machine's GPU: an agent sees it, and no check reads it.
        let sha = self.put_png(rgba, size)?;
        self.display_only.insert(sha.clone());
        Ok(sha)
    }
}
