//! A scene's views share what no camera changes (#3016). A mirror's view, each view inset's and
//! each look region's draw the scene the view draws, from a camera or a look of their own. What
//! depends on the scene alone (its meshes, its material maps and their groups, the environment's
//! cubes, the IES and DFG tables, and the log of the pipelines made for it) is held once, by the
//! renderer that draws the scene, and lent to each other view for its prepare and its jobs, so
//! the device holds it once. What depends on the camera stays each view's own: its targets and
//! stored samples, its culled lists and pyramid, its levels of detail, its light cut, its
//! cascades, its frame uniforms and its picks.

use super::*;

/// What a renderer's lights' group binds of the shared resources: the DFG table, the
/// environment's cubes and the IES atlas. A lent view binds them again when they change under it.
#[derive(Clone, Default, PartialEq)]
pub struct Bound {
    dfg: Option<wgpu::Buffer>,
    views: [Option<wgpu::TextureView>; 5],
}

impl Renderer {
    /// Moves what a scene's views share between this renderer and `view`, another view of the
    /// same scene, which draws from it as from its own until a second call moves it back. Each
    /// keeps its own log's warm-up flag, which steers what it does; what `view` makes meanwhile
    /// is listed as this renderer's warm-up or frame lists it.
    pub fn lend(&mut self, view: &mut Renderer) {
        use std::mem::swap;
        swap(&mut self.env.cube, &mut view.env.cube);
        swap(&mut self.env.to, &mut view.env.to);
        swap(&mut self.env.bg, &mut view.env.bg);
        self.lend_look(view);
    }

    /// [`Renderer::lend`] to a view drawing the scene in another look (a look region, #462): all
    /// but the environment's cubes, which its look may light from another sky.
    pub fn lend_look(&mut self, view: &mut Renderer) {
        use std::mem::swap;
        swap(&mut self.meshes, &mut view.meshes);
        swap(&mut self.sways, &mut view.sways);
        swap(&mut self.maps, &mut view.maps);
        swap(&mut self.op_binds, &mut view.op_binds);
        swap(&mut self.ies, &mut view.ies);
        swap(&mut self.dfg_buffer, &mut view.dfg_buffer);
        swap(&mut self.sheen_written, &mut view.sheen_written);
        self.trade_logs(view);
        view.log.lender_warming = self.log.warming;
    }

    /// The two renderers' pipeline logs traded, each keeping its own warm-up flag.
    pub(super) fn trade_logs(&mut self, view: &mut Renderer) {
        std::mem::swap(&mut self.log, &mut view.log);
        std::mem::swap(&mut self.log.warming, &mut view.log.warming);
    }

    /// Each view drawn beside this one in its last frame, by name (`mirror`, `inset <id>`, and
    /// `inset <id> mirror` for an inset's own mirror), with its own counts this frame and its own
    /// pipeline log: what it made itself, never what it drew from this view's.
    pub fn second_views(&self) -> Vec<(String, &Counts, &created::Log)> {
        let mut out = Vec::new();
        if let Some(m) = self.mirrorer.as_ref().filter(|_| self.mirroring) {
            out.push(("mirror".to_string(), &m.view.counts, &m.view.log));
        }
        for (id, r) in &self.views {
            out.push((format!("inset {id}"), &r.counts, &r.log));
            if let Some(m) = r.mirrorer.as_ref().filter(|_| r.mirroring) {
                out.push((format!("inset {id} mirror"), &m.view.counts, &m.view.log));
            }
        }
        out
    }

    /// The shared resources the lights' group would bind now.
    pub(super) fn shared_bound(&self) -> Bound {
        let cube = |c: &Option<env::Cube>| c.as_ref().map(|c| c.view.clone());
        Bound {
            dfg: Some(self.dfg_buffer.clone()),
            views: [
                cube(&self.env.cube),
                cube(&self.env.to),
                cube(&self.env.bg[0]),
                cube(&self.env.bg[1]),
                Some(self.ies.view.clone()),
            ],
        }
    }

    /// A lent view's lights' group, made again when the shared resources it binds changed.
    pub(super) fn bind_lent(&mut self, device: &Device) {
        if self.lent && self.bound != self.shared_bound() {
            self.rebind_lights(device);
        }
    }

    /// A new renderer for another view of the scene this one draws.
    pub(super) fn view_of(device: &Device, planted: Planted) -> Box<Renderer> {
        let mut r = Box::new(Renderer::new(device, planted));
        r.lent = true;
        r.pictured = true;
        r
    }
}
