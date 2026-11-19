//! `test.boom` (#1415's acceptance README: test-boom): a kind whose operator panics at every frame
//! at or after its `at`, so a live session's frame freezes the session as an operator's panic
//! does. Only deep-show's `test-boom` build holds it.

use deep_canvas::grammar::{Time, TimeContext};
use deep_canvas::registry::{Module, Registrar};
use deep_canvas::schedule::{OpError, Val, View};

use super::{kind, manifest, str_param};

/// `at` in flicks, read at 60 fps; none when it isn't a time.
fn at_of(at: Option<&str>) -> Option<i64> {
    let ctx = TimeContext {
        frame_rate: (60, 1),
        markers: Default::default(),
    };
    Time::parse(at?).ok()?.resolve(&ctx).ok()
}

fn boom_out(v: &mut View<'_>) -> Result<(), OpError> {
    let at = at_of(v.item()?["params"]["at"].as_str());
    let t = v.t()?;
    if at.is_some_and(|at| t >= at) {
        panic!("test.boom: the frame at {t} flicks is at or after `at`");
    }
    v.write("test.boom.out", Val::typed(0.0))
}

fn register_boom(r: &mut Registrar) {
    r.kind(kind("test", "boom", vec![str_param("at", "1s")]), &[], "");
    r.array("test.boom.out", "f32", "item", "params", "items");
    r.operator("out", "items", &["self", "t"], &["test.boom.out"])
        .run(boom_out);
}

/// `test.boom`: an item whose frame at or after `at` panics.
pub fn boom() -> Module {
    Module {
        manifest: manifest("test.boom", &[]),
        register: register_boom,
    }
}
