//! #213: the physics module's between-step service `physics.cast@1` in this build: its entry in the
//! core's `logic.service@1`, which the physics module fills, and the service the hub binds for a
//! document's logic items, answering on the document's worlds through the backend's caster.

use std::cell::RefCell;
use std::rc::Rc;

use deep_canvas::registry::{Registrar, Sealed};
use deep_logic::services::Service;
use deep_physics_rapier::cast::{self, Caster};
use serde_json::Value;

/// `physics.cast@1` answering on `form`'s worlds and the core input track `track`; `late`, the
/// planted service that answers from each world after its next step.
pub(crate) fn service(form: &Value, track: &[Value], late: bool) -> Service {
    let caster = RefCell::new(Caster::new(form, track, late));
    Service {
        name: cast::NAME.into(),
        request: cast::REQUEST as u32,
        result: cast::RESULT as u32,
        max_per_step: cast::MAX_PER_STEP,
        fuel_per_request: cast::FUEL_PER_REQUEST,
        answer: Rc::new(move |t, r| caster.borrow_mut().answer(t, r)),
    }
}

/// The services this build binds for `form`'s logic items: `physics.cast@1` when the sealed set
/// holds the physics module's entry.
pub(crate) fn services(sealed: &Sealed, form: &Value, track: &[Value], late: bool) -> Vec<Service> {
    let held = sealed
        .registry("logic.service@1")
        .is_some_and(|r| r.entries.iter().any(|e| e.name == cast::NAME));
    if held {
        vec![service(form, track, late)]
    } else {
        Vec::new()
    }
}

/// The services the logic module's `logic.step` binds for `doc`'s logic items: `physics.cast@1`
/// on its worlds and its input track.
pub(crate) fn bound(doc: &Value) -> Vec<Service> {
    let track = doc.get("track").and_then(Value::as_array);
    vec![service(doc, track.map_or(&[], Vec::as_slice), false)]
}

/// The physics module's entry in `logic.service@1`.
pub(crate) fn register(r: &mut Registrar) {
    r.entry("logic.service@1", cast::NAME, cast::entry(), "R6");
}
