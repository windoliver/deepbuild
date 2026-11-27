//! DeepBuild patch (windoliver/deepbuild#1427): what each identified element painted, for the replica's motion
//! recording. While a recorder is on, every div with an id notes its painted bounds and the opacity it painted at
//! (its own times its ancestors'); a hidden element paints nothing and so notes nothing. Off, it costs one check.

use std::cell::RefCell;

use crate::{Bounds, GlobalElementId, Pixels, Window};

thread_local! {
    static PAINTED: RefCell<Option<Vec<Painted>>> = const { RefCell::new(None) };
}

/// One identified element as it was painted.
#[derive(Clone, Debug)]
pub struct Painted {
    /// Its id path, root first.
    pub id: GlobalElementId,
    /// In window coordinates.
    pub bounds: Bounds<Pixels>,
    /// The opacity it painted at, 0 to 1.
    pub opacity: f32,
}

/// Turns the notes on, empty, or off.
pub fn note_paints(on: bool) {
    PAINTED.with(|painted| *painted.borrow_mut() = on.then(Vec::new));
}

/// What was painted since the last take, in paint order; empty while the notes are off.
pub fn take_painted() -> Vec<Painted> {
    PAINTED.with(|painted| painted.borrow_mut().as_mut().map(std::mem::take).unwrap_or_default())
}

impl Window {
    pub(crate) fn note_painted(&self, id: Option<&GlobalElementId>, bounds: Bounds<Pixels>) {
        let Some(id) = id else { return };
        PAINTED.with(|painted| {
            if let Some(list) = painted.borrow_mut().as_mut() {
                list.push(Painted { id: id.clone(), bounds, opacity: self.element_opacity });
            }
        });
    }
}
