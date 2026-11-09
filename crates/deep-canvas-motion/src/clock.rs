//! Frames on demand on a virtual display (canvas primitives: Frame clock and scheduler): the clock
//! arms a frame only at the session's first vsync, at a pan, and when the presented frame's
//! `valid_until` passes, so a still document presents once and then nothing. With a view (#1487)
//! that `valid_until` counts only the items whose bounds meet it, so an item out of view stops
//! the clock; every frame is still the document evaluated at its `t`.

use serde_json::{Map, Value};

use crate::eval::{frame_with, Frame, Validity};
use crate::program::Program;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Evaluate and present only when the clock arms a frame.
    Armed,
    /// Evaluate and present at every vsync: the kit case's reference run.
    EveryVsync,
}

/// A region of the document, `[x, y, w, h]` in document u, y down.
pub type Rect = [f64; 4];

/// A 2D view over the document (#1487): the region it shows from vsync 0 and each pan, in order,
/// as the vsync time it arrives at and the region it shows from then on.
pub struct View<'a> {
    pub rect: Rect,
    pub pans: &'a [(i64, Rect)],
    /// Whether an evaluated item's bounds meet a region: [`meets`], or a proof surface's twin.
    pub meets: fn(&Value, &Rect) -> bool,
    /// #1487's planted wrong return: the frame a pan arms draws each item it brings into view
    /// with its data from the frame shown before the pan.
    pub stale_return: bool,
}

impl View<'_> {
    fn at(&self, t: i64) -> Rect {
        self.pans
            .iter()
            .take_while(|(at, _)| *at <= t)
            .last()
            .map_or(self.rect, |(_, r)| *r)
    }
}

/// Whether an evaluated item's bounds meet `rect`: its `params.box` (an array `[x, y, w, h]`, or
/// a text's `{w, h}`) about `at.pos`, scaled by `at.scale`, swept through every rotation, as the
/// interaction scope's flat hit tests read an item's box. An item with no box meets every view.
pub fn meets(item: &Value, rect: &Rect) -> bool {
    let n = |v: Option<&Value>| v.and_then(Value::as_f64);
    let at = |field: &str, i: usize| n(item.pointer(&format!("/at/{field}/{i}")));
    let pos = [at("pos", 0).unwrap_or(0.0), at("pos", 1).unwrap_or(0.0)];
    let scale = [at("scale", 0).unwrap_or(1.0), at("scale", 1).unwrap_or(1.0)];
    let b = item.pointer("/params/box");
    let local = match b.and_then(Value::as_array) {
        Some(b) => [n(b.first()), n(b.get(1)), n(b.get(2)), n(b.get(3))],
        None => [
            Some(0.0),
            Some(0.0),
            n(b.and_then(|b| b.get("w"))),
            n(b.and_then(|b| b.get("h"))),
        ],
    };
    let [Some(x), Some(y), Some(w), Some(h)] = local else {
        return true;
    };
    // A circle about the item's origin holding the box turned about that origin or its center.
    let (sx, sy) = (scale[0].abs(), scale[1].abs());
    let centre = deep_canvas::ops::hypot((x + w / 2.0) * sx, (y + h / 2.0) * sy);
    let r = centre + deep_canvas::ops::hypot(w * sx, h * sy) / 2.0;
    let dx = (rect[0] - pos[0])
        .max(0.0)
        .max(pos[0] - (rect[0] + rect[2]));
    let dy = (rect[1] - pos[1])
        .max(0.0)
        .max(pos[1] - (rect[1] + rect[3]));
    deep_canvas::ops::hypot(dx, dy) <= r
}

/// One vsync of a run: whether it presented, and the frame on screen after it.
pub struct Vsync<'a> {
    pub t: i64,
    pub presented: bool,
    pub shown: &'a Frame,
}

/// Runs the virtual display clock from 0 to `to` with a vsync every `period` flicks, calling
/// `each` once per vsync in order.
#[allow(clippy::too_many_arguments)]
pub fn run(
    doc: &Map<String, Value>,
    program: &Program,
    to: i64,
    period: i64,
    mode: Mode,
    validity: Validity,
    view: Option<&View<'_>>,
    mut each: impl FnMut(Vsync<'_>),
) {
    let mut shown: Option<Frame> = None;
    let mut state = program.state();
    let mut k: i64 = 0;
    while k * period <= to {
        let t = k * period;
        // A pan is input: it arms the vsync it arrives at.
        let panned = view.is_some_and(|v| v.pans.iter().any(|(at, _)| *at == t));
        let armed = match (&shown, mode) {
            (None, _) | (_, Mode::EveryVsync) => true,
            (Some(f), Mode::Armed) => panned || f.valid_until.is_some_and(|v| v <= t),
        };
        if armed {
            let mut f = frame_with(doc, program, t, validity, &mut state);
            if let Some(v) = view {
                let rect = v.at(t);
                let meets = |id: &str| f.items.get(id).is_none_or(|i| (v.meets)(i, &rect));
                f.valid_until = program.valid_until_in_view(&state, validity, meets);
                if let (true, true, Some(before)) = (v.stale_return, panned, &shown) {
                    let left = v.at(t - 1);
                    for (id, item) in &before.items {
                        if (v.meets)(item, &rect) && !(v.meets)(item, &left) {
                            f.items.insert(id.clone(), item.clone());
                        }
                    }
                }
            }
            shown = Some(f);
        }
        if let Some(f) = &shown {
            each(Vsync {
                t,
                presented: armed,
                shown: f,
            });
        }
        k += 1;
    }
}
