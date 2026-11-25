//! Issue #231: when an export's frame is the frame before it again (Export: "A frame whose
//! content key and view equal the previous frame's, and whose time is before the previous
//! frame's `valid_until`, reuses its raw buffer and hash"). A frame is read here once it is
//! evaluated and before it is drawn: its content by each layer's content key and its status
//! marks' canonical bytes (what the scheduler hands back unchanged is the same without a look),
//! its view by each side's camera, and the time it holds until by the motion program and by each
//! print finish's own steps. A frame that reads time some other way is never held.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas::schedule::{Canonical, Scheduler, Session as DocSession};
use deep_canvas_marks::modules::{Drawing, StatusDrawing};
use deep_canvas_marks::print;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::shots::Pose;
use serde_json::Value;

use crate::frames::Painted;
use crate::hub::{Hub, Planted};

/// What an evaluated frame shows, by which the next frame is told from it.
pub(super) struct Shown {
    drawing: Option<Arc<Drawing>>,
    status: Option<Arc<StatusDrawing>>,
    /// Each core box's rect and color, by their bits.
    boxes: Vec<([u64; 4], [u8; 3])>,
    size: [u64; 2],
    /// The caption layer's drawing, and each video's picture.
    caption: Option<Arc<crate::snapshot::Drawn>>,
    videos: BTreeMap<String, Arc<vello_cpu::Pixmap>>,
    /// The view: each side's camera and look, and the side whose status marks draw on top.
    view: (Vec<(Pose, Option<String>)>, usize),
    /// When the timeline next changes what it shows, by the motion program.
    until: Option<i64>,
    /// Each print finish's values at its time, which change at the finish's own rates.
    printed: Vec<print::Frame>,
}

/// The wrong reuses a test must catch.
#[derive(Clone, Copy, Default)]
pub(super) struct Lax {
    /// A frame is held whatever the frame before's `valid_until`.
    pub ignores_until: bool,
    /// What the frames show isn't compared: the content key of an item that reads a spectrum
    /// array leaves the band levels out, so nothing tells a frame from the one before.
    pub keyless: bool,
}

/// Whether `doc` holds a spectrum bake's array, which its mark sets' columns read.
pub(super) fn reads_spectrum(doc: &Value) -> bool {
    let arrays = doc.get("arrays").and_then(Value::as_object);
    (arrays.into_iter().flatten()).any(|(name, _)| name.starts_with("spectrum."))
}

/// Whether two frames hold the same thing: the one object, or two that `equal` finds equal.
fn same<T>(a: &Option<Arc<T>>, b: &Option<Arc<T>>, equal: impl Fn(&T, &T) -> bool) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => Arc::ptr_eq(a, b) || equal(a, b),
        (None, None) => true,
        _ => false,
    }
}

/// Two drawings of one content: the same frame and ground, and each layer by its content key.
fn drawn_alike(a: &Drawing, b: &Drawing) -> bool {
    let (a, b) = (&a.frame, &b.frame);
    a.size == b.size
        && a.ground == b.ground
        && a.layers.len() == b.layers.len()
        && (a.layers.iter().zip(&b.layers)).all(|(x, y)| x.id == y.id && x.key == y.key)
}

impl Shown {
    /// Whether the frame at `t`, which shows `next`, is this frame again: the same content
    /// through the same view, before this frame's `valid_until`.
    pub(super) fn holds(&self, next: &Shown, t: i64, lax: Lax) -> bool {
        let content = same(&self.drawing, &next.drawing, drawn_alike)
            && same(&self.status, &next.status, |a, b| {
                a.canonical_bytes() == b.canonical_bytes()
            })
            && self.boxes == next.boxes
            && self.size == next.size
            && same(&self.caption, &next.caption, |_, _| false)
            && self.videos.len() == next.videos.len()
            && (self.videos.iter().zip(&next.videos))
                .all(|((a, p), (b, q))| a == b && Arc::ptr_eq(p, q));
        let valid = self.until.is_none_or(|u| t < u) && self.printed == next.printed;
        (content || lax.keyless)
            && self.view == next.view
            && (valid || lax.ignores_until || lax.keyless)
    }
}

impl Hub<'_> {
    /// What the frame of `doc` at `t` shows, once [`Hub::export_evaluated`] gave it `painted`;
    /// `None` for a frame that is never held: one that draws in 3D, in a transition, under a
    /// look that boils, under the tour's pointer, or through a test build's or a planted
    /// program's own painting.
    pub(super) fn frame_shown(
        &mut self,
        sched: &Scheduler<'_>,
        session: &DocSession,
        doc: &Value,
        t: i64,
        painted: &Painted,
        opaque: bool,
    ) -> Option<Shown> {
        let shown = crate::played::at(doc, t);
        let doc = shown.as_ref();
        if deep_canvas_scene3d::scene::has_3d(doc)
            || self.has_boil(doc)
            || self.scenario.planted == Some(Planted::SeedsNoiseFromClock)
            || self.guard_planted(super::Guard::StoresRawFrames)
            || self.tour_pointer(doc, t, false).is_some()
        {
            return None;
        }
        #[cfg(feature = "test-export-guards")]
        if super::test_guards::reads_frame(doc) {
            return None;
        }
        let program = crate::film::program_of(sched, session);
        let sides = (program.as_ref()).and_then(|p| crate::film::sides(p, doc, t, false));
        if sides.as_ref().is_some_and(|s| s.mix.is_some()) {
            return None;
        }
        let until = program.as_ref().and_then(|p| {
            let mut state = p.state();
            p.evaluate(t, Validity::Full, &mut state);
            state.valid_until
        });
        // The looks the frame prints through: each side's, or the document's own.
        let looks: Vec<Option<String>> = match &sides {
            Some(s) => s.sides.iter().map(|side| side.look.clone()).collect(),
            None => vec![None],
        };
        let seed = doc.get("seed").and_then(Value::as_u64).unwrap_or(0) as u32;
        let printed = (looks.iter().filter(|_| opaque))
            .filter_map(|look| self.print_look(doc, look.as_deref()))
            .filter_map(|def| print::read(&def, &self.look.light, 1.0).ok())
            .map(|p| print::frame(&p, seed, t, false))
            .collect();
        let view = sides.map_or((Vec::new(), 0), |s| {
            let cameras = s.sides.into_iter().map(|side| (side.pose, side.look));
            (cameras.collect(), s.status)
        });
        Some(Shown {
            drawing: painted.drawing.clone(),
            status: painted.status.clone(),
            boxes: (painted.boxes.iter())
                .map(|b| (b.rect.map(f64::to_bits), b.color))
                .collect(),
            size: painted.size.map(f64::to_bits),
            caption: self.renderer.caption.clone(),
            videos: self.renderer.videos.clone(),
            view,
            until,
            printed,
        })
    }
}
