//! Frame history in a live view (#173; canvas primitives: Look `look@1`: frame history): while
//! the view moves, each frame it shows is the last grid step at or before t, rendered once into
//! the window jittered by its own step and resolved with the window's other frames; a jump
//! renders the window again before t shows, and at rest history drops and the view draws its
//! frame of its own. A canonical render never comes here.

use deep_canvas::camera::Offsets;
use deep_canvas_scene3d::history::{
    self as rules, Entry, Grid, History, Mode, Move, Plan, Schedule,
};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::module::OUTPUT_PASS;
use deep_canvas_scene3d::scene::{Labels, Refused};
use deep_gpu::alloc::outside;
use deep_gpu::device::Device;
use deep_gpu::meter::Rung;
use deep_scene3d_render::history::{Window, RESOLVE_PASS};
use deep_scene3d_render::surface::{scaled, Surface, LABEL_PASS, OUTLINE_PASS};

use super::{Content, Drawing, Kit, Timer, View};

/// A live view's frame history.
pub struct Live {
    pub look: History,
    pub grid: Grid,
    schedule: Schedule,
    window: Option<Window>,
    /// The rung, render scale and hand's offsets its window's frames drew at.
    drew: Option<(Rung, f64, Offsets)>,
    /// The next frame jumps: a revision, a seek, the frame a scrub lets go on.
    pub jump: bool,
    /// The playhead is being dragged: frames draw without history.
    pub scrub: bool,
    /// The grid frames the last frame rendered, and the frames it resolved.
    pub rendered: u32,
    pub resolved: u32,
}

impl Live {
    /// A view's history at its fit's `window` (the look's, or shorter where memory asks), on the
    /// grid at the view's frame `cap`, keeping `past` frames past the window in a planted twin.
    pub fn new(look: &History, window: u32, cap: u32, past: u32) -> Result<Live, String> {
        Ok(Live {
            look: look.clone(),
            grid: Grid::of(look, cap, None, 0)?,
            schedule: Schedule::new(window.clamp(2, 16), past),
            window: None,
            drew: None,
            jump: true,
            scrub: false,
            rendered: 0,
            resolved: 0,
        })
    }

    /// The scale its frames render at: the look's with upscale, else the view's.
    pub fn scale(&self, view: f64) -> f64 {
        match self.look.mode {
            Mode::Upscale => self.look.scale.min(view),
            _ => view,
        }
    }

    /// What its window holds on the device, as it reports it (by the formats where it can't).
    pub fn bytes(&self) -> u64 {
        self.window
            .as_ref()
            .map_or(0, |w| w.bytes.unwrap_or(w.estimate()))
    }

    /// Its window's row in the memory report: what its formats hold and what the device says.
    pub fn row(&self) -> Option<(&'static str, u64, Option<u64>)> {
        self.window
            .as_ref()
            .map(|w| ("frame_history", w.estimate(), w.bytes))
    }

    /// The frames the window holds.
    pub fn frames(&self) -> u32 {
        self.schedule.entries().count() as u32
    }
}

impl View {
    /// Opens the view's frame history for `look` at its fit's `window` on the grid at its
    /// frame `cap`, or keeps the one it has at that window; none when the look keeps none.
    pub fn hold_history(
        &mut self,
        look: &Look3,
        window: u32,
        cap: u32,
        past: u32,
    ) -> Result<(), String> {
        if !look.history.on() || window == 0 {
            self.history = None;
        } else if self
            .history
            .as_ref()
            .is_none_or(|h| h.schedule.layers() != window + past)
        {
            self.history = Some(Live::new(&look.history, window, cap, past)?);
        }
        Ok(())
    }

    /// Frame history's plan for the frame at `t`, or `None` when the view has none or this draw
    /// is canonical.
    pub(super) fn history_plan(
        &mut self,
        t: i64,
        drawing: &Drawing,
        scale: f64,
        labels: &mut Labels,
    ) -> Result<Option<Plan>, Refused> {
        let (Some(live), Content::Scene(frames)) = (self.history.as_mut(), &mut self.frames) else {
            return Ok(None);
        };
        if drawing.canonical || drawing.rung == Rung::Placeholder {
            return Ok(None);
        }
        let k = live.grid.index(t);
        let size = scaled(self.size, live.scale(scale));
        let shown = live.schedule.entries().last().map(|e| e.k);
        let how = if live.scrub {
            Move::Scrub
        } else if live.jump
            || live.window.as_ref().is_none_or(|w| w.size != size)
            || live
                .drew
                .is_some_and(|(r, s, _)| r != drawing.rung || s != live.scale(scale))
        {
            Move::Jump
        } else if live.drew.is_some_and(|(.., o)| o != drawing.offsets) {
            Move::Hand
        } else if shown == Some(k) {
            Move::Play
        } else {
            // A new step: at rest when the scene there draws as the window's newest frame did.
            frames.at(live.grid.at(k), self.size, &drawing.offsets, labels)?;
            if self.prepared && !frames.changed() {
                Move::Rest
            } else {
                Move::Play
            }
        };
        Ok(Some(live.schedule.next(k, how)))
    }

