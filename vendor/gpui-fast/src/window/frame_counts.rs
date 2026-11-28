//! DeepBuild patch (windoliver/deepbuild#1482): what each frame a window drew rendered, and what asked for it, for a
//! replica's per-frame report. `App::notify` notes the entity it was given; a draw notes whether it was a refresh,
//! each view it rendered or reused with its type, and how many elements it laid out. The profiler's view timing drops
//! views under 500 µs, so it can't count them. Counters only, no clocks: they stay on in every test-support build.

use std::{cell::RefCell, collections::HashMap};

use crate::{EntityId, Window, WindowId};

/// A replica's planted wrong program switches the keeping of a reused view's accessibility nodes off.
pub use super::a11y::reuse_plainly;

/// The most drawn frames kept untaken; older ones go first, so a harness that never takes them stays bounded.
const KEPT: usize = 4096;

/// One frame a window drew.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrameCounts {
    /// The window that drew it.
    pub window: WindowId,
    /// Each entity notified since the frame before it, once, in the order first notified.
    pub notified: Vec<EntityId>,
    /// Whether the frame was a refresh, which renders every view whatever was notified.
    pub refreshed: bool,
    /// Each view the frame rendered, in the order rendered.
    pub rendered: Vec<EntityId>,
    /// Each cached view the frame reused instead of rendering.
    pub reused: Vec<EntityId>,
    /// How many elements the frame laid out.
    pub elements: u64,
}

#[derive(Default)]
struct Counts {
    notified: Vec<EntityId>,
    drawing: Option<FrameCounts>,
    drawn: Vec<FrameCounts>,
    /// Each view seen rendering: its type and the view it was rendered in.
    views: HashMap<EntityId, (&'static str, Option<EntityId>)>,
    /// Each entity that notified itself, by its type.
    types: HashMap<EntityId, &'static str>,
}

thread_local! {
    static COUNTS: RefCell<Counts> = RefCell::new(Counts::default());
}

/// The frames drawn since the last take, oldest first.
pub fn take_frame_counts() -> Vec<FrameCounts> {
    COUNTS.with(|counts| std::mem::take(&mut counts.borrow_mut().drawn))
}

/// The entities notified since the last frame drew or the last take: what no frame has named yet.
pub fn take_notified() -> Vec<EntityId> {
    COUNTS.with(|counts| std::mem::take(&mut counts.borrow_mut().notified))
}

/// A view's type and the view it was last rendered in, once it has rendered.
pub fn view_of(entity: EntityId) -> Option<(&'static str, Option<EntityId>)> {
    COUNTS.with(|counts| counts.borrow().views.get(&entity).copied())
}

/// The type of an entity that was notified through its own context, which a model has no other way to give.
pub fn type_of(entity: EntityId) -> Option<&'static str> {
    COUNTS.with(|counts| {
        let counts = counts.borrow();
        let view = counts.views.get(&entity).map(|(name, _)| *name);
        view.or_else(|| counts.types.get(&entity).copied())
    })
}

/// An entity notified itself: its type.
pub(crate) fn name_entity(entity: EntityId, name: &'static str) {
    COUNTS.with(|counts| {
        counts.borrow_mut().types.insert(entity, name);
    });
}

/// An entity was notified.
pub(crate) fn note_notified(entity: EntityId) {
    COUNTS.with(|counts| {
        let mut counts = counts.borrow_mut();
        // A draw reads what's pending as its own, so a notify made while one runs is the next frame's.
        if !counts.notified.contains(&entity) {
            counts.notified.push(entity);
        }
    });
}

/// A view rendered, in the frame being drawn, inside the view `window` is rendering.
pub(crate) fn note_rendered(window: &Window, entity: EntityId, name: &'static str) {
    let parent = window
        .rendered_entity_stack
        .iter()
        .rev()
        .find(|view| **view != entity)
        .copied();
    COUNTS.with(|counts| {
        let mut counts = counts.borrow_mut();
        counts.views.insert(entity, (name, parent));
        if let Some(frame) = counts.drawing.as_mut() {
            frame.rendered.push(entity);
        }
    });
}

/// A cached view was reused, in the frame being drawn.
pub(crate) fn note_reused(entity: EntityId) {
    COUNTS.with(|counts| {
        if let Some(frame) = counts.borrow_mut().drawing.as_mut() {
            frame.reused.push(entity);
        }
    });
}

/// An element was laid out, in the frame being drawn.
pub(crate) fn note_laid_out() {
    COUNTS.with(|counts| {
        if let Some(frame) = counts.borrow_mut().drawing.as_mut() {
            frame.elements += 1;
        }
    });
}

impl Window {
    /// A draw begins: what was notified since the frame before is this frame's.
    pub(crate) fn begin_frame_counts(&self) {
        let (window, refreshed) = (self.handle.window_id(), self.refreshing);
        COUNTS.with(|counts| {
            let mut counts = counts.borrow_mut();
            let notified = std::mem::take(&mut counts.notified);
            counts.drawing = Some(FrameCounts {
                window,
                notified,
                refreshed,
                rendered: Vec::new(),
                reused: Vec::new(),
                elements: 0,
            });
        });
    }

    /// The draw ended: its frame is kept until taken.
    pub(crate) fn end_frame_counts(&self) {
        COUNTS.with(|counts| {
            let mut counts = counts.borrow_mut();
            if let Some(frame) = counts.drawing.take() {
                if counts.drawn.len() == KEPT {
                    counts.drawn.remove(0);
                }
                counts.drawn.push(frame);
            }
        });
    }
}
