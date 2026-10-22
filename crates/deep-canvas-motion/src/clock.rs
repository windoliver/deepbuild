//! Frames on demand on a virtual display (canvas primitives: Frame clock and scheduler): the clock
//! arms a frame only at the session's first vsync and when the presented frame's `valid_until`
//! passes, so a still document presents once and then nothing.

use serde_json::{Map, Value};

use crate::eval::{frame, Frame, Validity};
use crate::program::Program;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Evaluate and present only when the clock arms a frame.
    Armed,
    /// Evaluate and present at every vsync: the kit case's reference run.
    EveryVsync,
}

/// One vsync of a run: whether it presented, and the frame on screen after it.
pub struct Vsync<'a> {
    pub t: i64,
    pub presented: bool,
    pub shown: &'a Frame,
}

/// Runs the virtual display clock from 0 to `to` with a vsync every `period` flicks, calling
/// `each` once per vsync in order.
pub fn run(
    doc: &Map<String, Value>,
    program: &Program,
    to: i64,
    period: i64,
    mode: Mode,
    validity: Validity,
    mut each: impl FnMut(Vsync<'_>),
) {
    let mut shown: Option<Frame> = None;
    let mut k: i64 = 0;
    while k * period <= to {
        let t = k * period;
        let armed = match (&shown, mode) {
            (None, _) | (_, Mode::EveryVsync) => true,
            (Some(f), Mode::Armed) => f.valid_until.is_some_and(|v| v <= t),
        };
        if armed {
            shown = Some(frame(doc, program, t, validity));
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