    /// Renders the plan's grid frames into the window, each at its own step and jittered by it
    /// (all but the last submitted on their own, so each reads its own uniforms), then resolves
    /// the window into the slot, and draws thin lines, outlines and labels over it.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn draw_window(
        &mut self,
        device: &Device,
        kit: &Kit,
        look: &Look3,
        drawing: &Drawing,
        labels: &mut Labels,
        encoder: &mut wgpu::CommandEncoder,
        timer: &mut Timer,
        session: usize,
        scale: f64,
        render: &[Entry],
        resolve: &[Entry],
    ) -> Result<bool, Refused> {
        let mut live = self
            .history
            .take()
            .expect("a window's plan comes from its history");
        let drawn = self.render_window(
            device, kit, look, drawing, labels, encoder, timer, session, scale, render, resolve,
            &mut live,
        );
        self.history = Some(live);
        drawn
    }

    #[allow(clippy::too_many_arguments)]
    fn render_window(
        &mut self,
        device: &Device,
        kit: &Kit,
        look: &Look3,
        drawing: &Drawing,
        labels: &mut Labels,
        encoder: &mut wgpu::CommandEncoder,
        timer: &mut Timer,
        session: usize,
        scale: f64,
        render: &[Entry],
        resolve: &[Entry],
        live: &mut Live,
    ) -> Result<bool, Refused> {
        let scale = live.scale(scale);
        self.renderer.upscale = kit.upscale.clone();
        self.renderer.shadow_scale = if drawing.rung <= Rung::Shadows2x {
            2
        } else {
            1
        };
        self.renderer.surface = Surface {
            scale,
            ..self.surface
        };
        self.renderer.history = true;
        let internal = self.renderer.internal_size(self.size);
        self.drew = (
            scale,
            if internal == self.size {
                "none"
            } else {
                "temporal"
            },
        );
        let layers = live.schedule.layers();
        if live
            .window
            .as_ref()
            .is_none_or(|w| w.size != internal || w.layers != layers)
        {
            live.window = Some(Window::new(device, internal, layers));
        }
        let slot = self.next;
        self.next = (self.next + 1) % self.slots.len();
        self.shown = Some(slot);
        let slot_view = self.slots[slot].target().clone();
        let to_display = [
            f64::from(self.size[0]) / f64::from(internal[0]),
            f64::from(self.size[1]) / f64::from(internal[1]),
        ];
        for (i, e) in render.iter().enumerate() {
            let at = live.grid.at(e.k);
            if let Content::Scene(frames) = &mut self.frames {
                frames.at(at, self.size, &drawing.offsets, labels)?;
            }
            let j = rules::jitter(e.k);
            self.renderer.jitter = [j[0] * to_display[0], j[1] * to_display[1]];
            let window = live.window.as_mut().expect("made above");
            let layer = window.target(e.layer).clone();
            // Every frame but the last goes on its own, before the next one's uniforms are written.
            let mut own = (i + 1 < render.len())
                .then(|| outside(|| device.device.create_command_encoder(&Default::default())));
            let enc = own.as_mut().unwrap_or(&mut *encoder);
            if !self.record_frame(
                device, kit, look, at, drawing, internal, enc, timer, session,
            ) {
                return Ok(true);
            }
            let o = timer.start(OUTPUT_PASS, session);
            self.renderer.record_output(enc, &layer, timer.writes(o));
            timer.end(o);
            if let Content::Scene(frames) = &self.frames {
                window.store(&self.renderer, frames.scene(), j, e.layer, enc);
            }
            if let Some(own) = own {
                outside(|| device.queue.submit([own.finish()]));
            }
        }
        let prepared = match (&self.frames, live.window.as_mut()) {
            (Content::Scene(frames), Some(window)) => window.prepare(
                device,
                &kit.history,
                &self.renderer,
                &live.look,
                frames.scene(),
                resolve,
                self.size,
            ),
            _ => None,
        };
        if let Some(r) = &prepared {
            let i = timer.start(RESOLVE_PASS, session);
            r.record(encoder, &slot_view, timer.writes(i));
            timer.end(i);
        }
        // Line marks after the resolve test the display's depth it wrote.
        for (name, draw) in [
            (OUTLINE_PASS, self.renderer.outline_draw(false)),
            (LABEL_PASS, self.renderer.label_draw()),
        ] {
            if let Some(draw) = draw.map(|d| match &prepared {
                Some(r) => r.lines(d),
                None => d,
            }) {
                let i = timer.start(name, session);
                draw.record(encoder, &slot_view, timer.writes(i));
                timer.end(i);
            }
        }
        self.after(encoder, slot);
        self.still = None;
        live.rendered = render.len() as u32;
        live.resolved = resolve.len() as u32;
        live.drew = Some((drawing.rung, scale, drawing.offsets));
        live.jump = false;
        Ok(true)
    }
}
